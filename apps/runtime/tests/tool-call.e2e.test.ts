import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	ContextItem,
	LLMInferenceRequest,
	LLMInferenceResult,
	StreamEvent,
	ToolCallDTO,
	ToolDefinition,
	ToolResultDTO,
} from "@argentum/contracts";
import type { RuntimeStartupConfigResult } from "@argentum/environment";
import type { ContentResolver, LLMProvider } from "@argentum/llm-provider";
import { TelemetryWriter } from "@argentum/telemetry";
import { ToolRegistry } from "@argentum/tooling";

afterEach(() => {
	vi.doUnmock("@argentum/environment");
	vi.doUnmock("../src/tooling-registration.js");
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("runtime tool-call e2e happy path", () => {
	it("runs a tool-call turn through runCliTurn with real tooling composition, compaction, and terminal telemetry semantics", async () => {
		const workspace = await createTestWorkspace();
		const selectedToolName = "tool.selected";
		const decoyToolName = "tool.decoy";
		const toolTailMarker = "TAIL-MARKER-0041";
		const toolOutput = `Selected tool summary ${"x".repeat(5000)} ${toolTailMarker}`;
		const toolCalls: ToolCallDTO[] = [];
		let decoyExecutionCount = 0;
		let capturedRegistry: ToolRegistry | undefined;
		let provider: ToolCallHappyPathProvider | undefined;

		const flushSpy = vi.spyOn(TelemetryWriter.prototype, "flush");

		try {
			const { startRuntime } = await importRuntimeModuleWithMocks(workspace, {
				enabledTools: [selectedToolName, decoyToolName],
				mockToolingRegistration: () => ({
					registerRuntimeTools: (registry: ToolRegistry) => {
						capturedRegistry = registry;
						registry.register(
							makeToolDefinition(selectedToolName),
							async (call): Promise<ToolResultDTO> => {
								toolCalls.push(call);
								return {
									call_id: call.call_id,
									status: "success",
									human_summary: toolOutput,
									duration_ms: 7,
									truncated: false,
									retryable: false,
								};
							},
						);
						registry.register(
							makeToolDefinition(decoyToolName),
							async (call): Promise<ToolResultDTO> => {
								decoyExecutionCount += 1;
								return {
									call_id: call.call_id,
									status: "success",
									human_summary: `Unexpected decoy execution for ${call.tool_name}`,
									duration_ms: 1,
									truncated: false,
									retryable: false,
								};
							},
						);
					},
				}),
			});

			const ctx = await startRuntime("./config/runtime.example.json", {
				dbPath: ":memory:",
				llmProviderFactory: ({ resolveContent }) => {
					provider = new ToolCallHappyPathProvider(resolveContent, selectedToolName);
					return provider;
				},
			});

			const result = await ctx.runCliTurn("run the selected tool", {
				userId: "tool-user",
			});
			const session = ctx.gateway.resolveSession({
				channel: "terminal_cli",
				user_id: "tool-user",
			});
			const logFile = path.join(workspace.logs, `${result.sessionId}.jsonl`);
			const storedArtifacts = await readdir(workspace.artifacts);
			const telemetryEvents = await readTelemetryEvents(logFile);

			expect(result.finalEnvelope.state).toBe("completed");
			expect(result.finalEnvelope.step_count).toBe(2);
			expect(result.finalEnvelope.final_outcome).toBe("Tool call complete.");
			expect(session.session_id).toBe(result.sessionId);
			expect(session.session.has_active_turn).toBe(false);
			expect(session.session.queued_ingress_count).toBe(0);

			expect(capturedRegistry).toBeDefined();
			expect(
				capturedRegistry!.snapshotDefinitions().map((definition) => definition.name),
			).toEqual([selectedToolName, decoyToolName]);
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0]?.tool_name).toBe(selectedToolName);
			expect(decoyExecutionCount).toBe(0);

			expect(provider).toBeDefined();
			expect(provider!.requests).toHaveLength(2);
			expect(provider!.requests[0]?.availableToolNames).toEqual([
				selectedToolName,
				decoyToolName,
			]);
			expect(provider!.requests[1]?.availableToolNames).toEqual([
				selectedToolName,
				decoyToolName,
			]);
			expect(provider!.requests[0]?.contents.join("\n")).toContain("run the selected tool");
			expect(
				provider!.requests[1]?.contextItems.some((item) => item.layer === "tool_summary"),
			).toBe(true);
			expect(provider!.requests[1]?.contents.join("\n")).toContain("Selected tool summary");
			expect(provider!.requests[1]?.contents.join("\n")).not.toContain(toolTailMarker);

			const llmStartedEvents = telemetryEvents.filter((event) => event.kind === "llm.started");
			expect(llmStartedEvents).toHaveLength(2);
			for (const event of llmStartedEvents) {
				expect(event.payload).toMatchObject({
					request_id: expect.any(String),
					tool_count: 2,
				});
			}

			const toolPlanned = expectEvent(telemetryEvents, "tool.planned");
			const toolStarted = expectEvent(telemetryEvents, "tool.started");
			const toolFinished = expectEvent(telemetryEvents, "tool.finished");
			const compactionStarted = expectEvent(telemetryEvents, "memory.compaction_started");
			const compactionCommitted = expectEvent(telemetryEvents, "memory.compaction_committed");
			const responseCompleted = expectEvent(telemetryEvents, "response.completed");
			const turnCompleted = expectEvent(telemetryEvents, "turn.completed");

			expect(toolPlanned.payload).toMatchObject({
				call_id: toolStarted.payload.call_id,
				tool_name: selectedToolName,
			});
			expect(toolStarted.payload).toMatchObject({
				call_id: toolFinished.payload.call_id,
				tool_name: selectedToolName,
			});
			expect(toolFinished.payload).toMatchObject({
				call_id: toolStarted.payload.call_id,
				tool_name: selectedToolName,
				status: "success",
			});
			expect(typeof toolFinished.payload.duration_ms).toBe("number");
			expect((toolFinished.payload.duration_ms as number) >= 0).toBe(true);
			expect(compactionStarted.payload).toMatchObject({
				call_id: toolStarted.payload.call_id,
				compaction_revision: 0,
			});
			expect(compactionCommitted.payload).toMatchObject({
				call_id: toolStarted.payload.call_id,
				compaction_revision: 1,
				artifact_count: storedArtifacts.length,
			});
			expect(storedArtifacts).toHaveLength(1);
			expect(responseCompleted.payload).toMatchObject({
				response_kind: "respond",
				final_outcome: "Tool call complete.",
			});
			expect(turnCompleted.payload).toMatchObject({
				final_outcome: "Tool call complete.",
				step_count: 2,
			});

			expectOrderedKinds(telemetryEvents, [
				"llm.started",
				"tool.planned",
				"tool.started",
				"tool.finished",
				"memory.compaction_started",
				"memory.compaction_committed",
				"llm.started",
				"response.completed",
				"turn.completed",
			]);

			const stateChanges = telemetryEvents
				.filter((event) => event.kind === "turn.state_changed")
				.map((event) => `${String(event.payload.from_state)}->${String(event.payload.to_state)}`);
			expect(stateChanges).toEqual([
				"building_context->inferring",
				"inferring->validating",
				"validating->executing_tools",
				"executing_tools->compacting",
				"compacting->building_context",
				"building_context->inferring",
				"inferring->validating",
				"validating->responding",
				"responding->finalizing",
			]);

			expect(result.renderedOutput).toContain(`Using ${selectedToolName}...`);
			expect(result.renderedOutput).toContain(`${selectedToolName} completed`);
			expect(result.renderedOutput).toContain("Tool call complete.");
			expect(result.renderedOutput.indexOf(`Using ${selectedToolName}...`)).toBeLessThan(
				result.renderedOutput.indexOf(`${selectedToolName} completed`),
			);
			expect(result.renderedOutput.indexOf(`${selectedToolName} completed`)).toBeLessThan(
				result.renderedOutput.indexOf("Tool call complete."),
			);

			await ctx.shutdown();
			expect(flushSpy).toHaveBeenCalledOnce();
		} finally {
			await removeTestWorkspace(workspace.root);
		}
	});
});

interface TestWorkspace {
	readonly root: string;
	readonly bedrock: string;
	readonly working: string;
	readonly artifacts: string;
	readonly logs: string;
}

interface RuntimeModuleMockOptions {
	readonly enabledTools?: readonly string[];
	readonly mockToolingRegistration?: () => {
		readonly registerRuntimeTools: typeof import("../src/tooling-registration.js").registerRuntimeTools;
	};
}

class ToolCallHappyPathProvider implements LLMProvider {
	readonly #resolveContent: ContentResolver;
	readonly #selectedToolName: string;
	readonly requests: Array<{
		readonly turnId: string;
		readonly availableToolNames: readonly string[];
		readonly contents: readonly string[];
		readonly contextItems: readonly ContextItem[];
	}> = [];

	constructor(resolveContent: ContentResolver, selectedToolName: string) {
		this.#resolveContent = resolveContent;
		this.#selectedToolName = selectedToolName;
	}

	async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
		const contents = await Promise.all(
			request.context_items.map((item) => this.#resolveContent(item.content_ref)),
		);
		this.requests.push({
			turnId: request.turn_id,
			availableToolNames: request.available_tools.map((tool) => tool.name),
			contents,
			contextItems: [...request.context_items],
		});

		if (this.requests.length === 1) {
			return {
				request_id: request.request_id,
				decision: {
					decision_id: "tool-call-step-1",
					kind: "tool_calls",
					tool_calls: [
						{
							tool_name: this.#selectedToolName,
							arguments: { query: "status" },
						},
					],
				},
				normalization_status: "native_tool",
			};
		}

		return {
			request_id: request.request_id,
			decision: {
				decision_id: "tool-call-step-2",
				kind: "respond",
				message: "Tool call complete.",
			},
			normalization_status: "parsed_text",
		};
	}
}

async function importRuntimeModuleWithMocks(
	workspace: TestWorkspace,
	options: RuntimeModuleMockOptions = {},
) {
	const loadRuntimeStartupConfig = vi.fn(async () =>
		makeRuntimeStartupConfigResult(workspace, options.enabledTools),
	);

	vi.doMock("@argentum/environment", async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("@argentum/environment")
			>();

		return {
			...actual,
			loadRuntimeStartupConfig,
		};
	});

	if (options.mockToolingRegistration) {
		vi.doMock(
			"../src/tooling-registration.js",
			options.mockToolingRegistration,
		);
	}

	const runtimeModule = await import("../src/composition-root.js");

	return {
		startRuntime: runtimeModule.startRuntime,
		loadRuntimeStartupConfig,
	};
}

async function createTestWorkspace(): Promise<TestWorkspace> {
	const root = await mkdtemp(path.join(tmpdir(), "argentum-runtime-tool-call-"));
	const workspace = {
		root,
		bedrock: path.join(root, "bedrock"),
		working: path.join(root, "working"),
		artifacts: path.join(root, "artifacts"),
		logs: path.join(root, "logs"),
	} satisfies TestWorkspace;

	await Promise.all([
		mkdir(workspace.bedrock, { recursive: true }),
		mkdir(workspace.working, { recursive: true }),
		mkdir(workspace.artifacts, { recursive: true }),
		mkdir(workspace.logs, { recursive: true }),
	]);

	return workspace;
}

async function removeTestWorkspace(root: string): Promise<void> {
	await rm(root, { recursive: true, force: true });
}

async function readTelemetryEvents(filePath: string): Promise<StreamEvent[]> {
	const jsonl = await readFile(filePath, "utf-8");
	return jsonl
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as StreamEvent);
}

function makeRuntimeStartupConfigResult(
	workspace: TestWorkspace,
	enabledTools: readonly string[] = ["workspace.read_file"],
): RuntimeStartupConfigResult {
	return {
		configPath: path.join(workspace.root, "config", "runtime.json"),
		runtimeConfig: {
			workspace: {
				bedrock_root: workspace.bedrock,
				working_root: workspace.working,
				artifacts_root: workspace.artifacts,
				logs_root: workspace.logs,
			},
			provider: {
				name: "deepseek",
				model_id: "deepseek-chat",
				endpoint: "http://localhost:11434/v1",
			},
			governor: {
				max_inference_steps: 6,
				max_repair_attempts: 2,
				max_wall_clock_ms: 30000,
			},
			gateway: {
				max_queued_ingress_per_session: 8,
				queue_overflow_policy: "reject_newest",
			},
			tool_policy: {
				enabled_tools: [...enabledTools],
				enabled_secret_handles: ["provider/deepseek/default"],
				max_tool_runtime_ms: 10000,
				trusted_local_mode: true,
			},
			telemetry: {
				format: "jsonl",
				persist_events: true,
			},
		},
		workspaceRoots: {
			bedrock: workspace.bedrock,
			working: workspace.working,
			artifacts: workspace.artifacts,
			logs: workspace.logs,
		},
		runtimePolicy: {
			enabled_tools: [...enabledTools],
			enabled_secret_handles: ["provider/deepseek/default"],
			max_tool_runtime_ms: 10000,
			trusted_local_mode: true,
			execution_driver: "native",
			workspace_roots: {
				bedrock: workspace.bedrock,
				working: workspace.working,
				artifacts: workspace.artifacts,
				logs: workspace.logs,
			},
		},
		governorDefaults: {
			max_inference_steps: 6,
			max_repair_attempts: 2,
			max_wall_clock_ms: 30000,
			repair_attempts_used: 0 as const,
		},
		gatewayDefaults: {
			max_queued_ingress_per_session: 8,
			queue_overflow_policy: "reject_newest" as const,
		},
	};
}

function makeToolDefinition(name: string): ToolDefinition {
	return {
		name,
		description: `Description for ${name}`,
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
			additionalProperties: false,
		},
		side_effect_level: "read_only",
		path_scope: "none",
		required_secret_handles: [],
		network_access: "deny",
		default_timeout_ms: 30000,
	};
}

function expectOrderedKinds(
	events: readonly StreamEvent[],
	kinds: readonly StreamEvent["kind"][],
): void {
	let cursor = -1;

	for (const kind of kinds) {
		const nextIndex = events.findIndex(
			(event, index) => index > cursor && event.kind === kind,
		);
		expect(nextIndex, `Expected ${kind} after index ${cursor}.`).toBeGreaterThan(
			cursor,
		);
		cursor = nextIndex;
	}
}

function expectEvent(
	events: readonly StreamEvent[],
	kind: StreamEvent["kind"],
): StreamEvent {
	const event = events.find((candidate) => candidate.kind === kind);
	if (!event) {
		throw new Error(`Expected telemetry to contain ${kind}.`);
	}

	return event;
}