# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-25
- Phase: 3/7 (Environment boundary and hardening)
- Owner: environment
- Execution readiness: implemented-and-validated. Slice 0002 (runtime startup config), slice 0015 (`ExecutionGrantDTO`), slice 0020 (grant resolution), and slice 0021 (execution-driver interface) are validated upstream. This slice adds a validated backend-neutral secret-handle resolution seam in `@argentum/environment` for later execution-time wiring without selecting a production secret backend.

## Scope

- Slice name: Secret handle resolver interface
- Target package or boundary: `environment` (`@argentum/environment`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/40-modules/environment/secrets-and-config.md](../../spec/40-modules/environment/secrets-and-config.md) — sole authority for secret-handle ownership, secret-resolution locality, and no-generic-env-read rules
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md) — execution layers consume secret handles; they must not assume generic environment-variable access
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — `env_secret_handles` is the canonical cross-boundary secret-handle list
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
  - [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md) — current approved bootstrap decision covers handle-name discovery only, not a permanent secret-value backend
- Acceptance criteria:
  - `@argentum/environment` exports a secret-resolution interface such as `SecretHandleResolver` with a single operation that resolves canonical handle names to secret values for execution-time use.
  - The interface accepts handle names only and returns resolved values only to the immediate execution consumer; it must not emit telemetry, write artifacts, or materialize secret values into contracts.
  - The environment package also provides a deterministic test adapter such as `StaticSecretHandleResolver` backed by constructor-injected in-memory values so runtime and environment tests can exercise secret-using flows without choosing a production backend.
  - Missing handles return a deterministic failure that identifies missing handle names only. Failure surfaces must not echo resolved secret values.
  - The slice does not introduce a generic host-environment read capability and does not redefine the long-term operator secret backend.
  - The public seam stays narrow: one interface, one deterministic test adapter, and one error/result shape suitable for later execution-driver wiring.
- Inputs crossing the boundary:
  - `readonly string[]` of canonical secret handle names from `ExecutionGrantDTO.env_secret_handles`
  - Optional constructor-injected in-memory handle map for the deterministic test adapter
- Outputs crossing the boundary:
  - `SecretHandleResolver` interface
  - Deterministic test adapter for runtime and environment integration tests
  - Error or result shape carrying missing-handle names without exposing secret values

## Plan

- First contracts or interfaces to create:
  - `SecretHandleResolver`
  - `SecretHandleResolutionResult` or `SecretHandleResolutionError`
  - `StaticSecretHandleResolver`
- Minimal implementation steps:
  1. Add a new secret-resolution module under `packages/environment/src/`.
  2. Define the interface and deterministic failure surface around handle names only.
  3. Implement a constructor-injected in-memory resolver for tests and runtime doubles.
  4. Re-export the interface, test adapter, and error/result types from `packages/environment/src/index.ts`.
  5. Add focused environment tests covering successful lookup, missing handles, immutability, and no-value-leak error text.
- Required tests:
  - Resolving a known handle returns the injected value to the caller.
  - Missing handles are reported deterministically by handle name only.
  - Repeated calls with identical inputs return identical resolved maps.
  - The deterministic test adapter does not mutate the injected backing map.
  - Error messages and thrown surfaces never include resolved secret values.
- Narrow validation step:
  - `pnpm --filter @argentum/environment test -- secret-handle-resolver`
  - `pnpm --filter @argentum/environment build`

## Execution Strategy

- Autopilot suitability: conditional. The boundary is narrow and deterministic, but it must remain explicitly backend-neutral so it does not accidentally resolve the deferred production secret-store choice.
- Parallel subagent opportunities:
  - Read-only checklist against [docs/spec/40-modules/environment/secrets-and-config.md](../../spec/40-modules/environment/secrets-and-config.md) and [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md).
- Out of scope:
  - Production host secret backend selection
  - Startup handle discovery changes
  - Execution-driver wiring
  - Telemetry redaction
  - Runtime end-to-end proof of secret-safe execution
- Deferred decisions that must remain deferred:
  - Exact host-managed secret-value backend beyond the deterministic test adapter
  - Any session-secret behavior beyond MVP

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
- 2026-05-25 post-implementation adversarial review repair finding (HIGH): The success payload built resolved values through ordinary object writes plus object spread, so a canonical handle name of `__proto__` did not round-trip correctly even when explicitly injected as a real handle.
- 2026-05-25 approval review: No CRITICAL, HIGH, MEDIUM, or LOW findings remained. The card is approval-ready as written.
- 2026-05-25 adversarial review: No CRITICAL, HIGH, MEDIUM, or LOW findings remained after implementation, focused validation, and re-review of the environment secret-resolution seam against the owning specs.
- Refinements applied:
- 2026-05-25 implementation refinement: Added `packages/environment/src/secret-handle-resolver.ts` with the `SecretHandleResolver` interface, `SecretHandleResolutionResult` discriminated union, `SecretHandleResolutionError`, and the deterministic `StaticSecretHandleResolver` test adapter; re-exported the public seam from `packages/environment/src/index.ts`.
- 2026-05-25 validation refinement: Added `packages/environment/tests/secret-handle-resolver.test.ts` with focused coverage for successful lookup, deterministic missing-handle failure, repeatability, backing-map immutability, no-value-leak error text, and frozen success values.
- 2026-05-25 review refinement: Hardened `StaticSecretHandleResolver` to use `Map`-backed handle lookup so prototype-named keys such as `toString` are only resolved when explicitly injected, and added a focused regression test for that case.
- 2026-05-25 repair refinement: Rebuilt successful resolution values as a null-prototype object populated via `Object.defineProperty` and froze that object directly so canonical string keys, including `__proto__`, are preserved exactly in the returned payload.
- 2026-05-25 regression refinement: Added focused coverage that injects `__proto__` as an explicit own property, resolves it successfully, asserts the returned values object retains that exact key/value pair, and keeps the existing failure-path and no-secret-leak assertions intact.
- 2026-05-25 repair validation: `pnpm --filter @argentum/environment test -- secret-handle-resolver` and `pnpm --filter @argentum/environment build` passed after the `__proto__` round-trip repair.
- 2026-05-25 repair review result: A read-only subagent adversarial review was run against the repaired implementation and test coverage; it did not surface any HIGH findings in its output.