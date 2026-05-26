import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LLMInferenceRequest, LLMInferenceResult, StreamEvent } from "@argentum/contracts";
import type { RuntimeStartupConfigResult } from "@argentum/environment";
import type { ContentResolver, LLMProvider } from "@argentum/llm-provider";

afterEach(() => {
	vi.doUnmock("@argentum/environment");
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("E2E happy path", () => {
	it("uses runCliTurn as the supported public CLI happy-path seam", async () => {
		const workspace = await createTestWorkspace();
		try {
			const { startRuntime } = await importRuntimeModuleWithEnvironmentMock(workspace);
			let provider: RecordingResolverAwareProvider | undefined;

			const ctx = await startRuntime("./config/runtime.example.json", {
				dbPath: ":memory:",
				llmProviderFactory: ({ resolveContent }) => {
					provider = new RecordingResolverAwareProvider(resolveContent);
					return provider;
				},
			});

			const result = await ctx.runCliTurn("   Hello, Argentum!   ");
			const request = provider!.requestForTurn(result.finalEnvelope.turn_id);

			expect(result.finalEnvelope.state).toBe("completed");
			expect(request.contents).toContain("Hello, Argentum!");
			expect(result.renderedEvents.some((event) => event.kind === "response.completed")).toBe(true);
			expect(result.renderedOutput).toContain("Echo: Hello, Argentum!");

			await ctx.shutdown();
		} finally {
			await removeTestWorkspace(workspace.root);
		}
	});

	it("isolates session-scoped episodic memory across two sessions", async () => {
		const workspace = await createTestWorkspace();
		try {
			const { startRuntime } = await importRuntimeModuleWithEnvironmentMock(workspace);
			let provider: RecordingResolverAwareProvider | undefined;

			const ctx = await startRuntime("./config/runtime.example.json", {
				dbPath: ":memory:",
				llmProviderFactory: ({ resolveContent }) => {
					provider = new RecordingResolverAwareProvider(resolveContent);
					return provider;
				},
			});

			const alpha = await ctx.runCliTurn("alpha-first", { userId: "alpha" });
			const beta = await ctx.runCliTurn("beta-first", { userId: "beta" });

			expect(ctx.orchestrator).toBeDefined();
			expect(typeof ctx.orchestrator.executeTurn).toBe("function");
			expect(provider).toBeDefined();

			const alphaRequest = provider!.requestForTurn(alpha.finalEnvelope.turn_id);
			const betaRequest = provider!.requestForTurn(beta.finalEnvelope.turn_id);

			expect(alphaRequest.contents).toContain("alpha-first");
			expect(betaRequest.contents).toContain("beta-first");
			expect(betaRequest.contents).not.toContain("alpha-first");

			await ctx.shutdown();
		} finally {
			await removeTestWorkspace(workspace.root);
		}
	});

	it("keeps the lower-level orchestrator facade available for advanced callers", async () => {
		const workspace = await createTestWorkspace();
		try {
			const { startRuntime } = await importRuntimeModuleWithEnvironmentMock(workspace);
			let provider: RecordingResolverAwareProvider | undefined;

			const ctx = await startRuntime("./config/runtime.example.json", {
				dbPath: ":memory:",
				llmProviderFactory: ({ resolveContent }) => {
					provider = new RecordingResolverAwareProvider(resolveContent);
					return provider;
				},
			});

			const result = await ctx.runCliTurn("   Hello, Argentum!   ");
			const request = provider!.requestForTurn(result.finalEnvelope.turn_id);

			expect(ctx.gateway).toBeDefined();
			expect(ctx.orchestrator).toBeDefined();
			expect(result.finalEnvelope.state).toBe("completed");
			expect(request.contents).toContain("Hello, Argentum!");
			expect(result.renderedEvents.some((event) => event.kind === "response.completed")).toBe(true);
			expect(result.renderedOutput).toContain("Echo: Hello, Argentum!");

			await ctx.shutdown();
		} finally {
			await removeTestWorkspace(workspace.root);
		}
	});

	it("persists telemetry events and flushes telemetry on shutdown", async () => {
		const workspace = await createTestWorkspace();
		try {
			const telemetryModule = await import("@argentum/telemetry");
			const flushSpy = vi.spyOn(
				telemetryModule.TelemetryWriter.prototype,
				"flush",
			);
			const { startRuntime } = await importRuntimeModuleWithEnvironmentMock(workspace);
			const ctx = await startRuntime("./config/runtime.example.json", {
				dbPath: ":memory:",
			});

			const result = await ctx.runCliTurn("telemetry proof");
			const logFile = path.join(workspace.logs, `${result.sessionId}.jsonl`);
			const events = await readTelemetryEvents(logFile);

			expect(events.some((event) => event.kind === "llm.started")).toBe(true);
			expect(events.some((event) => event.kind === "response.completed")).toBe(true);

			await ctx.shutdown();
			expect(flushSpy).toHaveBeenCalledOnce();
		} finally {
			await removeTestWorkspace(workspace.root);
		}
	});

	it("resolves persisted ContentRef values on a later provider-facing inference step", async () => {
		const workspace = await createTestWorkspace();
		try {
			const { startRuntime } = await importRuntimeModuleWithEnvironmentMock(workspace);
			let provider: RecordingResolverAwareProvider | undefined;

			const ctx = await startRuntime("./config/runtime.example.json", {
				dbPath: ":memory:",
				llmProviderFactory: ({ resolveContent }) => {
					provider = new RecordingResolverAwareProvider(resolveContent);
					return provider;
				},
			});

			await ctx.runCliTurn("remember apples", { userId: "memory-user" });
			const secondTurn = await ctx.runCliTurn("what do you remember?", {
				userId: "memory-user",
			});
			const secondRequest = provider!.requestForTurn(secondTurn.finalEnvelope.turn_id);

			expect(secondRequest.contents).toContain("remember apples");
			expect(secondRequest.contents).toContain("Echo: remember apples");

			await ctx.shutdown();
		} finally {
			await removeTestWorkspace(workspace.root);
		}
	});
});

// ── Helpers ─────────────────────────────────────────────────────

async function importRuntimeModuleWithEnvironmentMock(workspace: TestWorkspace) {
	const loadRuntimeStartupConfig = vi.fn(
		async () => makeRuntimeStartupConfigResult(workspace),
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

async function importActualEnvironmentModule() {
	return vi.importActual<typeof import("@argentum/environment")>(
		"@argentum/environment",
	);
}

interface TestWorkspace {
	readonly root: string;
	readonly bedrock: string;
	readonly working: string;
	readonly artifacts: string;
	readonly logs: string;
}

class RecordingResolverAwareProvider implements LLMProvider {
	readonly #resolveContent: ContentResolver;
	readonly requests: Array<{
		readonly turnId: string;
		readonly contents: readonly string[];
	}> = [];

	constructor(resolveContent: ContentResolver) {
		this.#resolveContent = resolveContent;
	}

	async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
		const contents = await Promise.all(
			request.context_items.map((item) =>
				this.#resolveContent(item.content_ref),
			),
		);
		this.requests.push({
			turnId: request.turn_id,
			contents,
		});

		return {
			request_id: request.request_id,
			decision: {
				decision_id: `recording-${this.requests.length}`,
				kind: "respond",
				message: `Echo: ${latestNonBootContent(contents)}`,
			},
			normalization_status: "parsed_text",
		};
	}

	requestForTurn(turnId: string): {
		readonly turnId: string;
		readonly contents: readonly string[];
	} {
		const request = this.requests.find((entry) => entry.turnId === turnId);
		if (!request) {
			throw new Error(`No recorded request for turn ${turnId}.`);
		}

		return request;
	}
}

async function createTestWorkspace(): Promise<TestWorkspace> {
	const root = await mkdtemp(path.join(tmpdir(), "argentum-runtime-test-"));
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

function latestNonBootContent(contents: readonly string[]): string {
	for (let index = contents.length - 1; index >= 0; index -= 1) {
		const content = contents[index];
		if (content !== undefined && content !== "Argentum runtime boot context initialized.") {
			return content;
		}
	}

	return "empty";
}

function makeRuntimeStartupConfigResult(workspace: TestWorkspace): RuntimeStartupConfigResult {
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
