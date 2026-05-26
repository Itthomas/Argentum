import type {
  ContentRef,
  ContextItem,
  LLMInferenceRequest,
  LLMInferenceResult,
  ToolCallEntry,
  ToolDefinition,
  ToolResultDTO,
  TurnEnvelope,
  TurnState,
} from "@argentum/contracts";
import { LLMProviderError } from "@argentum/llm-provider";
import type { LLMProvider } from "@argentum/llm-provider";
import { Buffer } from "node:buffer";

import type {
  ArtifactExternalizer,
  CompactionPolicy,
} from "./compaction-policy.js";
import type { ContextSelector } from "./context-selector.js";
import type { EpisodicMemory } from "./episodic-memory.js";
import { PromptCompilerError } from "./prompt-compiler.js";
import type { PromptCompiler } from "./prompt-compiler.js";
import { evaluateGovernor } from "./turn-governor.js";
import { executeTransition, isTerminal } from "./turn-state-machine.js";
import type {
  TurnEventEmitter,
  TurnEventMetadata,
} from "./turn-state-machine.js";
import { validateAndRepair } from "./validation-repair.js";

// ── ToolCallExecutor interface ──────────────────────────────────

/**
 * Encapsulates tool call execution for one {@link ToolCallEntry}.
 *
 * Implementations must:
 * 1. Resolve an `ExecutionGrantDTO` for the tool (via grant resolver).
 * 2. Construct a valid `ToolCallDTO` from the entry and grant.
 * 3. Execute the tool call.
 * 4. Return the `ToolResultDTO`.
 *
 * Grant resolution and `ToolCallDTO` construction are hidden from the
 * orchestrator — it only sees `ToolCallEntry` in and `ToolResultDTO` out.
 *
 * The concrete implementation lives in the composition root
 * (runtime package), not in this module.
 */
export interface ToolCallExecutor {
  /**
   * Execute a tool call identified by `entry` within the context of `envelope`.
   * @param entry - The tool call entry from the LLM decision.
   * @param envelope - The current turn envelope (read-only context).
   * @returns The tool execution result.
   */
  execute(entry: ToolCallEntry, envelope: TurnEnvelope): Promise<ToolResultDTO>;
}

/**
 * Persists turn-generated text content referenced by `ContextItem.content_ref`
 * and externalized tool artifacts.
 */
export interface TurnContentStore extends ArtifactExternalizer {
  /**
   * Persist text for a working-area `ContentRef` created during the turn.
   *
   * Implementations must ensure the content is later resolvable by the
   * provider-layer `ContentResolver` using the same `storage_area` + `locator`.
   */
  write(ref: ContentRef, content: string): Promise<void>;
}

// ── CoreLoopOrchestratorDependencies ────────────────────────────

/**
 * Constructor options bag for {@link CoreLoopOrchestrator}.
 *
 * All boundary-crossing dependencies are injected here — no service
 * location, no global registry, no static state.
 */
export interface CoreLoopOrchestratorDependencies {
  /** Session-scoped episodic memory for storing/retrieving context items. */
  readonly memory: EpisodicMemory;
  /** Compiles `LLMInferenceRequest` from selected context and registry-owned tools. */
  readonly promptCompiler: PromptCompiler;
  /** Selects context items from episodic memory for each inference step. */
  readonly contextSelector: ContextSelector;
  /** Compacts tool execution results before they enter episodic memory. */
  readonly compactionPolicy: CompactionPolicy;
  /** Provider-neutral LLM inference seam. */
  readonly llmProvider: LLMProvider;
  /** Executes tool calls; encapsulates grant resolution and DTO construction. */
  readonly toolExecutor: ToolCallExecutor;
  /** Persists working-area context text and externalized tool artifacts. */
  readonly contentStore: TurnContentStore;
  /** Optional event emitter for turn-scoped lifecycle and coordination events. */
  readonly eventEmitter?: TurnEventEmitter;
  /** Tool definitions registered for this turn (set once at composition time). */
  readonly registeredTools: readonly ToolDefinition[];
}

// ── Constants ───────────────────────────────────────────────────

/** Hard safety ceiling on loop iterations to prevent infinite loops from bugs. */
const HARD_SAFETY_LIMIT = 100;

// ── CoreLoopOrchestrator ────────────────────────────────────────

/**
 * Executes a single turn through the full core loop state machine.
 *
 * ## Lifecycle
 *
 * 1. Accepts a `TurnEnvelope` in `accepted` state.
 * 2. Runs the full turn loop: context building → inference → validation →
 *    tool execution (if needed) → compaction → loop, or terminal respond/abort.
 * 3. Returns the envelope in a terminal state (`completed` or `aborted`).
 *
 * ## Guarantees
 *
 * - **Immutability**: Never mutates the input envelope. Each transition
 *   produces a new envelope via `executeTransition()`.
 * - **Governance**: Checks governor limits before every inference step.
 * - **Provider failure**: Catches `LLMProviderError` and aborts gracefully.
 * - **Compilation failure**: Catches `PromptCompilerError` and aborts.
 * - **Loop safety**: Internal counter throws if step count exceeds
 *   `HARD_SAFETY_LIMIT` (100).
 * - **Event emission**: Emits `turn.<state>` events at every transition
 *   when an `eventEmitter` is provided.
 *
 * ## Delegation
 *
 * Does NOT own:
 * - Session locking, queue management, or persistence (gateway)
 * - Provider-specific API calls (delegates to `LLMProvider`)
 * - Tool execution (delegates to `ToolCallExecutor`)
 * - Grant resolution (delegated to `ToolCallExecutor` implementation)
 * - Event emission implementation (consumes interface only)
 */
export class CoreLoopOrchestrator {
  readonly #memory: EpisodicMemory;
  readonly #promptCompiler: PromptCompiler;
  readonly #contextSelector: ContextSelector;
  readonly #compactionPolicy: CompactionPolicy;
  readonly #llmProvider: LLMProvider;
  readonly #toolExecutor: ToolCallExecutor;
  readonly #contentStore: TurnContentStore;
  readonly #eventEmitter: TurnEventEmitter | undefined;
  readonly #registeredTools: readonly ToolDefinition[];

  constructor(deps: CoreLoopOrchestratorDependencies) {
    this.#memory = deps.memory;
    this.#promptCompiler = deps.promptCompiler;
    this.#contextSelector = deps.contextSelector;
    this.#compactionPolicy = deps.compactionPolicy;
    this.#llmProvider = deps.llmProvider;
    this.#toolExecutor = deps.toolExecutor;
    this.#contentStore = deps.contentStore;
    this.#eventEmitter = deps.eventEmitter;
    this.#registeredTools = deps.registeredTools;
  }

  // ── Public entrypoint ─────────────────────────────────────────

  /**
   * Execute one full turn through the core loop.
   *
   * @param envelope - A `TurnEnvelope` in `accepted` state.
   * @param startedAt - Epoch-ms turn start timestamp; defaults to `Date.now()`.
   * @returns The envelope in a terminal state (`completed` or `aborted`).
   */
  async executeTurn(
    envelope: TurnEnvelope,
    startedAt?: number,
  ): Promise<TurnEnvelope> {
    const start = startedAt ?? Date.now();

    // 1. accepted → building_context
    let current = executeTransition(
      envelope,
      "building_context",
      undefined,
      this.#eventEmitter,
    );

    // 2. Main loop
    let safetyCounter = 0;
    while (!isTerminal(current.state)) {
      if (++safetyCounter > HARD_SAFETY_LIMIT) {
        throw new Error(
          `CoreLoopOrchestrator: safety limit exceeded (${HARD_SAFETY_LIMIT} iterations) for turn ${current.turn_id}`,
        );
      }

      // ── Governor check ──────────────────────────────────────
      const govDecision = evaluateGovernor(current, start);
      if (govDecision.action === "abort") {
        await this.#storeAbortContext(govDecision.reason, current);
        current = executeTransition(
          current,
          "aborted",
          { reason: govDecision.reason },
          this.#eventEmitter,
        );
        break;
      }

      // ── Context selection ───────────────────────────────────
      const selection = this.#contextSelector.select(
        this.#memory.getRecent(),
        current.budget,
      );

      // ── Prompt compilation ──────────────────────────────────
      let request: LLMInferenceRequest;
      try {
        request = this.#promptCompiler.compile({
          turnId: current.turn_id,
          contextItems: selection.selected,
          registeredTools: this.#registeredTools,
          budget: current.budget,
        });
      } catch (err: unknown) {
        if (err instanceof PromptCompilerError) {
          await this.#storeAbortContext(
            `prompt_compilation_failed: ${err.message}`,
            current,
          );
          current = executeTransition(
            current,
            "aborted",
            { reason: `prompt_compilation_failed: ${err.message}` },
            this.#eventEmitter,
          );
          break;
        }
        throw err;
      }

      // ── building_context → inferring ────────────────────────
      current = executeTransition(
        current,
        "inferring",
        undefined,
        this.#eventEmitter,
      );
      this.#emitEvent("llm.started", current, {
        requestId: request.request_id,
        contextItemCount: request.context_items.length,
        availableToolCount: request.available_tools.length,
      });

      // ── LLM inference ───────────────────────────────────────
      let result: LLMInferenceResult;
      try {
        result = await this.#llmProvider.infer(request);
      } catch (err: unknown) {
        if (err instanceof LLMProviderError) {
          this.#emitEvent("llm.failed", current, {
            requestId: request.request_id,
            reason: `provider_failure: ${err.message}`,
          });
          await this.#storeAbortContext(
            `provider_failure: ${err.message}`,
            current,
          );
          current = executeTransition(
            current,
            "aborted",
            { reason: `provider_failure: ${err.message}` },
            this.#eventEmitter,
          );
          break;
        }
        // Unexpected error — propagate to caller.
        throw err;
      }
      this.#emitEvent("llm.finished", current, {
        requestId: result.request_id,
        normalizationStatus: result.normalization_status,
        decisionKind: result.decision.kind,
      });

      // ── inferring → validating ──────────────────────────────
      current = executeTransition(
        current,
        "validating",
        undefined,
        this.#eventEmitter,
      );
      this.#emitEvent("validation.started", current, {
        requestId: result.request_id,
      });

      // ── Validation & repair ─────────────────────────────────
      const validation = validateAndRepair(
        result.decision,
        current,
        this.#memory,
      );

      switch (validation.outcome) {
        case "valid": {
          const decision = validation.decision;
          this.#emitEvent("validation.passed", current, {
            decisionKind: decision.kind,
          });
          switch (decision.kind) {
            case "tool_calls": {
              current = executeTransition(
                current,
                "executing_tools",
                { decisionKind: "tool_calls" },
                this.#eventEmitter,
              );

              // Execute tool calls sequentially.
              const toolCalls = decision.tool_calls ?? [];
              let newRevision = current.compaction_revision;
              try {
                for (const [index, entry] of toolCalls.entries()) {
                  this.#emitEvent("tool.planned", current, {
                    toolName: entry.tool_name,
                    callIndex: index,
                  });
                  this.#emitEvent("tool.started", current, {
                    toolName: entry.tool_name,
                    callIndex: index,
                  });
                  const toolResult = await this.#toolExecutor.execute(
                    entry,
                    current,
                  );
                  this.#emitEvent(
                    toolResult.status === "blocked"
                      ? "tool.blocked"
                      : "tool.finished",
                    current,
                    {
                      toolName: entry.tool_name,
                      callId: toolResult.call_id,
                      callIndex: index,
                      status: toolResult.status,
                      durationMs: toolResult.duration_ms,
                    },
                  );
                  this.#emitEvent("memory.compaction_started", current, {
                    toolName: entry.tool_name,
                    callId: toolResult.call_id,
                    callIndex: index,
                  });
                  const compactionResult =
                    await this.#compactionPolicy.compact(
                      toolResult,
                      newRevision,
                      this.#contentStore,
                    );
                  await this.#contentStore.write(
                    compactionResult.contextItem.content_ref,
                    compactionResult.committedText,
                  );
                  this.#memory.add(compactionResult.contextItem);
                  this.#emitEvent("memory.compaction_committed", current, {
                    toolName: entry.tool_name,
                    callId: toolResult.call_id,
                    callIndex: index,
                    disposition: compactionResult.disposition,
                    contentRef: compactionResult.contextItem.content_ref,
                    artifactCount: compactionResult.externalizedRefs.length,
                    newRevision: compactionResult.newRevision,
                  });
                  newRevision = compactionResult.newRevision;
                }
              } catch (err: unknown) {
                const message =
                  err instanceof Error ? err.message : String(err);
                await this.#storeAbortContext(
                  `tool_execution_failed: ${message}`,
                  current,
                );
                current = executeTransition(
                  current,
                  "aborted",
                  { reason: `tool_execution_failed: ${message}` },
                  this.#eventEmitter,
                );
                break;
              }

              // Update compaction revision on working envelope.
              current = { ...current, compaction_revision: newRevision };

              current = executeTransition(
                current,
                "compacting",
                { decisionKind: "tool_calls" },
                this.#eventEmitter,
              );
              current = executeTransition(
                current,
                "building_context",
                { decisionKind: "tool_calls" },
                this.#eventEmitter,
              );
              break;
            }
            case "respond":
            case "clarify": {
              current = executeTransition(
                current,
                "responding",
                { decisionKind: decision.kind },
                this.#eventEmitter,
              );

              const responseContext = await this.#storeResponseMessage(
                decision.message ?? "",
                current,
              );
              this.#emitEvent("response.emitted", current, {
                decisionKind: decision.kind,
                contextId: responseContext.context_id,
                contentRef: responseContext.content_ref,
              });

              // Set final_outcome on the envelope before finalizing.
              current = {
                ...current,
                final_outcome: decision.message ?? "",
              };

              current = executeTransition(
                current,
                "finalizing",
                { decisionKind: decision.kind },
                this.#eventEmitter,
              );
              this.#emitEvent("response.completed", current, {
                decisionKind: decision.kind,
                contextId: responseContext.context_id,
                contentRef: responseContext.content_ref,
              });
              current = executeTransition(
                current,
                "completed",
                { decisionKind: decision.kind },
                this.#eventEmitter,
              );
              break;
            }
            case "abort": {
              const abortReason = decision.message ?? "decision_abort";
              await this.#storeAbortContext(abortReason, current);
              current = executeTransition(
                current,
                "aborted",
                { decisionKind: "abort", reason: abortReason },
                this.#eventEmitter,
              );
              break;
            }
          }
          break;
        }
        case "repair": {
          await this.#contentStore.write(
            validation.feedback.content_ref,
            validation.feedbackText,
          );
          this.#emitEvent("validation.repair_requested", current, {
            contextId: validation.feedback.context_id,
          });
          // validation-repair already stored feedback in memory and
          // incremented repair_attempts_used on updatedEnvelope.
          current = validation.updatedEnvelope;
          current = executeTransition(
            current,
            "building_context",
            { reason: "repair" },
            this.#eventEmitter,
          );
          break;
        }
        case "abort": {
          this.#emitEvent("validation.aborted", current, {
            reason: validation.reason,
          });
          // Repairs exhausted.
          current = validation.updatedEnvelope;
          await this.#storeAbortContext(
            validation.reason,
            current,
          );
          current = executeTransition(
            current,
            "aborted",
            { reason: validation.reason },
            this.#eventEmitter,
          );
          break;
        }
      }
    }

    return current;
  }

  // ── Private helpers ───────────────────────────────────────────

  #emitEvent(
    eventName: string,
    envelope: TurnEnvelope,
    metadata?: TurnEventMetadata,
  ): void {
    this.#eventEmitter?.emit(eventName, envelope, metadata);
  }

  /**
   * Store the response message as a `ContextItem` in episodic memory.
   */
  async #storeResponseMessage(
    message: string,
    envelope: TurnEnvelope,
  ): Promise<ContextItem> {
    const contextId = `response:${envelope.turn_id}:${envelope.step_count}`;
    const contentRef = this.#makeWorkingTextRef(
      contextId,
      `turns/${envelope.turn_id}/response-${envelope.step_count}.txt`,
      "session",
    );
    const contextItem: ContextItem = {
      context_id: contextId,
      layer: "episodic",
      role: "assistant",
      content_ref: contentRef,
      origin: "assistant",
      retention: "rolling",
      token_estimate: Math.ceil(Buffer.byteLength(message, "utf-8") / 4),
    };

    await this.#contentStore.write(contentRef, message);
    this.#memory.add(contextItem);

    return contextItem;
  }

  /**
   * Store abort context as a `ContextItem` in episodic memory before
   * the abort transition.
   */
  async #storeAbortContext(
    reason: string,
    envelope: TurnEnvelope,
  ): Promise<ContextItem> {
    const contextId = `abort:${envelope.turn_id}:${envelope.step_count}`;
    const abortContextText = this.#serializeAbortContext(reason, envelope.state);
    const contentRef = this.#makeWorkingTextRef(
      contextId,
      `turns/${envelope.turn_id}/abort-${envelope.step_count}.txt`,
      "session",
    );
    const contextItem: ContextItem = {
      context_id: contextId,
      layer: "episodic",
      role: "system",
      content_ref: contentRef,
      origin: "system",
      retention: "ephemeral",
      token_estimate: Math.ceil(Buffer.byteLength(abortContextText, "utf-8") / 4),
    };

    await this.#contentStore.write(contentRef, abortContextText);
    this.#memory.add(contextItem);

    return contextItem;
  }

  #serializeAbortContext(reason: string, lastKnownState: TurnState): string {
    return JSON.stringify(
      {
        reason,
        last_known_state: lastKnownState,
      },
      null,
      2,
    );
  }

  #makeWorkingTextRef(
    refId: string,
    locator: string,
    retention: ContentRef["retention"],
  ): ContentRef {
    return {
      ref_id: refId,
      kind: "text",
      storage_area: "working",
      locator,
      retention,
    };
  }
}
