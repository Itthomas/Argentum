import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	ActionDecision,
	ContextItem,
	LLMInferenceRequest,
	LLMInferenceResult,
	StreamEvent,
} from "@argentum/contracts";
import type { RuntimeStartupConfigResult } from "@argentum/environment";
import type { ContentResolver, LLMProvider } from "@argentum/llm-provider";
import { TelemetryWriter } from "@argentum/telemetry";

afterEach(() => {
	vi.doUnmock("@argentum/environment");
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("runtime repair exhaustion e2e", () => {
	it("aborts through repair exhaustion after exactly the configured repair budget", async () => {
		const workspace = await createTestWorkspace();
		const repairBudget = 3;
		const flushSpy = vi.spyOn(TelemetryWriter.prototype, "flush");
		let provider: RepairExhaustionProvider | undefined;

		try {
			const { startRuntime } = await importRuntimeModuleWithEnvironmentMock(
				workspace,
				{ maxRepairAttempts: repairBudget },
			);

			const ctx = await startRuntime("./config/runtime.example.json", {
				dbPath: ":memory:",
				llmProviderFactory: ({ resolveContent }) => {
					provider = new RepairExhaustionProvider(resolveContent);
					return provider;
				},
			});

			const result = await ctx.runCliTurn("trigger repair exhaustion", {
				userId: "repair-user",
			});
			const session = ctx.gateway.resolveSession({
				channel: "terminal_cli",
				user_id: "repair-user",
			});
			const logFile = path.join(workspace.logs, `${result.sessionId}.jsonl`);
			const telemetryEvents = await readTelemetryEvents(logFile);
			const inMemoryEvents = [...result.renderedEvents];
			const repairRequestedEvents = telemetryEvents.filter(
				(event) => event.kind === "validation.repair_requested",
			);
			const inMemoryRepairRequestedEvents = inMemoryEvents.filter(
				(event) => event.kind === "validation.repair_requested",
			);
			const llmStartedEvents = telemetryEvents.filter(
				(event) => event.kind === "llm.started",
			);
			const validationFailedEvent = expectSingleEvent(
				telemetryEvents,
				"validation.failed",
			);
			const turnAbortedEvent = expectSingleEvent(
				telemetryEvents,
				"turn.aborted",
			);

			expect(result.finalEnvelope.state).toBe("aborted");
			expect(result.finalEnvelope.final_outcome).toBeUndefined();
			expect(session.session.has_active_turn).toBe(false);
			expect(session.session.queued_ingress_count).toBe(0);

			expect(provider).toBeDefined();
			expect(provider!.requests).toHaveLength(repairBudget + 1);
			expect(provider!.requests.map((request) => request.repairContextIds.length)).toEqual(
				[0, 1, 2, 3],
			);

			expect(llmStartedEvents).toHaveLength(repairBudget + 1);
			expect(telemetryEvents.some((event) => event.kind === "llm.failed")).toBe(
				false,
			);
			expect(telemetryEvents.some((event) => event.kind === "tool.planned")).toBe(
				false,
			);
			expect(telemetryEvents.some((event) => event.kind === "tool.started")).toBe(
				false,
			);
			expect(telemetryEvents.some((event) => event.kind === "tool.finished")).toBe(
				false,
			);
			expect(
				telemetryEvents.some((event) => event.kind === "response.completed"),
			).toBe(false);

			expect(repairRequestedEvents).toHaveLength(repairBudget);
			expect(inMemoryRepairRequestedEvents).toHaveLength(repairBudget);
			expect(repairRequestedEvents.map(getAttemptNumber)).toEqual([1, 2, 3]);
			expect(inMemoryRepairRequestedEvents.map(getAttemptNumber)).toEqual([
				1,
				2,
				3,
			]);

			for (const event of repairRequestedEvents) {
				expect(event.payload).toMatchObject({
					phase: "validation",
					attempt_number: expect.any(Number),
				});
			}

			expect(validationFailedEvent.payload).toMatchObject({
				phase: "validation",
				reason: "repair_attempts_exhausted",
				repairable: false,
			});
			expect(turnAbortedEvent.payload).toMatchObject({
				reason: "repair_attempts_exhausted",
				error_code: "runtime_abort",
			});

			expectOrderedKinds(telemetryEvents, [
				"llm.started",
				"validation.repair_requested",
				"llm.started",
				"validation.repair_requested",
				"llm.started",
				"validation.repair_requested",
				"llm.started",
				"validation.failed",
				"turn.aborted",
			]);
			expectOrderedKinds(inMemoryEvents, [
				"llm.started",
				"validation.repair_requested",
				"llm.started",
				"validation.repair_requested",
				"llm.started",
				"validation.repair_requested",
				"llm.started",
				"validation.failed",
				"turn.aborted",
			]);
			expect(inMemoryEvents.map((event) => event.kind)).toEqual(
				telemetryEvents.map((event) => event.kind),
			);

			expect(result.renderedOutput).toContain(
				"[system] Validation failed: repair_attempts_exhausted",
			);
			expect(result.renderedOutput).toContain(
				"Turn aborted: repair_attempts_exhausted",
			);
			expect(result.renderedOutput).not.toContain("Inference failed:");
			expect(result.renderedOutput.indexOf(
				"[system] Validation failed: repair_attempts_exhausted",
			)).toBeLessThan(
				result.renderedOutput.indexOf(
					"Turn aborted: repair_attempts_exhausted",
				),
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
	readonly maxRepairAttempts?: number;
}

class RepairExhaustionProvider implements LLMProvider {
	readonly #resolveContent: ContentResolver;
	readonly requests: Array<{
		readonly turnId: string;
		readonly contents: readonly string[];
		readonly repairContextIds: readonly string[];
	}> = [];

	constructor(resolveContent: ContentResolver) {
		this.#resolveContent = resolveContent;
	}

	async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
		const contents = await Promise.all(
			request.context_items.map((item) => this.#resolveContent(item.content_ref)),
		);
		this.requests.push({
			turnId: request.turn_id,
			contents,
			repairContextIds: request.context_items
				.filter((item) => item.origin === "repair")
				.map((item) => item.context_id),
		});

		return {
			request_id: request.request_id,
			decision: {
				decision_id: `repair-step-${this.requests.length}`,
				kind: "respond",
			} as unknown as ActionDecision,
			normalization_status: "parsed_text",
		};
	}
}

async function importRuntimeModuleWithEnvironmentMock(
	workspace: TestWorkspace,
	options: RuntimeModuleMockOptions = {},
) {
	const loadRuntimeStartupConfig = vi.fn(async () =>
		makeRuntimeStartupConfigResult(
			workspace,
			options.maxRepairAttempts ?? 2,
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

	const runtimeModule = await import("../src/composition-root.js");

	return {
		startRuntime: runtimeModule.startRuntime,
		loadRuntimeStartupConfig,
	};
}

async function createTestWorkspace(): Promise<TestWorkspace> {
	const root = await mkdtemp(path.join(tmpdir(), "argentum-runtime-repair-"));
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
	maxRepairAttempts: number,
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
				max_repair_attempts: maxRepairAttempts,
				max_wall_clock_ms: 30000,
			},
			gateway: {
				max_queued_ingress_per_session: 8,
				queue_overflow_policy: "reject_newest",
			},
			tool_policy: {
				enabled_tools: ["workspace.read_file"],
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
			enabled_tools: ["workspace.read_file"],
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
			max_repair_attempts: maxRepairAttempts,
			max_wall_clock_ms: 30000,
			repair_attempts_used: 0 as const,
		},
		gatewayDefaults: {
			max_queued_ingress_per_session: 8,
			queue_overflow_policy: "reject_newest" as const,
		},
	};
}

function getAttemptNumber(event: StreamEvent): number {
	const attemptNumber = event.payload.attempt_number;
	if (typeof attemptNumber !== "number") {
		throw new Error("Expected validation.repair_requested attempt_number.");
	}

	return attemptNumber;
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
	if (matching.length !== 1) {
		throw new Error(`Expected exactly one ${kind} event, received ${matching.length}.`);
	}

	return matching[0]!;
}