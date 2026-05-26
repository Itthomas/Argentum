import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type ContextItem,
	type LLMInferenceRequest,
	type LLMInferenceResult,
	type StreamEvent,
	type ToolDefinition,
	type ToolResultDTO,
} from "@argentum/contracts";
import { CompactionPolicy } from "@argentum/agentic-core";
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

describe("runtime blocked grant tool path", () => {
	it("aborts deterministically on a blocked grant without executing the denied tool implementation", async () => {
		const workspace = await createTestWorkspace();
		const blockedToolName = "tool.blocked.selected";
		const expectedReason = `Tool '${blockedToolName}' is not in the enabled_tools policy.`;
		const expectedErrorCode = "tool_disabled";
		const expectedAbortReason = `Blocked [${expectedErrorCode}]: ${expectedReason}`;
		const compactSpy = vi.spyOn(CompactionPolicy.prototype, "compact");
		const flushSpy = vi.spyOn(TelemetryWriter.prototype, "flush");
		let deniedExecutionCount = 0;
		let provider: BlockedGrantProvider | undefined;

		try {
			const { startRuntime } = await importRuntimeModuleWithMocks(workspace, {
				enabledTools: [],
				mockToolingRegistration: () => ({
					registerRuntimeTools: (registry: ToolRegistry) => {
						registry.register(
							makeToolDefinition(blockedToolName),
							async (call): Promise<ToolResultDTO> => {
								deniedExecutionCount += 1;
								return {
									call_id: call.call_id,
									status: "success",
									human_summary: `Unexpected execution for ${call.tool_name}`,
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
					provider = new BlockedGrantProvider(
						resolveContent,
						blockedToolName,
						expectedAbortReason,
					);
					return provider;
				},
			});

			const result = await ctx.runCliTurn("run the blocked tool", {
				userId: "blocked-user",
			});
			const session = ctx.gateway.resolveSession({
				channel: "terminal_cli",
				user_id: "blocked-user",
			});
			const logFile = path.join(workspace.logs, `${result.sessionId}.jsonl`);
			const telemetryEvents = await readTelemetryEvents(logFile);
			const blockedEvent = expectSingleEvent(telemetryEvents, "tool.blocked");
			const turnAbortedEvent = expectSingleEvent(telemetryEvents, "turn.aborted");
			const blockedCompactionInput = compactSpy.mock.calls
				.map((call) => call[0])
				.find((candidate): candidate is ToolResultDTO => {
					return (
						typeof candidate === "object" &&
						candidate !== null &&
						"status" in candidate &&
						(candidate as ToolResultDTO).status === "blocked"
					);
				});

			expect(result.finalEnvelope.state).toBe("aborted");
			expect(result.finalEnvelope.step_count).toBe(2);
			expect(result.finalEnvelope.final_outcome).toBeUndefined();
			expect(session.session.has_active_turn).toBe(false);
			expect(session.session.queued_ingress_count).toBe(0);
			expect(deniedExecutionCount).toBe(0);

			expect(provider).toBeDefined();
			expect(provider!.requests).toHaveLength(2);
			expect(provider!.blockedSummary).toContain(`Blocked [${expectedErrorCode}]`);
			expect(provider!.blockedSummary).toContain(expectedReason);

			expect(blockedCompactionInput).toBeDefined();
			expect(blockedCompactionInput).toMatchObject({
				call_id: blockedEvent.payload.call_id,
				status: "blocked",
				error_code: expectedErrorCode,
				human_summary: `Tool '${blockedToolName}' denied: ${expectedReason}`,
			});

			expect(blockedEvent.payload).toMatchObject({
				call_id: expect.any(String),
				tool_name: blockedToolName,
				reason: expectedReason,
				error_code: expectedErrorCode,
			});
			expect(turnAbortedEvent.payload).toMatchObject({
				reason: expectedAbortReason,
				error_code: "runtime_abort",
			});

			expect(telemetryEvents.some((event) => event.kind === "validation.failed")).toBe(
				false,
			);
			expect(telemetryEvents.some((event) => event.kind === "tool.started")).toBe(false);
			expect(telemetryEvents.some((event) => event.kind === "tool.finished")).toBe(false);

			expectOrderedKinds(telemetryEvents, [
				"llm.started",
				"tool.blocked",
				"memory.compaction_started",
				"memory.compaction_committed",
				"llm.started",
				"turn.aborted",
			]);

			expect(result.renderedOutput).toContain(
				`${blockedToolName} blocked: ${expectedReason}`,
			);
			expect(result.renderedOutput).toContain(
				`Turn aborted: ${expectedAbortReason}`,
			);
			expect(result.renderedOutput).not.toContain(`Using ${blockedToolName}...`);
			expect(result.renderedOutput).not.toContain(
				`${blockedToolName} completed`,
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

class BlockedGrantProvider implements LLMProvider {
	readonly #resolveContent: ContentResolver;
	readonly #blockedToolName: string;
	readonly #abortReason: string;
	readonly requests: Array<{
		readonly turnId: string;
		readonly availableToolNames: readonly string[];
		readonly contents: readonly string[];
		readonly contextItems: readonly ContextItem[];
	}> = [];
	blockedSummary = "";

	constructor(
		resolveContent: ContentResolver,
		blockedToolName: string,
		abortReason: string,
	) {
		this.#resolveContent = resolveContent;
		this.#blockedToolName = blockedToolName;
		this.#abortReason = abortReason;
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
					decision_id: "blocked-tool-step-1",
					kind: "tool_calls",
					tool_calls: [
						{
							tool_name: this.#blockedToolName,
							arguments: { query: "status" },
						},
					],
				},
				normalization_status: "native_tool",
			};
		}

		this.blockedSummary =
			this.requests[1]?.contextItems
				.map((item, index) => ({
					item,
					content: contents[index] ?? "",
				}))
				.find((entry) => entry.item.layer === "tool_summary")?.content ?? "";

		return {
			request_id: request.request_id,
			decision: {
				decision_id: "blocked-tool-step-2",
				kind: "abort",
				message: this.#abortReason,
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
	const root = await mkdtemp(path.join(tmpdir(), "argentum-runtime-blocked-grant-"));
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

function expectSingleEvent(
	events: readonly StreamEvent[],
	kind: StreamEvent["kind"],
): StreamEvent {
	const matching = events.filter((event) => event.kind === kind);
	expect(matching, `Expected exactly one telemetry event ${kind}.`).toHaveLength(1);
	return matching[0]!;
}