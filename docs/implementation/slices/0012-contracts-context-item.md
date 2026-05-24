# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: adversarial review
- Approval date: 2026-05-23
- Implementation date: 2026-05-23
- Validation date: 2026-05-23
- Phase: 3
- Owner: contracts
- Execution readiness: ready. Slice 0011 is validated; this slice may proceed independently as a contracts-only surface. Run contracts-first before downstream action-decision and tooling contracts slices.

## Scope

- Slice name: Canonical context-item contract surface
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md)
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md)
  - Context-shape authority remains in the contracts specs above; the following module docs are contextual usage constraints only:
  - [docs/spec/40-modules/agentic-layer/context-selection.md](../../spec/40-modules/agentic-layer/context-selection.md)
  - [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `ContextItem` types plus parser or validator entrypoints for one item and ordered item arrays.
  - The contract enforces required fields (`context_id`, `layer`, `role`, `content_ref`, `origin`, `retention`) and rejects unknown keys.
  - `layer` accepts only the canonical literals `bedrock`, `environment`, `episodic`, `tool_summary`, and `system`.
  - `retention` accepts only the canonical literals `sticky`, `rolling`, and `ephemeral`.
  - `context_id`, `role`, and `origin` must each be a non-empty string and must not be coerced from numbers, booleans, arrays, or objects.
  - `version`, when provided, must be a non-empty string and must not be coerced from other primitive shapes.
  - `token_estimate`, when provided, must satisfy `Number.isInteger()` and must not be coerced from strings, floats, `NaN`, or `Infinity`.
  - `content_ref` composes the canonical `ContentRef` parser or validator and rejects non-canonical reference shapes.
  - The slice remains contract-only and does not implement context selection, ranking, compaction policy, token budgeting heuristics, or provider message formatting.
- Inputs crossing the boundary:
  - Context-item-shaped values produced by future context selection and episodic-memory seams.
  - Nested content-reference-shaped values intended for canonical `ContentRef` composition.
- Outputs crossing the boundary:
  - Canonical `ContextItem` contract exports and parser or validator surfaces in `@argentum/contracts`.
  - Validation issue surfaces for downstream deterministic boundary tests.

## Plan

- First contracts or interfaces to create:
  - `ContextItem` type export.
  - Literal unions for context layer and retention vocabularies.
  - Parser or validator issue type reuse wiring needed for deterministic boundary errors.
  - Parser or validator entrypoint for one context item and for ordered context-item arrays.
  - Public contracts index exports for the new context-item surface.
- Minimal implementation steps:
  - Add a context-item contract module under `packages/contracts`.
  - Reuse canonical `ContentRef` parsing for `content_ref` via `parseContentRefAtPath` with path-prefixed issue collection (same pattern used by `TurnEnvelope.context_refs`), not throw/catch/re-wrap, so validation issues preserve full field-path fidelity.
  - Enforce required fields and unknown-key rejection with deterministic validation issues.
  - Export the new surface through `packages/contracts/src/index.ts` only.
- Required tests:
  - Contract validation tests for valid `ContextItem` values across all canonical layer and retention literals.
  - Contract validation tests for nested `content_ref` composition through the public `ContentRef` validator.
  - Contract validation tests proving `context_id`, `role`, and `origin` each reject non-string primitive types and empty strings.
  - Contract validation tests proving `version` is accepted when present as a non-empty string and rejected when presented with the wrong primitive type or an empty string.
  - Contract validation tests proving `token_estimate` accepts integers via `Number.isInteger()` semantics and rejects strings, floats, `NaN`, and `Infinity`.
  - Contract validation tests for missing required fields, invalid literals, wrong primitive types, and unknown keys.
  - Boundary tests proving ordered context-item arrays preserve order and do not reorder caller input.
  - Package entrypoint test proving downstream imports can consume the new context-item surface.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: conditional. The owner and validation target are clear; run with a contracts-only patch scope plus the exact validation gate listed above. No upstream gateway dependency blocks this contracts-only surface.
- Parallel subagent opportunities:
  - Read-only extraction of required context fields from [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md).
  - Read-only extraction of composition rules from [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md).
- Out of scope:
  - Context ranking policies.
  - Prompt assembly and provider request formatting.
  - Episodic-memory commit behavior.
  - Any core-loop transition logic.
- Deferred decisions that must remain deferred:
  - Post-MVP role-taxonomy expansion beyond the canonical MVP surface.

## Review Log

- Adversarial review findings:
  - Initial planning used broad acceptance wording that could allow implementation drift into selection or compaction policy logic.
  - Follow-up review found approval should be held until literal-level constraints and non-coercion behavior are explicit.
  - Current review found one remaining approval gap: optional `version` handling was not explicitly accepted or tested, and the authoritative-source wording needed to keep contracts specs clearly normative.
  - Final approval review found asymmetric validation specificity between `version`/`token_estimate` (explicit non-coercion and dedicated tests) and `role`/`origin`/`context_id` (implicit only). Required symmetric type-guard acceptance criteria for all required string fields and explicit `Number.isInteger()` semantics for `token_estimate`.
  - Final approval review found the sequencing dependency on slice 0011 was stale (0011 is now validated), and the `ContentRef` composition pattern needed an explicit precedent note to avoid throw/catch/re-wrap path-fidelity loss.
- Refinements applied:
  - Tightened acceptance criteria to literal-level `layer` and `retention` vocabularies plus explicit `token_estimate` non-coercion.
  - Tightened tests to prove order preservation without implying policy behavior.
  - Added explicit optional `version` acceptance and negative typing coverage.
  - Clarified that agentic-layer docs are contextual constraints, not shape-defining authorities for this contracts slice.
  - Added symmetric non-coercion acceptance criteria and dedicated tests for `context_id`, `role`, and `origin`.
  - Added `Number.isInteger()` semantics and `NaN`/`Infinity` rejection for `token_estimate`.
  - Added `ContentRef` composition precedent referencing the `TurnEnvelope.context_refs` pattern for path-fidelity preservation.
  - Removed stale slice-0011 sequencing blocker; 0011 is validated and this contracts-only surface may proceed independently.
  - Card approved.

## Implementation Log

- Created `packages/contracts/src/context-item.ts` — canonical `ContextItem` contract module with `ContextLayer` and `ContextRetention` literal unions, `ContextItem` interface, `ContextItemValidationCode`/`ContextItemValidationIssue`/`ContextItemValidationError`, `parseContextItem(value)` for single-item validation, and `parseContextItemArray(value)` for ordered array validation preserving caller input order.
- `content_ref` composition reuses `parseContentRefAtPath` with full field-path fidelity, following the same pattern as `TurnEnvelope.context_refs`. No throw/catch/re-wrap.
- All required string fields (`context_id`, `role`, `origin`) enforce `typeof === "string"` and non-empty via `parseStringValue` — numbers, booleans, arrays, and objects all rejected with `invalid_type`.
- `token_estimate` uses two-gate validation: `typeof !== "number"` → `invalid_type`, then `!Number.isInteger(value)` → `invalid_integer`. This rejects strings, floats, `NaN`, and `Infinity`. Negative integers pass `Number.isInteger()` per spec (non-negativity not required by acceptance criteria).
- Unknown keys rejected via `pushUnknownKeys`. All six required fields enforced via `parseRequiredString`/`parseRequiredLiteral`/`parseRequiredContentRef`.
- Updated `packages/contracts/src/index.ts` with type and value exports: `ContextItem`, `ContextItemValidationCode`, `ContextItemValidationIssue`, `ContextLayer`, `ContextRetention`, `ContextItemValidationError`, `parseContextItem`, `parseContextItemArray`.
- Created `packages/contracts/tests/context-item.test.ts` — 55 tests covering all acceptance criteria plus edge cases (empty array, all-invalid items, negative token_estimate acceptance, immutability).
- Updated `packages/contracts/tests/package-entrypoint.test.ts` with ContextItem import resolution and validation-error export tests.
- Post-implementation adversarial review (2026-05-23) found no spec drift, no boundary violations. Minor refinements applied: removed unused `parseContentRef` import, moved `import type { ContextItem }` to top of test file, added empty-array and all-invalid-items array tests, added negative `token_estimate` acceptance test. Remaining notes: duplicated validation helpers across contracts files (pre-existing pattern, future refactor candidate), `ContextItemValidationCode` redundantly redeclares literals from `ContentRefValidationCode` (harmless, consistent with `TurnEnvelopeValidationCode` pattern).
- Adversarial review follow-up (2026-05-24) found two HIGH findings in test validation quality:
  - **H1**: `expectContextItemIssues` and `expectContextItemArrayIssues` used `expect.arrayContaining(expect.objectContaining(...))` subset matching, allowing tests to pass when the implementation produced extra issues. Replaced with exact `{path, code}` tuple matching via `issues.map(...).toEqual(expected)`.
  - **H2**: `version` field non-coercion tests covered only number and boolean but not array and object, violating symmetric coverage required by acceptance criteria. Added `"rejects version when it is an array"` and `"rejects version when it is an object"` tests.
  - Fixing H1 also surfaced a latent defect: the "rejects an array where every item is invalid" test was missing `unknown_key` issues for both items and all `missing_required` issues for `[1]`. Corrected the expected-issue list to the full 14-issue set actually produced.
  - All 411 contracts tests pass; `pnpm typecheck` passes cleanly.
