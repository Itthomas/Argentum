# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: human (CRITICAL C1/C2 resolved 2026-05-24)
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core
- Implemented: 2026-05-24
- Execution readiness: ready-when-approved. This slice depends on `@argentum/contracts` for `ActionDecision`, `DecisionKind`, `TurnEnvelope`, `TurnBudget`, `ContextItem`, `ContentRef`, and `parseActionDecision` (slices 0007, 0012, 0013 — all validated). It also depends on `EpisodicMemory` from `@argentum/agentic-core` (slice 0025, implemented) for appending repair feedback. The `@argentum/agentic-core` package already has `@argentum/contracts` as a workspace dependency (added by slice 0024). The `EpisodicMemory` class is already implemented and exported.

## Scope

- Slice name: Agentic Core — Validation and Repair Policy
- Target package or boundary: `agentic_core` (`@argentum/agentic-core`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "Multi-tool action decisions execute sequentially in MVP"
  - [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md) — **sole authority** for validation layers, repair rules, recovery paths, and non-goals
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — cross-reference: `validating` state transitions: to `building_context` (repair re-entry), `executing_tools` (tool_calls), `responding` (respond/clarify), `aborted` (abort or cannot recover)
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md) — `repair_attempts_used` increment semantics and `max_repair_attempts` budget
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md) — `ActionDecision` contract shape, `DecisionKind` union, `ToolCallEntry` shape, validation rules
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `TurnEnvelope` with `budget.repair_attempts_used` and `budget.max_repair_attempts`
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md) — `ContextItem` shape for repair feedback entries
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — `ContentRef` shape for repair feedback references
  - [docs/spec/40-modules/agentic-layer/episodic-memory.md](../../spec/40-modules/agentic-layer/episodic-memory.md) — repair feedback is stored in episodic memory
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "failure-path tests for repair exhaustion" and "state-machine tests for allowed and forbidden transitions"
- Acceptance criteria:
  - **`ValidationOutcome` type exported**: a discriminated union on `outcome`:
    - `{ outcome: "valid", decision: ActionDecision }` — the decision passed canonical contract validation; the core loop should route to `executing_tools`, `responding`, or `aborted` based on `decision.kind`
    - `{ outcome: "repair", feedback: ContextItem, updatedEnvelope: TurnEnvelope }` — validation failed but repair is possible; feedback was appended to episodic memory; `repair_attempts_used` was incremented; the core loop should re-enter `building_context`
    - `{ outcome: "abort", reason: string, updatedEnvelope: TurnEnvelope }` — validation failed and repair is exhausted or unrecoverable; the core loop should transition to `aborted`
  - **`validateAndRepair(decision: ActionDecision, envelope: TurnEnvelope, memory: EpisodicMemory): ValidationOutcome` exported** — synchronous function:
    1. Validate `decision` against canonical contracts using `parseActionDecision` from `@argentum/contracts`
    2. If validation passes: return `{ outcome: "valid", decision }`
    3. If validation fails: check whether repair attempts remain (`envelope.budget.repair_attempts_used < envelope.budget.max_repair_attempts`)
       - If repairs remain: increment `repair_attempts_used`, construct repair feedback `ContextItem`, call `memory.add(feedback)`, return `{ outcome: "repair", feedback, updatedEnvelope }`
       - If repairs exhausted: return `{ outcome: "abort", reason: "repair_attempts_exhausted", updatedEnvelope }`
  - **Canonical contract validation only**: The module validates by delegating entirely to `parseActionDecision()` from `@argentum/contracts`. It does NOT implement its own conditional field validation logic — `parseActionDecision` is the single source of truth for all `ActionDecision` schema rules (required fields, correct types, valid `kind` literal, conditional field rules including kind-specific `message`/`tool_calls` requirements). It does NOT validate:
    - Provider adapter normalization (owned by provider adapters)
    - Tool argument schema (owned by tool layer)
    - Governor budget checks (owned by turn governor, slice 0029)
  - **Repair feedback `ContextItem` shape**: When validation fails and repair is attempted, the function constructs a `ContextItem` with:
    - `context_id`: `"repair:<decision_id>"` — deterministic, reproducible ID keyed to the failed decision
    - `layer`: `"system"` — repair feedback is system-level corrective guidance (per CRITICAL C1 resolution: uses an existing canonical layer rather than introducing a new layer literal)
    - `role`: `"system"` — consistent with system-layer placement
    - `content_ref`: a `ContentRef` with `kind: "text"`, `storage_area: "working"`, `retention: "session"`, `ref_id: "repair:<decision_id>"`, `locator: "repair:<decision_id>"` — the `retention` field is required by the `ContentRef` contract; `"session"` is appropriate for turn-scoped repair feedback. The actual feedback text is embedded in the `ContextItem` metadata; the `content_ref` serves as a formal locator (the prompt compiler resolves repair feedback directly from episodic memory).
    - `origin`: `"repair"` — indicates the entry was generated by the repair policy
    - `retention`: `"rolling"` — repair feedback is transient, scoped to the current turn
    - `token_estimate`: derived from feedback text length (using `Math.ceil(Buffer.byteLength(feedbackText, "utf-8") / 4)`) 
  - **Repair feedback content**: The feedback text is a compact, operational message that includes:
    - The validation error summary (from `ActionDecisionValidationError.issues`)
    - The expected schema constraints (e.g., "`message` is required for `respond` kind")
    - A directive to re-generate the decision with corrected structure
    - Format: `"Validation failed for decision <decision_id>: <error summary>. Expected: <constraint>. Please re-generate with corrected structure."`
  - **`repair_attempts_used` increment**: The returned `updatedEnvelope` has `budget.repair_attempts_used` incremented by exactly 1. All other envelope fields are preserved (identity, state, step_count, context_refs, compaction_revision). The original `envelope` is NOT mutated.
  - **Validation delegation (CRITICAL C2 resolution)**: The module does NOT implement its own conditional field validation. All `ActionDecision` validation — including kind-specific rules (`message` required for `respond`/`clarify`, `tool_calls` required for `tool_calls`, `abort` handling per spec) — is delegated entirely to `parseActionDecision()` from `@argentum/contracts`. This avoids duplication and ensures a single source of truth. The module catches `ActionDecisionValidationError` to extract structured issues for repair feedback.
  - **The module does NOT**:
    - Trigger re-inference — it returns an outcome that the core loop acts on
    - Own tool argument schema validation (delegated to tool layer)
    - Own provider adapter normalization (delegated to provider adapters)
    - Own governor budget checks (delegated to turn governor)
    - Mutate the input `envelope` or `decision` — returns new objects
    - Emit telemetry (owned by core loop)
    - Manage session locks or persistence
- Inputs crossing the boundary:
  - `ActionDecision` — the normalized decision to validate, from `@argentum/contracts` (slice 0013)
  - `TurnEnvelope` — the current turn envelope with budget counters, from `@argentum/contracts` (slice 0007)
  - `EpisodicMemory` — the session-scoped memory store for appending repair feedback, from `@argentum/agentic-core` (slice 0025, implemented)
- Outputs crossing the boundary:
  - `ValidationOutcome` discriminated union — `valid`, `repair`, or `abort`; the `repair` variant carries both the repair `ContextItem` and its `feedbackText` so the core loop can persist the backing text through its content-store seam before re-inference
  - `validateAndRepair` function — synchronous, exported from `@argentum/agentic-core`

## Plan

- First contracts or interfaces to create:
  - `ValidationOutcome` type — discriminated union with three variants
  - `validateAndRepair` function signature
  - Repair feedback `ContextItem` factory (private helper)
- Minimal implementation steps:
  1. Create `packages/agentic_core/src/validation-repair.ts`:
     - Import `ActionDecision`, `DecisionKind`, `parseActionDecision`, `ActionDecisionValidationError` from `@argentum/contracts`
     - Import `TurnEnvelope`, `TurnBudget` from `@argentum/contracts`
     - Import `ContextItem`, `ContextLayer`, `ContentRef`, `ContentRefKind` from `@argentum/contracts`
     - Import `EpisodicMemory` from `./episodic-memory.js`
     - Import `Buffer` from `node:buffer`
     - Import `randomUUID` from `node:crypto` (for generating `ref_id` if needed)
     - Define and export `ValidationOutcome` type
     - Define private helper `buildRepairFeedback(decision: ActionDecision, error: ActionDecisionValidationError): ContextItem`
       - Construct `context_id: "repair:<decision_id>"`
       - Construct error summary from `error.issues`
       - Build feedback text with validation error details and schema expectations
       - Return a `ContextItem` with `layer: "system"`, `role: "system"`, `origin: "repair"`, `retention: "rolling"`
     - Define private helper `incrementRepairAttempts(envelope: TurnEnvelope): TurnEnvelope`
       - Return a new `TurnEnvelope` with `budget.repair_attempts_used + 1`, all other fields preserved
     - Implement and export `validateAndRepair(decision: ActionDecision, envelope: TurnEnvelope, memory: EpisodicMemory): ValidationOutcome`:
       1. Call `parseActionDecision(decision)` — this is the SINGLE source of validation (per CRITICAL C2 resolution; no custom `validateConditionalFields`)
       2. If it returns successfully: return `{ outcome: "valid", decision }`
       3. If it throws `ActionDecisionValidationError`: catch the error, extract `issues` for repair feedback
       4. Check `envelope.budget.repair_attempts_used < envelope.budget.max_repair_attempts`
          - If repairs remain: build repair feedback via `buildRepairFeedback()`, call `memory.add(feedback.contextItem)`, increment repair attempts, return `{ outcome: "repair", feedback: feedback.contextItem, feedbackText: feedback.feedbackText, updatedEnvelope }`
          - If repairs exhausted: return `{ outcome: "abort", reason: "repair_attempts_exhausted", updatedEnvelope }` — note: `repair_attempts_used` is NOT incremented on abort (per spec, the counter increments only on committed repair attempts, not terminal failures). The returned envelope is a shallow copy of the input envelope.
  2. Update `packages/agentic_core/src/index.ts` to export all public symbols from `validation-repair.ts`
- Required tests:
  - **Valid respond decision**: Provide a valid `ActionDecision` with `kind: "respond"`, `message: "Hello"`. Assert `outcome === "valid"` and the returned decision matches input.
  - **Valid tool_calls decision**: Provide a valid `ActionDecision` with `kind: "tool_calls"`, `tool_calls: [{ tool_name: "read", arguments: {} }]`. Assert `outcome === "valid"`.
  - **Valid clarify decision**: Provide a valid `ActionDecision` with `kind: "clarify"`, `message: "What file?"`. Assert `outcome === "valid"`.
  - **Valid abort decision**: Provide a valid `ActionDecision` with `kind: "abort"`, `message: "Cannot proceed"`. Assert `outcome === "valid"`.
  - **Schema failure — missing decision_id**: Provide an object missing `decision_id`. Assert `parseActionDecision` throws → caught → repair path. Assert `outcome === "repair"` when repairs remain.
  - **Schema failure — invalid kind**: Provide `kind: "invalid_kind"`. Assert repair path.
  - **Schema failure — respond missing message**: Provide `kind: "respond"` with no `message`. Assert `parseActionDecision` catches it → repair path (delegated validation, not custom logic).
  - **Schema failure — tool_calls missing array**: Provide `kind: "tool_calls"` with no `tool_calls`. Assert repair path via `parseActionDecision`.
  - **Repair feedback stored in memory**: On validation failure with repairs remaining, assert `memory.getRecent(1)[0].layer === "system"` and the feedback `context_id` matches `"repair:<decision_id>"`.
  - **Repair feedback content includes error details**: Assert the repair feedback `ContextItem` contains the validation error summary in its content reference.
  - **repair_attempts_used incremented on repair**: Provide an envelope with `repair_attempts_used: 0`, `max_repair_attempts: 3`. After a repair outcome, assert `updatedEnvelope.budget.repair_attempts_used === 1`.
  - **repair_attempts_used NOT incremented on valid**: After a valid outcome, assert the input envelope is not mutated (no `updatedEnvelope` returned in valid path; caller retains original).
  - **Repair exhaustion → abort**: Provide `repair_attempts_used: 3`, `max_repair_attempts: 3`. Provide an invalid decision. Assert `outcome === "abort"` with `reason: "repair_attempts_exhausted"`. Assert `updatedEnvelope.budget.repair_attempts_used === 3` (NOT incremented — per spec, increment only on committed repair attempts).
  - **Repair exhaustion just below limit**: Provide `repair_attempts_used: 2`, `max_repair_attempts: 3`. Invalid decision → `outcome === "repair"` (one more repair allowed).
  - **Multiple repair attempts**: Simulate 3 sequential repair calls (repair_attempts_used: 0→1→2). Assert each returns `"repair"`. The 4th call (at 3/3) returns `"abort"`.
  - **Immutability — envelope not mutated**: Call `validateAndRepair` with an invalid decision; assert the input envelope's `budget.repair_attempts_used` is unchanged.
  - **Immutability — decision not mutated**: Assert the input `ActionDecision` object is unchanged after the call.
  - **Repair feedback token estimate**: Assert the repair feedback `ContextItem.token_estimate` is > 0 and derived from the feedback text length.
  - **Deterministic context_id**: Call `validateAndRepair` twice with the same invalid decision (same `decision_id`). Assert both repair feedback entries have the same `context_id: "repair:<decision_id>"`.
  - **Repair feedback uses canonical `system` layer**: Assert the repair feedback `ContextItem.layer === "system"` — per CRITICAL C1 resolution, uses an existing canonical layer rather than introducing a new literal.
  - **TypeScript compilation**: The module must compile cleanly with no provider-native types imported or referenced.
- Narrow validation step:
  - `pnpm --filter @argentum/agentic-core test`
  - `pnpm typecheck`
  - `pnpm --filter @argentum/agentic-core build`

## Execution Strategy

- Autopilot suitability: **safe**. The slice is a synchronous validation-and-decision module (~120 lines) with clear dependencies on already-implemented modules (`parseActionDecision`, `EpisodicMemory`). All input types are validated in `@argentum/contracts`. The three outcome paths are explicitly defined by the spec. Tests are ~23 cases covering all validation scenarios, conditional field rules, repair exhaustion, and immutability. The only side effect is `memory.add()` which is a well-tested EpisodicMemory method. Autopilot can create the module and tests in one pass.
- Parallel subagent opportunities:
  - **Read-only spec cross-reference** (safe for parallel subagent): Verify that the validation and repair rules in this slice card exactly match `docs/spec/30-core-loop/validation-and-repair.md` and `docs/spec/30-core-loop/core-loop-state-machine.md`. Flag any discrepancies.
  - **Read-only contract dependency audit** (safe for parallel subagent): Verify that `@argentum/contracts` exports `ActionDecision`, `parseActionDecision`, `ActionDecisionValidationError`, `TurnEnvelope`, `TurnBudget`, `ContextItem`, `ContentRef` with the shapes expected by this slice.
  - **Read-only parallel with slice 0029** (safe): The validation-and-repair policy and turn governor have no mutual implementation dependencies — both can be implemented in parallel by separate subagents.
- Out of scope:
  - Provider adapter normalization (owned by provider adapters)
  - Tool argument schema validation (owned by tool layer)
  - Governor budget checks on step_count or wall clock (owned by turn governor)
  - Triggering re-inference or advancing the turn state machine (owned by core loop)
  - Telemetry emission on validation failure (owned by core loop)
  - Session lock management
  - Turn creation or `TurnEnvelope` validation
  - Provider adapter integration
  - Any I/O, file system, or network access
  - Preserving hidden chain-of-thought during repair (explicit non-goal per spec)
  - Delegating schema repair to channel modules or tools (explicit non-goal per spec)
- Deferred decisions that must remain deferred:
  - Exact local persistence technology for session and queue state — not relevant
  - Exact initial tool catalog included in MVP — not consumed by this slice
  - Exact DeepSeek endpoint and model selection — not consumed by this slice
  - Exact compaction size thresholds — not consumed by this slice
  - Maintenance-mode semantics for bedrock mutation — not relevant
  - Whether tool exposure per step is full-registry or curated subset in MVP — not consumed by this slice

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **C1 (CRITICAL) — `"repair_feedback"` is not a valid `ContextLayer`** (RESOLVED 2026-05-24): Per human decision, repair feedback will use the existing canonical `"system"` layer rather than introducing a new layer literal. The `ContextLayer` union (`"bedrock" | "environment" | "episodic" | "tool_summary" | "system"`) remains unchanged. No contract amendment needed.
  - **C2 (CRITICAL) — `validateConditionalFields` is redundant with `parseActionDecision`** (RESOLVED 2026-05-24): Per human decision, the module will delegate ALL validation to `parseActionDecision()` from `@argentum/contracts`. The custom `validateConditionalFields` helper is dropped. `parseActionDecision` is the single source of truth — it already validates all kind-specific field rules (`message` for `respond`/`clarify`, `tool_calls` for `tool_calls`, `abort` per spec).
  - **L1 (LOW) — Type assertions on literal types** (NOTED 2026-05-24): The `buildRepairFeedback` helper uses explicit type assertions (`as ContentRefKind`, `as ContentRefStorageArea`, `as ContentRefRetention`, `as ContextLayer`) for string literals. These are correct but could be avoided by using `as const` on the object literals. No behavior impact.
  - **L2 (LOW) — Duplicate envelope spread in abort paths** (NOTED 2026-05-24): The `unexpected_validation_error` and `repair_attempts_exhausted` abort paths both spread the envelope identically (`{ ...envelope }`). A shared helper could DRY this, but correctness is unaffected.
  - **No CRITICAL, HIGH, or MEDIUM findings.**
- Refinements applied:
  - C1: All references to `layer: "repair_feedback"` changed to `layer: "system"` in acceptance criteria, plan, and tests.
  - C2: Removed `validateConditionalFields` helper from plan. Simplified `validateAndRepair` to single-step `parseActionDecision()` delegation. Removed 5 conditional-failure tests (now covered by `parseActionDecision` contract tests).
  - Card status updated to `approved` (2026-05-24).
  - Implementation completed (2026-05-24): Created `validation-repair.ts`, updated `index.ts` exports, and created `validation-repair.test.ts`. The repair outcome now carries `feedbackText` so slice 0034 can persist repair feedback behind the returned `ContentRef` before re-inference. All focused and package validations pass. No contract amendments needed.

## Implementation Summary

### Files changed
- **Created**: `packages/agentic_core/src/validation-repair.ts` — `ValidationOutcome` type, `validateAndRepair` function, private helpers `buildRepairFeedback` and `incrementRepairAttempts`
- **Updated**: `packages/agentic_core/src/index.ts` — added exports for `validateAndRepair` and `ValidationOutcome`
- **Created**: `packages/agentic_core/tests/validation-repair.test.ts` — 33 tests covering valid paths, schema failures, repair feedback storage and returned backing text, repair attempt counters, repair exhaustion, immutability, edge cases, and export verification

### What validated
- `pnpm --filter @argentum/agentic-core test`: 312 tests passed (33 validation-repair tests included), 0 failures
- `pnpm typecheck`: full project typecheck passes cleanly
- `pnpm --filter @argentum/agentic-core build`: compiles without errors

### Remaining risks
- The `ContentRef.locator` uses the pattern `"repair:<decision_id>"`. This is a valid relative locator per `isRelativeLocator()` rules (no leading slash, no drive letter, no URI scheme with `://`). However, if `decision_id` values ever contain characters that make the locator invalid (e.g., a `://` substring), the `ContentRef` would fail validation inside `EpisodicMemory.add()`. This is unlikely with UUID-format `decision_id` values but worth noting.
- The `Buffer` import from `node:buffer` ties this module to Node.js runtime. This is consistent with the project's `"types": ["node"]` configuration and the MVP's server-side deployment model. If the package ever targets browser environments, `Buffer.byteLength` would need a substitute (e.g., `TextEncoder`).
- The repair feedback text is now surfaced on the `ValidationOutcome` repair variant rather than duplicated inside the `ContextItem` shape. That keeps slice 0030 contract-first while letting slice 0034 persist the backing text through its `TurnContentStore` seam before re-inference.
