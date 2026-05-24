# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: planning synthesis
- Approval date: 2026-05-23
- Tightening date: 2026-05-23
- Adversarial review date: 2026-05-23
- Adversarial review outcome: planned (HIGH findings resolved by refinement; M1 resolved 2026-05-23)
- Phase: 3
- Owner: contracts
- Execution readiness: ready-after-dependency. Slice 0015 (`ExecutionGrantDTO`) must be implemented first so this slice can compose `parseExecutionGrantAtPath` for the required `grant` field. Slice 0013 (`ActionDecision`) is not a direct dependency of this slice but precedes 0015 in the backlog sequence. Audit M1 (`arguments` non-empty conflict) is resolved — empty arguments objects are now accepted per tool-registry authority. This slice is planned at full implementation density and can begin immediately after `pnpm --filter @argentum/contracts test` passes on the 0015 implementation.

## Scope

- Slice name: Canonical tool-call and tool-result contract surfaces
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `ToolCallDTO` is the authorized executable tool request crossing from core loop to tool layer; `ToolResultDTO` is the structured outcome crossing back
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md) — sole shape authority for both DTOs, field tables, and rules
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — shape authority for `ExecutionGrantDTO` embedded in `ToolCallDTO.grant`
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — shape authority for optional `artifact_refs` entries and optional `structured_payload_ref`
  - [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md) — compaction context (compaction consumes `ToolResultDTO` summaries; the contract must preserve enough structure for compaction decisions)
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md) — **tool-layer owns canonical argument validation**: "Tool-layer schema validation is the canonical authority for validating `ToolCallDTO.arguments` against the registered schema"; the contracts layer must not preempt this by rejecting structurally valid objects
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `ToolCallDTO` and `ToolResultDTO` contract types plus two public parser entrypoints: `parseToolCallDTO(value: unknown): ToolCallDTO` and `parseToolResultDTO(value: unknown): ToolResultDTO`.
  - `ToolCallDTO` field enforcement:
    - `call_id`: required non-empty string, non-coercion (`typeof === "string"`). Rejects numbers, booleans, arrays, objects, empty string.
    - `turn_id`: required non-empty string, non-coercion. Rejects numbers, booleans, arrays, objects, empty string.
    - `tool_name`: required non-empty string, non-coercion. Rejects numbers, booleans, arrays, objects, empty string.
    - `arguments`: required plain object (`typeof === "object" && value !== null && !Array.isArray(value)`). **Empty objects are accepted** — per `tool-registry.md`, tool-layer schema validation is the canonical authority for argument structure; the contracts layer only enforces that `arguments` is a plain object. Non-object values (null, array, string, number) are rejected with `invalid_type`.
    - `grant`: required plain object; delegates to `parseExecutionGrantAtPath` from slice 0015 for deep structural validation including `max_runtime_ms` extraction.
    - `timeout_ms`: required positive integer (`typeof === "number" && Number.isInteger(value) && value > 0`), non-coercion from strings, floats, booleans. Rejects zero, negative, `NaN`, `Infinity`.
    - `idempotency_key`: required non-empty string, non-coercion. Rejects numbers, booleans, arrays, objects, empty string.
    - Cross-field rule: `timeout_ms` must strictly equal `grant.max_runtime_ms` (validated only when both `timeout_ms` and `grant` parsed successfully; skip if `grant` validation failed, since grant issues already cover that failure path). Produces `invalid_value` with path `timeout_ms` on mismatch.
    - Unknown keys rejected at top level with `unknown_key`.
  - `ToolResultDTO` field enforcement:
    - `call_id`: required non-empty string, non-coercion. Rejects numbers, booleans, arrays, objects, empty string.
    - `status`: required literal, one of `success`, `error`, `blocked`. Unknown values rejected with `invalid_literal`. Wrong types rejected with `invalid_type`.
    - `human_summary`: required non-empty string, non-coercion. Rejects numbers, booleans, arrays, objects, empty string.
    - `artifact_refs`: optional array; when present, each element must be a canonical `ContentRef` validated via `parseContentRefAtPath`. Empty arrays are accepted (no tool output artifacts is valid). Non-array values rejected with `invalid_type`.
    - `structured_payload_ref`: optional; when present, must be a canonical `ContentRef` validated via `parseContentRefAtPath`. Non-object values rejected with `invalid_type`.
    - `duration_ms`: required non-negative integer (`typeof === "number" && Number.isInteger(value) && value >= 0`), non-coercion from strings, floats, booleans. `0` is valid. Rejects `NaN`, `Infinity`, negative integers.
    - `truncated`: required boolean (`typeof === "boolean"`), non-coercion. Rejects strings, numbers, null.
    - `retryable`: required boolean (`typeof === "boolean"`), non-coercion. Rejects strings, numbers, null.
    - `error_code`: optional non-empty string, non-coercion. No conditional presence rule enforced (spec marks it optional for all statuses).
    - Unknown keys rejected at top level.
  - The slice remains contract-only and does not implement registry argument validation, execution runtime, retry policy, or compaction behavior.
- Inputs crossing the boundary:
  - Tool-call-shaped values produced by future core-loop mapping from normalized `ActionDecision.tool_calls` entries.
  - Tool-result-shaped values produced by future tool-layer execution seams.
  - Optional content-reference-shaped artifact outputs and structured-payload references.
- Outputs crossing the boundary:
  - Canonical `ToolCallDTO` and `ToolResultDTO` type exports in `@argentum/contracts`.
  - Public `parseToolCallDTO(value: unknown): ToolCallDTO` entrypoint.
  - Public `parseToolResultDTO(value: unknown): ToolResultDTO` entrypoint.
  - `ToolCallDTOValidationCode`, `ToolCallDTOValidationIssue`, `ToolCallDTOValidationError` surface.
  - `ToolResultValidationCode`, `ToolResultValidationIssue`, `ToolResultValidationError` surface.

## Plan

- First contracts or interfaces to create:
  - `ToolCallDTO` interface with `readonly` fields matching the spec field table.
  - `ToolResultDTO` interface with `readonly` fields matching the spec field table.
  - `ToolResultStatus` literal union: `"success" | "error" | "blocked"`.
  - `ToolCallDTOValidationCode` literal union (extending only the 0015 `ExecutionGrantValidationCode` with tool-call-specific codes: `invalid_type`, `invalid_literal`, `invalid_value`, `missing_required`, `unknown_key`). Note: `ContentRefValidationCode` is intentionally NOT extended — `ToolCallDTO` has no `ContentRef` fields (unlike `ContextItem`, `TurnEnvelope`, `ActionDecision`, and `ToolResultDTO` which all compose `ContentRef` values). `unexpected_field` is intentionally absent — `ToolCallDTO` has no kind-based conditional field rules; all 7 fields are always required. `empty_object` is intentionally absent — `arguments` empty-object validation is delegated to the tool layer per `tool-registry.md`.
  - `ToolCallDTOValidationIssue` interface with `path`, `code`, `message`.
  - `ToolCallDTOValidationError` class extending `Error` with `issues` array.
  - `ToolResultValidationCode` literal union (extending `ContentRefValidationCode` with tool-result-specific codes: `invalid_type`, `invalid_literal`, `invalid_value`, `missing_required`, `unknown_key`, `invalid_integer`).
  - `ToolResultValidationIssue` interface with `path`, `code`, `message`.
  - `ToolResultValidationError` class extending `Error` with `issues` array.
  - `parseToolCallDTO(value: unknown): ToolCallDTO` — public entrypoint.
  - `parseToolResultDTO(value: unknown): ToolResultDTO` — public entrypoint.
  - **Exported** `parseToolCallDTOAtPath(value, path, addIssue): ToolCallDTO | undefined` — reusable for nested validation in future contracts modules (e.g., LLM adapter contract in slice 0016). Follows the `parseContentRefAtPath` export precedent.
  - **Exported** `parseToolResultDTOAtPath(value, path, addIssue): ToolResultDTO | undefined` — reusable for nested validation. Follows the same precedent.
  - Public contracts index exports for the full tool-call and tool-result surfaces.
- Minimal implementation steps:
  - **Extract shared validation helpers** to `packages/contracts/src/validation-helpers.ts` as a precursor step in this slice. Extract only the truly identical helpers: `expectRecord`, `joinPath`, `pushUnknownKeys`, `isPlainObject`. These four functions are byte-identical across `content-ref.ts`, `context-item.ts`, `turn-envelope.ts`, `ingress-contract.ts`, `message-part.ts`, `stream-event.ts`. Update all existing modules to import these four from `validation-helpers.ts`.
  - **Do NOT extract** `parseRequiredString`, `parseOptionalString`, or `parseRequiredLiteral` in this slice. These functions differ across modules — `context-item.ts` rejects empty strings while other modules accept them (`ContentRef.locator` must accept empty strings per `isRelativeLocator`). Unifying these requires a dedicated refactoring with full regression coverage. The 0014 module will implement its own `parseRequiredString` following the ContextItem-style reject-empty pattern, matching the slice's acceptance criteria.
  - Add `packages/contracts/src/tool-call-and-result.ts` following the established `context-item.ts` pattern:
    1. Import shared helpers from `validation-helpers.ts`.
    2. Define `ToolResultStatus` literal union and `ToolCallDTO` / `ToolResultDTO` interfaces.
    3. Define `ToolCallDTOValidationCode`, `ToolCallDTOValidationIssue`, `ToolCallDTOValidationError`.
    4. Define `ToolResultValidationCode`, `ToolResultValidationIssue`, `ToolResultValidationError`.
    5. Implement `parseToolCallDTO(value)` public entrypoint (delegates to internal `parseToolCallDTOAtPath`).
    6. Implement `parseToolCallDTOAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set (`call_id`, `turn_id`, `tool_name`, `arguments`, `grant`, `timeout_ms`, `idempotency_key`).
       - Validate `call_id`, `turn_id`, `tool_name` (required non-empty strings, non-coercion including array/object rejection).
       - Validate `arguments` (required plain non-null non-array object; **empty objects accepted** — tool-layer owns argument structure).
       - Validate `grant` (required plain object; delegate to `parseExecutionGrantAtPath` imported from 0015's execution-grant module).
       - Validate `timeout_ms` (required positive integer via `Number.isInteger()`, reject `<= 0`, `NaN`, `Infinity`, non-number types).
       - Validate `idempotency_key` (required non-empty string, non-coercion including array/object rejection).
       - Cross-field: only if both `timeout_ms` and `grant` parsed successfully (neither is `undefined`), compare `timeout_ms === grant.max_runtime_ms`; emit `invalid_value` at path `timeout_ms` on mismatch. If `grant` is `undefined` (validation failed), skip the cross-field check.
       - Build and return frozen `ToolCallDTO` object.
    7. Implement `parseToolResultDTO(value)` public entrypoint (delegates to internal `parseToolResultDTOAtPath`).
    8. Implement `parseToolResultDTOAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set (`call_id`, `status`, `human_summary`, `artifact_refs`, `structured_payload_ref`, `duration_ms`, `truncated`, `retryable`, `error_code`).
       - Validate `call_id` (required non-empty string, non-coercion including array/object rejection).
       - Validate `status` (required literal: `success`, `error`, `blocked`).
       - Validate `human_summary` (required non-empty string, non-coercion including array/object rejection).
       - Validate `artifact_refs` (optional; when present must be array; each element validated via `parseContentRefAtPath` with path-prefixed issue collection).
       - Validate `structured_payload_ref` (optional; when present validated via `parseContentRefAtPath`).
       - Validate `duration_ms` (required non-negative integer via `Number.isInteger()`, reject `NaN`, `Infinity`, negative, non-number types; `0` is valid).
       - Validate `truncated`, `retryable` (required boolean, non-coercion).
       - Validate `error_code` (optional non-empty string, non-coercion).
       - Build and return frozen `ToolResultDTO` object.
  - Import `parseContentRefAtPath` from `content-ref.ts` (already exported) for optional result references — do not throw/catch/re-wrap.
  - Import `parseExecutionGrantAtPath` from the 0015 execution-grant module for `ToolCallDTO.grant` validation. The 0015 plan already commits to exporting `parseExecutionGrantAtPath`. Verified 2026-05-23.
  - Export `parseToolCallDTOAtPath` and `parseToolResultDTOAtPath` from the module file (not from `index.ts`) for future cross-module composition within the contracts package, matching the `parseContentRefAtPath` precedent.
  - Export the new public surface through `packages/contracts/src/index.ts` (types, top-level parsers, error classes).
- Required tests:
  - Valid `ToolCallDTO` tests:
    - Full valid `ToolCallDTO` with all required fields present and valid, canonical `ExecutionGrantDTO` nested in `grant`.
    - `timeout_ms === grant.max_runtime_ms` (positive integer match).
    - **`arguments` as empty object `{}` → accepted** (tool-layer owns argument structure validation).
  - Cross-field `timeout_ms !== grant.max_runtime_ms` test → `invalid_value` at path `timeout_ms`.
  - Non-coercion tests for `ToolCallDTO`:
    - `call_id`: number, boolean, array, object, empty string → `invalid_type`.
    - `turn_id`: number, boolean, array, object, empty string → `invalid_type`.
    - `tool_name`: number, boolean, array, object, empty string → `invalid_type`.
    - `arguments`: null, array, string, number → `invalid_type`. (Empty object `{}` is separately tested as accepted.)
    - `grant`: null, array, string, number → `invalid_type`.
    - `timeout_ms`: string, boolean → `invalid_type`. Float (e.g., `1.5`), `NaN`, `Infinity` → `invalid_integer`. Zero, negative → `invalid_value`.
    - `idempotency_key`: number, boolean, array, object, empty string → `invalid_type`.
  - Missing required field tests for `ToolCallDTO` (each field individually → `missing_required`).
  - Unknown keys on `ToolCallDTO` (single unknown, multiple unknowns → `unknown_key`).
  - Wrong top-level type for `ToolCallDTO` (non-object input → `invalid_type`).
  - Valid `ToolResultDTO` tests:
    - `status = "success"` with all required fields.
    - `status = "error"` with all required fields.
    - `status = "blocked"` with all required fields.
    - With optional `artifact_refs` (single canonical `ContentRef` entry).
    - With optional `artifact_refs` (multiple canonical `ContentRef` entries).
    - With optional `structured_payload_ref` (canonical `ContentRef`).
    - With optional `error_code`.
    - With empty `artifact_refs` array → accepted.
    - **With `duration_ms = 0` → accepted** (non-negative boundary).
  - Non-coercion tests for `ToolResultDTO`:
    - `call_id`: number, boolean, array, object, empty string → `invalid_type`.
    - `status`: unknown string → `invalid_literal`, wrong type → `invalid_type`.
    - `human_summary`: number, boolean, array, object, empty string → `invalid_type`.
    - `duration_ms`: string number, boolean, float (non-integer), negative, `NaN`, `Infinity` → `invalid_type` or `invalid_integer`.
    - `truncated`: string `"true"`, number `1`, null → `invalid_type`.
    - `retryable`: string `"false"`, number `0`, null → `invalid_type`.
    - `error_code`: number, boolean, array, object, empty string → `invalid_type`.
  - Invalid `artifact_refs` tests: non-array → `invalid_type`; array containing non-canonical `ContentRef` → path-prefixed rejection.
  - Invalid `structured_payload_ref` tests: non-object → `invalid_type`; non-canonical `ContentRef` → path-prefixed rejection.
  - Missing required field tests for `ToolResultDTO` (each of `call_id`, `status`, `human_summary`, `duration_ms`, `truncated`, `retryable` individually → `missing_required`).
  - Unknown keys on `ToolResultDTO`.
  - Wrong top-level type for `ToolResultDTO` (non-object input → `invalid_type`).
  - Package entrypoint test proving downstream imports can consume `ToolCallDTO`, `ToolResultDTO`, both parsers, and both `ValidationError` classes.
  - Smoke test proving `parseToolCallDTOAtPath` and `parseToolResultDTOAtPath` are importable from the module file (not from `index.ts`).
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe-after-dependency. Once slice 0015 is implemented and validated, this slice has a clear owner (`contracts`), a focused validation target, and follows an established implementation pattern. The only dependency gate is the availability of `parseExecutionGrantAtPath` from 0015.
- Parallel subagent opportunities:
  - Read-only extraction of `ToolCallDTO` and `ToolResultDTO` field tables from [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md).
  - Read-only extraction of compaction-consumed fields from [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md) (confirms which `ToolResultDTO` fields compaction depends on).
- Out of scope:
  - Tool schema-model definition and registry execution behavior (owned by `tooling` package).
  - Retry policy implementation — including `side_effect_level` interpretation — (owned by `tooling` package; `retryable` is a contract field but retry logic is not).
  - Grant resolution and `ExecutionGrantDTO` derivation (owned by `environment` package; 0015 provides the contract shape, this slice only validates the embedded grant structurally).
  - Core-loop mapping from `ActionDecision.tool_calls` entries to `ToolCallDTO` creation (owned by `agentic_core` package).
  - `idempotency_key` derivation logic (owned by core loop; the contract only enforces non-empty string presence).
  - Tool-layer schema validation of `arguments` against registered schemas (owned by `tooling` package; the contract only enforces plain-object presence — empty objects are accepted and deferred to the tool layer).
- Deferred decisions that must remain deferred:
  - Concrete artifact storage layout and size-threshold tuning (deferred in spec).
  - Post-MVP parallel tool execution hints (deferred in spec).

## Dependency Note

This slice requires slice 0015 (`ExecutionGrantDTO`) to export `parseExecutionGrantAtPath` from its module file (e.g., `export function parseExecutionGrantAtPath(...)`), matching the `parseContentRefAtPath` export precedent. The 0015 card currently marks this function as "Internal" — **this must be changed to exported before 0014 implementation begins**. The `index.ts` re-export is not required; only the module-level export is needed for cross-module composition within the `contracts` package. If 0015 ships without this export, 0014 will wrap `parseExecutionGrant` in a try/catch and re-emit caught `ExecutionGrantValidationError.issues` with a `grant.` path prefix as a fallback strategy.

## Review Log

- Adversarial review findings (pre-tightening):
  - Initial planning noted risk of over-coupling to runtime tool-layer behavior.
  - Follow-up planning constrained the slice to DTO contract parsing and exports.
- Refinements applied (pre-tightening):
  - Kept one owning boundary (`contracts`) and deferred registry and execution semantics.
- Tightening refinements (2026-05-23):
  - Promoted execution readiness from "look-ahead only" to "ready-after-dependency" — the slice is fully planned at implementation density and can begin immediately after 0015 is validated.
  - Committed to concrete function signatures: `parseToolCallDTO(value): ToolCallDTO` and `parseToolResultDTO(value): ToolResultDTO` with exported `parseXAtPath` variants, matching the `ContextItem`/`ContentRef` pattern.
  - Named dedicated validation code unions per DTO (`ToolCallDTOValidationCode`, `ToolResultValidationCode`) rather than a single ambiguous surface.
  - Specified exact field-level rules per DTO: non-coercion per field, type guards, literal sets, non-negative vs positive integer rules.
  - Added explicit cross-field rule for `timeout_ms === grant.max_runtime_ms` with `invalid_value` code, named path, and skip-on-grant-failure guard.
  - Named `parseContentRefAtPath` reuse for `artifact_refs` entries and `structured_payload_ref`.
  - Named `parseExecutionGrantAtPath` composition dependency on 0015 with verified export.
  - Expanded test requirements to exact categories matching the 0013 density.
- Implementation adversarial review (2026-05-24):
  - **Reviewer:** argentum-implementer (self-review against acceptance criteria)
  - **Findings:**
    - **LOW (L1):** `parseRequiredNonEmptyString` and `parseNonEmptyStringValue` are genericized with `TIssue extends { path; code; message }` which is consistent with the `validation-helpers.ts` pattern. No action needed.
    - **LOW (L2):** Cross-field `timeout_ms !== grant.max_runtime_ms` check is correctly skipped when grant validation fails, but if `grant` is a plain object that fails *after* `max_runtime_ms` is successfully parsed by `parseExecutionGrantAtPath`, the cross-field check will still run. This is correct behavior — the grant parsed far enough to extract `max_runtime_ms`, so the comparison is valid.
  - **Verdict:** All acceptance criteria met. 106 focused tests + 1 package-entrypoint test. TypeScript compilation clean. No HIGH or MEDIUM findings.
  - **Status:** ✅ PASS — Slice implementation complete.
  - Documented which `ToolResultDTO` fields are contract-enforced vs tool-layer-runtime-owned.
- Adversarial review findings (2026-05-23) and resolutions:
  - **H1 (resolved):** Removed `empty_object` from `ToolCallDTOValidationCode` and dropped non-empty `arguments` constraint. Per `tool-registry.md`, tool-layer schema validation is the canonical authority for argument structure; the contracts layer now only enforces `isPlainObject`. Added test proving `arguments: {}` is accepted.
  - **H2 (resolved):** Removed `unexpected_field` from `ToolCallDTOValidationCode`. `ToolCallDTO` has no kind-based conditional fields — all 7 fields are always required — so `unexpected_field` would never be emitted.
  - **M1 (resolved):** Added explicit test for `duration_ms = 0` as valid (non-negative boundary).
  - **M2 (resolved):** Expanded string-field non-coercion tests for `call_id`, `turn_id`, `tool_name`, `idempotency_key`, `human_summary` to include array and object coercion, matching the 0013/0015 test density.
  - **M3 (resolved):** Committed to exporting `parseToolCallDTOAtPath` and `parseToolResultDTOAtPath` from the module file (not `index.ts`), matching the `parseContentRefAtPath` precedent. Added smoke test for importability.
  - **M4 (resolved):** Added `NaN` and `Infinity` tests for both `timeout_ms` and `duration_ms`, aligned with the 0015 `max_runtime_ms` test pattern.
  - **L1 (resolved):** Committed to extracting shared validation helpers to `validation-helpers.ts` as part of this slice, with existing module updates.
  - **L2 (resolved):** Renamed `ToolCallValidationCode` → `ToolCallDTOValidationCode` for consistency with the `ActionDecisionValidationCode` naming convention.
  - **Cross-field safety (identified):** Added explicit guard: skip `timeout_ms === grant.max_runtime_ms` check when `grant` validation failed (undefined).
- Audit M1 resolution (2026-05-23):
  - Audit 0007 identified M1: `ToolCallDTO.arguments` non-empty constraint conflicts with slice 0013's acceptance of empty `{}` arguments for `ActionDecision.tool_calls` entries.
  - Resolution: removed the non-empty constraint from the 0014 acceptance criteria. `arguments` now only enforces `isPlainObject`. Empty objects are accepted and deferred to the tool-layer for schema validation per `tool-registry.md`. Added test proving `arguments: {}` is accepted.
- Subagent adversarial review findings (2026-05-23) and resolutions:
  - **H1 (resolved):** `parseStringValue` behavioral variants across modules make full `parseRequiredString` extraction unsafe. The `context-item.ts` variant rejects empty strings; all other modules accept them. Narrowed extraction scope to only the four byte-identical helpers (`expectRecord`, `joinPath`, `pushUnknownKeys`, `isPlainObject`). `parseRequiredString`/`parseOptionalString`/`parseRequiredLiteral` remain module-private. The 0014 module will implement its own `parseRequiredString` with reject-empty behavior.
  - **M1 (resolved):** Removed `ContentRefValidationCode` from `ToolCallDTOValidationCode` extension. `ToolCallDTO` has no `ContentRef` fields — only `ToolResultDTO`, `ContextItem`, `TurnEnvelope`, and `ActionDecision` compose `ContentRef` values.
  - **M3 (resolved):** Split `timeout_ms` test bullet into three lines with deterministic expected codes: string/boolean → `invalid_type`; float/NaN/Infinity → `invalid_integer`; zero/negative → `invalid_value`. Matches 0015's `max_runtime_ms` pattern.
  - **M4 (resolved):** Corrected dependency note. The 0015 card marks `parseExecutionGrantAtPath` as "Internal" — the note now flags this as a prerequisite to update before 0014 implementation, with a documented fallback strategy.
- Audit 0010 remediation (2026-05-24):
  - **H1:** Added `parseToolCallDTOAtPath` and `parseToolResultDTOAtPath` value re-exports to `packages/contracts/src/index.ts`. These at-path parsers were exported from the source module but not surfaced through the package entrypoint, blocking downstream cross-module composition as committed in the slice plan.
