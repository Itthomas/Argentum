# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (autopilot)
- Approval date: 2026-05-24
- Phase: 3
- Owner: environment

## Scope

- Slice name: Environment grant resolver (pure derivation of `ExecutionGrantDTO` from `ToolDefinition` + `RuntimePolicyDTO`)
- Target package or boundary: `environment` (`@argentum/environment`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — sole authority for grant derivation rules, path-permission mapping, secret-intersection logic, network-policy mapping, runtime ceiling capping, approval-outcome rules, and blocked-outcome rules
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — canonical `ExecutionGrantDTO` shape (already implemented in `@argentum/contracts`)
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md) — `RuntimePolicyDTO` shape consumed during resolution (already implemented in `@argentum/contracts`)
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — `ToolDefinition` fields consumed by grant resolution: `side_effect_level`, `path_scope`, `network_access`, `required_secret_handles`, `default_timeout_ms`
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - A side-effect-free (except `grant_id` generation via `crypto.randomUUID()`) `resolveGrant(toolDef, policy): GrantResolution` function derives one `ExecutionGrantDTO` per tool call from `ToolDefinition` + `RuntimePolicyDTO` with deterministic output (same inputs → same result except for `grant_id`).
  - **Path permissions** are derived from `path_scope`:
    - `"none"` → `path_permissions = []`
    - `"working"` → `working` (read + write) + `artifacts` (read + write)
    - `"workspace"` → `bedrock` (read) + `working` (read + write) + `artifacts` (read + write) + `logs` (append)
  - **cwd** is set to `RuntimePolicyDTO.workspace_roots.working`.
  - **env_secret_handles** is the intersection of `required_secret_handles` and `enabled_secret_handles`; if any required handle is unavailable, the grant resolves to `deny`.
  - **network_access** maps `"deny"` → `"deny"`, `"inherit"` → `"inherit"` for `network_policy`.
  - **max_runtime_ms** is `default_timeout_ms` capped by `RuntimePolicyDTO.max_tool_runtime_ms` (i.e., `Math.min(default_timeout_ms, max_tool_runtime_ms)`).
  - **Tools not in `enabled_tools`** resolve to `deny` with a stable `error_code` of `"tool_disabled"`.
  - **`trusted_local_mode = true`** + all policy checks pass → `approval_mode = "auto_allow"`. Otherwise → `deny`.
  - **Denied grants** produce `approval_mode = "deny"` with:
    - A stable policy-oriented `error_code` (`"tool_disabled"`, `"secret_unavailable"`, or `"policy_denied"` for catch-all policy violations).
    - `path_permissions = []`, `env_secret_handles = []`, `network_policy = "deny"`, `max_runtime_ms = 0`.
    - A human-readable `denial_reason` string.
  - The `GrantResolution` discriminated union allows callers to branch on `approval_mode` without inspecting grant internals.
  - The slice does NOT wire the resolver into the execution driver, core loop, or any runtime pipeline. It is a standalone pure function exported from `@argentum/environment`.
- Inputs crossing the boundary:
  - `ToolDefinition` from `@argentum/contracts` (fields: `name`, `path_scope`, `required_secret_handles`, `network_access`, `default_timeout_ms`).
  - `RuntimePolicyDTO` from `@argentum/contracts` (fields: `enabled_tools`, `enabled_secret_handles`, `max_tool_runtime_ms`, `workspace_roots`, `trusted_local_mode`).
- Outputs crossing the boundary:
  - `resolveGrant(toolDef, policy): GrantResolution` — public entrypoint.
  - `GrantResolution` discriminated union type (`{ approval_mode: "auto_allow"; grant: ExecutionGrantDTO } | { approval_mode: "deny"; grant: ExecutionGrantDTO; denial_reason: string; error_code: string }`).
  - `GrantDenialCode` literal union (`"tool_disabled" | "secret_unavailable" | "policy_denied"`).
  - Exported through `packages/environment/src/index.ts`.

## Plan

- First contracts or interfaces to create:
  - `GrantDenialCode` literal union: `"tool_disabled" | "secret_unavailable" | "policy_denied"`.
  - `DENIAL_CODES` constant: `const DENIAL_CODES: readonly GrantDenialCode[] = ["tool_disabled", "secret_unavailable", "policy_denied"];` — used for runtime iteration and validation of denial code literals.
  - `GrantResolution` discriminated union type with `approval_mode` discriminant. **Rationale for discriminated union**: The top-level `approval_mode` discriminant enables TypeScript control-flow narrowing on the result without requiring callers to inspect `grant.approval_mode`. While `ExecutionGrantDTO` also carries an `approval_mode` field, the union's tag resides at the result surface for ergonomic branching (`if (result.approval_mode === "auto_allow") { /* result.grant is narrowed */ }`).
  - Internal helper types for path-permission construction, secret intersection, and runtime capping.
- Minimal implementation steps:
  1. Create `packages/environment/src/grant-resolver.ts`:
     - Import `ToolDefinition`, `RuntimePolicyDTO`, `ExecutionGrantDTO`, `ExecutionGrantPathPermission`, `PathRoot`, `Capability`, `ApprovalMode`, `NetworkPolicy` from `@argentum/contracts`.
     - Define `GrantDenialCode` type and `DENIAL_CODES` constant map (`const DENIAL_CODES: readonly GrantDenialCode[] = ["tool_disabled", "secret_unavailable", "policy_denied"]`).
     - Define `GrantResolution` discriminated union.
     - Implement `resolveGrant(toolDef: ToolDefinition, policy: RuntimePolicyDTO): GrantResolution`:
       1. **Enabled-tool check**: If `toolDef.name` is not in `policy.enabled_tools`, return deny with `error_code = "tool_disabled"`.
       2. **Secret-intersection check**: Compute intersection of `toolDef.required_secret_handles` and `policy.enabled_secret_handles`. If `required_secret_handles` contains any handle not in `enabled_secret_handles`, return deny with `error_code = "secret_unavailable"`.
       3. **Path-permission derivation**: Map `toolDef.path_scope` to `ExecutionGrantPathPermission[]` using the spec rules. Use concrete paths from `policy.workspace_roots`. **Canonical ordering**: Within the returned array, path permissions MUST be ordered `bedrock → working → artifacts → logs` (matching the spec's declaration order). This ensures deterministic array equality beyond content alone.
       4. **Network-policy mapping**: Map `toolDef.network_access` → `NetworkPolicy`.
       5. **Runtime ceiling**: `Math.min(toolDef.default_timeout_ms, policy.max_tool_runtime_ms)`.
       6. **cwd**: `policy.workspace_roots.working`.
       7. **grant_id**: Generate via `crypto.randomUUID()`.
       8. **Approval outcome**: If `policy.trusted_local_mode === true` and no denial conditions triggered, return `auto_allow` with the fully populated grant. Otherwise return `deny` with `error_code = "policy_denied"`.
     - Implement internal helpers:
       - `derivePathPermissions(scope: PathScope, roots: WorkspaceRootsDTO): ExecutionGrantPathPermission[]`
       - `intersectSecretHandles(required: readonly string[], enabled: readonly string[]): { available: string[]; missing: string[] }`
       - `buildDeniedGrant(toolName: string, errorCode: GrantDenialCode, reason: string): ExecutionGrantDTO` — `toolName` is used **only** to compose the human-readable `denial_reason` string (e.g., `"Tool '${toolName}' denied: ${reason}"`). It does not correspond to any field on `ExecutionGrantDTO` (which has no `tool_name` field). The `reason` parameter provides the specific policy violation detail.
       - `buildAutoAllowGrant(toolDef: ToolDefinition, policy: RuntimePolicyDTO, pathPerms: ExecutionGrantPathPermission[], secretHandles: string[], networkPolicy: NetworkPolicy, maxRuntimeMs: number): ExecutionGrantDTO`
  2. Export the new surface through `packages/environment/src/index.ts`:
     - Add `export { resolveGrant } from "./grant-resolver.js";`
     - Add `export type { GrantResolution, GrantDenialCode } from "./grant-resolver.js";`
  3. Ensure `@argentum/environment` already depends on `@argentum/contracts` (confirmed — already in `package.json`).
- Required tests:
  - All tests in `packages/environment/tests/grant-resolver.test.ts`.
  - **Auto-allow path tests**:
    - Tool in `enabled_tools`, all secrets available, `trusted_local_mode = true`, `path_scope = "workspace"` → `auto_allow` with all 4 root permissions.
    - `path_scope = "working"` → `auto_allow` with working + artifacts permissions only.
    - `path_scope = "none"` → `auto_allow` with empty `path_permissions`.
    - Tool with no required secrets → `auto_allow` (empty secret intersection).
    - `network_access = "deny"` → `network_policy = "deny"`.
    - `network_access = "inherit"` → `network_policy = "inherit"`.
    - `default_timeout_ms` > `max_tool_runtime_ms` → `max_runtime_ms` capped to policy max.
    - `default_timeout_ms` < `max_tool_runtime_ms` → `max_runtime_ms` = `default_timeout_ms`.
    - `cwd` always equals `workspace_roots.working`.
  - **Deny path tests**:
    - Tool not in `enabled_tools` → `deny` with `error_code = "tool_disabled"`, `path_permissions = []`, `env_secret_handles = []`, `network_policy = "deny"`, `max_runtime_ms = 0`.
    - Required secret not in `enabled_secret_handles` → `deny` with `error_code = "secret_unavailable"`.
    - `trusted_local_mode = false` → `deny` with `error_code = "policy_denied"` (even if all other checks pass).
  - **Determinism tests**:
    - Same `ToolDefinition` + `RuntimePolicyDTO` called twice produces same `path_permissions`, `cwd`, `env_secret_handles`, `network_policy`, `max_runtime_ms`, and `approval_mode` (only `grant_id` differs due to UUID generation).
    - **Array-order determinism**: Verify exact `path_permissions` array order (`bedrock → working → artifacts → logs`) for `path_scope = "workspace"`; verify `working → artifacts` order for `path_scope = "working"`.
  - **Edge cases**:
    - Empty `required_secret_handles` + empty `enabled_secret_handles` → intersection is `[]`, not a denial.
    - `path_scope = "none"` with `trusted_local_mode = true` → still `auto_allow` (no path access needed).
    - `max_tool_runtime_ms = 0` policy edge: `default_timeout_ms` is positive but `Math.min` caps to 0 (unlikely in practice, but tested).
- Narrow validation step:
  - Run `pnpm --filter @argentum/environment test` and confirm all grant-resolver tests pass.
  - Confirm pure function determinism: wrap tests to call `resolveGrant` twice with identical inputs and assert structural equality (ignoring `grant_id`).

## Execution Strategy

- Autopilot suitability: **safe**. The slice is a single pure function in the `environment` package with no I/O, no side effects, and no unresolved bootstrap decisions. All contracts (`ToolDefinition`, `RuntimePolicyDTO`, `ExecutionGrantDTO`) are already implemented and validated. The mapping rules are fully specified in `grant-resolution.md` with no ambiguity. Tests are deterministic and self-contained.
- Parallel subagent opportunities:
  - **Read-only risk review** (subagent): An adversarial-review subagent can independently verify that the grant derivation rules in the implementation match every clause in `grant-resolution.md` and that no rule is omitted or widened. This can run in parallel with implementation.
  - **Test-harvesting subagent** (read-only): A subagent can extract the exact acceptance criteria from `grant-resolution.md` into a checklist and cross-reference against the test plan in this slice card to confirm coverage before implementation begins.
- Out of scope:
  - Wiring `resolveGrant()` into the execution driver or core loop (follow-up slices 0021+).
  - Secret value resolution (only handle intersection is performed; actual secret injection is deferred).
  - Interactive approval workflows (rich `approval_mode` beyond `auto_allow`/`deny` is post-MVP).
  - Fine-grained network policy beyond `deny`/`inherit`.
  - Tool-call construction (`ToolCallDTO`) — that is owned by the core loop or execution driver.
  - `ToolResultDTO` construction for blocked outcomes — the resolver provides the `error_code` and `denial_reason`; the execution driver constructs the result DTO.
  - `tool.blocked` event emission — the execution driver emits the event when it encounters a denied grant.
  - Bedrock immutability enforcement at the filesystem level (enforced structurally through `path_permissions` granting only `read` on `bedrock`).
- Deferred decisions that must remain deferred:
  - None triggered by this slice. All inputs (`ToolDefinition`, `RuntimePolicyDTO`) are already canonical. The mapping rules are fully specified. No persistence, provider selection, or compaction decisions are involved.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **CRITICAL**: none
  - **HIGH**: none
  - **MEDIUM** (6 findings):
    - **M1** — `DENIAL_CODES` constant map declared but never specified.
    - **M2** — `buildDeniedGrant` receives unused `toolName` parameter but `ExecutionGrantDTO` has no `tool_name` field.
    - **M3** — Plan step 1.8 underspecifies `error_code` for `trusted_local_mode = false`.
    - **M4** — Type re-exports from `index.ts` vaguely specified as "and type exports".
    - **M5** — `GrantResolution` duplicates `approval_mode` discriminant (present on both union tag and nested `ExecutionGrantDTO`).
    - **M6** — `path_permissions` array ordering not specified.
  - **LOW**: none
- Refinements applied (2026-05-24):
  - **M1**: Specified `DENIAL_CODES` as `readonly GrantDenialCode[]` with all three literal values. Removed the `policy` parameter from `buildDeniedGrant` (unused).
  - **M2**: Documented that `toolName` is used **only** to compose the human-readable `denial_reason` string. Noted that `ExecutionGrantDTO` has no `tool_name` field.
  - **M3**: Amended step 1.8 to explicitly state `deny` with `error_code = "policy_denied"` when `trusted_local_mode = false`.
  - **M4**: Specified exact `index.ts` exports: `export { resolveGrant }` plus `export type { GrantResolution, GrantDenialCode }`.
  - **M5**: Documented rationale for `GrantResolution` discriminated union: top-level `approval_mode` discriminant enables TypeScript control-flow narrowing without inspecting nested `grant.approval_mode`.
  - **M6**: Specified canonical `path_permissions` array ordering (`bedrock → working → artifacts → logs`). Added array-order determinism sub-test for `path_scope = "workspace"` and `path_scope = "working"`.

- Post-implementation adversarial review (2026-05-24):
  - **CRITICAL**: none
  - **HIGH**: none
  - **MEDIUM**: none
  - **LOW** (2 findings):
    - **L1** — `max_runtime_ms = 0` for denied grants: The `ExecutionGrantDTO` parser (`parseRequiredPositiveInteger`) requires `>= 1`, but the slice card explicitly requires `max_runtime_ms = 0` for denied grants. Since the grant resolver constructs DTOs directly (not through parsing), this is not a runtime issue. The execution driver checks `approval_mode === "deny"` and short-circuits before inspecting `max_runtime_ms`. Noted for awareness; no change required.
    - **L2** — Defensive sort in `derivePathPermissions`: The `.sort()` by `PATH_ROOT_ORDER` is redundant given the `switch` statement already emits permissions in canonical order. Harmless safety net; no change required.
  - **Implementation refinements applied during review**:
    - Removed unused `ToolDefinition` parameter from internal `deny()` helper (the tool name is embedded in the `reason` string by callers).
    - Removed unused `Capability` import.
    - Added `DENIAL_CODES` to the value exports from `index.ts` (beyond the type-only `GrantDenialCode`), since it is intended for runtime iteration.
  - **Validation results**:
    - `pnpm --filter @argentum/environment test`: 36 tests pass (25 grant-resolver + 11 runtime-startup-config)
    - `pnpm typecheck` (`tsc -b`): clean build, no errors
  - **Approval recommendation**: `approved` — no blocking findings. Slice is complete and ready for wiring in follow-up slices 0021+.
