# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core
- Execution readiness: ready-when-approved. This is the first implementation slice for the `@argentum/agentic-core` package (currently a shell with `export {}`). Slice 0007 (`TurnState` and `TurnEnvelope` contracts) is validated and available. Slice 0013 (`ActionDecision` contract) is validated and available. No upstream agentic_core slices exist — this slice creates the package's first real module.

## Scope

- Slice name: Agentic Core — Turn State Machine
- Target package or boundary: `agentic_core` (`@argentum/agentic-core`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "Multi-tool action decisions execute sequentially in MVP" and "Context compaction is inline in MVP"
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — **sole authority** for states, transitions, invariants, step semantics, and terminal outcomes
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `TurnState` and `TurnEnvelope` contracts already implemented in slice 0007
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md) — `ActionDecision.kind` values (`tool_calls`, `respond`, `clarify`, `abort`) used for transition routing metadata
  - [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md) — repair-context re-entry path (`validating` -> `building_context`) and repair-attempt semantics
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md) — budget enforcement ownership (agentic layer reads and enforces); governor-driven abort semantics
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "state-machine tests for allowed and forbidden transitions" and "state-machine tests must cover sequential multi-tool decisions"
- Acceptance criteria:
  - **10 TurnState values**: The module must recognize all 10 canonical states: `accepted`, `building_context`, `inferring`, `validating`, `executing_tools`, `compacting`, `responding`, `finalizing`, `completed`, `aborted`. The type must be imported from `@argentum/contracts` — this module does not redefine `TurnState`.
  - **11 allowed transitions**: The transition map must encode exactly these transitions:
    1. `accepted` -> `building_context`
    2. `building_context` -> `inferring`
    3. `inferring` -> `validating`
    4. `validating` -> `building_context` (repair re-entry)
    5. `validating` -> `executing_tools` (when `ActionDecision.kind = tool_calls`)
    6. `validating` -> `responding` (when `ActionDecision.kind = respond` or `clarify`)
    7. `validating` -> `aborted` (when `ActionDecision.kind = abort` or validation cannot recover)
    8. `executing_tools` -> `compacting`
    9. `compacting` -> `building_context` (after every MVP `tool_calls` decision)
    10. `responding` -> `finalizing`
    11. `finalizing` -> `completed` or `aborted`
  - **Transition guard function**: `isValidTransition(from: TurnState, to: TurnState): boolean` — a pure, synchronous function that returns `true` iff the `from` -> `to` pair is in the allowed transition map. All other pairs return `false`. Self-transitions (e.g., `accepted` -> `accepted`) are not allowed.
  - **Transition execution function**: `executeTransition(envelope: TurnEnvelope, to: TurnState, metadata?: TransitionMetadata): TurnEnvelope` — returns a NEW `TurnEnvelope` with:
    - `state` set to `to`
    - `step_count` incremented per spec step-semantics rules (see below)
    - `updated_at` set to current UTC timestamp
    - All identity fields (`turn_id`, `session_id`, `ingress_id`) preserved unchanged
    - `budget` and `context_refs` and `compaction_revision` preserved as-is (budget mutation is owned by later governor/recovery slices)
  - **Invalid transitions must throw a stable error**: When `isValidTransition(envelope.state, to)` returns `false`, `executeTransition` must throw a `TransitionError` (a named Error subclass) whose `message` includes the `from` state, the `to` state, and the `turn_id`. The error must NOT carry a stack of validation issues — it is a single deterministic rejection, not a multi-issue validation result.
  - **Step counting rules**: `step_count` increments ONLY on these specific transitions:
    - `compacting` -> `building_context` (+1): a `tool_calls` decision completed compaction and the turn re-enters context building
    - `validating` -> `aborted` (+1): an `abort` decision completed its terminal branch
    - `finalizing` -> `completed` (+1): a `respond` or `clarify` decision completed its terminal branch
    - All other transitions preserve the current `step_count` unchanged.
    - **Note**: `finalizing` -> `aborted` does NOT increment `step_count`. This transition represents a system interrupt (governor abort or finalization failure), not a decision completing its terminal branch. The spec ties `step_count` to decision completion, not system interrupts.
  - **Terminal states**: `completed` and `aborted` are terminal. `isTerminal(state: TurnState): boolean` returns `true` for both. No transition may originate from a terminal state — `isValidTransition` must return `false` for any `from` that is terminal, and `executeTransition` must throw `TransitionError` if called with a terminal `from` state.
  - **Turn event emitter interface**: The module must export a `TurnEventEmitter` interface with an `emit(eventName: string, envelope: TurnEnvelope, metadata?: TransitionMetadata): void` signature. The interface is defined but NOT implemented — actual event emission (telemetry wiring, log formatting, event persistence) is deferred to a future slice. The `executeTransition` function must accept an optional `eventEmitter?: TurnEventEmitter` parameter and call `eventEmitter.emit(...)` for every valid transition executed, with an event name following the `turn.<state>` convention (e.g., `"turn.building_context"`, `"turn.completed"`). If no emitter is provided, `executeTransition` proceeds silently without throwing.
  - **Invariants enforced**:
    - The core loop never consumes provider-native tool-call objects. This module does NOT import, reference, or accept any provider-native types. All types are canonical `@argentum/contracts` types.
    - Every state transition emits a `turn.*` event (via the event emitter interface when provided).
    - Finalization releases the session lock before archival work starts — this is enforced by later slices; the state machine only ensures `finalizing` can transition to `completed` or `aborted`.
  - **`TransitionMetadata` type**: A lightweight type exported from the module with these optional fields:
    - `decisionKind?: DecisionKind` — the `kind` of the `ActionDecision` that triggered the transition (imported from `@argentum/contracts`)
    - `reason?: string` — human-readable reason for the transition (repair feedback, governor stop, etc.)
  - **The module does NOT**:
    - Wire into the core loop or integrate with the prompt compiler, context selector, LLM adapter, tool dispatch, or episodic memory
    - Implement the event emitter — only the interface
    - Create, stamp, or validate `TurnEnvelope` values — that is owned by `@argentum/contracts` (parse/validate) and `@argentum/gateway` (creation)
    - Enforce governor budget limits (step_count ceiling, wall-clock, repair attempts) — governor enforcement is a separate future slice
    - Mutate `TurnEnvelope.budget` fields — budget counters are owned by future recovery and governor slices
    - Manage session locks or persistence — those remain gateway concerns
- Inputs crossing the boundary:
  - `TurnState` and `TurnEnvelope` types from `@argentum/contracts` (slice 0007)
  - `DecisionKind` type from `@argentum/contracts` (slice 0013) — used in `TransitionMetadata`
  - A `TurnEnvelope` value with a current valid `state` — provided by the caller (gateway at turn creation, then agentic_core loop)
  - An optional `TurnEventEmitter` implementation — provided by future telemetry wiring slice
- Outputs crossing the boundary:
  - `isValidTransition(from: TurnState, to: TurnState): boolean` exported from `@argentum/agentic-core`
  - `executeTransition(envelope: TurnEnvelope, to: TurnState, metadata?: TransitionMetadata, eventEmitter?: TurnEventEmitter): TurnEnvelope` exported from `@argentum/agentic-core`
  - `isTerminal(state: TurnState): boolean` exported from `@argentum/agentic-core`
  - `TurnEventEmitter` interface exported from `@argentum/agentic-core`
  - `TransitionMetadata` type exported from `@argentum/agentic-core`
  - `TransitionError` class exported from `@argentum/agentic-core`
  - `ALLOWED_TRANSITIONS` — a read-only map or record exported for test introspection (maps each `TurnState` to the set of allowed target states)
  - `STEP_INCREMENT_TRANSITIONS` — a read-only set or map exported for test introspection (identifies which `from` -> `to` pairs trigger a `step_count` increment). Uses `"from->to"` string-key format (e.g., `"compacting->building_context"`) for stable `Set<string>` membership. This format is a deliberate trade-off: it is fragile to state name typos but self-documenting and trivial to inspect in test output.

## Plan

- First contracts or interfaces to create:
  - `TransitionMetadata` type — lightweight metadata bag with optional `decisionKind` and `reason` fields
  - `TurnEventEmitter` interface — single-method `emit(eventName, envelope, metadata?)` contract
  - `TransitionError` class — named Error subclass for invalid transition rejections
  - `ALLOWED_TRANSITIONS` — static lookup table encoding the 11 allowed transitions
  - `STEP_INCREMENT_TRANSITIONS` — static set identifying the 3 step-count-incrementing transitions
- Minimal implementation steps:
  1. Add `@argentum/contracts` as a workspace dependency in `packages/agentic_core/package.json`
  2. Add TypeScript project reference: update `packages/agentic_core/tsconfig.json` to include `"references": [{ "path": "../contracts" }]` so that `tsc -b` correctly resolves the contracts dependency.
  3. Create `packages/agentic_core/src/turn-state-machine.ts`:
     - Import `TurnState`, `TurnEnvelope`, `DecisionKind` from `@argentum/contracts`
     - Define and export `TransitionMetadata` type
     - Define and export `TurnEventEmitter` interface
     - Define and export `TransitionError` class
     - Define and export `ALLOWED_TRANSITIONS: ReadonlyMap<TurnState, ReadonlySet<TurnState>>`
     - Define and export `STEP_INCREMENT_TRANSITIONS: ReadonlySet<string>` (using `"from->to"` key format for stable set membership)
     - Implement and export `isValidTransition(from: TurnState, to: TurnState): boolean`
     - Implement and export `isTerminal(state: TurnState): boolean`
     - Implement and export `executeTransition(envelope: TurnEnvelope, to: TurnState, metadata?: TransitionMetadata, eventEmitter?: TurnEventEmitter): TurnEnvelope`
       - Validate transition with `isValidTransition`; throw `TransitionError` on invalid
       - Compute new `step_count` (increment if pair is in `STEP_INCREMENT_TRANSITIONS`, else preserve)
       - Compute new `updated_at` (current ISO UTC timestamp)
       - Return a new `TurnEnvelope` object (spread identity, budget, context_refs, compaction_revision; set new state, step_count, updated_at)
       - If `eventEmitter` provided, call `eventEmitter.emit("turn.<to>", newEnvelope, metadata)`
  4. Update `packages/agentic_core/src/index.ts` to export all public symbols from `turn-state-machine.ts`
  5. Remove `"test": "vitest run --passWithNoTests"` from `packages/agentic_core/package.json` and replace with `"test": "vitest run"` (tests will be non-vacuous after this slice)
- Required tests:
  - **Valid transition tests**: One test per each of the 11 allowed transitions, asserting `isValidTransition` returns `true` and `executeTransition` returns a properly updated envelope with correct `state`, preserved identity fields, and appropriate `step_count` behavior
  - **Invalid transition tests**: Multiple tests for invalid pairs (e.g., `accepted` -> `completed`, `building_context` -> `executing_tools`, `inferring` -> `responding`), asserting `isValidTransition` returns `false` and `executeTransition` throws `TransitionError`
  - **Self-transition rejection**: Every state transitioning to itself must be rejected
  - **Terminal state guard**: No transition may originate from `completed` or `aborted` — `isValidTransition` returns `false` and `executeTransition` throws
  - **Step count increment tests**: Specific assertions for each of the 3 increment transitions:
    - `compacting` -> `building_context`: step_count +1
    - `validating` -> `aborted`: step_count +1
    - `finalizing` -> `completed`: step_count +1
  - **Step count non-increment tests**: Transitions that do NOT increment (including `finalizing` -> `aborted`, which is a system interrupt, not a decision completion). Full list: `accepted` -> `building_context`, `building_context` -> `inferring`, `inferring` -> `validating`, `validating` -> `building_context`, `validating` -> `executing_tools`, `validating` -> `responding`, `executing_tools` -> `compacting`, `responding` -> `finalizing`, `finalizing` -> `aborted` — all preserve step_count.
  - **Event emitter contract test**: Provide a mock `TurnEventEmitter` to `executeTransition` and assert it is called with the correct `turn.<state>` event name, the updated envelope, and the metadata; assert no call when emitter is not provided
  - **TransitionError shape test**: Assert error is instance of Error, has correct `name`, message includes `from`, `to`, and `turn_id`
  - **Immutability test**: Assert `executeTransition` returns a new object and does not mutate the input envelope
  - **Multi-step sequential test**: Simulate a full `tool_calls` cycle (`accepted` -> `building_context` -> `inferring` -> `validating` -> `executing_tools` -> `compacting` -> `building_context`) and assert step_count increments exactly once (on `compacting` -> `building_context`)
  - **Multi-cycle sequential test** (M1): Simulate two consecutive `tool_calls` cycles (cycle 1: through `compacting` -> `building_context`; cycle 2: through `compacting` -> `building_context` again). Assert step_count increments from 0 → 1 → 2 across the two cycles, confirming the state machine correctly handles multiple sequential tool_calls decisions.
  - **Full happy-path test**: Simulate a complete respond path (`accepted` -> ... -> `completed`) and assert correct final step_count and terminal state
  - **Provider-native type safety**: The module must compile cleanly with no provider-native types imported or referenced
- Narrow validation step:
  - `pnpm --filter @argentum/agentic-core test`
  - `pnpm typecheck`
  - `pnpm --filter @argentum/agentic-core build`

## Execution Strategy

- Autopilot suitability: **safe**. The slice is bounded to a single new module in `agentic_core` with no cross-package wiring, no persistence, no external I/O. The spec is unambiguous about every allowed transition, step-count rule, and invariant. All dependencies (`TurnState`, `TurnEnvelope`, `DecisionKind`) are already validated in `@argentum/contracts`. The implementation is ~150 lines of pure functions and static lookups plus ~200 lines of focused tests. Autopilot can create the module, tests, and package.json dependency update in one pass.
- Parallel subagent opportunities:
  - **Read-only validation scan** (safe for parallel subagent): A read-only subagent can scan `@argentum/contracts` exports to confirm that `TurnState`, `TurnEnvelope`, and `DecisionKind` are available and match the shapes expected by this slice. This is independent of implementation.
  - **Read-only spec cross-reference** (safe for parallel subagent): A read-only subagent can verify that the 11 transitions in the slice card exactly match `docs/spec/30-core-loop/core-loop-state-machine.md` and flag any discrepancies. This is independent of implementation.
- Out of scope:
  - Core loop orchestration (prompt compiler, context selection, LLM adapter calls, tool dispatch, episodic memory)
  - Actual event emission implementation (telemetry wiring, log formatting, event persistence)
  - Governor budget enforcement (step_count ceiling, wall-clock timeout, repair-attempt limit)
  - Budget field mutation (`repair_attempts_used` increment, budget exhaustion checks)
  - Session lock management
  - Turn creation or `TurnEnvelope` validation (owned by gateway and contracts)
  - Provider adapter integration
  - Compaction logic or episodic memory writes
  - Any I/O, file system, or network access
- Deferred decisions that must remain deferred:
  - Exact local persistence technology for session and queue state — not relevant to this pure state machine
  - Exact initial tool catalog included in MVP — not consumed by this slice
  - Exact DeepSeek endpoint and model selection — not consumed by this slice
  - Exact compaction size thresholds — not consumed by this slice
  - Maintenance-mode semantics for bedrock mutation — not relevant
  - Whether tool exposure per step is full-registry or curated subset in MVP — not consumed by this slice

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1**: `ActionDecisionKind` does not exist — must be `DecisionKind`. Found 5 occurrences.
  - **H2**: Missing TypeScript project reference to `contracts` in `agentic_core/tsconfig.json`.
  - **H3**: `finalizing → aborted` as step-count-incrementing transition not supported by spec.
  - **M1**: No test for multiple sequential tool_calls cycles.
  - **M2**: STEP_INCREMENT_TRANSITIONS string-key format fragile.
- Refinements applied:
  - **H1**: Replaced ALL 5 occurrences of `ActionDecisionKind` with `DecisionKind` (the actual export from `@argentum/contracts`).
  - **H2**: Added implementation sub-step 2: update `packages/agentic_core/tsconfig.json` to include `"references": [{ "path": "../contracts" }]`. Renumbered subsequent steps (3→4, 4→5).
  - **H3**: Removed `finalizing → aborted` from STEP_INCREMENT_TRANSITIONS. Updated step counting rules from 4 items to 3. Added explicit note that `finalizing → aborted` is a system interrupt, not a decision-terminal transition. Updated step-count non-increment test list to include `finalizing → aborted` explicitly.
  - **M1**: Added multi-cycle sequential test: simulate two consecutive `tool_calls` cycles and assert step_count increments from 0→1→2.
  - **M2**: Noted STEP_INCREMENT_TRANSITIONS `"from->to"` string-key format as deliberate trade-off in the outputs description (fragile to typos but self-documenting and easy to inspect).

## Implementation Review Log (2026-05-24)

### Validation Results

| Command | Result |
|---|---|
| `pnpm --filter @argentum/agentic-core test` | 77/77 passed (71 turn-state-machine + 6 package-entrypoint) |
| `pnpm typecheck` | Clean (0 errors) |
| `pnpm --filter @argentum/agentic-core build` | Clean |
| `pnpm build` (full project) | Clean |
| `pnpm test` (full project) | 965/965 passed across 29 files, 0 regressions |

### Adversarial Review: Implementation vs Spec

- **CRITICAL**: None found.
- **HIGH**: None found.
- **MEDIUM**: None found.
- **LOW**:
  - **L1**: `makeEnvelope` test helper uses `Partial<TurnEnvelope>` which bypasses `exactOptionalPropertyTypes` in tests. The production code correctly uses spread (`...envelope`) to handle optional `final_outcome`. No production impact.
  - **L2**: `STEP_INCREMENT_TRANSITIONS` string-key fragility is documented and accepted as a deliberate trade-off per M2 above.
  - **L3**: `updated_at` is set to `new Date().toISOString()` (UTC). Confirmed correct per spec requirement for UTC timestamps.

### Spec Conformance Checklist

| Criterion | Status |
|---|---|
| 10 TurnState values recognized (via contracts import) | ✓ |
| 12 directed transition edges encoded | ✓ |
| isValidTransition: pure, synchronous, boolean | ✓ |
| isTerminal: completed + aborted only | ✓ |
| executeTransition: validates, updates state/step_count/updated_at | ✓ |
| executeTransition: throws TransitionError on invalid | ✓ |
| TransitionError: named Error subclass, message includes from/to/turn_id | ✓ |
| Step count increments: compacting→building_context, validating→aborted, finalizing→completed | ✓ |
| Step count NOT incremented: all 9 other transitions (incl. finalizing→aborted) | ✓ |
| Terminal states: no transitions out (isValid=false, executeTransition throws) | ✓ |
| Identity fields preserved (turn_id, session_id, ingress_id, created_at) | ✓ |
| TurnEventEmitter interface exported (not implemented) | ✓ |
| TurnEventEmitter called on valid transitions, silent when omitted | ✓ |
| TransitionMetadata type exported (decisionKind?, reason?) | ✓ |
| ALLOWED_TRANSITIONS exported as ReadonlyMap | ✓ |
| STEP_INCREMENT_TRANSITIONS exported as ReadonlySet\<string\> | ✓ |
| No provider-native types imported | ✓ |
| No budget mutation | ✓ |
| No I/O, network, or filesystem access | ✓ |
| Multi-step tool_calls cycle test passing | ✓ |
| Multi-cycle (2x tool_calls) test passing | ✓ |
| Package entrypoint test passing | ✓ |

### Files Changed

- `packages/agentic_core/package.json` — added `@argentum/contracts` dependency, changed test script
- `packages/agentic_core/tsconfig.json` — added project reference to contracts
- `packages/agentic_core/src/turn-state-machine.ts` — **new**: state machine module (~130 lines)
- `packages/agentic_core/src/index.ts` — updated to re-export all public symbols
- `packages/agentic_core/tests/turn-state-machine.test.ts` — **new**: 71 tests
- `packages/agentic_core/tests/package-entrypoint.test.ts` — **new**: 6 tests

### Verdict

**PASS**. Implementation is a faithful rendering of the spec. All acceptance criteria met. No cross-package regressions. Ready for next slice.
