import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	ContentRef,
	ContextItem,
	LLMInferenceRequest,
	LLMInferenceResult,
	StreamEvent,
	ToolCallDTO,
	ToolDefinition,
	ToolResultDTO,
} from "@argentum/contracts";
import {
	StaticSecretHandleResolver,
	type RuntimeStartupConfigResult,
	type SecretHandleResolver,
	} from "@argentum/environment";
import type {
	ContentResolver,
	LLMProvider,
	TraceWriter,
} from "@argentum/llm-provider";
import { ToolRegistry } from "@argentum/tooling";

afterEach(() => {
	vi.doUnmock("@argentum/environment");
	vi.doUnmock("../src/tooling-registration.js");
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("runtime secret tool no-leak e2e", () => {
	it("runs a secret-using tool through runCliTurn without leaking the resolved secret into emitted runtime surfaces", async () => {
		const workspace = await createTestWorkspace();
		const secretHandle = "provider/deepseek/default";
		const secretValue = "runtime-secret-0043-value";
		const selectedToolName = "tool.secret.selected";
		const decoyToolName = "tool.secret.decoy";
		const selectedToolSummary = "Secret-backed status ok.";
		const toolCalls: ToolCallDTO[] = [];
		const toolResults: ToolResultDTO[] = [];
		let decoyExecutionCount = 0;
		let observedResolvedSecretValue: string | undefined;
		let provider: SecretToolHappyPathProvider | undefined;

		const secretResolver: SecretHandleResolver =
			new StaticSecretHandleResolver({
				[secretHandle]: secretValue,
			});

		try {
			const { startRuntime } = await importRuntimeModuleWithMocks(workspace, {
				enabledTools: [selectedToolName, decoyToolName],
				enabledSecretHandles: [secretHandle],
				mockToolingRegistration: () => ({
					registerRuntimeTools: (registry: ToolRegistry) => {
						registry.register(
							makeToolDefinition(selectedToolName, [secretHandle]),
							async (call): Promise<ToolResultDTO> => {
								toolCalls.push(call);
								const resolution = await secretResolver.resolve(
									call.grant.env_secret_handles,
								);

								expect(resolution.ok).toBe(true);
								if (!resolution.ok) {
									throw resolution.error;
								}

								observedResolvedSecretValue = resolution.values[secretHandle];

								const result: ToolResultDTO = {
									call_id: call.call_id,
									status: "success",
									human_summary: selectedToolSummary,
									duration_ms: 5,
									truncated: false,
									retryable: false,
								};

								toolResults.push(result);
								return result;
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
				llmProviderFactory: ({ resolveContent, writeTrace }) => {
					provider = new SecretToolHappyPathProvider(
						resolveContent,
						selectedToolName,
						writeTrace,
					);
					return provider;
				},
			});

			const result = await ctx.runCliTurn("run the secret-backed tool", {
				userId: "secret-user",
			});
			const logFile = path.join(workspace.logs, `${result.sessionId}.jsonl`);
			const telemetryJsonl = await readFile(logFile, "utf-8");
			const telemetryEvents = parseTelemetryEvents(telemetryJsonl);
			const logFiles = await readWorkspaceFilesRecursive(workspace.logs);
			const workingFiles = await readWorkspaceFilesRecursive(workspace.working);
			const artifactFiles = await readWorkspaceFilesRecursive(workspace.artifacts);
			const structuredPayloadBodies = await readStructuredPayloadBodies(
				workspace,
				toolResults,
			);
			const providerRequests = provider?.requests ?? [];
			const providerTraceRefs = provider?.traceRefs ?? [];
			const providerTraceBodies = await Promise.all(
				providerTraceRefs.map((ref) => readContentRefBody(workspace, ref)),
			);
			const secondRequest = providerRequests[1];
			const toolSummaryBodies =
				secondRequest?.contextItems
					.map((item, index) => ({
						item,
						content: secondRequest.contents[index] ?? "",
					}))
					.filter((entry) => entry.item.layer === "tool_summary")
					.map((entry) => entry.content) ?? [];

			expect(result.finalEnvelope.state).toBe("completed");
			expect(result.finalEnvelope.final_outcome).toBe(
				"Secret-backed tool call complete.",
			);
			expect(result.finalEnvelope.step_count).toBe(2);
			expect(observedResolvedSecretValue).toBe(secretValue);

			expect(providerRequests).toHaveLength(2);
			expect(providerRequests[0]?.availableToolNames).toContain(selectedToolName);
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0]?.tool_name).toBe(selectedToolName);
			expect(toolCalls[0]?.grant.env_secret_handles).toEqual([secretHandle]);
			expect(decoyExecutionCount).toBe(0);
			expect(toolResults).toHaveLength(1);
			expect(toolResults[0]?.human_summary).toBe(selectedToolSummary);
			expect(toolResults[0]?.artifact_refs).toBeUndefined();
			expect(toolResults[0]?.structured_payload_ref).toBeUndefined();

			expect(secondRequest).toBeDefined();
			expect(
				secondRequest?.contextItems.filter((item) => item.layer === "tool_summary"),
			).toHaveLength(1);
			expect(toolSummaryBodies).toEqual([selectedToolSummary]);
			expect(result.renderedOutput).toContain(`Using ${selectedToolName}...`);
			expect(result.renderedOutput).toContain(`${selectedToolName} completed`);
			expect(result.renderedOutput).toContain(
				"Secret-backed tool call complete.",
			);
			expect(result.renderedOutput).not.toContain(decoyToolName);
			expect(result.renderedOutput).not.toContain(
				`${selectedToolName} blocked:`,
			);
			expect(result.renderedOutput).not.toContain(
				`${decoyToolName} blocked:`,
			);

			expect(providerTraceRefs.length).toBeGreaterThan(0);
			expect(workingFiles.length).toBeGreaterThan(0);
			expect(artifactFiles).toHaveLength(0);
			expect(structuredPayloadBodies).toHaveLength(0);

			assertSecretAbsentFromString(secretValue, result.renderedOutput, "rendered output");
			assertSecretAbsentFromString(secretValue, telemetryJsonl, "telemetry JSONL");
			assertSecretAbsentFromUnknown(secretValue, result.renderedEvents, "rendered stream events");
			assertSecretAbsentFromUnknown(secretValue, telemetryEvents, "parsed telemetry events");
			assertSecretAbsentFromUnknown(secretValue, logFiles, "persisted log files");
			assertSecretAbsentFromUnknown(secretValue, workingFiles, "persisted working-area files");
			assertSecretAbsentFromUnknown(secretValue, toolCalls, "ToolCallDTO values");
			assertSecretAbsentFromUnknown(secretValue, toolResults, "ToolResultDTO values");
			assertSecretAbsentFromUnknown(secretValue, result.finalEnvelope, "final turn envelope");
			assertSecretAbsentFromUnknown(secretValue, providerRequests.map((request) => request.contextItems), "provider request context items");
			assertSecretAbsentFromUnknown(secretValue, providerRequests.map((request) => request.availableToolNames), "provider available tool names");
			assertSecretAbsentFromUnknown(secretValue, providerTraceRefs, "provider raw_trace_ref values");
			assertSecretAbsentFromUnknown(secretValue, providerTraceBodies, "provider raw trace bodies");
			for (const [index, request] of providerRequests.entries()) {
				assertSecretAbsentFromUnknown(
					secretValue,
					request.availableTools,
					`provider visible available_tools payload for inference step ${index + 1}`,
				);
				assertSecretAbsentFromUnknown(
					secretValue,
					request.request,
					`full provider request payload for inference step ${index + 1}`,
				);
			}
			for (const request of providerRequests) {
				for (const content of request.contents) {
					assertSecretAbsentFromString(
						secretValue,
						content,
						"committed ContextItem content",
					);
				}
			}

			const toolFamilyEvents = telemetryEvents.filter((event) =>
				event.kind.startsWith("tool."),
			);
			const renderedToolFamilyEvents = result.renderedEvents.filter((event) =>
				event.kind.startsWith("tool."),
			);
			const toolPlannedEvents = toolFamilyEvents.filter(
				(event) => event.kind === "tool.planned",
			);
			const toolStartedEvents = toolFamilyEvents.filter(
				(event) => event.kind === "tool.started",
			);
			const toolFinishedEvents = toolFamilyEvents.filter(
				(event) => event.kind === "tool.finished",
			);
			const toolBlockedEvents = toolFamilyEvents.filter(
				(event) => event.kind === "tool.blocked",
			);
			const renderedToolBlockedEvents = renderedToolFamilyEvents.filter(
				(event) => event.kind === "tool.blocked",
			);
			const toolPlannedEvent = expectSingleEvent(toolPlannedEvents, "tool.planned");
			const toolStartedEvent = expectSingleEvent(toolStartedEvents, "tool.started");
			const toolFinishedEvent = expectSingleEvent(toolFinishedEvents, "tool.finished");

			expect(toolBlockedEvents).toHaveLength(0);
			expect(renderedToolBlockedEvents).toHaveLength(0);
			expect(toolPlannedEvent.payload).toMatchObject({
				call_id: toolStartedEvent.payload.call_id,
				tool_name: selectedToolName,
			});
			expect(toolStartedEvent.payload).toMatchObject({
				call_id: toolFinishedEvent.payload.call_id,
				tool_name: selectedToolName,
			});
			expect(toolFinishedEvent.payload).toMatchObject({
				call_id: toolStartedEvent.payload.call_id,
				tool_name: selectedToolName,
				status: "success",
			});
			for (const event of toolFamilyEvents) {
				if ("tool_name" in event.payload) {
					expect(event.payload.tool_name).toBe(selectedToolName);
					expect(event.payload.tool_name).not.toBe(decoyToolName);
				}
			}
			for (const event of renderedToolFamilyEvents) {
				if ("tool_name" in event.payload) {
					expect(event.payload.tool_name).toBe(selectedToolName);
					expect(event.payload.tool_name).not.toBe(decoyToolName);
				}
			}

			await ctx.shutdown();
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
	readonly enabledSecretHandles?: readonly string[];
	readonly mockToolingRegistration?: () => {
		readonly registerRuntimeTools: typeof import("../src/tooling-registration.js").registerRuntimeTools;
	};
}

class SecretToolHappyPathProvider implements LLMProvider {
	readonly #resolveContent: ContentResolver;
	readonly #selectedToolName: string;
	readonly #writeTrace: TraceWriter | undefined;
	readonly requests: Array<{
		readonly turnId: string;
		readonly availableToolNames: readonly string[];
		readonly availableTools: LLMInferenceRequest["available_tools"];
		readonly contents: readonly string[];
		readonly contextItems: readonly ContextItem[];
		readonly request: LLMInferenceRequest;
	}> = [];
	readonly traceRefs: ContentRef[] = [];

	constructor(
		resolveContent: ContentResolver,
		selectedToolName: string,
		writeTrace?: TraceWriter,
	) {
		this.#resolveContent = resolveContent;
		this.#selectedToolName = selectedToolName;
		this.#writeTrace = writeTrace;
	}

	async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
		const contents = await Promise.all(
			request.context_items.map((item) => this.#resolveContent(item.content_ref)),
		);
		this.requests.push({
			turnId: request.turn_id,
			request: structuredClone(request),
			availableToolNames: request.available_tools.map((tool) => tool.name),
			availableTools: structuredClone(request.available_tools),
			contents,
			contextItems: [...request.context_items],
		});

		const response =
			this.requests.length === 1
				? {
					decision: {
						decision_id: "secret-tool-step-1",
						kind: "tool_calls" as const,
						tool_calls: [
							{
								tool_name: this.#selectedToolName,
								arguments: { query: "status" },
							},
						],
					},
					normalization_status: "native_tool" as const,
				}
				: {
					decision: {
						decision_id: "secret-tool-step-2",
						kind: "respond" as const,
						message: "Secret-backed tool call complete.",
					},
					normalization_status: "parsed_text" as const,
				};

		const rawTraceRef = await this.writeRawTrace(request, response.decision);
		const result: LLMInferenceResult = {
			request_id: request.request_id,
			decision: response.decision,
			normalization_status: response.normalization_status,
		};
		if (rawTraceRef !== undefined) {
			(result as { raw_trace_ref?: ContentRef }).raw_trace_ref = rawTraceRef;
		}

		return result;
	}

	private async writeRawTrace(
		request: LLMInferenceRequest,
		decision: LLMInferenceResult["decision"],
	): Promise<ContentRef | undefined> {
		if (!this.#writeTrace) {
			return undefined;
		}

		const rawTraceRef: ContentRef = {
			ref_id: `${request.request_id}-trace`,
			kind: "trace",
			storage_area: "logs",
			locator: `secret-tool-provider/${request.request_id}/trace.json`,
			retention: "session",
		};
		await this.#writeTrace(rawTraceRef, {
			request,
			response: {
				decision,
			},
		});
		this.traceRefs.push(rawTraceRef);
		return rawTraceRef;
	}
}

async function importRuntimeModuleWithMocks(
	workspace: TestWorkspace,
	options: RuntimeModuleMockOptions = {},
) {
	const loadRuntimeStartupConfig = vi.fn(async () =>
		makeRuntimeStartupConfigResult(
			workspace,
			options.enabledTools,
			options.enabledSecretHandles,
		),
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
	const root = await mkdtemp(path.join(tmpdir(), "argentum-runtime-secret-tool-"));
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

function parseTelemetryEvents(jsonl: string): StreamEvent[] {
	return jsonl
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as StreamEvent);
}

async function readWorkspaceFilesRecursive(
	root: string,
	relativePath = "",
): Promise<
	readonly {
		readonly relativePath: string;
		readonly content: string;
	}[]
> {
	const directoryPath = path.join(root, relativePath);
	const entries = await readdir(directoryPath, { withFileTypes: true });
	const files: Array<{ relativePath: string; content: string }> = [];

	for (const entry of entries) {
		const childRelativePath = path.join(relativePath, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await readWorkspaceFilesRecursive(root, childRelativePath)));
			continue;
		}

		const filePath = path.join(root, childRelativePath);
		files.push({
			relativePath: childRelativePath,
			content: await readFile(filePath, "utf-8"),
		});
	}

	return files;
}

async function readStructuredPayloadBodies(
	workspace: TestWorkspace,
	toolResults: readonly ToolResultDTO[],
): Promise<readonly string[]> {
	const bodies: string[] = [];
	for (const result of toolResults) {
		for (const ref of result.artifact_refs ?? []) {
			bodies.push(await readContentRefBody(workspace, ref));
		}

		if (result.structured_payload_ref) {
			bodies.push(
				await readContentRefBody(workspace, result.structured_payload_ref),
			);
		}
	}

	return bodies;
}

async function readContentRefBody(
	workspace: TestWorkspace,
	ref: ContentRef,
): Promise<string> {
	const roots: Record<ContentRef["storage_area"], string> = {
		bedrock: workspace.bedrock,
		working: workspace.working,
		artifacts: workspace.artifacts,
		logs: workspace.logs,
	};
	const filePath = path.join(roots[ref.storage_area], ref.locator);
	return readFile(filePath, "utf-8");
}

function makeRuntimeStartupConfigResult(
	workspace: TestWorkspace,
	enabledTools: readonly string[] = ["workspace.read_file"],
	enabledSecretHandles: readonly string[] = ["provider/deepseek/default"],
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
				enabled_secret_handles: [...enabledSecretHandles],
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
			enabled_secret_handles: [...enabledSecretHandles],
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

function makeToolDefinition(
	name: string,
	requiredSecretHandles: readonly string[] = [],
): ToolDefinition {
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
		required_secret_handles: [...requiredSecretHandles],
		network_access: "deny",
		default_timeout_ms: 30000,
	};
}

function assertSecretAbsentFromString(
	secretValue: string,
	value: string,
	surface: string,
): void {
	expect(value, `${surface} should not contain the raw secret value.`).not.toContain(
		secretValue,
	);
}

function assertSecretAbsentFromUnknown(
	secretValue: string,
	value: unknown,
	surface: string,
): void {
	assertSecretAbsentFromString(secretValue, JSON.stringify(value), surface);
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

function expectSingleEvent(
	events: readonly StreamEvent[],
	kind: StreamEvent["kind"],
): StreamEvent {
	expect(events, `Expected exactly one telemetry event ${kind}.`).toHaveLength(1);
	return events[0]!;
}