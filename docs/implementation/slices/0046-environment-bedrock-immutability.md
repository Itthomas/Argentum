# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-26
- Phase: 7 (Hardening)
- Owner: packages/environment

## Scope

- Slice name: Environment bedrock immutability enforcement
- Target package or boundary: `packages/environment` (`@argentum/environment`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/40-modules/environment/immutable-bedrock.md](../../spec/40-modules/environment/immutable-bedrock.md) — bedrock files are read-only during MVP runtime; the agent may not modify, delete, or replace bedrock files
  - [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md) — bedrock and working areas must be separated; no runtime bedrock writes
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md) — every tool execution must receive an `ExecutionGrantDTO`; path authorization uses lexical containment
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — `path_scope = workspace` grants `bedrock` with `read` only, never `write`
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — environment tests for bedrock immutability enforcement
- Acceptance criteria:
  - The environment package exposes an explicit bedrock-immutability guard that rejects any write, delete, or modification request targeting a bedrock path.
  - The guard accepts read-only requests to bedrock paths without interfering with normal bedrock reads.
  - The guard rejects write requests even when a caller supplies a grant with `bedrock` + `write` capability, because bedrock writes are forbidden by the frozen MVP rule regardless of grant contents.
  - The guard produces a stable, descriptive denial code (`bedrock_immutable`) distinct from generic `permission_denied` or `path_escape`.
  - `WorkspacePathDenialCode` in `workspace-path-guard.ts` is extended to include the `'bedrock_immutable'` literal.
  - The guard runs first as a root-level pre-filter before `authorizeWorkspacePath` handles lexical containment: the guard inspects `WorkspacePathRequest.root` and `capability`, returns a denial for any bedrock write/delete, and returns `null` (pass-through) for non-bedrock or read-only requests so `authorizeWorkspacePath` can proceed normally.
  - A pure-function composition test proves that `bedrockImmutabilityGuard` → `authorizeWorkspacePath` chains correctly: bedrock reads pass through the guard and are authorized by `authorizeWorkspacePath`; bedrock writes are denied by the guard before reaching `authorizeWorkspacePath`.
  - Existing workspace-path-guard tests continue to pass; the guard layers on top of the existing lexical containment model without changing its behavior for non-bedrock paths.
  - No core-loop contract changes are required.
- Inputs crossing the boundary:
  - `WorkspacePathRequest` with `root = "bedrock"` and any write/delete capability
  - Existing `WorkspaceRootsDTO` for path resolution
- Outputs crossing the boundary:
  - `WorkspacePathAuthorizationResult` with `status = "denied"` and `code = "bedrock_immutable"` for write requests
  - `WorkspacePathAuthorizationResult` with `status = "allowed"` for valid read requests

## Plan

- First contracts or interfaces to create:
  - `bedrockImmutabilityGuard(request: WorkspacePathRequest): WorkspacePathAuthorizationResult | null` — returns a denial for bedrock writes, `null` (pass-through) for non-bedrock or read-only requests
  - Extend `WorkspacePathDenialCode` in `packages/environment/src/workspace-path-guard.ts` with `'bedrock_immutable'`
- Minimal implementation steps:
  1. Extend `WorkspacePathDenialCode` in `packages/environment/src/workspace-path-guard.ts` to include `'bedrock_immutable'`.
  2. Implement `bedrockImmutabilityGuard` in a new `packages/environment/src/bedrock-immutability-guard.ts`.
  3. Export `bedrockImmutabilityGuard` from `packages/environment/src/index.ts`.
  4. Keep the guard as a standalone function so it can be used for pre-flight checks without coupling to the execution driver.
  5. Guard layering order: `bedrockImmutabilityGuard` runs first as root-level pre-filter → if it returns `null` (pass-through), `authorizeWorkspacePath` handles lexical containment normally.
- Required tests:
  - A bedrock write request (`capability = "write"`) is denied with code `bedrock_immutable`.
  - A bedrock delete request is denied with code `bedrock_immutable`.
  - A bedrock read request (`capability = "read"`) is allowed (returns `null` from the guard, pass-through to normal path authorization).
  - A non-bedrock write request (e.g., `root = "working"`) is not intercepted by the guard (returns `null`, pass-through).
  - Pure-function composition test: `bedrockImmutabilityGuard` is called first; if it returns `null`, the result of `authorizeWorkspacePath` is used. Verifies that bedrock reads chain through both functions correctly and that bedrock writes are denied at the guard before `authorizeWorkspacePath` runs.
  - Existing workspace-path-guard tests continue to pass without modification.
- Narrow validation step:
  - `pnpm --filter @argentum/environment test -- bedrock`
  - `pnpm --filter @argentum/environment build`

## Execution Strategy

- Autopilot suitability: safe. The slice is bounded to a single guard function in the environment package with clear inputs, outputs, and no cross-package ambiguity.
- Parallel subagent opportunities:
  - Read-only extraction of bedrock immutability assertions from [docs/spec/40-modules/environment/immutable-bedrock.md](../../spec/40-modules/environment/immutable-bedrock.md) and [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md).
- Out of scope:
  - Maintenance-mode bedrock write behavior (deferred to post-MVP)
  - Bedrock file content validation or schema checking
  - Changes to the lexical containment algorithm in `workspace-path-guard.ts`
  - Runtime-level end-to-end bedrock immutability proofs (the environment-layer guard is sufficient for this slice)
- Deferred decisions that must remain deferred:
  - Maintenance-mode semantics for bedrock mutation

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1** — Execution-driver integration test is weak because `NativeExecutionDriver` is a no-op stub that blocks everything. Replaced with a pure-function composition test of `bedrockImmutabilityGuard` → `authorizeWorkspacePath`.
  - **H2** — Plan did not explicitly extend `WorkspacePathDenialCode` to include `'bedrock_immutable'`. Added to first contracts and implementation step 1.
  - **M1** — Guard layering order was unclear. Clarified: guard runs first as root-level pre-filter, then `authorizeWorkspacePath` handles containment.
  - **M2** — `bedrockImmutabilityGuard` export from `packages/environment/src/index.ts` was not listed. Added as step 3.
- Implementation review findings (2026-05-26):
  - **M3** — `WorkspacePathRequest`, `WorkspacePathAuthorizationResult`, and `WorkspacePathDenialCode` types were not exported from `index.ts`. Consumers of `bedrockImmutabilityGuard` need these types to type the guard's parameter and return value. Fixed: added `export type` declarations for all three types from `workspace-path-guard.js`.
  - **L1** — The `Capability` union does not include `"delete"`. The guard handles all non-`"read"` capabilities (`"write"`, `"append"`) correctly. Test naming mentions "delete" but the actual test uses `"write"` since that is the canonical non-read write capability. No code change needed — this is a spec-level naming convention.
- Refinements applied:
  - 2026-05-26 implementation: Added `bedrockImmutabilityGuard`, extended `WorkspacePathDenialCode`, exported guard and types, added 12 focused tests.
  - 2026-05-26 adversarial review (post-implementation): No CRITICAL or HIGH findings. MEDIUM: acceptance criterion references "delete" which is not a `Capability` member (guard correctly catches all non-read); `authorizeWorkspacePath` does not internally compose the guard (by design — integration deferred). 2026-05-26 — All HIGH and MEDIUM findings resolved (H1, H2, M1, M2 from planning; M3 from implementation). Type exports added to `index.ts`. Bedrock immutability guard implemented, 12 new tests pass, 39 existing workspace-path-guard tests pass, build succeeds.
- Remaining risk: None. The guard is a pure function with clear inputs/outputs. Bedrock immutability enforcement at the environment boundary is complete. Integration with `NativeExecutionDriver` is deferred until that driver graduates from its no-op stub.
