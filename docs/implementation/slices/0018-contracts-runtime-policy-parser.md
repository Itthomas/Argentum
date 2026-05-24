# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: agent (argentum-implementer)
- Approval date: 2026-05-24
- Phase: 3
- Owner: contracts
- Execution readiness: ready. This slice adds a parser to the existing `RuntimePolicyDTO` type in `packages/contracts/src/runtime-policy.ts`. No upstream dependency blocks this contracts-only surface. Slice 0017 (`ToolDefinition`) is independent and can run in parallel. Must complete before slice 0019 (`tooling` tool registry) which consumes `RuntimePolicyDTO` for grant resolution.

## Scope

- Slice name: Canonical RuntimePolicyDTO contract surface with parser
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `RuntimePolicyDTO` is the canonical runtime policy input for grant derivation; produced by environment configuration layer, consumed by environment grant resolver, gateway, and tool layer
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md) — sole shape authority for policy fields, derivation rule ("derived from `RuntimeConfigDTO`, not authored as an unrelated parallel configuration object"), and grant-resolution constraints
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md) — contextual authority: `RuntimePolicyDTO` fields are derived from `RuntimeConfigDTO.tool_policy` and `RuntimeConfigDTO.workspace` sections
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — contextual authority: grant derivation consumes `RuntimePolicyDTO` fields for allowed-tool filtering, secret availability, runtime ceiling capping, workspace rooting, and trusted-local-mode approval
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports a public `parseRuntimePolicyDTO(value: unknown): RuntimePolicyDTO` parser entrypoint in addition to the existing `RuntimePolicyDTO` and `WorkspaceRootsDTO` type exports.
  - `RuntimePolicyDTO` field enforcement:
    - `enabled_tools`: required array. Empty arrays are valid (no tools enabled). Each element must be a non-empty string, non-coercion (rejects numbers, booleans, arrays, objects, empty string). Non-array inputs rejected with `invalid_type`.
    - `enabled_secret_handles`: required array. Empty arrays are valid. Each element must be a non-empty string, non-coercion. Non-array inputs rejected with `invalid_type`.
    - `max_tool_runtime_ms`: required positive integer via `Number.isInteger()` non-coercion (rejects strings, floats, `NaN`, `Infinity`, negative integers, zero). Must be $\ge 1$.
    - `workspace_roots`: required plain object. Must contain exactly four required string fields:
      - `bedrock`: required non-empty string, `typeof === "string"` non-coercion.
      - `working`: required non-empty string, non-coercion.
      - `artifacts`: required non-empty string, non-coercion.
      - `logs`: required non-empty string, non-coercion.
      - Unknown keys on `workspace_roots` rejected with `unknown_key`.
      - Non-object values on `workspace_roots` rejected with `invalid_type`.
    - `trusted_local_mode`: required boolean (`typeof === "boolean"`), non-coercion. Rejects strings (`"true"`, `"false"`), numbers (`0`, `1`), null.
    - Unknown keys rejected at top level with `unknown_key`.
  - The existing `RuntimePolicyDTO` and `WorkspaceRootsDTO` interfaces in `packages/contracts/src/runtime-policy.ts` are preserved and remain the canonical type definitions. The parser is added to the same module.
  - The slice remains contract-only and does not implement `RuntimeConfigDTO` → `RuntimePolicyDTO` derivation, grant resolution, workspace validation against the filesystem, or secret-handle availability checks.
- Inputs crossing the boundary:
  - Runtime-policy-shaped values produced by the environment configuration layer during startup (derived from `RuntimeConfigDTO`).
  - Workspace-roots-shaped values mapping logical storage areas to concrete filesystem paths.
- Outputs crossing the boundary:
  - Canonical `RuntimePolicyDTO` and `WorkspaceRootsDTO` type exports in `@argentum/contracts` (existing).
  - Public `parseRuntimePolicyDTO(value: unknown): RuntimePolicyDTO` entrypoint (new).
  - `RuntimePolicyValidationCode`, `RuntimePolicyValidationIssue`, `RuntimePolicyValidationError` surface for deterministic boundary tests.

## Plan

- First contracts or interfaces to create:
  - `RuntimePolicyValidationCode` literal union with policy-specific codes: `invalid_type`, `invalid_integer`, `invalid_value`, `missing_required`, `unknown_key`. (`RuntimePolicyDTO` has no literal/enum fields, so `invalid_literal` is not applicable.)
  - `RuntimePolicyValidationIssue` interface with `path`, `code`, `message`.
  - `RuntimePolicyValidationError` class extending `Error` with `issues` array.
  - `parseRuntimePolicyDTO(value: unknown): RuntimePolicyDTO` — public entrypoint.
  - Internal `parseRuntimePolicyDTOAtPath(value, path, addIssue): RuntimePolicyDTO | undefined` — exported for downstream composition (e.g., environment startup validation, grant-resolver input validation). Follows the `parseExecutionGrantAtPath` export precedent.
  - Internal `parseWorkspaceRootsAtPath(value, path, addIssue): WorkspaceRootsDTO | undefined` — reusable for nested workspace-roots validation.
  - Public contracts index exports for the new parser and validation surface (types already exported).
- Minimal implementation steps:
  - Extend `packages/contracts/src/runtime-policy.ts` (currently ~12 lines of interfaces only) following the `execution-grant.ts` pattern:
    1. Import shared helpers (`expectRecord`, `isPlainObject`, `joinPath`, `pushUnknownKeys`) from `validation-helpers.ts`.
    2. Keep existing `WorkspaceRootsDTO` and `RuntimePolicyDTO` interfaces unchanged.
    3. Define `RuntimePolicyValidationCode`, `RuntimePolicyValidationIssue`, `RuntimePolicyValidationError`.
    4. Implement `parseRuntimePolicyDTO(value)` public entrypoint (delegates to internal `parseRuntimePolicyDTOAtPath`).
    5. Implement `parseRuntimePolicyDTOAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set: `enabled_tools`, `enabled_secret_handles`, `max_tool_runtime_ms`, `workspace_roots`, `trusted_local_mode`.
       - Validate `enabled_tools` (required array; validate each element as non-empty string, non-coercion including array/object rejection; empty array accepted).
       - Validate `enabled_secret_handles` (required array; validate each element as non-empty string, non-coercion; empty array accepted).
       - Validate `max_tool_runtime_ms` (required positive integer via `Number.isInteger()`, reject $\le 0$, `NaN`, `Infinity`, non-number types).
       - Validate `workspace_roots` (required plain object; delegate to `parseWorkspaceRootsAtPath`).
       - Validate `trusted_local_mode` (required boolean; reject strings, numbers, null, undefined).
       - Build and return frozen `RuntimePolicyDTO` object.
    6. Implement `parseWorkspaceRootsAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with known-field set: `bedrock`, `working`, `artifacts`, `logs`.
       - Validate all four required string fields (non-empty, non-coercion from numbers, booleans, arrays, objects).
       - Build and return frozen `WorkspaceRootsDTO` object.
  - Update `packages/contracts/src/index.ts` to export the new parser and validation surface (type exports already exist; add value exports).
- Required tests:
  - All tests live in a new file `packages/contracts/tests/runtime-policy.test.ts` following the existing `execution-grant.test.ts` pattern.
  - Valid policy tests:
    - Full valid `RuntimePolicyDTO` with populated `enabled_tools`, `enabled_secret_handles`, all four workspace roots, `trusted_local_mode = true`.
    - Valid policy with `trusted_local_mode = false`.
    - Valid policy with empty `enabled_tools` (no tools enabled).
    - Valid policy with empty `enabled_secret_handles`.
    - Valid policy with `max_tool_runtime_ms = 1` (minimum positive integer boundary).
  - Required-field missing tests:
    - Missing `enabled_tools` → `missing_required`.
    - Missing `enabled_secret_handles` → `missing_required`.
    - Missing `max_tool_runtime_ms` → `missing_required`.
    - Missing `workspace_roots` → `missing_required`.
    - Missing `trusted_local_mode` → `missing_required`.
  - Missing workspace-root field tests (each producing `missing_required` at path `workspace_roots.<field>`):
    - Missing `bedrock`.
    - Missing `working`.
    - Missing `artifacts`.
    - Missing `logs`.
  - Invalid type tests:
    - `enabled_tools` as string, object — each rejected with `invalid_type`.
    - `enabled_tools` element as number, boolean, empty string, array, object — each rejected with `invalid_type`.
    - `enabled_secret_handles` as string, object — each rejected with `invalid_type`.
    - `enabled_secret_handles` element as number, boolean, empty string, array, object — each rejected with `invalid_type`.
    - `max_tool_runtime_ms` as string, float, boolean, `NaN`, `Infinity` → `invalid_integer`.
    - `max_tool_runtime_ms` as `0`, `-1` → `invalid_value`.
    - `workspace_roots` as string, array, null — each rejected with `invalid_type`.
    - `workspace_roots.bedrock` as number, boolean, array, object, empty string — each rejected.
    - `trusted_local_mode` as string (`"true"`, `"false"`), number (`0`, `1`), null — each rejected with `invalid_type`.
  - Unknown key tests:
    - Extra top-level key rejected with `unknown_key`.
    - Extra key on `workspace_roots` rejected with `unknown_key`.
  - Error class test:
    - `parseRuntimePolicyDTO` throws `RuntimePolicyValidationError` (instanceof check) on invalid input.
  - Package entrypoint test proving downstream imports can consume `parseRuntimePolicyDTO`.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe. The owner and validation target are clear. This is a bounded contracts-only slice adding a parser to an existing type module. No upstream dependencies, no persistence, no filesystem access, and no deferred decisions to resolve. Run with a contracts-only patch scope plus the exact validation gates listed above.
- Parallel subagent opportunities:
  - Read-only extraction of field table from [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md).
  - Read-only extraction of existing parser patterns from `packages/contracts/src/execution-grant.ts` for fidelity.
- Out of scope:
  - `RuntimeConfigDTO` → `RuntimePolicyDTO` derivation (owned by environment configuration layer).
  - **Note — latent integration gap:** `deriveRuntimePolicy` in `packages/environment/src/runtime-startup-config.ts` currently constructs `RuntimePolicyDTO` without calling a parser. After this slice, a follow-up should wire `parseRuntimePolicyDTO` into the `deriveRuntimePolicy` return path.
  - Grant resolution logic (owned by environment grant resolver in a future slice).
  - Workspace-root filesystem validation or existence checks.
  - Secret-handle availability resolution.
  - Tool-name allowlist enforcement (grant resolver responsibility).
- Deferred decisions that must remain deferred:
  - Post-MVP `RuntimePolicyDTO` field expansion (the spec defines a closed 5-field policy surface for MVP).
  - Rich interactive approval workflows beyond `trusted_local_mode` boolean.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1:** Removed `invalid_literal` from `RuntimePolicyValidationCode` — `RuntimePolicyDTO` has no literal/enum fields. Final union: `invalid_type | invalid_integer | invalid_value | missing_required | unknown_key`.
  - **H2:** Added explicit test file declaration: `packages/contracts/tests/runtime-policy.test.ts`.
  - **M1:** Added array/object element rejection tests for `enabled_tools` and `enabled_secret_handles`.
  - **M2:** Specified `max_tool_runtime_ms` rejection codes: non-integer → `invalid_integer`, ≤ 0 → `invalid_value`.
  - **M3:** Added latent integration gap note about `deriveRuntimePolicy` not calling the parser.
  - **M4:** Added `RuntimePolicyValidationError` instanceof test requirement.
- Refinements applied: 2026-05-24 — H1, H2, M1, M2, M3, M4.
- Implementation notes (2026-05-24):
  - **Files changed:** `packages/contracts/src/runtime-policy.ts` (parser added to existing module), `packages/contracts/src/index.ts` (new exports), `packages/contracts/tests/runtime-policy.test.ts` (new, 51 tests), `packages/contracts/tests/package-entrypoint.test.ts` (+1 test).
  - **Type cast needed:** `Object.freeze()` return cast to `RuntimePolicyDTO` because existing interface uses mutable `string[]` (not `readonly`). Existing interfaces preserved per slice requirements.
  - **Pre-existing type issue:** `tool-definition.ts:197` had a stale tsc buildinfo artifact; resolved by cleaning `tsc -b --clean` before rebuild.
  - **Validation:** `pnpm --filter @argentum/contracts test` → 636/636 passed (12 files). `pnpm typecheck` → clean.
- Adversarial review findings (implementation review, 2026-05-24):
  - **L1 (LOW):** `workspace_roots` type-coercion tests only cover `bedrock` field. Working, artifacts, logs fields use the same `parseRequiredNonEmptyString` internal function so coverage is functionally complete, but explicit per-field coercion tests would improve regression resistance. No action required for MVP.
  - **L2 (LOW):** `parseRequiredPositiveInteger` does not special-case `-0` (handled correctly via `< 1` check). No action required.
  - **No CRITICAL, HIGH, or MEDIUM findings.** Contract fidelity, coercion resistance, edge-case handling, and module boundaries all verified correct.
- Audit 0010 remediation (2026-05-24):
  - **H1:** Added `parseRuntimePolicyDTOAtPath` and `parseWorkspaceRootsAtPath` value re-exports to `packages/contracts/src/index.ts`. These at-path parsers were exported from the source module but not surfaced through the package entrypoint.
  - **M2:** Changed `RuntimePolicyDTO.enabled_tools` from `string[]` to `readonly string[]` and `enabled_secret_handles` from `string[]` to `readonly string[]`. Removed the `as RuntimePolicyDTO` cast from `Object.freeze()` return — the types now align naturally. This is consistent with all other contracts interfaces using `readonly` for array fields.
  - **M6:** Switched `expectPolicyIssues` helper in `runtime-policy.test.ts` from `toHaveLength` + `arrayContaining(objectContaining(...))` to exact `{path, code}` tuple matching via `issues.map(({ path, code }) => ({ path, code })).toEqual(expected)`. This is stricter and matches the `context-item.test.ts` convention.
- Adversarial review remediation (2026-05-24):
  - **M1:** Added tests for non-object top-level input (`null`, `"foo"`, `42`) to `runtime-policy.test.ts` — each producing `{ path: "$", code: "invalid_type" }`.
  - **M2:** Added multi-issue collection test: `expectPolicyIssues({ trusted_local_mode: true }, [...])` verifying four simultaneous `missing_required` issues.
  - **M3:** Changed `WorkspaceRootsDTO` fields (`bedrock`, `working`, `artifacts`, `logs`) from mutable `string` to `readonly string` for consistency with all other DTOs in the codebase.
