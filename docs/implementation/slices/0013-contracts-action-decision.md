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
- Execution readiness: ready. Slice 0012 is implemented and validated; this contracts-only surface may proceed independently. Run contracts-first before downstream tool-call (0014) and execution-grant (0015) contracts slices.

## Scope

- Slice name: Canonical action-decision contract surface
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `ActionDecision` is the normalized result of one inference step; produced by LLM adapter, consumed by core loop
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md) — sole shape authority for decision kinds, fields, tool-call entry shape, and rules
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — shape authority for optional `provider_trace_ref` composition
  - [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md) — validation-layer context (core loop validates only canonical contracts; `ActionDecision` schema validation is layer 2)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `ActionDecision` contract types plus a single public parser entrypoint `parseActionDecision(value: unknown): ActionDecision`.
  - The contract enforces the four canonical decision kind literals: `respond`, `tool_calls`, `clarify`, `abort`. Unknown kind values are rejected with `invalid_literal`.
  - Conditional field enforcement by decision kind:
    - `message` is required (non-empty string, non-coercion) when `kind` is `respond` or `clarify`.
    - When `kind` is `abort`, `message` is optional — accepted when present as a non-empty string but not required.
    - `message` must not be present when `kind` is `tool_calls`.
    - `tool_calls` is required (non-empty array) when `kind` is `tool_calls`.
    - `tool_calls` must not be present when `kind` is `respond`, `clarify`, or `abort`.
  - `decision_id` is a required non-empty string with `typeof === "string"` non-coercion (rejects numbers, booleans, arrays, objects).
  - `decision_summary`, when provided, must be a non-empty string and must not be coerced from other primitive shapes.
  - Each `tool_calls` entry enforces:
    - `tool_name`: required non-empty string, non-coercion.
    - `arguments`: required plain object (`typeof === "object" && value !== null && !Array.isArray(value)`). Empty objects (`{}`) are accepted per spec — a parameterless tool call is valid. Null, arrays, and primitives are rejected with `invalid_type`.
    - `provider_call_ref`: optional non-empty string, non-coercion.
    - Unknown keys rejected per entry.
  - Optional `provider_trace_ref` composes canonical `ContentRef` via `parseContentRefAtPath` with path-prefixed issue collection — same pattern as `TurnEnvelope.context_refs` and `ContextItem.content_ref`. Non-canonical references are rejected with full field-path fidelity.
  - The slice remains contract-only and does not implement state transitions, tool execution, repair-loop orchestration, or event emission.
- Inputs crossing the boundary:
  - Normalized decision-shaped values produced by future provider normalization seams (LLM adapter → core loop boundary).
  - Optional provider trace references intended for canonical `ContentRef` composition.
- Outputs crossing the boundary:
  - Canonical `ActionDecision` type export in `@argentum/contracts`.
  - Public `parseActionDecision(value: unknown): ActionDecision` entrypoint.
  - `ActionDecisionValidationCode`, `ActionDecisionValidationIssue`, and `ActionDecisionValidationError` surface for deterministic core-loop boundary checks.

## Plan

- First contracts or interfaces to create:
  - `ActionDecision` interface with `readonly` fields matching the spec field table.
  - `DecisionKind` literal union: `"respond" | "tool_calls" | "clarify" | "abort"`.
  - `ToolCallEntry` interface for `tool_calls` array members.
  - `ActionDecisionValidationCode` literal union (extending `ContentRefValidationCode` with action-decision-specific codes: `invalid_literal`, `invalid_type`, `invalid_value`, `missing_required`, `unknown_key`, `unexpected_field`, `empty_array`).
  - `ActionDecisionValidationIssue` interface with `path`, `code`, `message`.
  - `ActionDecisionValidationError` class extending `Error` with `issues` array.
  - `parseActionDecision(value: unknown): ActionDecision` — public entrypoint.
  - Internal `parseActionDecisionAtPath(value, path, addIssue): ActionDecision | undefined` — reused for nested validation.
  - Public contracts index exports for the full action-decision surface.
- Minimal implementation steps:
  - Add `packages/contracts/src/action-decision.ts` following the established `context-item.ts` pattern:
    1. Define `DecisionKind` literal union and `ToolCallEntry` interface.
    2. Define `ActionDecision` interface with all spec fields.
    3. Define validation code, issue, and error types.
    4. Implement `parseActionDecision(value)` public entrypoint (delegates to internal `parseActionDecisionAtPath`).
    5. Implement `parseActionDecisionAtPath` with:
       - `expectRecord` guard.
       - `pushUnknownKeys` with the known-field set.
       - Validate `kind` first (required literal).
       - Branch conditional validation on `kind` value.
       - Validate `decision_id` (required non-empty string, non-coercion).
       - Validate `message` by kind: required for `respond`/`clarify` (`parseRequiredString`), optional for `abort` (`parseOptionalString`), forbidden for `tool_calls` (reject with `unexpected_field`).
       - Validate `tool_calls` presence/absence by kind.
       - For `tool_calls` array: validate each entry with `parseToolCallEntryAtPath`.
       - Validate optional `decision_summary` (non-empty string, non-coercion).
       - Validate optional `provider_trace_ref` via `parseContentRefAtPath`.
       - Build and return frozen `ActionDecision` object.
    6. Implement `parseToolCallEntryAtPath` for per-entry `tool_name`, `arguments`, `provider_call_ref`, and unknown-key rejection.
  - Reuse `parseContentRefAtPath` from `content-ref.ts` for optional `provider_trace_ref` — do not throw/catch/re-wrap.
  - Reuse shared helpers (`isPlainObject`, `joinPath`, `parseStringValue`, `pushUnknownKeys`) if they are extractable; otherwise inline as the `ContextItem` module did. **Specifically use the `ContextItem`-style `parseStringValue`** that rejects empty strings with `invalid_value` — not the `ContentRef`-style variant that accepts empty strings. The acceptance criteria requires non-empty enforcement on `decision_id`, `message`, and `decision_summary`.
  - Export the new surface through `packages/contracts/src/index.ts` only.
- Required tests:
  - Valid decision tests across all four decision kinds (`respond`, `tool_calls`, `clarify`, `abort`) with all required fields present and valid.
  - Valid decision tests with optional fields (`decision_summary`, `provider_trace_ref`, per-entry `provider_call_ref`).
  - Valid `tool_calls` decision with single and multiple tool call entries.
  - Conditional field enforcement tests:
    - `message` missing on `respond`/`clarify` → `missing_required`.
    - `message` absent on `abort` → decision accepted as valid (no issue).
    - `message` present as valid non-empty string on `abort` → decision accepted with `message` populated.
    - `message` present on `tool_calls` → `unexpected_field`.
    - `message` is empty string `""` on `respond`/`clarify`/`abort` → `invalid_value` at path `message`.
    - `tool_calls` missing on `tool_calls` kind → `missing_required`.
    - `tool_calls` present on `respond`/`clarify`/`abort` → `unexpected_field`.
    - `tool_calls` empty array on `tool_calls` kind → `empty_array`.
  - Non-coercion tests for `decision_id` (number, boolean, array, object, empty string).
  - Non-coercion tests for `decision_summary` (number, boolean, array, object, empty string).
  - Invalid `kind` literal test (unknown string → `invalid_literal`, wrong type → `invalid_type`).
  - Invalid tool call entry tests:
    - `tool_calls` contains a non-object item (string, number, null, array) → `invalid_type` at indexed path.
    - `tool_name` missing, wrong type, empty string.
    - `arguments` missing, null, array, wrong primitive type → rejected.
    - `arguments` is empty object `{}` → accepted (parameterless tool call is valid per spec).
    - `provider_call_ref` wrong type, empty string when present.
    - Unknown keys on tool call entry.
  - Nested `provider_trace_ref` composition test (canonical `ContentRef` accepted; non-canonical `ContentRef` rejected with path-prefixed issues).
  - Unknown keys on top-level `ActionDecision` object.
  - Missing all required fields (bulk `missing_required`).
  - Wrong top-level type (non-object input → `invalid_type`).
  - Package entrypoint test proving downstream imports can consume the action-decision surface and that `ActionDecisionValidationError` is catchable.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe. The owner (`contracts`) and validation target are clear. The slice is a narrow contracts-only surface following an established implementation pattern (`ContextItem`). No runtime dependencies. No gateway or provider coupling.
- Parallel subagent opportunities:
  - Read-only extraction of decision-kind semantics and field table from [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md).
  - Read-only extraction of validation-layer ordering from [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md).
- Out of scope:
  - Provider adapter repair behavior and provider-native normalization.
  - Core-loop state transitions (`building_context`, `awaiting_tool_result`, etc.).
  - Tool-call execution, `ToolCallDTO` creation, or `idempotency_key` derivation (owned by slice 0014).
  - Grant resolution or `ExecutionGrantDTO` embedding (owned by slice 0015).
  - Event emission (`StreamEvent`).
  - `decision_summary` content-level rule enforcement (hidden chain-of-thought prohibition is not structurally enforceable at the contract layer).
- Deferred decisions that must remain deferred:
  - Any post-MVP parallel execution hints or decision-shape extensions (deferred in spec).

## Review Log

- Adversarial review findings:
  - Initial planning noted risk of embedding transition logic into contracts.
  - Follow-up planning kept the slice field-level and parser-level only.
  - 2026-05-23 adversarial review found one HIGH (H1: `abort` message requirement over-constrained spec's "most abort outcomes"), two MEDIUM (M1: `arguments` non-empty stricter than spec; M2: missing empty-message tests), and three LOW (L1: `parseStringValue` ambiguity; L2: incomplete `decision_summary` non-coercion tests; L3: missing non-object tool_calls item test).
- Refinements applied (pre-tightening):
  - Kept one owning boundary (`contracts`) and deferred all runtime behavior.
- Tightening refinements (2026-05-23):
  - Removed stale "look-ahead only" sequencing blocker — slice 0012 is now implemented and validated.
  - Committed to concrete function signatures: `parseActionDecision(value): ActionDecision` with internal `parseActionDecisionAtPath`, matching the `ContextItem` pattern.
  - Specified exact conditional-field rules: `message` required for `respond`/`clarify`/`abort`, forbidden for `tool_calls`; `tool_calls` required for `tool_calls` kind with non-empty enforcement, forbidden for all other kinds.
  - Added per-entry tool-call validation specificity: `arguments` must be a non-null, non-array plain object with at least one own key; unknown keys rejected per entry.
  - Added `empty_array` validation code for zero-length `tool_calls` on `tool_calls` decisions.
  - Added `unexpected_field` validation code for conditional-field violations (field present on wrong kind).
  - Explicitly named `parseContentRefAtPath` reuse pattern with precedent references (`TurnEnvelope.context_refs`, `ContextItem.content_ref`).
  - Expanded test requirements to exact categories matching the `ContextItem` test density: non-coercion per field, conditional presence/absence, nested composition, bulk-missing, invalid literals, wrong types, entrypoint smoke.
  - Noted `decision_summary` chain-of-thought prohibition as a content-level rule not structurally enforceable at the contract layer.
- Adversarial-review refinements (2026-05-23):
  - H1: Changed `abort` message from required to optional (spec says "most abort outcomes" — not all). Added positive test for abort-without-message and abort-with-valid-message. Updated implementation plan to use `parseOptionalString` for abort.
  - M1: Removed `arguments` non-empty constraint — empty object `{}` is now accepted. A parameterless tool call is valid per spec.
  - M2: Added explicit empty-string `message` rejection tests for `respond`/`clarify`/`abort` → `invalid_value` at path `message`.
  - L1: Clarified implementation plan to use the `ContextItem`-style `parseStringValue` (with empty-string rejection) explicitly, not the `ContentRef`-style variant.
  - L2: Added array and object to `decision_summary` non-coercion test coverage.
  - L3: Added explicit non-object item test for `tool_calls` array.
- Post-validation adversarial-review refinements (2026-05-24):
  - H1 (deep-freeze): Changed `parseArgumentsField` to return `Object.freeze(value)` instead of raw `value as Record<string, unknown>`. Added test `returns deeply frozen tool_calls entries` asserting `Object.isFrozen` on `tool_calls` array, each entry, and each entry's `arguments` sub-object.
  - H2 (isPlainObject): Replaced inline `typeof !== "object" || null || Array.isArray` check in `parseArgumentsField` with `!isPlainObject(value)`, closing the class-instance bypass (Date, Map, Set, etc.). Added tests `rejects tool call entry where arguments is a class instance (Date)` and `rejects tool call entry where arguments is a Map instance`.
