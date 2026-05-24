# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer
- Approval date: 2026-05-24
- Phase: 3
- Owner: tooling

## Scope

- Slice name: Tool retry policy handler (decision logic and single-retry wrapper)
- Target package or boundary: `tooling` (`@argentum/tooling`)
- Authoritative spec files:
  - [docs/spec/README.md](../spec/README.md) — entrypoint authority; frozen decisions include "Automatic tool retries are limited to one transient retry for read-only tools inside the tool layer."
  - [docs/spec/40-modules/tool-layer/retry-policy.md](../spec/40-modules/tool-layer/retry-policy.md) — **sole authority** for the retry decision rules and acceptance criteria
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../spec/40-modules/tool-layer/tool-schema-model.md) — `side_effect_level` canonical vocabulary (`read_only`, `workspace_mutation`, `host_mutation`, `external_effect`)
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../spec/40-modules/tool-layer/tool-registry.md) — registry is upstream of retry; retry happens inside the tool-layer boundary, not in the core loop
  - [docs/spec/20-contracts/tool-call-and-result.md](../spec/20-contracts/tool-call-and-result.md) — `ToolCallDTO` and `ToolResultDTO` shapes consumed and produced by retry logic
  - [docs/spec/50-implementation/package-boundaries.md](../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md) — requires "tool-execution tests for blocked grants and narrow retry behavior"
- Acceptance criteria:
  - **Pure decision function exists**: `shouldRetry(toolDef: ToolDefinition, result: ToolResultDTO): boolean` is a pure, synchronous function exported from `@argentum/tooling`. It returns `true` when ALL of the following hold, `false` otherwise:
    - `toolDef.side_effect_level === "read_only"` — mutations must never be retried automatically.
    - `result.status === "error"` — successful or blocked calls are never retried.
    - `result.retryable === true` — the implementation or registry must signal that retry is safe.
    - The call has not already been retried (tracked by the retry wrapper, not by `shouldRetry` itself).
  - **`shouldRetry` rejects mutating tools**: When `side_effect_level` is `workspace_mutation`, `host_mutation`, or `external_effect`, `shouldRetry` returns `false` regardless of `ToolResultDTO` contents.
  - **`shouldRetry` rejects non-error statuses**: When `result.status` is `success` or `blocked`, `shouldRetry` returns `false` regardless of `side_effect_level`.
  - **`shouldRetry` rejects non-retryable results**: When `result.retryable` is `false`, `shouldRetry` returns `false`.
  - **Optional retry wrapper**: `dispatchWithRetry(registry, toolDef, call): Promise<ToolResultDTO>` wraps a single registry `dispatch()` call with at-most-one automatic retry. On first `dispatch()` returning a result for which `shouldRetry` returns `true`, it calls `dispatch()` exactly one more time and returns the second result. If the first `dispatch()` result does not qualify for retry, it is returned immediately. **`ToolRegistry.dispatch()` never throws** — it catches all implementation errors and returns `TOOL_EXECUTION_FAILED` error results. Therefore `dispatchWithRetry` does NOT need a try/catch around `dispatch()` calls. Any error result from `dispatch()` (including `TOOL_EXECUTION_FAILED`) is handled through the normal `shouldRetry` check.
  - **Retry count invariant**: The wrapper never attempts more than one retry (max 2 total `dispatch()` calls per invocation).
  - **No ActionDecision leakage**: Retry logic stays inside the tool-layer boundary. The wrapper does not create, emit, or signal `ActionDecision` steps or any core-loop artifacts.
  - **Final result reflects post-retry outcome**: When a retry occurs, the returned `ToolResultDTO` is the second `dispatch()` result, not the first.
  - **No retry for structural failures (registry-level non-retryable results)**: `shouldRetry` correctly rejects `TOOL_NOT_REGISTERED` and `SCHEMA_VALIDATION_FAILED` results because the `ToolRegistry` sets `retryable: false` on these error results. `shouldRetry` rejects them via the standard `retryable` check without inspecting `error_code`. No special-case error-code logic is needed.
  - The slice does NOT integrate the retry wrapper into the registry's `dispatch()` method itself, nor does it wire retry into the full core-loop dispatch pipeline. Those are future slices.
- Inputs crossing the boundary:
  - `ToolDefinition` values (from `@argentum/contracts`, already consumed by `tooling` package). Only `side_effect_level` is read.
  - `ToolResultDTO` values (from `@argentum/contracts`, already consumed by `tooling` package). `status`, `retryable`, and `error_code` fields are read.
  - `ToolCallDTO` values (from `@argentum/contracts`, already consumed by `tooling` package) — passed through to `dispatch()`.
  - `ToolRegistry` instance (already implemented in slice 0019) — used by the optional retry wrapper.
- Outputs crossing the boundary:
  - `shouldRetry(toolDef: ToolDefinition, result: ToolResultDTO): boolean` exported from `@argentum/tooling`.
  - `dispatchWithRetry(registry: ToolRegistry, toolDef: ToolDefinition, call: ToolCallDTO): Promise<ToolResultDTO>` exported from `@argentum/tooling`.
  - Deterministic boolean decisions for all combinations of `side_effect_level`, `status`, and `retryable`.
  - Note: `dispatchWithRetry` does not use try/catch because `ToolRegistry.dispatch()` never throws (all errors are returned as `ToolResultDTO` with appropriate error codes).

## Plan

- First contracts or interfaces to create:
  - `shouldRetry(toolDef: ToolDefinition, result: ToolResultDTO): boolean` — pure function signature. No interfaces or classes needed; the function IS the contract.
  - `dispatchWithRetry(registry: ToolRegistry, toolDef: ToolDefinition, call: ToolCallDTO): Promise<ToolResultDTO>` — async wrapper signature.
- Minimal implementation steps:
  - Create `packages/tooling/src/retry-policy.ts`:
    1. Implement `shouldRetry(toolDef, result)`: check `side_effect_level === "read_only"`, `result.status === "error"`, and `result.retryable === true`. All three must be `true`. Return `false` for any other combination.
    2. Implement `dispatchWithRetry(registry, toolDef, call)`:
       - Call `registry.dispatch(call)` to get `firstResult`.
       - If `shouldRetry(toolDef, firstResult)` returns `false`, return `firstResult`.
       - Otherwise, call `registry.dispatch(call)` a second time and return the second result.
       - No try/catch is needed — `ToolRegistry.dispatch()` never throws (it catches all implementation errors internally and returns `TOOL_EXECUTION_FAILED`).
  - Update `packages/tooling/src/index.ts` to export `shouldRetry` and `dispatchWithRetry` from the new module.
- Required tests:
  - `packages/tooling/tests/retry-policy.test.ts`:
    - **`shouldRetry` decision matrix tests** (pure function, exhaustive combinatorial coverage):
      - `read_only` + `status=error` + `retryable=true` → `true` (only qualifying combination)
      - `read_only` + `status=error` + `retryable=false` → `false`
      - `read_only` + `status=success` + `retryable=true` → `false`
      - `read_only` + `status=success` + `retryable=false` → `false`
      - `read_only` + `status=blocked` + `retryable=true` → `false`
      - `read_only` + `status=blocked` + `retryable=false` → `false`
      - `workspace_mutation` + `status=error` + `retryable=true` → `false` (mutating tool, critical safety rule)
      - `workspace_mutation` + any status/retryable → `false`
      - `host_mutation` + any status/retryable → `false`
      - `external_effect` + any status/retryable → `false`
    - **`dispatchWithRetry` integration tests** (using a live `ToolRegistry` with stub implementations):
      - Read-only tool, first call fails with `retryable=true` → second call succeeds, returns second result.
      - Read-only tool, first call fails with `retryable=true` → second call also fails → returns second failure result (exactly one retry, no third attempt).
      - Read-only tool, first call succeeds → no retry, returns first result immediately.
      - Mutating tool (`workspace_mutation`), first call fails with `retryable=true` → no retry, returns first result (safety: mutation must not be retried).
      - Read-only tool, dispatch returns `TOOL_EXECUTION_FAILED` with `retryable=true` → retry occurs, returns second dispatch result (verifies execution failures route through normal retry path, not a catch block).
      - Read-only tool, first dispatch returns non-retryable error (`TOOL_EXECUTION_FAILED` with `retryable=false`) → no retry, returns first result immediately.
      - Exactly 2 `dispatch()` calls when retry qualifies; exactly 1 when it does not (verify via mock call counter).
    - **Registry-generated error coverage tests** (M2):
      - Register no tool matching the call → `dispatch()` returns `TOOL_NOT_REGISTERED` with `retryable: false`. Call `dispatchWithRetry` and assert no retry occurs (single dispatch, returned result has `retryable: false`).
      - Register a tool with a schema that rejects the arguments → `dispatch()` returns `SCHEMA_VALIDATION_FAILED` with `retryable: false`. Call `dispatchWithRetry` and assert no retry occurs (single dispatch).
    - **Package entrypoint tests** (M1):
      - Import `shouldRetry` and `dispatchWithRetry` from `@argentum/tooling` and verify they are callable functions (type-check + existence).
- Narrow validation step:
  - `pnpm --filter @argentum/tooling test` must pass with focused retry-policy tests.
  - `pnpm --filter @argentum/tooling build` must succeed (type-check).

## Execution Strategy

- Autopilot suitability: **safe**. This slice has:
  - A single pure function (`shouldRetry`) with a small finite decision matrix (4 side_effect_levels × 3 statuses × 2 retryable values = 24 combinations, of which only 1 yields `true`).
  - A simple async wrapper (`dispatchWithRetry`) that calls an already-tested `ToolRegistry.dispatch()` exactly 0–2 times.
  - No new dependencies, no filesystem I/O, no provider integration, no core-loop coupling.
  - Clear acceptance criteria directly from the spec with no ambiguity.
  - The `tooling` package already has a working test infrastructure (vitest, 44 passing tests).
- Parallel subagent opportunities:
  - **None**. This is a single-file implementation in one package with no independent sub-tasks. The pure function and wrapper are tightly coupled and should be implemented together.
- Out of scope:
  - Integrating `dispatchWithRetry` into `ToolRegistry.dispatch()` as the default dispatch path.
  - Wiring retry into the full core-loop dispatch pipeline (the core loop calls `dispatchWithRetry` instead of `registry.dispatch()`).
  - Retry for non-transient failures (e.g., retry-after-backoff for rate limits).
  - Retry for schema validation failures or unregistered tools (these are structural, not transient).
  - Provider-adapter-level retry (LLM inference retry is a separate concern in `llm_provider`).
  - Grant-level retry decisions (grants are resolved before tool execution and are not re-resolved on retry).
  - Artifact storage interaction during retry.
- Deferred decisions that must remain deferred:
  - Exact initial tool catalog included in MVP (from [deferred-decisions.md](../spec/70-roadmap/deferred-decisions.md)) — does not affect retry-policy logic, which operates on any `ToolDefinition`.
  - Whether tool exposure per step is full-registry or curated subset in MVP — does not affect retry-policy logic.
  - Exact compaction size thresholds — not relevant to retry.
  - All other deferred decisions in the canonical deferred-decisions file remain deferred.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1**: `dispatchWithRetry` throw-handling is dead code — `ToolRegistry.dispatch()` never throws.
  - **H2**: `shouldRetry` acceptance criterion misleading about TOOL_NOT_REGISTERED/SCHEMA_VALIDATION_FAILED handling.
  - **M1**: Package entrypoint test not extended.
  - **M2**: Integration tests lack registry-generated error coverage.
- Refinements applied:
  - **H1**: Removed try/catch around `dispatch()` calls in `dispatchWithRetry` implementation plan. Removed throw-related tests ("registry throws on first dispatch", "second dispatch throws"). Replaced with: (1) read-only tool with `TOOL_EXECUTION_FAILED` + `retryable=true` verifies execution failures route through normal retry path, (2) `TOOL_EXECUTION_FAILED` + `retryable=false` verifies no retry.
  - **H2**: Rewrote acceptance criterion to clarify that `TOOL_NOT_REGISTERED` and `SCHEMA_VALIDATION_FAILED` are non-retryable because the registry sets `retryable: false` on them — `shouldRetry` correctly rejects them via the standard `retryable` check without needing error_code inspection.
  - **M1**: Added package entrypoint test: import `shouldRetry` and `dispatchWithRetry` from `@argentum/tooling`, verify they are callable functions.
  - **M2**: Added integration tests for `TOOL_NOT_REGISTERED` (unregistered tool → single dispatch, `retryable: false`) and `SCHEMA_VALIDATION_FAILED` (schema-rejected arguments → single dispatch, `retryable: false`) paths through `dispatchWithRetry`.

## Implementation Review (2026-05-24)

- Adversarial review findings:
  - **LOW**: `shouldRetry` implementation is trivially correct — 3 boolean ANDs matching exactly the spec. The 24-combination test matrix provides exhaustive coverage. No logic defects.
  - **LOW**: `dispatchWithRetry` implementation is trivially correct — single conditional dispatch. No try/catch (correct per spec), no side effects, no state mutation. Exactly 2 calls when retrying, exactly 1 otherwise.
  - **LOW**: Test file duplicates helper functions (`makeToolDef`, `makeResult`, `makeToolCall`) from `registry.test.ts`. Consistent with existing package convention where each test file is self-contained. Not a regression.
  - **MEDIUM** (non-blocking): The `TOOL_EXECUTION_FAILED with retryable=true` test constructs a synthetic result rather than going through an actual throw → catch → `makeErrorResult` path. This is intentional — the registry's `makeErrorResult` always sets `retryable: false`, so a registry-generated `TOOL_EXECUTION_FAILED` can never have `retryable: true`. The test instead exercises the path where a tool *returns* (not throws) an error result with that error_code. This is a valid scenario per spec (tool implementations may return any error_code), but the test name is mildly misleading. The complementary test (`TOOL_EXECUTION_FAILED with retryable=false` via actual throw) verifies the real throw → catch path correctly. No fix needed.
  - No CRITICAL or HIGH findings.
- Validation results:
  - `pnpm --filter @argentum/tooling test`: **90 tests passed** (4 files, 0 failures). Previous was 50 tests; +40 retry-policy tests.
  - `pnpm typecheck` (`tsc -b`): **passed** with zero errors.
- Remaining risks:
  - `dispatchWithRetry` passes the same `ToolCallDTO` (same `call_id`, same `idempotency_key`) to both dispatch calls. This is correct for MVP but downstream slices wiring retry into the core loop must ensure idempotency_key semantics are preserved.
  - No telemetry/logging for retry events. Future slices may add telemetry hooks (out of scope for this slice per spec).
- Deferred work: None within this boundary. Future slices will integrate `dispatchWithRetry` into `ToolRegistry.dispatch()` and wire it into the core-loop dispatch pipeline.
