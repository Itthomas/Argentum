# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: orchestrator (prerequisite: slice 0024 transition update applied 2026-05-24; slices 0030/0031 validated 2026-05-24)
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core
- Implemented: 2026-05-24
- CRITICAL C1/C2 resolved 2026-05-24 by human decision (Option A: add both `building_context → aborted` and `inferring → aborted` transitions to state machine spec). See Review Log.
- Execution readiness: implemented-and-validated. This slice now depends on already-implemented upstream surfaces: `LLMProvider` and `LLMProviderError` from `@argentum/llm-provider` (slice 0031, validated), `validateAndRepair` from `@argentum/agentic-core` (slice 0030, implemented and validated), and the slice 0024 turn-state-machine transitions for `building_context → aborted` and `inferring → aborted` (implemented and validated). Adjacent agentic_core dependencies are also implemented and validated: episodic memory (0025), prompt compiler (0026), context selector (0027), compaction policy (0028), and turn governor (0029).

## Scope

- Slice name: Agentic Core — Core Loop Orchestrator
- Target package or boundary: `agentic_core` (`@argentum/agentic-core`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "Multi-tool action decisions execute sequentially in MVP", "Context compaction is inline in MVP", "The governor uses loose but finite defaults", "One active turn per session with FIFO queued ingress"
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — **sole authority** for turn states, allowed transitions, step semantics, terminal outcomes, invariants. **Per 2026-05-24 human decision (Option A), this spec must be updated to include `building_context → aborted` (governor pre-inference abort) and `inferring → aborted` (provider failure).** The `ALLOWED_TRANSITIONS` map in `packages/agentic_core/src/turn-state-machine.ts` must also be updated to reflect these two additional edges. This spec+code update is a prerequisite for slice 0034 and will be performed as the first step of implementation.
  - [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md) — validation-and-repair policy (implemented slice 0030)
  - [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md) — compaction behavior (implemented slice 0028)
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md) — governor enforcement (implemented slice 0029)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md) — turn lifecycle definition, lifecycle guarantees
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md) — event families (`turn.*`, `validation.*`, `llm.*`, `tool.*`, `memory.*`, `response.*`) and rules
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — contract set definition and normalization boundary
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "end-to-end happy-path CLI tests for one full turn", "failure-path tests for repair exhaustion and budget exhaustion", "state-machine tests for allowed and forbidden transitions"
- Acceptance criteria:
  - **`CoreLoopOrchestrator` class exported** from `@argentum/agentic-core` with a single public method: `executeTurn(envelope: TurnEnvelope): Promise<TurnEnvelope>`. The method accepts a `TurnEnvelope` in `accepted` state, executes the full turn loop, and returns the envelope in a terminal state (`completed` or `aborted`).
  - **Constructor injection**: The orchestrator accepts ALL boundary-crossing dependencies via its constructor. No service location, no global registry, no static state. The constructor parameter is a single options bag (`CoreLoopOrchestratorDependencies`).
  - **Constructor dependencies**:
    - `memory: EpisodicMemory` — session-scoped episodic memory for storing/retrieving context items during the turn (from `@argentum/agentic-core`, slice 0025)
    - `promptCompiler: PromptCompiler` — compiles `LLMInferenceRequest` from selected context items and available tools (from `@argentum/agentic-core`, slice 0026)
    - `contextSelector: ContextSelector` — selects context items from episodic memory for each inference step (from `@argentum/agentic-core`, slice 0027)
    - `compactionPolicy: CompactionPolicy` — compacts tool execution results before they enter episodic memory (from `@argentum/agentic-core`, slice 0028)
    - `llmProvider: LLMProvider` — the LLM inference seam; the orchestrator calls `infer(request)` and receives an `LLMInferenceResult` (from `@argentum/llm-provider`, slice 0031)
    - `toolExecutor: ToolCallExecutor` — executes tool calls and returns results; defined as an interface in this module (see below)
    - `contentStore: TurnContentStore` — persists turn-generated working-area text for `ContextItem.content_ref` values and satisfies the compaction externalization seam for large or truncated tool outputs
    - `eventEmitter?: TurnEventEmitter` — optional event emitter for turn-scoped `turn.*`, `validation.*`, `llm.*`, `tool.*`, `memory.*`, and `response.*` events (from `@argentum/agentic-core`, slice 0024)
  - **`ToolCallExecutor` interface defined and exported**: A single-method interface that encapsulates tool call preparation (grant resolution + `ToolCallDTO` construction) and execution:
    - `execute(entry: ToolCallEntry, envelope: TurnEnvelope): Promise<ToolResultDTO>`
    - JSDoc documents that implementations must: resolve an `ExecutionGrantDTO` for the tool, construct a valid `ToolCallDTO`, execute it, and return the `ToolResultDTO`
    - The interface hides grant resolution and `ToolCallDTO` construction from the orchestrator — the orchestrator only sees `ToolCallEntry` in and `ToolResultDTO` out
    - The concrete implementation lives in the composition root (runtime package), not in this slice
  - **`TurnContentStore` interface defined and exported**: A boundary seam that:
    - extends the compaction externalization contract for large or truncated tool results
    - persists working-area text for any `ContextItem.content_ref` produced by this slice
    - guarantees persisted content is later resolvable by the provider-layer content resolver using the same `storage_area` + `locator`
  - **`CoreLoopOrchestratorDependencies` type exported**: The constructor options bag type.
  - **Exact transition order enforced**: The orchestrator follows the transition order from the core-loop state machine spec WITHOUT variation:
    1. `accepted` → `building_context` (one-time, at loop entry)
    2. `building_context` → `inferring` | `aborted` (governor pre-inference abort)
    3. `inferring` → `validating` | `aborted` (provider failure)
    4. `validating` → `building_context` (repair re-entry) | `executing_tools` (tool_calls) | `responding` (respond/clarify) | `aborted` (abort/unrecoverable)
    5. `executing_tools` → `compacting`
    6. `compacting` → `building_context` (loop back)
    7. `responding` → `finalizing`
    8. `finalizing` → `completed` | `aborted`
  - **`building_context → aborted` transition for governor pre-inference abort**: Before transitioning `building_context` → `inferring`, the orchestrator calls `evaluateGovernor(envelope, startedAt)`. If the governor returns `{ action: "abort", reason }`, the orchestrator transitions `building_context` → `aborted` directly (skipping inference). The governor is also checked after repair re-entry (before the next inference attempt). This transition must be present in `ALLOWED_TRANSITIONS` (slice 0024).
  - **`inferring → aborted` transition for provider failure**: When `llmProvider.infer(request)` throws `LLMProviderError` (from `@argentum/llm-provider`), the orchestrator catches it and transitions `inferring` → `aborted` with reason metadata `provider_failure: <message>`. Unexpected errors (not `LLMProviderError`) propagate to the caller. This transition must be present in `ALLOWED_TRANSITIONS` (slice 0024).
  - **`startedAt` recorded at turn start**: The orchestrator records `Date.now()` at the beginning of `executeTurn()` and passes it to `evaluateGovernor()` calls. If `startedAt` was already recorded by the caller (e.g., stamped by gateway at turn creation), the orchestrator accepts an optional `startedAt` parameter; defaults to `Date.now()`.
  - **Context selection and prompt compilation before inference**: For each inference step:
    1. Call `contextSelector.select(memory.getRecent(), current.budget)` to select context items for the step
    2. Call `promptCompiler.compile({ turnId, contextItems, availableTools, budget })` to produce an `LLMInferenceRequest`
    3. The `availableTools` array is provided by the caller or resolved from tool registry — for the orchestrator, it accepts `availableTools: ToolDefinition[]` as a constructor dependency (read-only, set once at composition time for MVP)
  - **Prompt compilation error handling**: If `promptCompiler.compile()` throws `PromptCompilerError` (from `@argentum/agentic-core`, slice 0026), the orchestrator catches it and transitions `building_context` → `aborted` with reason metadata `prompt_compilation_failed: <message>`. The turn does not proceed to inference with a malformed request.
  - **Validation and repair routing**: After inference, the orchestrator calls `validateAndRepair(decision, envelope, memory)` (from slice 0030). Routes based on `ValidationOutcome.outcome`:
    - `"valid"` with `decision.kind === "tool_calls"`: transition `validating` → `executing_tools`
    - `"valid"` with `decision.kind === "respond"` or `"clarify"`: transition `validating` → `responding`
    - `"valid"` with `decision.kind === "abort"`: transition `validating` → `aborted`
    - `"repair"`: transition `validating` → `building_context` (loop back; governor will re-check before next inference)
    - `"abort"`: transition `validating` → `aborted`
  - **Tool execution loop** (when `decision.kind === "tool_calls"`):
    1. Transition to `executing_tools`
    2. For each `ToolCallEntry` in `decision.tool_calls`, in listed order (sequential MVP):
       a. Call `toolExecutor.execute(entry, envelope)` → `ToolResultDTO`
       b. Call `compactionPolicy.compact(result, envelope.compaction_revision, contentStore)` → `CompactionResult`
       c. Persist `compactionResult.committedText` behind `compactionResult.contextItem.content_ref` via `contentStore.write(...)`
       d. Store `compactionResult.contextItem` in `memory` via `memory.add()`
       e. Update working envelope's `compaction_revision` to `compactionResult.newRevision`
    3. After all tool calls complete: transition `executing_tools` → `compacting`, then `compacting` → `building_context` (loop back to next inference step)
  - **Respond/clarify terminal path**:
    1. Transition `validating` → `responding`
    2. Persist the response `message` to `contentStore.write(...)` using a unique working-area `ContentRef`
    3. Store the response `message` as a `ContextItem` in `memory` (layer `"episodic"`, origin `"assistant"`)
    4. Transition `responding` → `finalizing`
    5. Transition `finalizing` → `completed`
    6. Return the envelope in `completed` state
  - **Abort terminal path**:
    1. Transition to `aborted` (from whichever state triggered the abort — `validating`, `building_context`, or `finalizing`)
    2. Persist structured abort context text containing both `reason` and `last_known_state` to `contentStore.write(...)` using a unique working-area `ContentRef`
    3. Store abort context (reason, last known state) as a `ContextItem` in `memory`
    4. Return the envelope in `aborted` state
  - **Turn-scoped event emission seam**: For each state transition executed via `executeTransition()`, the orchestrator provides the injected `eventEmitter`. If no emitter is provided, transitions proceed silently. The transition event name follows `turn.<new_state>` convention (e.g., `"turn.inferring"`, `"turn.completed"`). The orchestrator also emits turn-scoped `validation.*`, `llm.*`, `tool.*`, `memory.*`, and `response.*` lifecycle events around validation, inference, tool execution, compaction, and response persistence.
  - **Transition metadata**: For transitions triggered by decision routing, the orchestrator passes `TransitionMetadata` with `decisionKind` set to the `ActionDecision.kind`. For governor-triggered aborts, `reason` is set to the `GovernorAbortReason`. For repair re-entry, `reason` is `"repair"`.
  - **`TurnEnvelope` immutability**: The orchestrator never mutates the input envelope. Each transition produces a new envelope via `executeTransition()`. The orchestrator tracks the current envelope as a local variable throughout the loop.
  - **Loop termination guarantees**: The loop terminates when:
    - A terminal state is reached (`completed` or `aborted`)
    - The governor triggers an abort (step limit, repair limit, or wall clock)
    - An unrecoverable error occurs (LLM provider failure, validation exhaustion)
    - The loop includes an internal safety counter that throws if step count exceeds a hard ceiling (e.g., 100) to prevent infinite loops from implementation bugs — this is a development safeguard, not a spec-mandated limit
  - **The module does NOT**:
    - Own session locking, queue management, or persistence (gateway concerns)
    - Make provider-specific API calls (delegates to `LLMProvider` interface)
    - Own tool execution (delegates to `ToolCallExecutor` interface)
    - Own grant resolution (delegated to `ToolCallExecutor` implementation)
    - Own the tool registry or tool definition lookup (delegated via constructor)
    - Implement the event emitter — only consumes the interface
    - Create, stamp, or validate `TurnEnvelope` values (owned by gateway and contracts)
    - Manage session lifecycle or queue draining
    - Implement channel rendering or CLI output
    - Handle `clarify` differently from `respond` — both follow the same terminal path (responding → finalizing → completed) as the distinction is a rendering concern
- Inputs crossing the boundary:
  - `TurnEnvelope` in `accepted` state — from gateway (slice 0009), carries `budget`, `turn_id`, `session_id`, `ingress_id`, `compaction_revision`
  - `EpisodicMemory` — session-scoped memory (slice 0025), pre-populated with accepted ingress context
  - `PromptCompiler` — stateless compiler (slice 0026)
  - `ContextSelector` — stateless selector (slice 0027)
  - `CompactionPolicy` — stateless compaction engine (slice 0028)
  - `LLMProvider` — inference seam (slice 0031)
  - `ToolCallExecutor` — tool execution seam (defined in this module)
  - `TurnContentStore` — working-area text persistence + compaction externalization seam (defined in this module)
  - `ToolDefinition[]` — available tools for the turn (resolved from tool registry by composition root)
  - `TurnEventEmitter?` — optional event bus (slice 0024 interface)
  - `startedAt?: number` — optional epoch-ms turn start timestamp
- Outputs crossing the boundary:
  - `TurnEnvelope` in a terminal state (`completed` or `aborted`) with updated `step_count`, `compaction_revision`, `repair_attempts_used`, and `updated_at`
  - `CoreLoopOrchestrator` class exported from `@argentum/agentic-core`
  - `CoreLoopOrchestratorDependencies` type exported
  - `ToolCallExecutor` interface exported
  - `TurnContentStore` interface exported

## Prerequisites

- **Slice 0024 (turn state machine) must be updated** before this slice can be implemented. The `ALLOWED_TRANSITIONS` map in `packages/agentic_core/src/turn-state-machine.ts` must include two new edges:
  - `["building_context", new Set(["inferring", "aborted"])]` — currently only `["building_context", new Set(["inferring"])]`
  - `["inferring", new Set(["validating", "aborted"])]` — currently only `["inferring", new Set(["validating"])]`
- These transitions are now canonical per the 2026-05-24 human decision (Option A). The state machine spec (`docs/spec/30-core-loop/core-loop-state-machine.md`) must also be updated with the two new allowed transitions.
- Slice 0030 (validation & repair) must be validated.
- Slice 0031 (LLM provider interface) must be validated with `LLMProviderError` exported.

## Plan

- First contracts or interfaces to create:
  - `ToolCallExecutor` interface — `execute(entry: ToolCallEntry, envelope: TurnEnvelope): Promise<ToolResultDTO>`
  - `CoreLoopOrchestratorDependencies` type — options bag with all constructor dependencies
  - `CoreLoopOrchestrator` class — main orchestrator with `executeTurn()` method
- Minimal implementation steps:
  1. Add `@argentum/llm-provider` as a workspace dependency in `packages/agentic_core/package.json`:
     - Add `"@argentum/llm-provider": "workspace:*"` to `dependencies`
     - This imports `LLMProvider` and `LLMProviderError` (interface + error class from slice 0031)
  2. Add TypeScript project reference: update `packages/agentic_core/tsconfig.json` to include `"references": [{ "path": "../contracts" }, { "path": "../llm_provider" }]`
  3. Create `packages/agentic_core/src/core-loop-orchestrator.ts`:
     - Import `TurnEnvelope`, `TurnState`, `ActionDecision`, `ToolCallEntry`, `ToolResultDTO`, `ToolDefinition`, `ContextItem`, `LLMInferenceRequest`, `LLMInferenceResult` from `@argentum/contracts`
     - Import `LLMProvider`, `LLMProviderError` from `@argentum/llm-provider`
     - Import `EpisodicMemory` from `./episodic-memory.js`
     - Import `PromptCompiler`, `PromptCompilerInput`, `PromptCompilerError` from `./prompt-compiler.js`
     - Import `ContextSelector`, `SelectionOptions`, `SelectionResult` from `./context-selector.js`
     - Import `CompactionPolicy`, `CompactionResult`, `ArtifactExternalizer` from `./compaction-policy.js`
     - Import `evaluateGovernor`, `GovernorDecision` from `./turn-governor.js`
     - Import `validateAndRepair`, `ValidationOutcome` from `./validation-repair.js` (slice 0030)
     - Import `executeTransition`, `isTerminal`, `TransitionError`, `TurnEventEmitter`, `TransitionMetadata` from `./turn-state-machine.js`
     - Define and export `ToolCallExecutor` interface
     - Define and export `CoreLoopOrchestratorDependencies` type
     - Define and export `CoreLoopOrchestrator` class with:
       - Constructor accepting `CoreLoopOrchestratorDependencies`
       - Private helper `#checkGovernor(envelope, startedAt): GovernorDecision` — calls `evaluateGovernor`
       - Private helper `#buildContext(envelope): Promise<SelectionResult>` — selects context from memory
       - Private helper `#compilePrompt(envelope, selection, availableTools): LLMInferenceRequest` — compiles inference request
       - Private helper `#executeToolCalls(entries, envelope): Promise<{ results: ToolResultDTO[], newRevision: number }>` — iterates tool calls, executes, compacts, stores in memory
       - Private helper `#storeResponseMessage(message, envelope): void` — stores response as ContextItem in memory
       - Public `executeTurn(envelope: TurnEnvelope, startedAt?: number): Promise<TurnEnvelope>` — main loop
  4. The `executeTurn()` loop structure (pseudocode):
     ```
     let current = envelope;
     const start = startedAt ?? Date.now();
     
     // 1. accepted → building_context
     current = executeTransition(current, "building_context", {}, eventEmitter);
     
     // 2. Main loop
     let safetyCounter = 0;
     while (!isTerminal(current.state)) {
       if (++safetyCounter > HARD_SAFETY_LIMIT) throw new Error("Orchestrator safety limit exceeded");
       
       // Governor check
       const govDecision = evaluateGovernor(current, start);
       if (govDecision.action === "abort") {
         current = executeTransition(current, "aborted", {
           reason: govDecision.reason,
         }, eventEmitter);
         break;
       }
       
       // Context selection
       const selection = contextSelector.select(memory.getRecent(), current.budget);
       
       // Prompt compilation (with error handling for PromptCompilerError)
       let request: LLMInferenceRequest;
       try {
         request = promptCompiler.compile({
           turnId: current.turn_id,
           contextItems: selection.selected,
           availableTools,
           budget: current.budget,
         });
       } catch (err) {
         if (err instanceof PromptCompilerError) {
           current = executeTransition(current, "aborted", {
             reason: `prompt_compilation_failed: ${err.message}`,
           }, eventEmitter);
           break;
         }
         throw err;
       }
       
       // building_context → inferring
       current = executeTransition(current, "inferring", {}, eventEmitter);
       
       // LLM inference
       let result: LLMInferenceResult;
       try {
         result = await llmProvider.infer(request);
       } catch (err) {
         if (err instanceof LLMProviderError) {
           current = executeTransition(current, "aborted", {
             reason: `provider_failure: ${err.message}`,
           }, eventEmitter);
           break;
         }
         throw err; // Unexpected error
       }
       
       // inferring → validating
       current = executeTransition(current, "validating", {}, eventEmitter);
       
       // Validation & repair
       const validation = validateAndRepair(result.decision, current, memory);
       
       switch (validation.outcome) {
         case "valid":
           switch (validation.decision.kind) {
             case "tool_calls":
               current = executeTransition(current, "executing_tools", {
                 decisionKind: "tool_calls",
               }, eventEmitter);
               // Execute tool calls
               const { newRevision } = await this.#executeToolCalls(
                 validation.decision.tool_calls ?? [],
                 current,
               );
               current = { ...current, compaction_revision: newRevision };
               current = executeTransition(current, "compacting", {
                 decisionKind: "tool_calls",
               }, eventEmitter);
               current = executeTransition(current, "building_context", {
                 decisionKind: "tool_calls",
               }, eventEmitter);
               break;
             case "respond":
             case "clarify":
               current = executeTransition(current, "responding", {
                 decisionKind: validation.decision.kind,
               }, eventEmitter);
               this.#storeResponseMessage(validation.decision.message ?? "", current);
               current = executeTransition(current, "finalizing", {
                 decisionKind: validation.decision.kind,
               }, eventEmitter);
               current = executeTransition(current, "completed", {
                 decisionKind: validation.decision.kind,
               }, eventEmitter);
               break;
             case "abort":
               current = executeTransition(current, "aborted", {
                 decisionKind: "abort",
                 reason: "decision_abort",
               }, eventEmitter);
               break;
           }
           break;
         case "repair":
           // validation-repair already stored feedback in memory and incremented repair_attempts_used
           current = validation.updatedEnvelope;
           current = executeTransition(current, "building_context", {
             reason: "repair",
           }, eventEmitter);
           break;
         case "abort":
           current = validation.updatedEnvelope;
           current = executeTransition(current, "aborted", {
             reason: "repair_exhausted",
           }, eventEmitter);
           break;
       }
     }
     
     return current;
     ```
  5. Update `packages/agentic_core/src/index.ts` to export:
     - `CoreLoopOrchestrator` class
     - `CoreLoopOrchestratorDependencies` type
     - `ToolCallExecutor` interface
- Required tests:
  - **Happy path: respond decision completes turn**: Create an orchestrator with mock dependencies. Provide an envelope in `accepted` state. Mock `llmProvider.infer()` to return an `LLMInferenceResult` with `decision.kind = "respond"` and `decision.message = "Hello"`. Assert the returned envelope has `state = "completed"` and `step_count` incremented appropriately.
  - **Happy path: tool_calls → compaction → respond completes turn**: Two-step turn: first inference returns `tool_calls`, second returns `respond`. Mock `toolExecutor.execute()` to return a success `ToolResultDTO`. Assert the orchestrator loops correctly, both tools execute and compact, and the turn ends in `completed`.
  - **Happy path: multi-tool sequential execution**: `ActionDecision` with 3 `ToolCallEntry` items. Assert all three are executed in order (verify via mock call sequence). Assert each result is compacted and stored in memory.
  - **Clarify follows same terminal path as respond**: `decision.kind = "clarify"` → transitions through `responding` → `finalizing` → `completed`. Assert no different behavior from `respond`.
  - **Abort decision terminates turn**: `decision.kind = "abort"` → transitions `validating` → `aborted`. Assert returned envelope has `state = "aborted"`.
  - **Governor step limit abort**: Envelope with `step_count = 11`, `max_inference_steps = 12`. First inference completes (step_count becomes 12). Second loop iteration, governor check: `step_count >= 12` → abort. Assert orchestrator transitions `building_context` → `aborted` without calling inference.
  - **Governor wall clock abort**: `startedAt` set far in the past so `Date.now() - startedAt > max_wall_clock_ms`. First governor check → abort before any inference. Assert envelope `state = "aborted"` with reason metadata.
  - **Governor repair limit abort**: Mock `validateAndRepair` to return `{ outcome: "abort", ... }`. Assert orchestrator transitions to `aborted`. Also test: the governor aborts only when the next re-inference would cause `repair_attempts_used` to exceed `max_repair_attempts`, while the equality case remains covered by validation-side exhaustion handling.
  - **Repair → re-enter building_context → successful re-inference**: Mock first `validateAndRepair` → `"repair"` (with updatedEnvelope having incremented repair_attempts_used). Mock second → `"valid"` with respond. Assert the orchestrator loops through `building_context` → `inferring` → `validating` → `responding` → `finalizing` → `completed`.
  - **LLMProviderError caught and aborts turn**: Mock `llmProvider.infer()` to throw `LLMProviderError`. Assert orchestrator catches it, transitions to `aborted`, and does NOT crash.
  - **Unexpected error propagates**: Mock `llmProvider.infer()` to throw a plain `Error` (not `LLMProviderError`). Assert the orchestrator does NOT catch it — the error propagates to the caller.
  - **Event emission at every transition**: Provide a mock `TurnEventEmitter`. Assert `emit()` is called for each transition (`turn.building_context`, `turn.inferring`, `turn.validating`, `turn.responding`, `turn.finalizing`, `turn.completed`). Assert event names use `turn.<state>` convention.
  - **No event emitter provided — proceeds silently**: Omit `eventEmitter`. Assert the orchestrator completes without throwing and without attempting to emit events.
  - **Transition metadata carries decisionKind**: For a respond decision, assert the `responding` transition metadata includes `decisionKind: "respond"`. For a governor abort, assert `reason` metadata is present.
  - **Envelope immutability**: Assert the input envelope object is not mutated after `executeTurn()` returns. Compare pre- and post-call copies.
  - **Safety counter prevents infinite loop**: Create a scenario that would loop indefinitely (e.g., mock always returns `tool_calls` with no tool calls). Assert the orchestrator throws after exceeding the hard safety limit (e.g., 100 iterations).
  - **Empty tool_calls array**: `ActionDecision.kind = "tool_calls"` but `tool_calls` is empty. Assert orchestrator transitions through `executing_tools` → `compacting` → `building_context` without calling `toolExecutor`.
  - **Compaction revision is updated**: After a tool_calls → compacting cycle, assert `compaction_revision` on the returned envelope is incremented from its initial value.
  - **Step count increment on terminal transitions**: Assert `step_count` increments by 1 for each complete decision cycle (compacting→building_context for tool_calls, finalizing→completed for respond) per the `STEP_INCREMENT_TRANSITIONS` rules from slice 0024.
  - **No step count increment on system abort**: Governor-triggered abort from `building_context` → `aborted` should NOT increment `step_count` (it's not in `STEP_INCREMENT_TRANSITIONS`).
  - **Response message stored in memory**: For a respond decision, assert the response message is stored as a `ContextItem` in episodic memory with appropriate layer and origin.
  - **Full turn integration test** (end-to-end within agentic_core boundary): Wire real implementations of all agentic_core components (EpisodicMemory, PromptCompiler, ContextSelector, CompactionPolicy) with mock LLMProvider and mock ToolCallExecutor. Run a complete 3-step turn: tool_calls → tool_calls → respond. Assert the resulting envelope is in `completed` state with correct `step_count` and `compaction_revision`.
- Narrow validation step:
  - `pnpm --filter @argentum/agentic-core test` passes with all orchestrator tests (non-vacuous).
  - `pnpm --filter @argentum/agentic-core build` succeeds (TypeScript compilation, including new `@argentum/llm-provider` dependency).
  - `pnpm --filter @argentum/agentic-core lint` passes.
  - `pnpm typecheck` passes (full-project type checking, verifying no cross-package type errors introduced).
  - Run the full repo test suite to verify no regressions: `pnpm test`.

## Execution Strategy

- Autopilot suitability: **conditional**. This slice is:
  - **Bounded**: Single owning package (`agentic_core`), well-defined dependencies, clear acceptance criteria.
  - **Complex**: The orchestrator is the most complex component in agentic_core — it wires 7+ existing components together through a 200+ line state machine loop. The implementation requires careful handling of async flows, error paths, and state transitions.
  - **Dependent on upstream slices**: Cannot be implemented until slices 0030 (validation & repair) and 0031 (LLM provider interface) are validated. If autopilot is used, it must verify these dependencies are satisfied first.
  - **Risks for autopilot**: The orchestrator loop logic has many branches (valid→tool_calls, valid→respond, valid→abort, repair→loop, abort→terminal, governor→abort, provider_error→abort). Getting ALL edge cases correct requires careful attention. Mock setup for tests is intricate.
  - **Mitigations**: The acceptance criteria are detailed with specific transition sequences. The test plan covers 20+ scenarios including all branches, error paths, and edge cases. The step-by-step pseudocode in the plan section provides a clear implementation guide.
  - **Verdict**: Conditional — safe for autopilot ONLY after slices 0030 and 0031 are validated AND the autopilot agent is configured with the full context of all dependent modules. Manual code review of the orchestrator loop is recommended before approval.
- Parallel subagent opportunities:
  - **Read-only subagent: dependency interface audit** — Verify that all types imported by the orchestrator plan (`LLMProvider`, `LLMProviderError` from `@argentum/llm-provider`; `EpisodicMemory`, `PromptCompiler`, `ContextSelector`, `CompactionPolicy`, `evaluateGovernor`, `validateAndRepair`, `executeTransition` from `@argentum/agentic-core`; all contract types from `@argentum/contracts`) exist and have the expected shapes. This is independent of orchestrator implementation.
  - **Read-only subagent: test scenario completeness review** — Cross-reference the test plan against the core-loop-state-machine.md spec to verify all transitions, terminal outcomes, and invariants are covered. This is independent of implementation.
  - **Read-only subagent: spec gap analysis** — Review the orchestrator design against the eventing model, runtime lifecycle, and validation/repair specs to identify any behavioral gaps or unhandled edge cases BEFORE implementation starts.
- Out of scope:
  - Session locking, queue management, or persistence (gateway concerns)
  - Provider-specific API calls (delegated to `LLMProvider`)
  - Tool execution implementation (delegated to `ToolCallExecutor`)
  - Grant resolution implementation (delegated to `ToolCallExecutor`)
  - Tool registry integration (resolved by composition root)
  - Event emission implementation (only the `TurnEventEmitter` interface is consumed)
  - CLI channel rendering or user-facing output
  - Turn envelope creation or validation (gateway + contracts concerns)
  - Bedrock immutability enforcement (enforced by context selector + memory conventions)
  - Secret resolution or redaction (environment concern)
  - Telemetry persistence or log formatting (telemetry package concern)
  - Multi-provider failover or routing (MVP single-provider)
  - Parallel tool execution (MVP sequential)
  - Background summarization or long-term memory writeback
- Deferred decisions that must remain deferred:
  - Exact DeepSeek endpoint and model selection (deferred per `docs/spec/70-roadmap/deferred-decisions.md`)
  - Exact compaction size thresholds (deferred per roadmap)
  - Whether tool exposure per step is full-registry or curated subset in MVP (deferred per roadmap)
  - Queue coalescing behavior beyond FIFO (deferred per roadmap)
  - Exact `inference_policy` subfields (deferred per `docs/spec/20-contracts/llm-adapter-contract.md`)
  - Maintenance-mode semantics for bedrock mutation (deferred per roadmap)

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **CRITICAL C1 — `building_context → aborted` transition was absent** (RESOLVED 2026-05-24): Human decision Option A — add `building_context → aborted` to state machine spec and `ALLOWED_TRANSITIONS`. Slice card updated with explicit AC, updated transition order list, and Prerequisites section noting the required change to slice 0024.
  - **CRITICAL C2 — `inferring → aborted` transition was absent** (RESOLVED 2026-05-24): Human decision Option A — add `inferring → aborted` to state machine spec and `ALLOWED_TRANSITIONS`. Slice card updated with explicit AC and Prerequisites section.
  - **HIGH H1 — `contextSelector.select()` missing `budget` parameter** (RESOLVED 2026-05-24): Pseudocode fixed to pass `{ budget: current.budget }` as second argument to `contextSelector.select()`.
  - **HIGH H2 — missing `PromptCompilerError` handling** (RESOLVED 2026-05-24): Pseudocode updated with try/catch around `promptCompiler.compile()` that catches `PromptCompilerError` and transitions `building_context → aborted`. Import list updated to include `PromptCompilerError`.
  - **MEDIUM M1 — missing externalization seam for large or truncated tool results** (RESOLVED 2026-05-24): Acceptance criteria refined to require injected `TurnContentStore` and to pass that seam into `compactionPolicy.compact(...)`. The implemented orchestrator now externalizes large or truncated tool results through the injected seam and persists the compacted summary text behind the returned `ContextItem.content_ref` before the item enters episodic memory.
  - **HIGH H3 contributor — slice 0034 response/abort `ContentRef` values did not map to persisted text** (RESOLVED FOR 0034-OWNED PATHS 2026-05-24): Acceptance criteria refined so respond and abort paths persist their text content through `TurnContentStore.write(...)` using unique working-area locators instead of reusing the bare turn ID. This resolves the 0034-owned `ContentRef` persistence gap without widening into slice 0030 repair-feedback ownership.
  - **HIGH H4 — failure-side lifecycle event ordering assertions were incomplete** (RESOLVED 2026-05-24): The implementation already emitted `llm.failed`, `validation.repair_requested`, and `validation.aborted`, but focused tests did not prove their ordering against `turn.aborted` or repair-loop `turn.building_context` re-entry. Added targeted assertions for the provider-failure path, repair re-entry path, and repair-exhaustion path.
  - **MEDIUM M2 — status metadata was stale** (RESOLVED 2026-05-24): The status block still described slice 0034 as blocked on upstream planned work even though slices 0024, 0030, and 0031 were already implemented and validated. Updated `Implemented` and `Execution readiness` metadata to current reality.
- Refinements applied:
  - 2026-05-24: C1/C2 resolved by human decision (Option A). H1/H2 resolved. Prerequisites section added documenting required slice 0024 updates. Spec citation updated. Transition order list updated with new `aborted` edges.
  - 2026-05-24 (adversarial review #2): Remediated H1–H4 from second adversarial review:
    - **H1 — Missing abort context verification**: Added `memory.getRecent()` assertions verifying `origin === "system"` and `/^abort:/` context_id in all abort-path tests (governor step limit, wall clock, abort decision, LLMProviderError, repair exhaustion, PromptCompilerError).
    - **H2 — Tool executor throws unhandled**: Wrapped `toolExecutor.execute()` + `compactionPolicy.compact()` calls in try/catch in `core-loop-orchestrator.ts`. On catch, stores abort context and transitions `executing_tools → aborted`. Added `executing_tools → aborted` to `ALLOWED_TRANSITIONS` (now 15 edges). Added test: mock `toolExecutor.execute` to reject → assert `result.state === "aborted"` + abort context in memory.
    - **H3 — Compaction throws unhandled**: Same try/catch wrapping covers `compactionPolicy.compact()` rejections. Added test: mock `compactionPolicy.compact` to reject → assert `result.state === "aborted"` + abort context in memory.
    - **H4 — Weak event ordering validation**: Replaced all `toContain` assertions in event emission tests with ordered `toEqual` assertions verifying exact event sequence for respond path, tool_calls path, and abort path.
    - **C1 (spec file not updated)**: KNOWN, ACCEPTED gap — human deferred spec editing. Not escalated.
    - Updated `turn-state-machine.test.ts` edge counts (14→15, 12→13) and `expectedEdges` array. Updated source comment in `turn-state-machine.ts`.
  - 2026-05-24 (audit 0016 remediation): Added exported `TurnContentStore` seam to the orchestrator dependency bag. `CompactionResult` now carries `committedText`, letting the orchestrator persist the exact compacted summary text for inline, error, and externalized tool results before memory insertion. Response and abort context now use unique working-area locators and persist their backing text before `memory.add(...)`. Added focused orchestrator tests proving truncated tool-result externalization + summary persistence, response-message persistence, and abort-context persistence.
  - 2026-05-24 (adversarial review #3 remediation): Remediated the follow-up 0034 review findings recorded for public surface, abort persistence, event families, and adjacent proof:
    - **HIGH — public mutable memory field**: Converted the injected memory dependency to a private `#memory` field so `executeTurn()` is again the only public method/surface on `CoreLoopOrchestrator`.
    - **HIGH — abort terminal path missing full persisted context**: Abort persistence now writes structured working-area text containing both `reason` and `last_known_state`. Focused tests now assert the persisted payload for abort-decision, governor-abort, and provider-failure paths.
    - **HIGH — event seam too narrow**: Widened `TurnEventEmitter` metadata to support non-transition payloads and added turn-scoped `llm.*`, `validation.*`, `tool.*`, `memory.*`, and `response.*` lifecycle events in the orchestrator. Ordered event tests now prove those families on respond, tool-call, abort, and blocked-tool flows.
    - **MEDIUM — missing storage/resolution proof**: Added an adjacent resolver-requiring proof in `core-loop-orchestrator.test.ts` that round-trips a persisted compaction `ContentRef` by `storage_area + locator` on the second inference step.
    - **Adversarial review follow-up outcome**: The subagent follow-up surfaced no concrete remaining HIGH or MEDIUM findings in the updated slice.
  - 2026-05-24 (latest adversarial review remediation): Added focused failure-path event ordering assertions proving `llm.failed` precedes `turn.aborted` on `LLMProviderError`, `validation.repair_requested` precedes `turn.building_context` re-entry on repair, and `validation.aborted` precedes `turn.aborted` on repair exhaustion. Refreshed the status metadata to reflect that slice 0034 and its upstream prerequisites are implemented and validated.
  - 2026-05-24 (focused repair pass): Remediated the remaining 0034 findings without widening beyond the adjacent validation-repair seam:
    - **HIGH — repair feedback `ContentRef` lacked persisted backing text**: Extended the adjacent `ValidationOutcome` repair variant to carry `feedbackText`, then had the orchestrator persist that text through `TurnContentStore.write(...)` before repair re-entry. Added a focused re-inference test proving the persisted repair feedback `ContentRef` resolves by `storage_area + locator` on the next inference step.
    - **HIGH — inline small-result compaction left `compaction_revision` unchanged**: Updated `CompactionPolicy.compactInline(...)` so inline committed summaries increment `newRevision`, matching the compaction policy spec. Added unit and orchestrator tests proving the success path increments `compaction_revision`.
    - **MEDIUM — step-limit test mislabeled behavior**: Renamed the boundary test so it now proves that a terminal respond path may complete on the final permitted step, while the abort case remains covered by the tool-loop re-entry test.
    - **Adversarial review outcome**: Post-fix subagent review surfaced no new CRITICAL, HIGH, or MEDIUM findings in the updated 0034-owned implementation.
- Validation:
  - `pnpm --filter @argentum/agentic-core test`: 312 tests pass (9 files)
  - `pnpm typecheck`: clean
