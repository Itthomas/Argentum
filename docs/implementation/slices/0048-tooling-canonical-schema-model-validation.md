# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-26
- Phase: 7 (Hardening)
- Owner: packages/tooling

## Scope

- Slice name: Non-throwing tool schema validation wrapper
- Target package or boundary: `packages/tooling` (`@argentum/tooling`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — defines the canonical provider-neutral schema shape and vocabularies
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `ToolDefinition` is the canonical provider-neutral tool schema; `parseToolDefinition` performs all structural and vocabulary validation
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — execution policy fields are canonical inputs to grant resolution
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — tool registry tests for schema validation
- Acceptance criteria:
  - The tooling package exposes a `validateToolSchemaModel` function that wraps `parseToolDefinition` from `@argentum/contracts` in a try/catch, catches `ToolDefinitionValidationError`, and returns a non-throwing `ToolSchemaValidationResult`.
  - `validateToolSchemaModel` does **not** re-implement any validation logic. All structural parsing, vocabulary checks (`side_effect_level`, `path_scope`, `network_access` via `parseRequiredLiteral`), `required_secret_handles` array check, and `default_timeout_ms` positive integer check continue to happen exclusively in `parseToolDefinition`.
  - The function returns `{ valid: true, definition: ToolDefinition }` on success, or `{ valid: false, errors: string[] }` on failure (with error messages extracted from `ToolDefinitionValidationError.issues`).
  - The `ToolRegistry.register()` method may optionally use this wrapper instead of calling `parseToolDefinition` directly, to get a non-throwing result API. The registry's existing call to `parseToolDefinition` already validates everything; this wrapper is a convenience API, not a new validation layer.
  - No contract changes are required.
- Inputs crossing the boundary:
  - `unknown` value submitted for tool registration (passed through to `parseToolDefinition`)
- Outputs crossing the boundary:
  - `ToolSchemaValidationResult` — either `{ valid: true; definition: ToolDefinition }` or `{ valid: false; errors: string[] }`

## Plan

- First contracts or interfaces to create:
  - `ToolSchemaValidationResult` discriminated union type
  - `validateToolSchemaModel(value: unknown): ToolSchemaValidationResult`
- Minimal implementation steps:
  1. Import `parseToolDefinition` and `ToolDefinitionValidationError` from `@argentum/contracts`. The wrapper performs zero validation on its own — vocabulary constants are not needed because `parseToolDefinition` handles all checks internally.
  2. Implement `validateToolSchemaModel` in a new `packages/tooling/src/tool-schema-model.ts`: call `parseToolDefinition(value)` inside a try/catch, catch `ToolDefinitionValidationError`, extract `.issues` into error strings, and return the appropriate discriminated union.
  3. Export `validateToolSchemaModel` and `ToolSchemaValidationResult` from `packages/tooling/src/index.ts`.
  4. Optionally update `ToolRegistry.register()` to use the wrapper for a non-throwing code path (existing direct `parseToolDefinition` call already provides full validation).
- Required tests:
  - A valid tool definition raw object passes validation and returns `{ valid: true, definition: ... }`.
  - A tool definition missing `side_effect_level` returns `{ valid: false, errors: [...] }` with an error message naming the missing field.
  - An invalid `side_effect_level` value (e.g., `"destructive"`) returns `{ valid: false, errors: [...] }` with an error listing allowed values.
  - An invalid `path_scope` value returns validation failure.
  - An invalid `network_access` value returns validation failure.
  - `required_secret_handles` that is not a string array returns validation failure.
  - `default_timeout_ms` that is zero, negative, or non-integer returns validation failure.
  - The wrapper does not throw for any invalid input; all failures are returned as `{ valid: false }`.
  - Existing registry tests continue to pass (the registry still uses `parseToolDefinition` directly; the wrapper is an additional API).
- Narrow validation step:
  - `pnpm --filter @argentum/tooling test -- schema`
  - `pnpm --filter @argentum/tooling build`

## Execution Strategy

- Autopilot suitability: safe. The slice is a thin non-throwing wrapper around an existing, well-tested parser with clear inputs and outputs.
- Parallel subagent opportunities:
  - Read-only extraction of `ToolDefinitionValidationError` shape and `ToolDefinitionValidationIssue` fields from `@argentum/contracts` to inform error message extraction.
- Out of scope:
  - Re-implementing any validation logic (all validation stays in `parseToolDefinition`)
  - Defining duplicate vocabulary constants in `@argentum/tooling`
  - Changes to the `ToolDefinition` contract shape
  - Provider-native tool schema rendering (that lives in `@argentum/llm_provider`)
  - Runtime tool discovery or exposure planning
  - Schema migration or versioning
- Deferred decisions that must remain deferred:
  - Exact initial tool catalog included in MVP
  - Whether tool exposure per step is full-registry or curated subset in MVP

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1 (CRITICAL)** — The proposed `validateToolSchemaModel` was entirely redundant with `parseToolDefinition` in `@argentum/contracts`, which already performs ALL the same validations (vocabulary checks for `side_effect_level`/`path_scope`/`network_access` via `parseRequiredLiteral`, `required_secret_handles` array check, `default_timeout_ms` positive integer check). `ToolRegistry.register()` already calls `parseToolDefinition` before storing. Adding a second validator re-checking the same things on an already-validated frozen object adds zero protection and duplicates vocabulary constants.
  - **H2 (CRITICAL)** — Vocabulary constants (`SIDE_EFFECT_LEVELS`, `PATH_SCOPES`, `NETWORK_ACCESS_VALUES`) already exist in `@argentum/contracts`. Must not duplicate them in `@argentum/tooling`.
  - **H1 (HIGH — resolved)** — Post-re-scope review found the plan still required importing vocabulary constants that are not exported from `@argentum/contracts` and are not used by the non-throwing wrapper. Removed the vocabulary-constant import requirement from the plan and AC.
- Refinements applied: 2026-05-26 — Complete re-scope. Slice changed from "canonical schema model validation" (redundant validator) to "non-throwing tool schema validation wrapper" (thin try/catch around `parseToolDefinition`). All validation logic remains in `@argentum/contracts`. No vocabulary constants are imported (not needed by the wrapper and not exported from contracts). Title updated.
  - **2026-05-26 — Post-implementation review (LOW, no blockers):**
    - **L1 (LOW)** — The wrapper catches all `Error` subtypes (not only `ToolDefinitionValidationError`) as a defense-in-depth measure for the non-throwing contract. `parseToolDefinition` only throws `ToolDefinitionValidationError`, so the fallback branch is dead code in practice. Accepted as harmless safety net.
    - **L2 (LOW)** — `ToolSchemaValidationResult` uses `readonly` modifiers on both branches. This is consistent with the frozen `ToolDefinition` contract and provides maximal type safety. Accepted as a style choice aligned with the codebase conventions.
  - **Validation results:**
    - `pnpm --filter @argentum/tooling test -- schema`: 28/28 passed (15 schema-validator + 13 tool-schema-model)
    - `pnpm --filter @argentum/tooling build`: TypeScript compilation clean
    - `pnpm --filter @argentum/tooling test`: 113/113 passed (full suite, zero regressions)
