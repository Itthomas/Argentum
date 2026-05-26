import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
	ContextItem,
	ContentRef,
	ExecutionGrantDTO,
	StreamEvent,
	ToolCallEntry,
	ToolCallDTO,
	ToolDefinition,
	ToolResultDTO,
	TurnEnvelope,
} from "@argentum/contracts";
import {
	CoreLoopOrchestrator,
	CompactionPolicy,
	ContextSelector,
	EpisodicMemory,
	PromptCompiler,
	type TurnContentStore,
	type TurnEventEmitter,
	type ToolCallExecutor,
} from "@argentum/agentic-core";
import { normalizeCliInput, renderStreamEvent } from "@argentum/channel-cli";
import type { LLMProvider, ContentResolver, TraceWriter } from "@argentum/llm-provider";
import { ToolRegistry } from "@argentum/tooling";
import { TelemetryWriter } from "@argentum/telemetry";
import { resolveGrant, storeToolArtifact } from "@argentum/environment";

import {
	bootstrapRuntime,
	type RuntimeBootstrapContext,
} from "./index.js";
import { composeRuntimeTooling } from "./tooling-composition.js";
import type { Gateway, GatewayAcceptedAdmissionResult } from "@argentum/gateway";
import { Gateway as GatewayImpl } from "@argentum/gateway";
import { MockLLMProvider } from "./mock-llm-provider.js";

const RUNTIME_BOOT_CONTEXT = "Argentum runtime boot context initialized.";

export interface RuntimeCliTurnOptions {
	readonly channel?: string;
	readonly userId?: string;
}

export interface RuntimeCliTurnResult {
	readonly sessionId: string;
	readonly finalEnvelope: TurnEnvelope;
	readonly renderedEvents: readonly StreamEvent[];
	readonly renderedOutput: string;
}

export interface RuntimeLlmProviderFactoryInput {
	readonly startupConfig: RuntimeBootstrapContext["startupConfig"];
	readonly resolveContent: ContentResolver;
	readonly writeTrace: TraceWriter;
}

export interface StartRuntimeOptions {
	readonly dbPath?: string;
	readonly llmProviderFactory?: (
		input: RuntimeLlmProviderFactoryInput,
	) => LLMProvider;
}

// ── RuntimeContext ──────────────────────────────────────────────

/**
 * The handle returned by {@link startRuntime}.
 *
 * Exposes the supported CLI happy-path seam plus lower-level composed
 * runtime components for inspection and advanced runtime control.
 */
export interface RuntimeContext {
	/** Gateway facade for session lifecycle and turn management. */
	readonly gateway: Gateway;
	/**
	 * Session-aware orchestrator facade retaining the core-loop entrypoint.
	 *
	 * This lower-level surface is not, by itself, the complete CLI happy-path
	 * seam because accepted ingress priming, rendering, and telemetry live in
	 * {@link runCliTurn}.
	 */
	readonly orchestrator: CoreLoopOrchestrator;
	/**
	 * Supported public CLI happy-path seam from normalized ingress through
	 * rendered output.
	 */
	readonly runCliTurn: (
		rawInput: string,
		options?: RuntimeCliTurnOptions,
	) => Promise<RuntimeCliTurnResult>;
	/** Graceful shutdown: releases locks, closes DB, flushes telemetry. */
	readonly shutdown: () => Promise<void>;
}

// ── startRuntime ────────────────────────────────────────────────

/**
 * Top-level entrypoint for the Argentum runtime.
 *
 * Loads configuration, constructs the full dependency graph with
 * explicit constructor injection, and returns a {@link RuntimeContext}.
 *
 * @param configPath - Optional path to a `runtime.json` config file.
 *   Defaults to `./config/runtime.json`.
 * @returns A composed runtime context ready for turn execution.
 * @throws If config loading or any module construction fails.
 */
export async function startRuntime(
	configPath?: string,
	opts: StartRuntimeOptions = {},
): Promise<RuntimeContext> {
	// 1. Load & validate configuration
	const bootstrapOpts: { configOverridePath?: string } = {};
	if (configPath !== undefined) {
		bootstrapOpts.configOverridePath = configPath;
	}
	const bootstrapCtx = await bootstrapRuntime(bootstrapOpts);
	const { startupConfig } = bootstrapCtx;

	const workspaceRoots = startupConfig.workspaceRoots;
	const governorDefaults = startupConfig.governorDefaults;
	const gatewayDefaults = startupConfig.gatewayDefaults;
	const runtimePolicy = startupConfig.runtimePolicy;
	const storageRoots: Record<ContentRef["storage_area"], string> = {
		bedrock: workspaceRoots.bedrock,
		working: workspaceRoots.working,
		artifacts: workspaceRoots.artifacts,
		logs: workspaceRoots.logs,
	};

	// 2. Construct Gateway facade
	// Allow callers (e.g. tests) to override the DB path, including
	// ":memory:" for ephemeral databases that avoid state leakage
	// between test runs.
	let dbPath: string;
	if (opts?.dbPath !== undefined) {
		dbPath = opts.dbPath;
	} else {
		// Ensure the working directory exists before creating the SQLite DB.
		mkdirSync(workspaceRoots.working, { recursive: true });
		dbPath = `${workspaceRoots.working}/gateway.db`;
	}
	const gateway = new GatewayImpl({
		dbPath,
		governorDefaults: {
			max_inference_steps: governorDefaults.max_inference_steps,
			max_repair_attempts: governorDefaults.max_repair_attempts,
			max_wall_clock_ms: governorDefaults.max_wall_clock_ms,
		},
		gatewayDefaults: {
			max_queued_ingress_per_session:
				gatewayDefaults.max_queued_ingress_per_session,
			queue_overflow_policy: gatewayDefaults.queue_overflow_policy,
		},
	});

	// 3. Construct ToolRegistry + ToolCallExecutor bridge
	const toolRegistry = new ToolRegistry();
	const { registeredTools } = composeRuntimeTooling(toolRegistry);
	const toolDefMap = new Map<string, ToolDefinition>();
	for (const definition of registeredTools) {
		toolDefMap.set(definition.name, definition);
	}
	const telemetryWriter = new TelemetryWriter({
		logDir: workspaceRoots.logs,
		format: startupConfig.runtimeConfig.telemetry.format,
		persistEvents: startupConfig.runtimeConfig.telemetry.persist_events,
	});
	const eventPipeline = new RuntimeStreamPipeline(telemetryWriter);

	const toolExecutor: ToolCallExecutor = {
		async execute(
			entry: ToolCallEntry,
			envelope: TurnEnvelope,
		): Promise<ToolResultDTO> {
			const startedAt = Date.now();
			const callId = randomUUID();
			const toolDef = toolDefMap.get(entry.tool_name);

			if (!toolDef) {
				await eventPipeline.recordToolBlocked(
					envelope,
					callId,
					entry.tool_name,
					`Tool '${entry.tool_name}' not found in registry.`,
					"tool_not_found",
				);

				return {
					call_id: callId,
					status: "blocked",
					human_summary: `Tool '${entry.tool_name}' not found in registry.`,
					duration_ms: Date.now() - startedAt,
					truncated: false,
					retryable: false,
					error_code: "tool_not_found",
				};
			}

			// Resolve grant
			const resolution = resolveGrant(toolDef, runtimePolicy);
			if (resolution.approval_mode === "deny") {
				await eventPipeline.recordToolBlocked(
					envelope,
					callId,
					entry.tool_name,
					resolution.denial_reason,
					resolution.error_code,
				);

				return {
					call_id: callId,
					status: "blocked",
					human_summary: `Tool '${entry.tool_name}' denied: ${resolution.denial_reason}`,
					duration_ms: Date.now() - startedAt,
					truncated: false,
					retryable: false,
					error_code: resolution.error_code,
				};
			}

			const grant: ExecutionGrantDTO = resolution.grant;
			const call: ToolCallDTO = {
				call_id: callId,
				turn_id: envelope.turn_id,
				tool_name: entry.tool_name,
				arguments: entry.arguments,
				grant,
				timeout_ms: toolDef.default_timeout_ms,
				idempotency_key: randomUUID(),
			};

			await eventPipeline.recordToolPlanned(
				envelope,
				call.call_id,
				entry.tool_name,
			);
			await eventPipeline.recordToolStarted(
				envelope,
				call.call_id,
				entry.tool_name,
			);

			const result = await toolRegistry.dispatch(call);

			await eventPipeline.recordToolFinished(
				envelope,
				call.call_id,
				entry.tool_name,
				result.status,
				result.duration_ms,
			);

			return result;
		},
	};

	const contentStore: TurnContentStore = {
		async store(callId, content) {
			return storeToolArtifact(callId, content, workspaceRoots.artifacts);
		},
		async write(ref, content) {
			if (ref.storage_area !== "working") {
				throw new Error(
					`Runtime content store only writes working-area refs; received ${ref.storage_area}.`,
				);
			}

			const filePath = path.join(workspaceRoots.working, ref.locator);
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, content, "utf-8");
		},
	};
	const resolveContent: ContentResolver = async (ref) => {
		const filePath = path.join(storageRoots[ref.storage_area], ref.locator);
		return readFile(filePath, "utf-8");
	};
	const writeTrace: TraceWriter = async (ref, payload) => {
		const filePath = path.join(storageRoots[ref.storage_area], ref.locator);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
	};

	// 4. Construct agentic-core instances
	const promptCompiler = new PromptCompiler({
		defaultToolExposurePolicy: { mode: "all" },
	});
	const contextSelector = new ContextSelector();
	const compactionPolicy = new CompactionPolicy();

	// 5. Construct LLM Provider (mock for E2E; swap for real adapter)
	const llmProvider: LLMProvider =
		opts.llmProviderFactory?.({
			startupConfig,
			resolveContent,
			writeTrace,
		}) ?? new MockLLMProvider();

	// 6. Construct session-aware CoreLoopOrchestrator facade
	const orchestrator = new SessionScopedRuntimeOrchestrator({
		promptCompiler,
		contextSelector,
		compactionPolicy,
		llmProvider,
		toolExecutor,
		contentStore,
		createTurnEventEmitter: () => eventPipeline.createTurnEventEmitter(),
		registeredTools,
	});

	// The supported public CLI seam stays in the runtime because it owns the
	// ingress-to-memory priming step plus rendering and telemetry.
	const runCliTurn = async (
		rawInput: string,
		options: RuntimeCliTurnOptions = {},
	): Promise<RuntimeCliTurnResult> => {
		const normalized = normalizeCliInput(rawInput);
		const ingress = {
			...normalized,
			channel: options.channel ?? normalized.channel,
			user_id: options.userId ?? normalized.user_id,
		};
		const resolved = gateway.resolveSession({
			channel: ingress.channel,
			user_id: ingress.user_id,
		});
		const admission = gateway.admitIngress({
			session_id: resolved.session_id,
			session: resolved.session,
			ingress,
		});

		if (admission.disposition !== "accepted") {
			if ("queue_event" in admission) {
				await eventPipeline.recordEvent(admission.queue_event);
				await eventPipeline.drain();
			}
			throw new Error(
				`CLI turn could not start because ingress was ${admission.disposition}.`,
			);
		}

		await orchestrator.primeAcceptedIngress(admission);

		const claim = gateway.claimActiveTurn(admission);
		if (claim.kind !== "authority_granted") {
			throw new Error("CLI turn could not claim active-turn authority.");
		}

		const handoff = gateway.createTurnStartHandoff({
			admission,
			authority: claim.authority,
		});
		const turnCreated = gateway.createTurnFromHandoff(handoff);
		const finalEnvelope = await orchestrator.executeTurn(turnCreated.turn);

		gateway.releaseActiveTurnAndDequeue({
			authority: handoff.authority,
			finalizing_context: {
				session_id: resolved.session_id,
				turn_id: finalEnvelope.turn_id,
				terminal_kind:
					finalEnvelope.state === "completed"
						? "turn.completed"
						: "turn.aborted",
			},
		});

		await eventPipeline.drain();

		return {
			sessionId: resolved.session_id,
			finalEnvelope,
			renderedEvents: eventPipeline.getTurnEvents(finalEnvelope.turn_id),
			renderedOutput: eventPipeline.getRenderedOutput(finalEnvelope.turn_id),
		};
	};

	// 7. Shutdown hook
	const shutdown = async (): Promise<void> => {
		try {
			await eventPipeline.flush();
		} finally {
			gateway.close();
		}
	};

	return { gateway, orchestrator, runCliTurn, shutdown };
}

interface SessionScopedRuntimeOrchestratorDependencies {
	readonly promptCompiler: PromptCompiler;
	readonly contextSelector: ContextSelector;
	readonly compactionPolicy: CompactionPolicy;
	readonly llmProvider: LLMProvider;
	readonly toolExecutor: ToolCallExecutor;
	readonly contentStore: TurnContentStore;
	readonly createTurnEventEmitter: () => TurnEventEmitter;
	readonly registeredTools: readonly ToolDefinition[];
}

class SessionScopedRuntimeOrchestrator extends CoreLoopOrchestrator {
	readonly #deps: SessionScopedRuntimeOrchestratorDependencies;
	readonly #sessionMemories = new Map<string, Promise<EpisodicMemory>>();
	readonly #sessionOrchestrators = new Map<
		string,
		Promise<CoreLoopOrchestrator>
	>();

	constructor(deps: SessionScopedRuntimeOrchestratorDependencies) {
		super({
			memory: new EpisodicMemory("runtime-orchestrator-placeholder"),
			promptCompiler: deps.promptCompiler,
			contextSelector: deps.contextSelector,
			compactionPolicy: deps.compactionPolicy,
			llmProvider: deps.llmProvider,
			toolExecutor: deps.toolExecutor,
			contentStore: deps.contentStore,
			registeredTools: deps.registeredTools,
		});
		this.#deps = deps;
	}

	override async executeTurn(
		envelope: TurnEnvelope,
		startedAt?: number,
	): Promise<TurnEnvelope> {
		const orchestrator = await this.#getOrCreateOrchestrator(
			envelope.session_id,
		);
		return orchestrator.executeTurn(envelope, startedAt);
	}

	async primeAcceptedIngress(
		admission: GatewayAcceptedAdmissionResult,
	): Promise<void> {
		const memory = await this.#getOrCreateMemory(admission.ingress.session_id);
		const ingressText = stringifyIngressText(admission);
		const contextId = `ingress:${admission.ingress.ingress_id}`;
		const contentRef: ContentRef = {
			ref_id: contextId,
			kind: "text",
			storage_area: "working",
			locator: `sessions/${admission.ingress.session_id}/ingress/${admission.ingress.ingress_id}.txt`,
			retention: "session",
		};
		const contextItem: ContextItem = {
			context_id: contextId,
			layer: "episodic",
			role: "user",
			content_ref: contentRef,
			origin: "user",
			retention: "rolling",
			token_estimate: estimateTokenCount(ingressText),
		};

		await this.#deps.contentStore.write(contentRef, ingressText);
		memory.add(contextItem);
	}

	async #getOrCreateOrchestrator(
		sessionId: string,
	): Promise<CoreLoopOrchestrator> {
		const existing = this.#sessionOrchestrators.get(sessionId);
		if (existing) {
			return existing;
		}

		const created = this.#createSessionOrchestrator(sessionId);
		this.#sessionOrchestrators.set(sessionId, created);
		created.catch(() => {
			this.#sessionOrchestrators.delete(sessionId);
		});
		return created;
	}

	async #createSessionOrchestrator(
		sessionId: string,
	): Promise<CoreLoopOrchestrator> {
		const memory = await this.#getOrCreateMemory(sessionId);
		return new CoreLoopOrchestrator({
			memory,
			promptCompiler: this.#deps.promptCompiler,
			contextSelector: this.#deps.contextSelector,
			compactionPolicy: this.#deps.compactionPolicy,
			llmProvider: this.#deps.llmProvider,
			toolExecutor: this.#deps.toolExecutor,
			contentStore: this.#deps.contentStore,
			eventEmitter: this.#deps.createTurnEventEmitter(),
			registeredTools: this.#deps.registeredTools,
		});
	}

	async #getOrCreateMemory(sessionId: string): Promise<EpisodicMemory> {
		const existing = this.#sessionMemories.get(sessionId);
		if (existing) {
			return existing;
		}

		const created = this.#createSessionMemory(sessionId);
		this.#sessionMemories.set(sessionId, created);
		created.catch(() => {
			this.#sessionMemories.delete(sessionId);
		});
		return created;
	}

	async #createSessionMemory(sessionId: string): Promise<EpisodicMemory> {
		const memory = new EpisodicMemory(sessionId);
		const systemContextItem = makeSystemContextItem(sessionId);
		await this.#deps.contentStore.write(
			systemContextItem.content_ref,
			RUNTIME_BOOT_CONTEXT,
		);
		memory.add(systemContextItem);
		return memory;
	}
}

class RuntimeStreamPipeline {
	readonly #telemetryWriter: TelemetryWriter;
	readonly #turnEvents = new Map<string, StreamEvent[]>();
	readonly #turnRenderedLines = new Map<string, string[]>();
	readonly #turnSequences = new Map<string, number>();
	readonly #sessionSequences = new Map<string, number>();
	readonly #lastTurnState = new Map<string, TurnEnvelope["state"]>();
	#eventChain: Promise<void> = Promise.resolve();

	constructor(telemetryWriter: TelemetryWriter) {
		this.#telemetryWriter = telemetryWriter;
	}

	createTurnEventEmitter(): TurnEventEmitter {
		return {
			emit: (eventName, envelope, metadata) => {
				this.#eventChain = this.#eventChain.then(() =>
					this.#recordMappedTurnEvents(eventName, envelope, metadata),
				);
			},
		};
	}

	async recordEvent(event: StreamEvent): Promise<void> {
		this.#eventChain = this.#eventChain.then(() => this.#appendEvent(event));
		await this.#eventChain;
	}

	async recordToolPlanned(
		envelope: TurnEnvelope,
		callId: string,
		toolName: string,
	): Promise<void> {
		await this.recordEvent(
			this.#makeTurnEvent(envelope, "tool.planned", "telemetry", {
				call_id: callId,
				tool_name: toolName,
			}),
		);
	}

	async recordToolStarted(
		envelope: TurnEnvelope,
		callId: string,
		toolName: string,
	): Promise<void> {
		await this.recordEvent(
			this.#makeTurnEvent(envelope, "tool.started", "user", {
				call_id: callId,
				tool_name: toolName,
			}),
		);
	}

	async recordToolFinished(
		envelope: TurnEnvelope,
		callId: string,
		toolName: string,
		status: string,
		durationMs: number,
	): Promise<void> {
		await this.recordEvent(
			this.#makeTurnEvent(envelope, "tool.finished", "user", {
				call_id: callId,
				tool_name: toolName,
				status,
				duration_ms: durationMs,
			}),
		);
	}

	async recordToolBlocked(
		envelope: TurnEnvelope,
		callId: string,
		toolName: string,
		reason: string,
		errorCode: string,
	): Promise<void> {
		await this.recordEvent(
			this.#makeTurnEvent(envelope, "tool.blocked", "system", {
				call_id: callId,
				tool_name: toolName,
				reason,
				error_code: errorCode,
			}),
		);
	}

	getTurnEvents(turnId: string): readonly StreamEvent[] {
		return [...(this.#turnEvents.get(turnId) ?? [])];
	}

	getRenderedOutput(turnId: string): string {
		return (this.#turnRenderedLines.get(turnId) ?? []).join("\n");
	}

	async drain(): Promise<void> {
		await this.#eventChain;
	}

	async flush(): Promise<void> {
		await this.drain();
		await this.#telemetryWriter.flush();
	}

	async #recordMappedTurnEvents(
		eventName: string,
		envelope: TurnEnvelope,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		for (const event of this.#mapTurnEvents(eventName, envelope, metadata)) {
			await this.#appendEvent(event);
		}
	}

	#mapTurnEvents(
		eventName: string,
		envelope: TurnEnvelope,
		metadata?: Record<string, unknown>,
	): readonly StreamEvent[] {
		if (eventName.startsWith("turn.")) {
			return this.#mapStateTransition(eventName, envelope, metadata);
		}

		switch (eventName) {
			case "tool.planned":
			case "tool.started":
			case "tool.finished":
			case "tool.blocked":
				// Suppress: the ToolCallExecutor (composition root) emits
				// the authoritative tool lifecycle events after it has
				// allocated the canonical call_id. The orchestrator emits
				// the same lifecycle names around executor dispatch, but its
				// planned/started metadata does not carry call_id, and its
				// blocked metadata also lacks the canonical denial reason and
				// error code required by the runtime telemetry surface.
				return [];
			case "llm.started":
				return [
					this.#makeTurnEvent(envelope, "llm.started", "user", {
						request_id: getString(metadata, "requestId"),
						tool_count: getNumber(metadata, "availableToolCount") ?? 0,
					}),
				];
			case "llm.finished":
				return [
					this.#makeTurnEvent(envelope, "llm.completed", "telemetry", {
						request_id: getString(metadata, "requestId"),
						normalization_status:
							getString(metadata, "normalizationStatus") ?? "parsed_text",
					}),
				];
			case "llm.failed":
				return [
					this.#makeTurnEvent(envelope, "llm.failed", "system", {
						request_id: getString(metadata, "requestId"),
						reason: getString(metadata, "reason") ?? "provider_failure",
						error_code: "provider_failure",
					}),
				];
			case "memory.compaction_started":
				return [
					this.#makeTurnEvent(
						envelope,
						"memory.compaction_started",
						"telemetry",
						{
							call_id: getString(metadata, "callId"),
							compaction_revision: envelope.compaction_revision,
						},
					),
				];
			case "memory.compaction_committed":
				return [
					this.#makeTurnEvent(
						envelope,
						"memory.compaction_committed",
						"telemetry",
						{
							call_id: getString(metadata, "callId"),
							compaction_revision:
								getNumber(metadata, "newRevision") ??
								envelope.compaction_revision,
							artifact_count:
								getNumber(metadata, "artifactCount") ?? 0,
						},
					),
				];
			case "validation.repair_requested":
				return [
					this.#makeTurnEvent(
						envelope,
						"validation.repair_requested",
						"telemetry",
						{
							phase: "validation",
							attempt_number:
								envelope.budget.repair_attempts_used + 1,
						},
					),
				];
			case "validation.aborted":
				return [
					this.#makeTurnEvent(envelope, "validation.failed", "system", {
						phase: "validation",
						reason:
							getString(metadata, "reason") ?? "repair_attempts_exhausted",
						repairable: false,
					}),
				];
			case "response.emitted":
				return [
					this.#makeTurnEvent(envelope, "response.started", "telemetry", {
						response_kind:
							getString(metadata, "decisionKind") ?? "respond",
					}),
				];
			case "response.completed":
				return [
					this.#makeTurnEvent(envelope, "response.completed", "user", {
						response_kind:
							getString(metadata, "decisionKind") ?? "respond",
						final_outcome: envelope.final_outcome ?? "",
					}),
				];
			default:
				return [];
		}
	}

	#mapStateTransition(
		eventName: string,
		envelope: TurnEnvelope,
		metadata?: Record<string, unknown>,
	): readonly StreamEvent[] {
		const nextState = eventName.slice("turn.".length) as TurnEnvelope["state"];
		const previousState = this.#lastTurnState.get(envelope.turn_id);
		this.#lastTurnState.set(envelope.turn_id, nextState);

		if (previousState === undefined && nextState === "building_context") {
			return [
				this.#makeTurnEvent(envelope, "turn.started", "telemetry", {
					session_id: envelope.session_id,
					ingress_id: envelope.ingress_id,
					state: nextState,
				}),
			];
		}

		if (nextState === "completed") {
			return [
				this.#makeTurnEvent(envelope, "turn.completed", "system", {
					final_outcome: envelope.final_outcome ?? "",
					step_count: envelope.step_count,
				}),
			];
		}

		if (nextState === "aborted") {
			return [
				this.#makeTurnEvent(envelope, "turn.aborted", "system", {
					reason: getString(metadata, "reason") ?? "turn_aborted",
					error_code: "runtime_abort",
				}),
			];
		}

		if (previousState === undefined) {
			return [];
		}

		return [
			this.#makeTurnEvent(envelope, "turn.state_changed", "system", {
				from_state: previousState,
				to_state: nextState,
			}),
		];
	}

	#makeTurnEvent(
		envelope: TurnEnvelope,
		kind: StreamEvent["kind"],
		visibility: StreamEvent["visibility"],
		payload: Record<string, unknown>,
	): StreamEvent {
		return {
			event_id: randomUUID(),
			session_id: envelope.session_id,
			scope: "turn",
			turn_id: envelope.turn_id,
			sequence: this.#nextTurnSequence(envelope.turn_id),
			kind,
			timestamp: new Date().toISOString(),
			visibility,
			payload,
		};
	}

	async #appendEvent(event: StreamEvent): Promise<void> {
		if (event.scope === "turn" && event.turn_id) {
			const turnEvents = this.#turnEvents.get(event.turn_id) ?? [];
			turnEvents.push(event);
			this.#turnEvents.set(event.turn_id, turnEvents);

			const rendered = renderStreamEvent(event);
			if (rendered !== "") {
				const renderedLines = this.#turnRenderedLines.get(event.turn_id) ?? [];
				renderedLines.push(rendered);
				this.#turnRenderedLines.set(event.turn_id, renderedLines);
			}
		} else {
			this.#sessionSequences.set(
				event.session_id,
				event.sequence,
			);
		}

		await this.#telemetryWriter.writeEvent(event);
	}

	#nextTurnSequence(turnId: string): number {
		const next = (this.#turnSequences.get(turnId) ?? 0) + 1;
		this.#turnSequences.set(turnId, next);
		return next;
	}
}

function makeSystemContextItem(sessionId: string): ContextItem {
	return {
		context_id: `system:${sessionId}:argentum-boot`,
		layer: "system",
		role: "system",
		content_ref: {
			ref_id: `system:${sessionId}:argentum-boot`,
			kind: "text",
			storage_area: "working",
			locator: `sessions/${sessionId}/system/argentum-boot.txt`,
			retention: "session",
		},
		origin: "system",
		retention: "rolling",
		token_estimate: estimateTokenCount(RUNTIME_BOOT_CONTEXT),
	};
}

function stringifyIngressText(admission: GatewayAcceptedAdmissionResult): string {
	return admission.ingress.message_parts
		.map((messagePart) =>
			messagePart.kind === "text"
				? messagePart.text
				: JSON.stringify(messagePart),
		)
		.join("\n");
}

function estimateTokenCount(text: string): number {
	return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf-8") / 4));
}

function getString(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" ? value : undefined;
}

function getNumber(
	metadata: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = metadata?.[key];
	return typeof value === "number" ? value : undefined;
}
