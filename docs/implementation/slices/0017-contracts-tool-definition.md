# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer
- Approval date: 2026-05-24
- Phase: 3
- Owner: contracts
- Execution readiness: ready. No upstream dependency blocks this contracts-only surface. Must complete before slice 0019 (`tooling` tool registry) which composes `ToolDefinition` for registry registration. Slice 0018 (`RuntimePolicyDTO` parser) is independent and can run in parallel.

## Scope

- Slice name: Canonical ToolDefinition contract surface
- Target package or boundary: `contracts`
- Decision: `ToolDefinition` lives in `@argentum/contracts` (Option A). This keeps the canonical tool schema at the contracts boundary where all downstream packages can import it without creating a dependency on `tooling`.
- Slice prerequisite: Before implementation begins, update [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) to add `ToolDefinition` to the Contract Set table with Purpose "Canonical provider-neutral tool schema definition", Defining Spec `tool-schema-model.md`, Primary Producers "tool registry", Primary Consumers "environment grant resolver, LLM adapter".
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — contract rules; `ToolDefinition` is the canonical provider-neutral tool schema owned by the tool layer and projected outward for provider adapter use
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — sole shape authority for required schema fields, canonical vocabularies (`side_effect_level`, `path_scope`, `network_access`), and rules
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md) — contextual authority: "The registry is the source of truth for tool schema definitions" and "Provider-facing tool definitions must be generated from registry data"
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — contextual authority: `ExecutionGrantDTO` fields are derived from canonical tool schema execution-policy fields plus `RuntimePolicyDTO`
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `ToolDefinition` type plus a public parser entrypoint `parseToolDefinition(value: unknown): ToolDefinition`.
  - `ToolDefinition` field enforcement:
    - `name`: required non-empty string, `typeof === "string"` non-coercion (rejects numbers, booleans, arrays, objects, empty string). Represents namespace-qualified tool name per spec.
    - `description`: required non-empty string, non-coercion. Represents concise operational description per spec.
    - `input_schema`: required plain object (`typeof === "object" && value !== null && !Array.isArray(value)`). **Empty objects are accepted** — the schema's internal structure is the tool author's responsibility; the contracts layer only enforces presence as a plain object. Non-object values (null, array, string, number) are rejected with `invalid_type`.
    - `side_effect_level`: required canonical literal `"read_only" | "workspace_mutation" | "host_mutation" | "external_effect"`. Unknown string values rejected with `invalid_literal`. Wrong types rejected with `invalid_type`.
    - `path_scope`: required canonical literal `"none" | "working" | "workspace"`. Unknown string values rejected with `invalid_literal`. Wrong types rejected with `invalid_type`.
    - `required_secret_handles`: required array. Empty arrays are valid (tool may not need secrets). Each element must be a non-empty string, non-coercion. Non-array inputs rejected with `invalid_type`.
    - `network_access`: required canonical literal `"deny" | "inherit"`. Unknown string values rejected with `invalid_literal`. Wrong types rejected with `invalid_type`.
    - `default_timeout_ms`: required positive integer via `Number.isInteger()` non-coercion (rejects strings, floats, `NaN`, `Infinity`, negative integers, zero). Must be $\ge 1$.
    - `defaults`: optional plain object. When present, must satisfy `typeof === "object" && value !== null && !Array.isArray(value)`. **Empty objects are accepted.** Absence is valid (no default arguments). Non-object values (null, array, string, number) rejected with `invalid_type`.
    - Unknown keys rejected at top level with `unknown_key`.
  - The slice remains contract-only and does not implement registry registration, tool-routing logic, argument validation against `input_schema`, grant derivation, or provider-native tool-definition projection.
- Inputs crossing the boundary:
  - Tool-definition-shaped values produced by tool authors or operator configuration.
  - Execution-policy metadata intended for downstream grant-resolution consumption.
- Outputs crossing the boundary:
  - Canonical `ToolDefinition` type export in `@argentum/contracts`.
  - Public `parseToolDefinition(value: unknown): ToolDefinition` entrypoint.
  - `ToolDefinitionValidationCode`, `ToolDefinitionValidationIssue`, `ToolDefinitionValidationError` surface.

## Plan

- First contracts or interfaces to create:
  - `ToolDefinition` interface with `readonly` fields matching the spec required-fields list (all 9 fields; `defaults` is optional).
  - Literal unions: `SideEffectLevel` (`"read_only" | "workspace_mutation" | "host_mutation" | "external_effect"`), `PathScope` (`"none" | "working" | "workspace"`), `NetworkAccess` (`"deny" | "inherit"`).
  - `ToolDefinitionValidationCode` literal union with tool-definition-specific codes: `invalid_literal`, `invalid_type`, `invalid_integer`, `invalid_value`, `missing_required`, `unknown_key`.
  - `ToolDefinitionValidationIssue` interface with `path`, `code`, `message`.
  - `ToolDefinitionValidationError` class extending `Error` with `issues` array.
  - `parseToolDefinition(value: unknown): ToolDefinition` — public entrypoint.
  - Internal `parseToolDefinitionAtPath(value, path, addIssue): ToolDefinition | undefined` — reusable for nested validation in future modules (e.g., registry bulk-registration validation, provider tool-projection validation). Exported for downstream composition.
  - Public contracts index exports for the full tool-definition surface.
- Minimal implementation steps:
  - Add `packages/contracts/src/tool-definition.ts` following the established `execution-grant.ts` pattern:
    1. Import shared helpers (`expectRecord`, `isPlainObject`, `joinPath`, `pushUnknownKeys`) from `validation-helpers.ts`.
    2. Define `SideEffectLevel`, `PathScope`, `NetworkAccess` literal unions and lookup arrays.
    3. Define `ToolDefinition` interface with `readonly` fields.
    4. Define `ToolDefinitionValidationCode`, `ToolDefinitionValidationIssue`, `ToolDefinitionValidationError`.
    5. Implement `parseToolDefinition(value)` public entrypoint (delegates to internal `parseToolDefinitionAtPath`).
    6. Implement `parseToolDefinitionAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set: `name`, `description`, `input_schema`, `side_effect_level`, `path_scope`, `required_secret_handles`, `network_access`, `default_timeout_ms`, `defaults`.
       - Validate `name` (required non-empty string, non-coercion including array/object rejection).
       - Validate `description` (required non-empty string, non-coercion including array/object rejection).
       - Validate `input_schema` (required plain non-null non-array object; empty objects accepted — schema structure is author-owned).
       - Validate `side_effect_level` (required canonical literal; verify against lookup array).
       - Validate `path_scope` (required canonical literal; verify against lookup array).
       - Validate `required_secret_handles` (required array; validate each element as non-empty string, non-coercion; empty array accepted).
       - Validate `network_access` (required canonical literal; verify against lookup array).
       - Validate `default_timeout_ms` (required positive integer via `Number.isInteger()`, non-coercion):
         - Non-integer types (string, float, boolean, `NaN`, `Infinity`) → `invalid_integer`.
         - Integer but ≤ 0 (zero, negative) → `invalid_value`.
       - Validate `defaults` (optional plain object; when present and not `undefined`, must be plain non-null non-array object; empty objects accepted; absence accepted).
       - Build and return frozen `ToolDefinition` object.
  - Export the new surface through `packages/contracts/src/index.ts` only.
- Required tests:
  - Valid definition tests:
    - Full valid `ToolDefinition` with all 9 fields (including `defaults`).
    - Valid `ToolDefinition` without `defaults` (optional field absent).
    - Valid `ToolDefinition` with empty `required_secret_handles`.
    - Valid `ToolDefinition` with empty `input_schema` (`{}`).
    - Valid `ToolDefinition` with empty `defaults` (`{}`).
    - Valid `ToolDefinition` across all four `side_effect_level` literals.
    - Valid `ToolDefinition` across all three `path_scope` literals.
    - Valid `ToolDefinition` across both `network_access` literals.
    - Valid `ToolDefinition` with `default_timeout_ms = 1` (minimum positive integer boundary).
  - Required-field missing tests (one test per required field, each producing `missing_required`):
    - Missing `name`.
    - Missing `description`.
    - Missing `input_schema`.
    - Missing `side_effect_level`.
    - Missing `path_scope`.
    - Missing `required_secret_handles`.
    - Missing `network_access`.
    - Missing `default_timeout_ms`.
  - Invalid literal tests:
    - Unknown `side_effect_level` value rejected with `invalid_literal`.
    - Unknown `path_scope` value rejected with `invalid_literal`.
    - Unknown `network_access` value rejected with `invalid_literal`.
  - Invalid type tests:
    - `name` as number, boolean, array, object, empty string — each rejected with `invalid_type`.
    - `description` as number, boolean, array, object, empty string — each rejected with `invalid_type`.
    - `input_schema` as null, array, string, number — each rejected with `invalid_type`.
    - `side_effect_level` as number — rejected with `invalid_type`.
    - `required_secret_handles` as string, object — each rejected with `invalid_type`.
    - `required_secret_handles` element as number, boolean, empty string — each rejected with `invalid_type`.
    - `default_timeout_ms` as string, float, boolean, `NaN`, `Infinity` → `invalid_integer`.
    - `default_timeout_ms` as `0`, `-1` → `invalid_value`.
    - `defaults` as null, array, string — each rejected with `invalid_type`.
  - Non-object top-level test:
    - Non-object input (string, number, array, null) → `invalid_type` at path `$`.
  - Null element test:
    - `required_secret_handles` element as `null` → `invalid_type` at `required_secret_handles[0]`.
  - Unknown key test:
    - Extra top-level key rejected with `unknown_key`.
  - Package entrypoint test proving downstream imports can consume the new `ToolDefinition` surface.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe. The owner and validation target are clear. This is a bounded contracts-only slice with no upstream dependencies, no persistence, and no deferred decisions to resolve. Run with a contracts-only patch scope plus the exact validation gates listed above.
- Parallel subagent opportunities:
  - Read-only extraction of required fields and canonical vocabularies from [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md).
  - Read-only extraction of existing parser patterns from `packages/contracts/src/execution-grant.ts` for fidelity.
- Out of scope:
  - Tool registry registration and lifecycle.
  - Argument validation against `input_schema` (owned by tool registry in slice 0019).
  - Grant derivation from execution-policy fields.
  - Provider-native tool-definition projection (owned by `llm_provider`).
  - Tool implementation routing or execution.
- Deferred decisions that must remain deferred:
  - Post-MVP tool schema evolution beyond the nine required fields.
  - Provider-specific schema extensions (the spec requires projection from registry data, not schema duplication).

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **C1 (RESOLVED):** Option A — `ToolDefinition` lives in `@argentum/contracts`. Added decision note and spec-update prerequisite.
  - **H1:** Added `invalid_value` to `ToolDefinitionValidationCode`. Split `default_timeout_ms` rejection: non-integer types → `invalid_integer`, integer ≤ 0 → `invalid_value`.
  - **H2:** Specified exact error codes for each `default_timeout_ms` rejection case.
  - **M1:** Added non-object top-level test (string, number, array, null → `invalid_type` at `$`).
  - **M2:** Added `null` element test for `required_secret_handles`.
  - **M3 (RESOLVED):** Added `defaults as number` and `defaults as boolean` tests. Acceptance criteria lists "null, array, string, number" for `defaults` non-plain-object rejection; original suite covered only null, array, string. Boolean added defensively — `isPlainObject` rejects it correctly.
- Refinements applied: 2026-05-24 — C1, H1, H2, M1, M2, M3.
- Audit 0010 remediation (2026-05-24):
  - **H1:** Added `parseToolDefinitionAtPath` value re-export to `packages/contracts/src/index.ts`. This at-path parser was exported from the source module but not surfaced through the package entrypoint.
  - **M6:** Switched `expectToolDefinitionIssues` helper in `tool-definition.test.ts` from `toHaveLength` + `arrayContaining(objectContaining(...))` to exact `{path, code}` tuple matching via `issues.map(({ path, code }) => ({ path, code })).toEqual(expected)`. This is stricter than the previous pattern and matches the `context-item.test.ts` convention.
