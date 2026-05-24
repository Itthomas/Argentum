# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (via user directive)
- Approval date: 2026-05-24
- Phase: 3
- Owner: tooling
- Execution readiness: implemented-and-validated. Slice 0017 (`ToolDefinition` contract) must be implemented first so this slice can consume the canonical `ToolDefinition` type and parser. Slice 0014 (`ToolCallDTO`/`ToolResultDTO`) is already validated and available. Slice 0018 (`RuntimePolicyDTO` parser) is NOT a direct dependency — the registry validates calls against registered schemas, not against runtime policy (policy is consumed by grant resolution in a future environment slice). This is the first implementation slice for the `@argentum/tooling` package (currently a shell with `export {}`).

## Scope

- Slice name: In-process tool registry implementation
- Target package or boundary: `tooling`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md) — sole authority for registry responsibilities, rules, MVP constraints, and acceptance criteria
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — shape authority for `ToolDefinition` fields consumed during registration
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `ToolCallDTO` is the inbound request crossing from core loop to tool layer; `ToolResultDTO` is the outbound structured outcome
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md) — shape authority for `ToolCallDTO.arguments` validation rules and `ToolResultDTO` status values
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `tooling` package exports a `ToolRegistry` class (or function-based registry) that satisfies all registry responsibilities from `tool-registry.md`.
  - **Registration**: `register(tool: ToolDefinition, implementation: ToolImplementation)` registers one tool by namespace-qualified name. Duplicate registration (same name) must be rejected with a deterministic error. Registered tools must be retrievable by name.
  - **Schema enforcement on arguments**: When a `ToolCallDTO` is dispatched via the registry, `ToolCallDTO.arguments` must be validated against the registered tool's `input_schema`. Validation is the registry's canonical authority per spec: "Tool-layer schema validation is the canonical authority for validating `ToolCallDTO.arguments` against the registered schema."
    - If `arguments` fail schema validation, the registry must return a `ToolResultDTO` with `status = "error"`, `human_summary` describing the validation failure, `truncated = false`, `retryable = false`, and a stable `error_code` indicating schema validation failure.
    - If `arguments` pass schema validation, the registry must route the call to the registered implementation.
  - **Routing**: `dispatch(call: ToolCallDTO): Promise<ToolResultDTO>` routes the tool call to the implementation registered for `call.tool_name`. Calls for unregistered tool names must return `ToolResultDTO` with `status = "error"`, `human_summary` describing the missing tool, `truncated = false`, `retryable = false`, and a stable `error_code` for unregistered tool.
  - **Implementation contract**: A `ToolImplementation` is a function `(call: ToolCallDTO) => Promise<ToolResultDTO>`. The registry wraps implementation execution and must ensure:
    - `call_id` on the returned `ToolResultDTO` matches the inbound `ToolCallDTO.call_id`.
    - `duration_ms` is measured from dispatch start to implementation return.
    - Implementation throws are caught and converted to `ToolResultDTO` with `status = "error"`, `human_summary` describing the failure, `truncated = false`, `retryable = false`, and a stable `error_code` for execution failure.
  - **Projection**: `projectForProvider(): AvailableToolEntry[]` returns provider-facing tool entries (name, description, input_schema) derived from registered `ToolDefinition` data. Output must match the `AvailableToolEntry` shape defined in slice 0016 (`LLMInferenceRequest.available_tools`). This satisfies the spec acceptance criterion: "A provider adapter can project tool definitions from the registry without adapter-owned schema duplication."
  - **MVP constraints honored**: One local in-process registry; one implementation per registered tool.
  - The slice does NOT implement grant resolution, execution-driver subprocess spawning, artifact persistence, retry policy, or provider adapter projection wiring.
- Inputs crossing the boundary:
  - `ToolDefinition` values (canonical contract from slice 0017) for registration.
  - `ToolImplementation` functions provided by tool authors.
  - `ToolCallDTO` values (canonical contract from slice 0014) for dispatch.
- Outputs crossing the boundary:
  - `ToolRegistry` class/interface exported from `@argentum/tooling`.
  - `ToolImplementation` type exported from `@argentum/tooling`.
  - `TOOL_NOT_REGISTERED`, `SCHEMA_VALIDATION_FAILED`, `TOOL_EXECUTION_FAILED` constants exported from `@argentum/tooling`.
  - `ToolResultDTO` values returned from `dispatch()`.
  - `AvailableToolEntry[]` values returned from `projectForProvider()`.
  - Deterministic error results for unregistered tools, schema validation failures, and implementation throws.

## Plan

- First contracts or interfaces to create:
  - `ToolImplementation` type: `(call: ToolCallDTO) => Promise<ToolResultDTO>`.
  - `ToolRegistry` interface or class with:
    - `register(definition: ToolDefinition, implementation: ToolImplementation): void` — registers one tool; throws on duplicate name.
    - `dispatch(call: ToolCallDTO): Promise<ToolResultDTO>` — validates arguments against registered schema, routes to implementation, measures duration, catches throws.
    - `projectForProvider(): AvailableToolEntry[]` — returns provider-facing entries from registered definitions.
    - `isRegistered(name: string): boolean` — read-only lookup for testing and introspection.
    - `getDefinition(name: string): ToolDefinition | undefined` — read-only lookup for testing.
  - Internal schema validation utility: validates a `Record<string, unknown>` against a JSON Schema-like `input_schema` object. For MVP, implement a minimal structural validator supporting at least `type`, `properties`, `required`, and `additionalProperties` keywords — sufficient to validate structured tool arguments against the registered schema. If a tool's `input_schema` is empty (`{}`), all arguments objects pass validation (no constraints).
  - Stable error codes (exported as constants from `@argentum/tooling`):
    - `TOOL_NOT_REGISTERED` — dispatch for unregistered tool name.
    - `SCHEMA_VALIDATION_FAILED` — arguments fail schema check.
    - `TOOL_EXECUTION_FAILED` — implementation throws or returns structurally invalid `ToolResultDTO`.
- Minimal implementation steps:
  - Replace the shell `packages/tooling/src/index.ts` (`export {};`) with the registry implementation.
  - Add `@argentum/contracts` as a workspace dependency in `packages/tooling/package.json` (to import `ToolDefinition`, `ToolCallDTO`, `ToolResultDTO`, `AvailableToolEntry`, plus their parsers).
  - Create `packages/tooling/src/registry.ts`:
    1. Define `ToolImplementation` type.
    2. Define `ToolRegistryEntry` internal shape: `{ definition: ToolDefinition; implementation: ToolImplementation }`.
    3. Implement `ToolRegistry` class:
       - Private `Map<string, ToolRegistryEntry>` for storage.
       - `register()`: validate definition via `parseToolDefinition`, check for duplicate name, store entry. Throw on duplicate with stable error message.
       - `dispatch()`:
         - First line: `const startMs = Date.now()`. All three error paths must include `call_id` (set to `ToolCallDTO.call_id`) and `duration_ms` (computed as `Date.now() - startMs`).
         - Lookup tool by `call.tool_name`; if missing, return `TOOL_NOT_REGISTERED` result with `call_id` and `duration_ms`.
         - Validate `call.arguments` against `definition.input_schema` using internal schema validator; if invalid, return `SCHEMA_VALIDATION_FAILED` result with `call_id` and `duration_ms`.
         - Invoke `implementation(call)`, measure `duration_ms`.
         - Catch throws and return `TOOL_EXECUTION_FAILED` result with `call_id` and `duration_ms`.
         - After implementation returns and `call_id` is verified, validate the result via `parseToolResultDTO` from `@argentum/contracts`. If validation fails, return `TOOL_EXECUTION_FAILED` result with `human_summary` describing the structural validation failure (see H2 below).
         - Verify `result.call_id === call.call_id`. If they differ, construct and return a NEW `ToolResultDTO` with `call_id` forced to `call.call_id` and all other fields preserved. For MVP, emit no log or telemetry event (see H3 below).
       - `projectForProvider()`: iterate registered entries, map each to `{ name, description, input_schema }`.
       - `isRegistered()`, `getDefinition()`: read-only accessors.
    4. Export `ToolRegistry` class and `ToolImplementation` type.
  - Create `packages/tooling/src/schema-validator.ts`:
    1. Implement `validateAgainstSchema(args: Record<string, unknown>, schema: Record<string, unknown>): { valid: true } | { valid: false; errors: string[] }`.
    2. Support MVP-required keywords: `type: "object"`, `properties` (object with per-property `type` constraints), `required` (array of required property names), `additionalProperties: false` (reject unknown properties).
    3. Empty schema (`{}` or no constraints) passes all inputs.
    4. Return structured error messages with path information for each violation.
  - Update `packages/tooling/src/index.ts` to export the full registry surface.
  - Update `packages/tooling/package.json` scripts: change `"test": "vitest run --passWithNoTests"` to `"test": "vitest run"` (remove `--passWithNoTests` since this slice adds real tests).
  - Create `packages/tooling/tests/` directory if not present.
- Required tests:
  - Registration tests:
    - `register()` accepts a valid `ToolDefinition` and implementation.
    - `register()` throws on duplicate tool name with a stable error.
    - `register()` throws when passed a value that fails `parseToolDefinition` validation — validates via `parseToolDefinition` and lets `ToolDefinitionValidationError` propagate.
    - `isRegistered()` returns `true` after registration, `false` for unknown tools.
    - `getDefinition()` returns the registered definition.
  - Dispatch tests:
    - `dispatch()` routes to the correct implementation for a registered tool.
    - `dispatch()` returns `TOOL_NOT_REGISTERED` result with `status = "error"` for unregistered tool name.
    - `dispatch()` returns `SCHEMA_VALIDATION_FAILED` result when arguments fail schema validation.
    - `dispatch()` returns `TOOL_EXECUTION_FAILED` result when implementation throws.
    - `dispatch()` measures and populates `duration_ms` on the returned result.
    - `dispatch()` populates `duration_ms` on error results for all three error paths (`TOOL_NOT_REGISTERED`, `SCHEMA_VALIDATION_FAILED`, `TOOL_EXECUTION_FAILED`).
    - `dispatch()` preserves `call_id` from inbound `ToolCallDTO` on the returned `ToolResultDTO`.
    - `dispatch()` validates the `ToolResultDTO` returned by the implementation via `parseToolResultDTO`; returns `TOOL_EXECUTION_FAILED` with structural validation description if validation fails (two tests: one for missing required field, one for wrong-type field).
    - `dispatch()` patches `call_id` when implementation returns a mismatched `call_id` — constructs a NEW `ToolResultDTO` with `call_id` forced to `call.call_id` and all other fields preserved (two tests: one proving `call_id` is patched, one proving other fields are preserved).
    - `dispatch()` with empty `input_schema` (`{}`) accepts any arguments object (no constraints).
  - Schema validator tests:
    - Empty schema passes any arguments.
    - Schema with `required` rejects missing required properties.
    - Schema with `properties.type` rejects wrong-type property values.
    - Schema with `additionalProperties: false` rejects unknown properties.
    - Schema with nested `properties` validates recursively.
    - Validator returns structured error messages with property paths.
  - Projection tests:
    - `projectForProvider()` returns empty array for empty registry.
    - `projectForProvider()` returns one entry per registered tool.
    - Each entry has `name`, `description`, and `input_schema` matching the registered `ToolDefinition`.
    - Returned entries satisfy the `AvailableToolEntry` contract shape (can be validated by `parseLLMInferenceRequest` available-tools validation).
  - Package entrypoint test proving downstream imports can consume `ToolRegistry` and `ToolImplementation`.
- Narrow validation step:
  - `pnpm --filter @argentum/tooling test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: conditional. The owner, validation target, and contract dependencies are clear, and no deferred decisions need resolution. However, this is the first implementation slice for a shell package (`tooling`), requiring dependency wiring (`@argentum/contracts`), test infrastructure setup, and the `--passWithNoTests` → `vitest run` gate change. Autopilot is safe with the explicit constraint that it must NOT implement grant resolution, execution-driver spawning, or artifact persistence.
- Parallel subagent opportunities:
  - Read-only extraction of registry rules and MVP constraints from [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md).
  - Read-only extraction of `ToolDefinition` field list from [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) for registration validation strategy.
  - Read-only extraction of `AvailableToolEntry` shape from `packages/contracts/src/llm-adapter.ts` for projection fidelity.
- Out of scope:
  - Grant resolution from tool metadata plus `RuntimePolicyDTO` (owned by environment in a future slice).
  - Native execution-driver interface and subprocess spawning (future environment slice).
  - Tool result artifact storage and `ContentRef` creation (future environment slice).
  - Retry-policy handling for read-only tools (owned by tool layer per spec, but deferred to a future slice after registry is stable).
  - Provider-adapter wiring that calls `projectForProvider()` (owned by `llm_provider` in Phase 5).
  - Bedrock immutability enforcement (grant resolver responsibility).
- Deferred decisions that must remain deferred:
  - Post-MVP multi-registry or remote-registry topologies (MVP is one local in-process registry).
  - Post-MVP multiple implementations per tool (MVP is one implementation per registered tool).
  - Rich schema validation beyond the MVP `type`/`properties`/`required`/`additionalProperties` subset. The spec requires argument validation but does not mandate a full JSON Schema draft implementation for MVP.
  - Automatic tool retries (the spec limits MVP to one transient retry for read-only tools inside the tool layer; that belongs in a follow-up slice after the basic registry is stable).

## Dependency Wiring

This slice must add `@argentum/contracts` as a workspace dependency of `@argentum/tooling`:

```json
// packages/tooling/package.json
{
  "dependencies": {
    "@argentum/contracts": "workspace:*"
  }
}
```

The test script must change from `"vitest run --passWithNoTests"` to `"vitest run"` so the package gate fails if no tests are discovered.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1:** Fixed error-result `ToolResultDTO` construction — all three error paths now include `call_id` and `duration_ms`. `startMs` moved to first line of `dispatch()`. Added test for `duration_ms` on all three error paths.
  - **H2:** Added `parseToolResultDTO` validation of implementation-returned results. Structural validation failure returns `TOOL_EXECUTION_FAILED`. Added two tests.
  - **H3:** Specified precise `call_id` patching behavior — construct NEW `ToolResultDTO` with forced `call_id`, preserve all other fields, no log/telemetry for MVP. Added two tests.
  - **H4:** Export `TOOL_NOT_REGISTERED`, `SCHEMA_VALIDATION_FAILED`, `TOOL_EXECUTION_FAILED` as constants from `@argentum/tooling`. Added to outputs and tests.
  - **H5:** Added test for `register()` rejecting invalid `ToolDefinition` — validates via `parseToolDefinition` and lets `ToolDefinitionValidationError` propagate.
- Refinements applied: 2026-05-24 — H1, H2, H3, H4, H5.
- Implementation review (2026-05-24):
  - **M1 (MEDIUM):** `register()` was calling `parseToolDefinition(definition)` for validation but discarding the normalized + frozen result, storing the original (potentially mutable, non-normalized) object instead. **FIXED** — now stores `const validated = parseToolDefinition(definition)` and uses the validated copy. No test regression (44/44 pass).
  - No HIGH or CRITICAL findings. Package composes correctly with `@argentum/contracts`, all 44 tests pass (29 registry + 12 schema-validator + 3 entrypoint), typecheck and full build are clean.
- Audit 0010 remediation (2026-05-24):
  - **M1:** Added `else if` branch in `schema-validator.ts` `validateAgainstSchema`: when `required` is present but not an array, emit error `schema "required" must be an array, got <type>` and return `{ valid: false, errors }`. Previously the validator silently skipped required-property validation for malformed `required` values. Added two tests in `schema-validator.test.ts`: string case (`required: "foo"`) and number case (`required: 42`). All 14 schema-validator tests pass.
- Adversarial review remediation (2026-05-24):
  - **H1:** Fixed `dispatch()` success path to override `duration_ms` with registry-measured `Date.now() - startMs`. Updated existing test to verify override (impl returns `duration_ms: 999999`, registry overrides to `< 999999`). Added test proving registry `duration_ms` is always `>= 0` and `< 5000` regardless of impl value.
  - **M1:** Added guard in `validateAgainstSchema` rejecting non-object args when schema has constraints but no `type: "object"`. Prevents `TypeError` from `in` operator on null/primitive. Added schema-validator test passing `null` with schema having `properties` but no `type`.
  - **M2:** Added integration test `projected entries validate via parseLLMInferenceRequest` — wraps `projectForProvider()` result in `LLMInferenceRequest` stub and asserts no throw. Imported `parseLLMInferenceRequest` from `@argentum/contracts`.
  - **M3:** Changed `projectForProvider()` to shallow-clone `input_schema` via `{ ...definition.input_schema }`. Added test mutating projected entry's `input_schema` and verifying registry's stored definition is unaffected.
