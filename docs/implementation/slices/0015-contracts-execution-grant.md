# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: planning synthesis
- Approval date: 2026-05-23
- Tightening date: 2026-05-23
- Validation date: 2026-05-23
- Phase: 3
- Owner: contracts
- Execution readiness: ready. This slice has no dependency on slice 0013 (`ActionDecision`); it can run before, after, or in parallel with 0013. Must complete before slice 0014 (`ToolCallDTO`) which composes canonical `ExecutionGrantDTO` in `ToolCallDTO.grant`.

## Scope

- Slice name: Canonical execution-grant contract surface
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `ExecutionGrantDTO` is the scoped permission surface for one tool execution; produced by environment grant resolver, consumed by core loop, tool layer, and execution driver
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — sole shape authority for grant fields, `path_permissions` entry shape, and canonical vocabularies
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md) — contextual authority for grant derivation inputs (not shape-defining for this slice)
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — ownership constraint: environment grant resolver is the only module allowed to create `ExecutionGrantDTO` values (contextual, not shape-defining)
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — contextual authority for execution-policy fields consumed during grant derivation
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `ExecutionGrantDTO` contract types plus a single public parser entrypoint `parseExecutionGrant(value: unknown): ExecutionGrantDTO`.
  - The contract enforces all seven required top-level fields with non-coercion and literal enforcement as follows:
    - `grant_id`: required non-empty string, `typeof === "string"` non-coercion (rejects numbers, booleans, arrays, objects, empty string).
    - `cwd`: required non-empty string, `typeof === "string"` non-coercion (rejects numbers, booleans, arrays, objects, empty string).
    - `path_permissions`: required array; empty arrays are valid (per spec: `path_scope = none` → `path_permissions = []`). Non-array inputs are rejected with `invalid_type`.
    - `env_secret_handles`: required array; empty arrays are valid. Each element must be a non-empty string, non-coercion. Non-array inputs are rejected with `invalid_type`.
    - `network_policy`: required canonical literal `"deny"` | `"inherit"`. Unknown string values rejected with `invalid_literal`. Wrong types rejected with `invalid_type`.
    - `approval_mode`: required canonical literal `"auto_allow"` | `"deny"`. Unknown string values rejected with `invalid_literal`. Wrong types rejected with `invalid_type`.
    - `max_runtime_ms`: required integer via `Number.isInteger()` non-coercion (rejects strings, floats, `NaN`, `Infinity`, negative integers, zero). Must be a positive integer ($\ge 1$).
  - Each `path_permissions` entry enforces:
    - `root`: required canonical literal `"bedrock"` | `"working"` | `"artifacts"` | `"logs"`. Unknown values rejected with `invalid_literal`.
    - `path`: required non-empty string, `typeof === "string"` non-coercion.
    - `capabilities`: required non-empty array. Each element must be a canonical literal `"read"` | `"write"` | `"append"`. Unknown capability values rejected with `invalid_literal`. Empty arrays rejected with `empty_array`.
    - Unknown keys rejected per entry with `unknown_key`.
  - Unknown keys on the top-level `ExecutionGrantDTO` object are rejected with `unknown_key`.
  - The slice remains contract-only and does not implement grant derivation, secret resolution, execution driver behavior, tool policy decisions, or `RuntimePolicyDTO` → `ExecutionGrantDTO` mapping.
- Inputs crossing the boundary:
  - Execution-grant-shaped values produced by the future environment grant-resolver seam.
  - Path-permission and secret-handle fields intended for downstream tool execution boundaries.
- Outputs crossing the boundary:
  - Canonical `ExecutionGrantDTO` type export in `@argentum/contracts`.
  - Public `parseExecutionGrant(value: unknown): ExecutionGrantDTO` entrypoint.
  - `ExecutionGrantValidationCode`, `ExecutionGrantValidationIssue`, and `ExecutionGrantValidationError` surface for deterministic grant-boundary tests.

## Plan

- First contracts or interfaces to create:
  - `ExecutionGrantDTO` interface with `readonly` fields matching the spec field table (all 7 fields required).
  - `ExecutionGrantPathPermission` interface for `path_permissions` array members with `readonly` `root`, `path`, `capabilities`.
  - Literal unions: `ApprovalMode` (`"auto_allow" | "deny"`), `NetworkPolicy` (`"deny" | "inherit"`), `PathRoot` (`"bedrock" | "working" | "artifacts" | "logs"`), `Capability` (`"read" | "write" | "append"`).
  - `ExecutionGrantValidationCode` literal union with grant-specific codes: `invalid_literal`, `invalid_type`, `invalid_integer`, `missing_required`, `unknown_key`, `empty_array`, `invalid_value`.
  - `ExecutionGrantValidationIssue` interface with `path`, `code`, `message`.
  - `ExecutionGrantValidationError` class extending `Error` with `issues` array.
  - `parseExecutionGrant(value: unknown): ExecutionGrantDTO` — public entrypoint.
  - Internal `parseExecutionGrantAtPath(value, path, addIssue): ExecutionGrantDTO | undefined` — reused for nested path-permission validation via `parsePathPermissionEntryAtPath`.
  - Public contracts index exports for the full execution-grant surface.
- Minimal implementation steps:
  - Add `packages/contracts/src/execution-grant.ts` following the established `context-item.ts` pattern:
    1. Define literal unions (`ApprovalMode`, `NetworkPolicy`, `PathRoot`, `Capability`).
    2. Define `ExecutionGrantPathPermission` and `ExecutionGrantDTO` interfaces.
    3. Define validation code, issue, and error types.
    4. Implement `parseExecutionGrant(value)` public entrypoint (delegates to internal `parseExecutionGrantAtPath`).
    5. Implement `parseExecutionGrantAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set: `grant_id`, `cwd`, `path_permissions`, `env_secret_handles`, `network_policy`, `approval_mode`, `max_runtime_ms`.
       - Validate `grant_id` (required non-empty string, non-coercion).
       - Validate `cwd` (required non-empty string, non-coercion).
       - Validate `network_policy` (required literal union).
       - Validate `approval_mode` (required literal union).
       - Validate `max_runtime_ms` (required positive integer via `Number.isInteger()`, reject $\le 0$).
       - Validate `path_permissions` (required array; validate each entry via `parsePathPermissionEntryAtPath` with indexed path `[0]`, `[1]`, etc.).
       - Validate `env_secret_handles` (required array; validate each element as non-empty string, non-coercion).
       - Build and return frozen `ExecutionGrantDTO` object.
    6. Implement `parsePathPermissionEntryAtPath` for per-entry `root`, `path`, `capabilities`, and unknown-key rejection.
  - Reuse shared helpers (`isPlainObject`, `joinPath`, `parseRequiredString`, `pushUnknownKeys`, `expectRecord`) from existing contract modules if extractable; otherwise inline as prior modules did.
  - Export the new surface through `packages/contracts/src/index.ts` only.
- Required tests:
  - Valid grant tests:
    - Full valid grant with `approval_mode = "auto_allow"`, `network_policy = "inherit"`, non-empty `path_permissions` and `env_secret_handles`.
    - Full valid grant with `approval_mode = "deny"`, `network_policy = "deny"`.
    - Valid grant with empty `path_permissions` (per `path_scope = none` spec rule).
    - Valid grant with empty `env_secret_handles`.
    - Valid grant with single path-permission entry across all four root literals (`bedrock`, `working`, `artifacts`, `logs`).
    - Valid grant with multiple path-permission entries and varying capability sets.
    - Valid grant with `max_runtime_ms = 1` (minimum positive integer boundary).
  - Required-field missing tests (one test per field, each producing `missing_required`):
    - Missing `grant_id`.
    - Missing `cwd`.
    - Missing `path_permissions`.
    - Missing `env_secret_handles`.
    - Missing `network_policy`.
    - Missing `approval_mode`.
    - Missing `max_runtime_ms`.
    - Bulk missing all fields → multiple `missing_required` issues.
  - Non-coercion tests:
    - `grant_id`: number, boolean, array, object, empty string → `invalid_type`.
    - `cwd`: number, boolean, array, object, empty string → `invalid_type`.
    - `max_runtime_ms`: string, float, boolean, `NaN`, `Infinity` → `invalid_integer`.
    - `max_runtime_ms`: `0`, negative integer → `invalid_value`.
  - Invalid literal tests:
    - `network_policy`: unknown string → `invalid_literal`; wrong type → `invalid_type`.
    - `approval_mode`: unknown string → `invalid_literal`; wrong type → `invalid_type`.
  - Invalid array tests:
    - `path_permissions`: non-array (object, string, number) → `invalid_type`.
    - `env_secret_handles`: non-array (object, string, number) → `invalid_type`.
    - `env_secret_handles` containing non-string elements (number, boolean, null) → `invalid_type` per element.
    - `env_secret_handles` containing an empty-string element → `invalid_type` at indexed path.
  - Path-permission entry tests:
    - Valid entry with `root = "bedrock"`, `path = "/workspace/bedrock"`, `capabilities = ["read"]`.
    - Valid entry with `capabilities` containing all three literals `["read", "write", "append"]`.
    - Missing `root` in entry → `missing_required` at indexed path.
    - Missing `path` in entry → `missing_required` at indexed path.
    - Missing `capabilities` in entry → `missing_required` at indexed path.
    - Invalid `root` literal (unknown string) → `invalid_literal` at indexed path.
    - Invalid capability literal (unknown string) → `invalid_literal` at indexed path.
    - Empty `capabilities` array → `empty_array` at indexed path.
    - `path` non-coercion (number, boolean, empty string) → `invalid_type` at indexed path.
    - Unknown keys on path-permission entry → `unknown_key` at indexed path.
  - Unknown keys tests:
    - Unknown key on top-level grant object → `unknown_key`.
    - Unknown key on nested path-permission entry → `unknown_key`.
  - Wrong top-level type tests:
    - Non-object input (string, number, array, null) → `invalid_type`.
  - Package entrypoint test proving downstream imports can consume the execution-grant surface and that `ExecutionGrantValidationError` is catchable.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe. The owner (`contracts`) and validation target are clear. The slice is a narrow contracts-only surface following the established `ContextItem` parser pattern. No runtime dependencies. No gateway, provider, or tool-layer coupling. No dependency on slice 0013.
- Parallel subagent opportunities:
  - This slice is independent of slice 0013 (`ActionDecision`). Both are contracts-only surfaces with no cross-dependency. They can be implemented in parallel by separate autopilot runs.
  - Read-only extraction of canonical vocabularies from [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md).
  - Read-only extraction of grant-resolver ownership constraints and deterministic mapping rules from [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md).
- Out of scope:
  - Runtime grant derivation and `RuntimePolicyDTO` → `ExecutionGrantDTO` mapping.
  - Secret injection mechanics and handle resolution.
  - Execution driver enforcement and `cwd` sandboxing.
  - Tool-layer retry behavior.
  - `approval_mode` policy decisions (trusted-local, interactive approval workflows).
  - `path_scope` → `path_permissions` expansion (owned by grant resolver, not contracts).
- Deferred decisions that must remain deferred:
  - Fine-grained network policy beyond MVP `deny`/`inherit` literals (deferred in spec).

## Review Log

- Adversarial review findings:
  - Initial planning noted risk of blending grant shape with resolver behavior.
  - Follow-up planning constrained the slice to canonical DTO and validation only.
- Refinements applied (pre-tightening):
  - Kept one owning boundary (`contracts`) and deferred all environment execution policy logic.
- Tightening refinements (2026-05-23):
  - Removed stale "look-ahead only" / "start after slice 0013" sequencing blocker — this slice has no dependency on `ActionDecision` and can run in parallel with slice 0013.
  - Committed to concrete function signatures: `parseExecutionGrant(value): ExecutionGrantDTO` with internal `parseExecutionGrantAtPath` and `parsePathPermissionEntryAtPath`, matching the `ContextItem` pattern.
  - Specified exact field-by-field acceptance criteria for all 7 required top-level fields with non-coercion rules, including `grant_id` and `cwd` (previously unmentioned).
  - Added `max_runtime_ms` positive-integer enforcement ($\ge 1$, reject zero/negative).
  - Added `env_secret_handles` per-element string non-coercion (previously unspecified).
  - Clarified that empty `path_permissions` is valid (per `path_scope = none` spec rule) and empty `env_secret_handles` is valid.
  - Specified per-entry path-permission validation: `root` literal enforcement across all 4 canonical roots, `capabilities` literal enforcement with empty-array rejection, `path` non-coercion, unknown-key rejection per entry.
  - Added `empty_array` and `invalid_value` validation codes to the union.
  - Added `ExecutionGrantValidationError` class specification.
  - Expanded test requirements to exact categories matching the `ContextItem`/`ActionDecision` test density: per-field non-coercion, per-field missing, per-entry path-permission validation, empty-array validity, bulk missing, wrong top-level type, entrypoint smoke.
  - Noted explicit parallel-safe relationship with slice 0013 (mutually independent contracts-only surfaces).
- Second adversarial review (2026-05-23):
  - Findings: no CRITICAL, no HIGH. Three MEDIUM (M1: missing empty-string test for `env_secret_handles` elements; M2: missing empty-string test for `path` in path-permission entries; M3: ambiguous `invalid_integer`/`invalid_value` split for `max_runtime_ms` boundary values). Three LOW (L1: `max_runtime_ms` positivity not explicit in spec type column; L2: no test for non-string `root` type; L3: no test for non-array `capabilities` type). Approval: `approved`.
  - Refinements applied:
    - M3: Split `max_runtime_ms` tests into two lines — non-integer types → `invalid_integer`, zero/negative → `invalid_value`.
    - M1: Added test case for empty-string element in `env_secret_handles` → `invalid_type` at indexed path.
    - M2: Added empty string to `path` non-coercion test → `invalid_type` at indexed path.
    - L1–L3: Low-severity observations noted; no structural changes required.
  - Follow-up review (2026-05-23): found one MEDIUM inconsistency — `env_secret_handles` empty-string was assigned `invalid_value` while all other empty-string validations (`grant_id`, `cwd`, `path`) use `invalid_type`. Corrected to `invalid_type` for consistency with the established `parseRequiredString` pattern used across all existing contracts modules.
- Third adversarial review (2026-05-24):
  - Findings: no CRITICAL, no HIGH. Four MEDIUM (M1: no test for non-array `capabilities` input on path_permission entry; M2: `parseExecutionGrant` missing from package entrypoint test; M3: `expectGrantIssues` helper uses subset matching without length assertion; M4: no test for non-object element in `path_permissions` array).
  - Refinements applied:
    - M3: Added `expect(issues).toHaveLength(expected.length)` to `expectGrantIssues` helper to enforce exact issue count.
    - M1: Added three tests for non-array `capabilities` — string → `invalid_type`, number → `invalid_type`, object → `invalid_type`, all at `path_permissions[0].capabilities`.
    - M4: Added test where `path_permissions` contains a string element → `invalid_type` at `path_permissions[0]`.
    - M2: Added `parseExecutionGrant` and `ExecutionGrantValidationError` imports to package entrypoint test; added new `it` block asserting `parseExecutionGrant` succeeds on a valid grant and throws `ExecutionGrantValidationError` on `{}`; also added `parseExecutionGrant({})` assertion to the existing "exports validation errors" block.
  - Validation: `pnpm --filter @argentum/contracts test` — 412 tests pass (9 files, including 69 execution-grant + 5 entrypoint). `pnpm typecheck` — clean.
- Audit 0010 remediation (2026-05-24):
  - **H1:** Added `parseExecutionGrantAtPath` value re-export to `packages/contracts/src/index.ts`. This at-path parser was exported from the source module but not surfaced through the package entrypoint.
