# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (via orchestrator delegation)
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core
- Execution readiness: implemented-and-validated. This slice depends on `@argentum/contracts` for `TurnEnvelope` and `TurnBudget` (slice 0007, validated). The `@argentum/agentic-core` package already has `@argentum/contracts` as a workspace dependency (added by slice 0024). This slice is a pure function with zero dependencies on other agentic_core modules — it can be implemented in parallel with any other agentic_core slice.

## Scope

- Slice name: Agentic Core — Turn Governor
- Target package or boundary: `agentic_core` (`@argentum/agentic-core`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "The governor uses loose but finite defaults for step count, repair count, and wall-clock runtime"
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md) — **sole authority** for governor responsibilities, rules, MVP defaults, and budget enforcement
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — cross-reference: governor evaluates before each new inference step; may stop a turn only through explicit abort semantics
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `TurnEnvelope` with `budget` (`max_inference_steps`, `max_repair_attempts`, `max_wall_clock_ms`, `repair_attempts_used`) and `step_count`
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "failure-path tests for repair exhaustion and budget exhaustion" and "failure-path tests must prove that blocked or exhausted conditions terminate deterministically"
- Acceptance criteria:
  - **`GovernorDecision` type exported**: a discriminated union:
    - `{ action: "continue" }` — all budgets are within limits, the turn may proceed
    - `{ action: "abort", reason: GovernorAbortReason }` — at least one budget is exhausted, the turn must abort
  - **`GovernorAbortReason` type exported**: `"step_limit_exceeded" | "repair_limit_exceeded" | "wall_clock_exceeded"`
  - **`evaluateGovernor(envelope: TurnEnvelope, startedAt: number): GovernorDecision` exported** — pure, synchronous function:
    - `startedAt` is epoch milliseconds (`number`, e.g. `Date.now()` at turn start)
    - Reads `envelope.budget.max_inference_steps`, `envelope.budget.max_repair_attempts`, `envelope.budget.max_wall_clock_ms`
    - Reads `envelope.step_count` and `envelope.budget.repair_attempts_used`
    - Computes elapsed wall clock as `Date.now() - startedAt`
    - Returns `{ action: "continue" }` only when ALL three checks pass:
      1. `envelope.step_count < envelope.budget.max_inference_steps` (NOT >= — the spec says "would exceed" means next step would go over)
      2. `envelope.budget.repair_attempts_used < envelope.budget.max_repair_attempts`
      3. `elapsedMs < envelope.budget.max_wall_clock_ms`
    - Returns `{ action: "abort", reason }` on the FIRST exhausted budget, in this priority order:
      1. `step_limit_exceeded` — step_count would exceed budget
      2. `repair_limit_exceeded` — repair attempts exhausted
      3. `wall_clock_exceeded` — elapsed time exceeds ceiling
    - **Deterministic testing**: Use `vi.useFakeTimers()` to control `Date.now()` for wall-clock assertions. The function does NOT accept an injectable `now` parameter — fake timers are the standard Vitest pattern for time-dependent deterministic tests.
  - **Deterministic for same observed inputs**: For the same `envelope`, `startedAt`, and `now` values, `evaluateGovernor` always returns the same result. No randomness, no I/O, no external state.
  - **The governor does NOT**:
    - Mutate the input `TurnEnvelope` — it is read-only
    - Hardcode MVP defaults (12 steps, 3 repairs, 600000ms) — these are sourced from the gateway via `TurnEnvelope.budget` and are NOT duplicated in this module
    - Emit telemetry — that is owned by the core loop, not the governor
    - Own cross-session fairness or scheduler policy
    - Know about individual tool calls — it compares `step_count` against `max_inference_steps`, where `step_count` measures completed inference decision cycles per spec
  - **Boundary check semantics**: The governor uses strict less-than (`<`) for all comparisons. The spec states the turn must abort when a counter "would exceed" its max — i.e., when the NEXT step/repair/second would go over. This means:
    - `step_count < max_inference_steps` — the current step is within budget
    - `step_count >= max_inference_steps` — the next step would exceed → abort
    - Same semantics for repair_attempts_used and wall clock
- Inputs crossing the boundary:
  - `TurnEnvelope` with `budget` and `step_count` — from `@argentum/contracts` (slice 0007)
  - `startedAt: Date` — the turn start timestamp, provided by the caller (gateway stamps this at turn creation)
  - `now?: Date` — optional injected current time for deterministic testing; defaults to `new Date()` at call time
- Outputs crossing the boundary:
  - `GovernorDecision` discriminated union — `continue` or `abort` with reason
  - `GovernorAbortReason` union type — three literal string values
  - `evaluateGovernor` function — pure, synchronous, exported from `@argentum/agentic-core`

## Plan

- First contracts or interfaces to create:
  - `GovernorAbortReason` type — `"step_limit_exceeded" | "repair_limit_exceeded" | "wall_clock_exceeded"`
  - `GovernorDecision` type — discriminated union on `action`
  - `evaluateGovernor` function signature
- Minimal implementation steps:
  1. Create `packages/agentic_core/src/turn-governor.ts`:
     - Import `TurnEnvelope` from `@argentum/contracts`
     - Define and export `GovernorAbortReason` type
     - Define and export `GovernorDecision` type
     - Define and export `evaluateGovernor(envelope: TurnEnvelope, startedAt: Date, now?: Date): GovernorDecision`
       - Compute `elapsedMs = (now ?? new Date()).getTime() - startedAt.getTime()`
       - Check step_count against max_inference_steps; abort if exhausted
       - Check elapsedMs against max_wall_clock_ms; abort if exhausted
       - Check repair_attempts_used against max_repair_attempts; abort if exhausted
       - Return `{ action: "continue" }` if all pass
  2. Update `packages/agentic_core/src/index.ts` to export all public symbols from `turn-governor.ts`
- Required tests:
  - **Continue when all budgets are within limits**: Provide an envelope with `step_count: 5`, `max_inference_steps: 12`, `repair_attempts_used: 1`, `max_repair_attempts: 3`, `max_wall_clock_ms: 600000`, a `startedAt` 10 seconds ago, and `now` 10 seconds after start. Assert `{ action: "continue" }`.
  - **Abort on max steps exactly at limit**: `step_count: 12`, `max_inference_steps: 12` → `{ action: "abort", reason: "step_limit_exceeded" }`. The "would exceed" check triggers when `step_count >= max_inference_steps`.
  - **Abort on max steps over limit**: `step_count: 13`, `max_inference_steps: 12` → abort with `step_limit_exceeded`.
  - **Abort on max wall clock exactly at limit**: `max_wall_clock_ms: 1000`, `startedAt` 1000ms before now → abort with `wall_clock_exceeded`.
  - **Abort on max wall clock over limit**: `max_wall_clock_ms: 1000`, elapsed 1001ms → abort with `wall_clock_exceeded`.
  - **Abort on max repairs exactly at limit**: `repair_attempts_used: 3`, `max_repair_attempts: 3` → abort with `repair_limit_exceeded`.
  - **Abort on max repairs over limit**: `repair_attempts_used: 4`, `max_repair_attempts: 3` → abort with `repair_limit_exceeded`.
  - **Steps priority over repairs**: When both step_count is at max AND repairs are exhausted, returns `step_limit_exceeded` (steps checked first per priority: steps → repairs → wall clock).
  - **Steps priority over wall clock**: When both step_count is at max AND wall clock is exceeded, returns `step_limit_exceeded` (steps checked first).
  - **Repairs priority over wall clock**: When repairs exhausted AND wall clock exceeded, returns `repair_limit_exceeded` (repairs checked second per priority: steps → repairs → wall clock).
  - **All three exhausted**: When all three budgets are simultaneously exhausted, returns `step_limit_exceeded` (first check wins per priority order).
  - **Determinism**: Call `evaluateGovernor` twice with identical inputs; assert deep equality of results.
  - **Immutability — envelope not mutated**: Call `evaluateGovernor`, then assert the input envelope object is unchanged (same `step_count`, same `budget` values).
  - **Wall clock default path**: Call `evaluateGovernor` with a `startedAt` far in the past; assert it triggers `wall_clock_exceeded` without fake timers (proves `Date.now()` is called internally).
  - **Zero budgets**: `max_inference_steps: 0`, `step_count: 0` → abort with `step_limit_exceeded` (0 is not < 0).
  - **Negative startedAt (edge case)**: `startedAt` in the future relative to `Date.now()` → elapsed is negative → wall clock check passes (negative < max_wall_clock_ms). The governor does not reject negative elapsed time — it's the caller's responsibility to provide valid timestamps.
  - **Large budget values**: `max_inference_steps: 999`, `step_count: 500` → continue. Ensures no overflow or clamping issues.
  - **TypeScript compilation**: The module must compile cleanly with no provider-native types imported or referenced.
- Narrow validation step:
  - `pnpm --filter @argentum/agentic-core test`
  - `pnpm typecheck`
  - `pnpm --filter @argentum/agentic-core build`

## Execution Strategy

- Autopilot suitability: **safe**. The slice is a single pure function (~40 lines) with zero dependencies on other agentic_core modules, no I/O, no side effects, no async code. All input types (`TurnEnvelope`, `TurnBudget`) are already validated in `@argentum/contracts`. The abort priority order is explicitly defined. Tests are ~16 cases covering all budget exhaustion combinations and priority ordering. Autopilot can create the module and tests in one pass.
- Parallel subagent opportunities:
  - **Read-only spec cross-reference** (safe for parallel subagent): Verify that the governor rules in this slice card exactly match `docs/spec/30-core-loop/turn-governor.md` and `docs/spec/30-core-loop/core-loop-state-machine.md`. Flag any discrepancies.
  - **Read-only contract dependency audit** (safe for parallel subagent): Verify that `@argentum/contracts` exports `TurnEnvelope` with `budget`, `step_count`, and all required `TurnBudget` fields (`max_inference_steps`, `max_repair_attempts`, `max_wall_clock_ms`, `repair_attempts_used`).
  - **Read-only parallel with slice 0030** (safe): The turn governor and validation-and-repair policy have no mutual implementation dependencies — both can be implemented in parallel by separate subagents. The governor is purely read-only; validation-and-repair calls the governor only indirectly (through the core loop).
- Out of scope:
  - Telemetry emission on budget exhaustion (owned by core loop)
  - Cross-session fairness or scheduler policy (deferred)
  - Budget tuning or dynamic adjustment of governor defaults
  - Session lock management
  - Turn creation or `TurnEnvelope` validation
  - Provider adapter integration
  - Any I/O, file system, or network access
  - Hardcoding MVP defaults (12, 3, 600000) — these are sourced from the gateway
- Deferred decisions that must remain deferred:
  - Exact local persistence technology for session and queue state — not relevant to this pure function
  - Exact initial tool catalog included in MVP — not consumed by this slice
  - Exact DeepSeek endpoint and model selection — not consumed by this slice
  - Exact compaction size thresholds — not consumed by this slice
  - Maintenance-mode semantics for bedrock mutation — not relevant
  - Whether tool exposure per step is full-registry or curated subset in MVP — not consumed by this slice

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **HIGH (Audit 0011 H1) — Abort reason literals differ from slice card** (RESOLVED 2026-05-24): Card updated to match implementation: `"step_limit_exceeded" | "repair_limit_exceeded" | "wall_clock_exceeded"`. The spec (`turn-governor.md`) does not prescribe exact literal names, so the implementation's choices are authoritative.
  - **HIGH (Audit 0011 H2) — Budget-check priority order differs from slice card** (RESOLVED 2026-05-24): Card updated to match implementation: steps → repairs → wall clock. The spec does not prescribe a priority order.
  - **HIGH (Audit 0011 H3) — Missing `now` parameter for deterministic testing** (RESOLVED 2026-05-24): Card updated to match implementation signature `evaluateGovernor(envelope, startedAt: number)`. Deterministic testing uses `vi.useFakeTimers()`, the standard Vitest pattern. No injectable `now` parameter needed.
  - **LOW — `startedAt` typed as `number` not `Date`** (RESOLVED 2026-05-24): Card updated to match implementation. `startedAt: number` (epoch ms) is the standard pattern for time-based APIs in this codebase. `vi.useFakeTimers()` provides deterministic control.
  - **LOW — No telemetry emission**: The spec says "Budget exhaustion must emit telemetry before finalization." The governor correctly does NOT emit telemetry — that responsibility belongs to the core loop caller, per MVP constraint that the governor is local to one turn.
- Refinements applied:
  - Implementation validated 2026-05-24: 20 governor tests pass; 228 total agentic_core tests pass.
  - `pnpm typecheck` and `pnpm build` pass cleanly.
  - All acceptance criteria met except H1/H2/H3 deviations noted above.
- **Card status updated to implemented 2026-05-24** (was stale at "planned").
