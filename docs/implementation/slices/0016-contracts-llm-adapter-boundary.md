# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: planning synthesis
- Approval date: 2026-05-23
- Tightening date: 2026-05-23
- Implementation date: 2026-05-23
- Validation date: 2026-05-24
- Phase: 3
- Owner: contracts
- Execution readiness: ready-after-dependency. Slice 0013 (`ActionDecision`) must be implemented first so this slice can compose `parseActionDecisionAtPath` for `LLMInferenceResult.decision`. Slice 0012 (`ContextItem`) is already implemented and provides `parseContextItemArray` for `LLMInferenceRequest.context_items`. Slices 0014 (`ToolCallDTO`) and 0015 (`ExecutionGrantDTO`) are NOT dependencies of this slice — the LLM adapter boundary does not consume tool-call or grant contracts.

## Scope

- Slice name: Canonical LLM adapter request and result contract surfaces
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `LLMInferenceRequest`/`LLMInferenceResult` are the provider-neutral boundary between core loop and LLM provider module
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md) — sole shape authority for both contract types, field tables, and rules
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md) — shape authority for ordered `context_items` array members
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md) — shape authority for `LLMInferenceResult.decision`
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — shape authority for optional `raw_trace_ref`
  - [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md) — provider-module responsibilities (contextual, not shape-defining)
  - [docs/spec/40-modules/llm-provider/provider-normalization.md](../../spec/40-modules/llm-provider/provider-normalization.md) — normalization strategy context (contextual, not shape-defining)
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — canonical tool schema fields; used to derive the minimal `AvailableToolEntry` shape for inference requests
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `LLMInferenceRequest` and `LLMInferenceResult` types plus two public parser entrypoints: `parseLLMInferenceRequest(value: unknown): LLMInferenceRequest` and `parseLLMInferenceResult(value: unknown): LLMInferenceResult`.
  - `LLMInferenceRequest` field enforcement:
    - `request_id`: required non-empty string, `typeof === "string"` non-coercion (rejects numbers, booleans, arrays, objects, empty string).
    - `turn_id`: required non-empty string, non-coercion.
    - `context_items`: required array; each element validated as canonical `ContextItem` via the existing `parseContextItemArray` export. Non-array inputs rejected with `invalid_type`.
    - `available_tools`: required array; each element must be an `AvailableToolEntry` with `name` (required non-empty string, non-coercion), `description` (required non-empty string, non-coercion), and `input_schema` (required plain object, `typeof === "object" && value !== null && !Array.isArray(value)`). Unknown keys rejected per entry. Non-array inputs rejected with `invalid_type`.
    - `inference_policy`: required plain object. No subfield validation beyond the object-type guard and unknown-key rejection — exact `inference_policy` subfields are deferred to the DeepSeek adapter MVP per spec. Unknown keys on the policy object are **not** rejected (the envelope is provider-neutral; subfields are deferred).
    - Unknown keys rejected at top level.
  - `LLMInferenceResult` field enforcement:
    - `request_id`: required non-empty string, non-coercion.
    - `decision`: required plain object; delegates to `parseActionDecisionAtPath` from slice 0013 for deep structural validation.
    - `normalization_status`: required canonical literal `"native_tool" | "json_mode" | "parsed_text"`. Unknown values rejected with `invalid_literal`. Wrong types rejected with `invalid_type`.
    - `usage`: optional object. No subfield validation (provider-specific). Non-object values rejected with `invalid_type`.
    - `raw_trace_ref`: optional; when present, must be a canonical `ContentRef` validated via `parseContentRefAtPath` from the existing `content-ref.ts` module. Non-object values rejected with `invalid_type`.
    - Unknown keys rejected at top level.
  - The slice remains contract-only and does not implement provider API translation, normalization retry behavior, provider event emission, or prompt compilation policy.
- Inputs crossing the boundary:
  - Inference-request-shaped values produced by future prompt-compiler seams (core loop → LLM adapter).
  - Inference-result-shaped values produced by future provider adapter seams (LLM adapter → core loop).
  - Optional content-reference-shaped raw trace references.
- Outputs crossing the boundary:
  - Canonical `LLMInferenceRequest` and `LLMInferenceResult` type exports in `@argentum/contracts`.
  - Public `parseLLMInferenceRequest(value: unknown): LLMInferenceRequest` entrypoint.
  - Public `parseLLMInferenceResult(value: unknown): LLMInferenceResult` entrypoint.
  - `LLMRequestValidationCode`, `LLMRequestValidationIssue`, `LLMRequestValidationError` surface for deterministic provider-boundary tests.
  - `LLMResultValidationCode`, `LLMResultValidationIssue`, `LLMResultValidationError` surface for deterministic provider-boundary tests.

## Plan

- First contracts or interfaces to create:
  - `LLMInferenceRequest` interface with `readonly` fields matching the spec field table (all 5 fields required).
  - `LLMInferenceResult` interface with `readonly` fields matching the spec field table (`request_id`, `decision`, `normalization_status` required; `usage`, `raw_trace_ref` optional).
  - `AvailableToolEntry` interface for `available_tools` array members with `readonly name`, `description`, `input_schema`.
  - `NormalizationStatus` literal union: `"native_tool" | "json_mode" | "parsed_text"`.
  - `LLMRequestValidationCode` literal union (extending `ContextItemValidationCode` with llm-request-specific codes: `invalid_literal`, `invalid_type`, `missing_required`, `unknown_key`).
  - `LLMRequestValidationIssue` interface with `path`, `code`, `message`.
  - `LLMRequestValidationError` class extending `Error` with `issues` array.
  - `LLMResultValidationCode` literal union (extending `ContentRefValidationCode` and `ActionDecisionValidationCode` with llm-result-specific codes: `invalid_literal`, `invalid_type`, `missing_required`, `unknown_key`).
  - `LLMResultValidationIssue` interface with `path`, `code`, `message`.
  - `LLMResultValidationError` class extending `Error` with `issues` array.
  - `parseLLMInferenceRequest(value: unknown): LLMInferenceRequest` — public entrypoint.
  - `parseLLMInferenceResult(value: unknown): LLMInferenceResult` — public entrypoint.
  - Internal `parseLLMInferenceRequestAtPath(value, path, addIssue): LLMInferenceRequest | undefined` — reused for nested validation.
  - Internal `parseLLMInferenceResultAtPath(value, path, addIssue): LLMInferenceResult | undefined` — reused for nested validation.
  - Internal `parseAvailableToolEntryAtPath(value, path, addIssue): AvailableToolEntry | undefined` — per-entry validation for `available_tools`.
  - Public contracts index exports for the full LLM adapter boundary surfaces.
- Minimal implementation steps:
  - Add `packages/contracts/src/llm-adapter.ts` following the established `context-item.ts` pattern:
    1. Define `NormalizationStatus` literal union and `AvailableToolEntry` interface.
    2. Define `LLMInferenceRequest` and `LLMInferenceResult` interfaces.
    3. Define `LLMRequestValidationCode`, `LLMRequestValidationIssue`, `LLMRequestValidationError`.
    4. Define `LLMResultValidationCode`, `LLMResultValidationIssue`, `LLMResultValidationError`.
    5. Implement `parseLLMInferenceRequest(value)` public entrypoint (delegates to internal `parseLLMInferenceRequestAtPath`).
    6. Implement `parseLLMInferenceRequestAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set (`request_id`, `turn_id`, `context_items`, `available_tools`, `inference_policy`).
       - Validate `request_id` (required non-empty string, non-coercion).
       - Validate `turn_id` (required non-empty string, non-coercion).
       - Validate `context_items` (required array; delegate to existing `parseContextItemArray` from `context-item.ts` — see Dependency Note below for path-prefix strategy).
       - Validate `available_tools` (required array; validate each entry via `parseAvailableToolEntryAtPath` with indexed path `[0]`, `[1]`, etc.).
       - Validate `inference_policy` (required plain object; no subfield validation, no unknown-key rejection — deferred per spec).
       - Build and return frozen `LLMInferenceRequest` object.
    7. Implement `parseLLMInferenceResult(value)` public entrypoint (delegates to internal `parseLLMInferenceResultAtPath`).
    8. Implement `parseLLMInferenceResultAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set (`request_id`, `decision`, `normalization_status`, `usage`, `raw_trace_ref`).
       - Validate `request_id` (required non-empty string, non-coercion).
       - Validate `decision` (required plain object; delegate to `parseActionDecisionAtPath` from slice 0013's `action-decision.ts`).
       - Validate `normalization_status` (required literal union).
       - Validate `usage` (optional; if present must be a plain object, no subfield validation — provider-specific).
       - Validate `raw_trace_ref` (optional; when present validated via `parseContentRefAtPath` from `content-ref.ts`).
       - Build and return frozen `LLMInferenceResult` object.
    9. Implement `parseAvailableToolEntryAtPath` for per-entry `name`, `description`, `input_schema`, and unknown-key rejection.
  - Import `parseContextItemArray` from `context-item.ts` for `request.context_items` — catch `ContextItemValidationError` and re-emit issues with `context_items.` path prefix.
  - Import `parseContentRefAtPath` from `content-ref.ts` (already exported) for optional `raw_trace_ref` — do not throw/catch/re-wrap.
  - Import `parseActionDecisionAtPath` from the 0013 `action-decision.ts` module for `result.decision` — this requires 0013 to export an `AtPath` variant. If 0013 only exports `parseActionDecision`, 0016 will call it inside a try/catch and re-emit caught `ActionDecisionValidationError.issues` with a `decision.` path prefix.
  - Reuse shared helpers (`expectRecord`, `joinPath`, `pushUnknownKeys`, `parseRequiredString`, `parseOptionalString`, `parseRequiredLiteral`, `isPlainObject`) following the established `ContentRef`/`ContextItem` pattern. Extract shared helpers to `packages/contracts/src/validation-helpers.ts` if not already done by a prior slice.
  - Export the new surface through `packages/contracts/src/index.ts` only.
- Required tests:
  - Valid `LLMInferenceRequest` tests:
    - Full valid request with all required fields, non-empty `context_items` array (valid canonical `ContextItem` entries), and non-empty `available_tools` array (valid `AvailableToolEntry` entries).
    - Valid request with single context item and single available tool.
    - Valid request with `inference_policy` as empty object `{}` (no subfield validation per deferred decision).
    - Valid request with `inference_policy` containing arbitrary keys (no unknown-key rejection on policy — deferred).
  - Valid `LLMInferenceResult` tests:
    - Full valid result with canonical `ActionDecision` (kind `respond`), `normalization_status = "native_tool"`.
    - Valid result with `normalization_status = "json_mode"` and `normalization_status = "parsed_text"`.
    - Valid result with optional `usage` object present.
    - Valid result with optional `raw_trace_ref` (canonical `ContentRef`).
    - Valid result with both `usage` and `raw_trace_ref` absent.
  - Non-coercion tests for `LLMInferenceRequest`:
    - `request_id`: number, boolean, array, object, empty string → `invalid_type`.
    - `turn_id`: number, boolean, array, object, empty string → `invalid_type`.
    - `context_items`: non-array (object, string, number, null) → `invalid_type`.
    - `available_tools`: non-array (object, string, number, null) → `invalid_type`.
    - `inference_policy`: null, array, string, number → `invalid_type`.
  - Non-coercion tests for `LLMInferenceResult`:
    - `request_id`: number, boolean, array, object, empty string → `invalid_type`.
    - `decision`: null, array, string, number → `invalid_type`.
    - `normalization_status`: unknown string → `invalid_literal`; number, boolean → `invalid_type`.
    - `usage`: string, number, array, null → `invalid_type`.
    - `raw_trace_ref`: string, number, array → `invalid_type`.
  - Required-field missing tests (one test per required field, each producing `missing_required`):
    - `LLMInferenceRequest`: missing `request_id`, `turn_id`, `context_items`, `available_tools`, `inference_policy`.
    - `LLMInferenceResult`: missing `request_id`, `decision`, `normalization_status`.
    - Bulk missing all fields on each type → multiple `missing_required` issues.
  - Available-tool entry validation tests:
    - Valid entry with `name`, `description`, `input_schema` all present and valid.
    - Missing `name` → `missing_required` at indexed path.
    - Missing `description` → `missing_required` at indexed path.
    - Missing `input_schema` → `missing_required` at indexed path.
    - `name`: number, boolean, empty string, array, object → `invalid_type` at indexed path.
    - `description`: number, boolean, empty string → `invalid_type` at indexed path.
    - `input_schema`: null, array, string, number → `invalid_type` at indexed path.
    - Unknown keys on `AvailableToolEntry` → `unknown_key` at indexed path.
  - Composition tests:
    - `context_items` containing non-canonical `ContextItem` → `ContextItemValidationError` caught and re-emitted with `context_items.` prefix.
    - `decision` containing non-canonical `ActionDecision` → `ActionDecisionValidationError` caught and re-emitted with `decision.` prefix (or validated directly via `parseActionDecisionAtPath` if 0013 exports it).
    - `raw_trace_ref` containing non-canonical `ContentRef` → path-prefixed rejection via `parseContentRefAtPath`.
  - Unknown keys tests:
    - Unknown key on `LLMInferenceRequest` → `unknown_key`.
    - Unknown key on `LLMInferenceResult` → `unknown_key`.
    - Unknown key on `AvailableToolEntry` → `unknown_key` at indexed path.
  - Wrong top-level type tests:
    - Non-object input for `LLMInferenceRequest` (string, number, array, null) → `invalid_type`.
    - Non-object input for `LLMInferenceResult` (string, number, array, null) → `invalid_type`.
  - Package entrypoint test proving downstream imports can consume both types, both parsers, and both `ValidationError` classes.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe-after-dependency. Once slice 0013 is implemented and validated, this slice has a clear owner (`contracts`), a focused validation target, and follows the established `ContextItem`/`ContentRef` parser pattern. The only dependency gate is the availability of `parseActionDecisionAtPath` from 0013 (or a try/catch fallback).
- Parallel subagent opportunities:
  - This slice is independent of slices 0014 (`ToolCallDTO`) and 0015 (`ExecutionGrantDTO`). It can be implemented in parallel with 0014 once 0013 completes.
  - Read-only extraction of `LLMInferenceRequest` and `LLMInferenceResult` field constraints from [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md).
  - Read-only extraction of normalization-status semantics from [docs/spec/40-modules/llm-provider/provider-normalization.md](../../spec/40-modules/llm-provider/provider-normalization.md).
- Out of scope:
  - Provider API clients and DeepSeek adapter implementation.
  - Adapter normalization algorithms and provider-specific structured-output strategies.
  - Provider failure-handling and `llm.failed` event emission.
  - Prompt compilation and context-item selection policy.
  - Provider-native tool schema generation from the tool registry (owned by `llm_provider` package).
  - `usage` field sub-structure (provider-specific, no canonical shape in MVP).
- Deferred decisions that must remain deferred:
  - Exact `inference_policy` subfields beyond the canonical provider-neutral envelope (deferred to DeepSeek adapter MVP per spec).

## Dependency Note

This slice depends on:
- **Slice 0012** (`ContextItem`): already implemented. Uses `parseContextItemArray` for `request.context_items`. Because `parseContextItemAtPath` is not exported from `context-item.ts`, the implementation catches `ContextItemValidationError` from `parseContextItemArray` and re-emits issues with a `context_items.` path prefix. If a future refinement exports `parseContextItemAtPath`, the try/catch wrapper can be replaced with a direct composed call.
- **Slice 0013** (`ActionDecision`): must be implemented first. Uses `parseActionDecisionAtPath` for `result.decision`. If 0013 only exports `parseActionDecision`, the implementation catches `ActionDecisionValidationError` and re-emits issues with a `decision.` path prefix.

Slices 0014 (`ToolCallDTO`) and 0015 (`ExecutionGrantDTO`) are NOT dependencies of this slice.

## Review Log

- Adversarial review findings:
  - Initial planning noted risk of prematurely freezing provider-policy subfields.
  - Follow-up planning kept the policy shape provider-neutral and deferred exact subfields per spec.
- Refinements applied (pre-tightening):
  - Kept one owning boundary (`contracts`) and deferred all provider runtime behavior.
- Tightening refinements (2026-05-23):
  - Promoted execution readiness from "look-ahead only" to "ready-after-dependency" — only depends on slice 0013, not 0014 or 0015.
  - Committed to concrete function signatures: `parseLLMInferenceRequest(value): LLMInferenceRequest` and `parseLLMInferenceResult(value): LLMInferenceResult` with internal `parseXAtPath` variants, matching the `ContextItem`/`ContentRef` pattern.
  - Named separate validation code, issue, and error types per DTO (`LLMRequestValidationCode`/`Issue`/`Error`, `LLMResultValidationCode`/`Issue`/`Error`).
  - Defined `AvailableToolEntry` interface with `name`, `description`, `input_schema` fields, derived from the tool-schema-model spec's canonical fields.
  - Specified exact field-by-field acceptance criteria with non-coercion rules for every field on both types.
- Implementation review (2026-05-24):
  - Verdict: **APPROVE** — no CRITICAL, HIGH, or MEDIUM findings.
  - Implementation exists in `packages/contracts/src/llm-adapter.ts` with all types, parsers, validators, and error classes.
  - Tests: 99 tests in `packages/contracts/tests/llm-adapter.test.ts`, all passing.
  - TypeScript: `tsc -b` passes clean.
  - Exports: All 14 symbols exported through `packages/contracts/src/index.ts` only; no cross-package boundary violations.
  - Field enforcement: All non-coercion, missing-required, unknown-key, invalid-literal, and invalid-type rules verified per acceptance criteria.
  - `inference_policy` correctly deferred (required plain object, no subfield validation, no unknown-key rejection).
  - Delegation strategy: `parseContextItemArray` catch/re-emit with `context_items.` prefix; `parseActionDecision` catch/re-emit with `decision.` prefix; `parseContentRefAtPath` direct composition with `raw_trace_ref.` prefix.
  - `AvailableToolEntry` uses minimal fields (`name`, `description`, `input_schema`) as derived from tool-schema-model spec.
  - `LLMRequestValidationCode = ContextItemValidationCode` and `LLMResultValidationCode = ActionDecisionValidationCode` — functionally correct (both transitive unions already include all required codes).
  - Package entrypoint test imports both parsers, both error classes, and key types.
  - No provider runtime behavior — slice remains contract-only.
  - LOW observation: `parseRawTraceRefField` has a redundant plain-object guard before `parseContentRefAtPath` (harmless).
  - LOW observation: `LLMResultValidationCode` could explicitly union `ContentRefValidationCode | ActionDecisionValidationCode` for documentation clarity, though semantically identical.
  - Deferred: `inference_policy` subfields (DeepSeek adapter MVP), `parseActionDecisionAtPath` export (future refinement).
  - Clarified `inference_policy` treatment: required plain object, no subfield validation, no unknown-key rejection (deferred per spec).
  - Clarified `usage` treatment: optional plain object, no subfield validation (provider-specific).
  - Named `parseContextItemArray` reuse with try/catch path-prefix fallback (since `parseContextItemAtPath` is not exported).
  - Named `parseContentRefAtPath` reuse for optional `raw_trace_ref`.
  - Named `parseActionDecisionAtPath` composition dependency on 0013 with try/catch fallback.
  - Expanded test requirements to the same density as 0013/0015: per-field non-coercion, per-field missing, nested composition with path-prefix fidelity, all three normalization-status literals, entrypoint smoke.
  - Documented which slices are NOT dependencies (0014, 0015) and which are (0012 implemented, 0013 must-precede).
- Audit 0010 remediation (2026-05-24):
  - **H3:** Replaced ALL subset-matching issue assertions (`expect.arrayContaining([expect.objectContaining({...})])`) in `llm-adapter.test.ts` with exact `{path, code}` tuple matching via new `expectRequestIssues`/`expectResultIssues` helper functions. This catches both extra AND missing issues, matching the pattern established in `context-item.test.ts`. All 99 tests pass.
