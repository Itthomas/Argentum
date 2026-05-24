# Implementation Audit — Deep Audit of Slices 0012–0019

## Metadata

- **Audit scope**: Slices 0012 through 0019 — all contracts and tooling-registry slices from Phase 3
- **Auditor**: GitHub Copilot (argentum-implementation-auditor)
- **Audit date**: 2026-05-24
- **Audit type**: Deep comprehensive — source-level comparison of implementation vs spec, validation rigor analysis, planning-artifact freshness check, and deferred-decision leakage scan
- **Repo readiness verdict**: `ready-with-risks`

**Note**: This audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

---

## Sources Reviewed

### Governing spec files (all treated as authoritative)

- [docs/spec/README.md](../../spec/README.md) — entrypoint authority
- [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
- [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md)
- [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md)
- [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md)
- [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md)
- [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md)
- [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md)
- [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md)
- [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md)
- [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
- [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md)

### Implementation files (all read in full)

- `packages/contracts/src/validation-helpers.ts`
- `packages/contracts/src/context-item.ts`
- `packages/contracts/src/action-decision.ts`
- `packages/contracts/src/tool-call-and-result.ts`
- `packages/contracts/src/execution-grant.ts`
- `packages/contracts/src/llm-adapter.ts`
- `packages/contracts/src/tool-definition.ts`
- `packages/contracts/src/runtime-policy.ts`
- `packages/contracts/src/index.ts`
- `packages/tooling/src/registry.ts`
- `packages/tooling/src/schema-validator.ts`
- `packages/tooling/src/index.ts`

### Test files (all reviewed for validation quality)

- `packages/contracts/tests/context-item.test.ts`
- `packages/contracts/tests/action-decision.test.ts`
- `packages/contracts/tests/tool-call-and-result.test.ts`
- `packages/contracts/tests/execution-grant.test.ts`
- `packages/contracts/tests/llm-adapter.test.ts`
- `packages/contracts/tests/tool-definition.test.ts`
- `packages/contracts/tests/runtime-policy.test.ts`
- `packages/contracts/tests/package-entrypoint.test.ts`
- `packages/tooling/tests/registry.test.ts`
- `packages/tooling/tests/schema-validator.test.ts`
- `packages/tooling/tests/package-entrypoint.test.ts`

### Slice cards

- [0012-contracts-context-item.md](../slices/0012-contracts-context-item.md)
- [0013-contracts-action-decision.md](../slices/0013-contracts-action-decision.md)
- [0014-contracts-tool-call-and-result.md](../slices/0014-contracts-tool-call-and-result.md)
- [0015-contracts-execution-grant.md](../slices/0015-contracts-execution-grant.md)
- [0016-contracts-llm-adapter-boundary.md](../slices/0016-contracts-llm-adapter-boundary.md)
- [0017-contracts-tool-definition.md](../slices/0017-contracts-tool-definition.md)
- [0018-contracts-runtime-policy-parser.md](../slices/0018-contracts-runtime-policy-parser.md)
- [0019-tooling-registry-implementation.md](../slices/0019-tooling-registry-implementation.md)

### Workflow artifacts

- [docs/implementation/backlog.md](../backlog.md)
- [docs/implementation/audits/0009-slices-0012-0019-pipeline-state.md](./0009-slices-0012-0019-pipeline-state.md)

---

## Findings By Severity

### HIGH

- **H1 — At-path parser exports not surfaced through `@argentum/contracts` package entrypoint**

  Six at-path parser functions are exported from their source modules but NOT re-exported from `packages/contracts/src/index.ts`:

  | Function | Source Module | Exported from module? | Re-exported from index.ts? |
  |---|---|---|---|
  | `parseExecutionGrantAtPath` | `execution-grant.ts` | ✅ Yes | ❌ No |
  | `parseToolCallDTOAtPath` | `tool-call-and-result.ts` | ✅ Yes | ❌ No |
  | `parseToolResultDTOAtPath` | `tool-call-and-result.ts` | ✅ Yes | ❌ No |
  | `parseToolDefinitionAtPath` | `tool-definition.ts` | ✅ Yes | ❌ No |
  | `parseRuntimePolicyDTOAtPath` | `runtime-policy.ts` | ✅ Yes | ❌ No |
  | `parseWorkspaceRootsAtPath` | `runtime-policy.ts` | ✅ Yes | ❌ No |

  **Impact**: Slice plans 0017 and 0018 explicitly commit to exporting at-path parsers "for downstream composition" and "for cross-module composition." The slice 0014 plan says `parseToolCallDTOAtPath` and `parseToolResultDTOAtPath` should be reusable "for nested validation in future contracts modules." External packages like `@argentum/tooling` and `@argentum/environment` cannot import these functions from `@argentum/contracts`. Internal cross-module composition within the contracts package works (direct file imports), but the public API surface is incomplete.

  **Precedent note**: `parseContentRefAtPath` is also NOT re-exported from `index.ts`, so there is an existing pattern of keeping at-path parsers module-internal. However, slice 0014 and 0017/0018 plans explicitly commit to public export for downstream composition, creating a gap between planning promises and implementation reality.

  **Mitigation**: The actual downstream packages in this audit scope (`@argentum/tooling`) do not need at-path parsers — they use the top-level parsers (`parseToolDefinition`, `parseToolResultDTO`). Future packages may need them for nested validation. Decide whether to (a) re-export at-path parsers from `index.ts` or (b) update slice plans to reflect that at-path parsers are internal composition helpers only.

- **H2 — Backlog entries for slices 0017–0019 are stale**

  The `docs/implementation/backlog.md` Slice Queue lists slices 0017, 0018, and 0019 as:
  ```
  - Validated current slice: [docs/implementation/slices/0017-contracts-tool-definition.md]
  - Validated current slice: [docs/implementation/slices/0018-contracts-runtime-policy-parser.md]
  - Validated current slice: [docs/implementation/slices/0019-tooling-registry-implementation.md]
  ```

  These entries were updated at some point (the actual listing shows "Validated current slice" — the audit 0009 H1 complaint about them being "Planned slice" appears partially resolved). However, the Pipeline State section still reads:

  > - Implementation cursor: slice 0019 (last validated)
  > - Planned slices ahead: 0 (pipeline depleted — needs refill)

  And the Next Actions section still reads:

  > 4. Implement slices 0017 and 0018 (contracts-only, parallel-safe). Both are autopilot-safe with focused validation gates.
  > 5. Implement slice 0019 (tool registry — first `@argentum/tooling` implementation slice) after 0017 completes.

  Items 4 and 5 are completed but not struck through or updated. Item 7 ("Run repo audit to assess readiness for Phase 3 implementation") is still listed as pending. The Next Actions section needs a refresh to reflect current state and plan for slices 0020+.

- **H3 — `llm-adapter.test.ts` uses subset-matching issue assertions without length enforcement**

  The test helper `getRequestIssues` and `getResultIssues` return issue arrays, and individual tests use:

  ```typescript
  expect(issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "request_id", code: "invalid_type" }),
    ]),
  );
  ```

  This pattern does NOT assert `issues.length` or use exact tuple matching. If the implementation produces extra issues alongside the expected one (e.g., a regression adds spurious `unknown_key` issues), the test would still pass. This is the exact same weakness identified as **H1 in the 0012 slice adversarial review** (2026-05-24), which was fixed in `context-item.test.ts` by switching to `issues.map(...).toEqual(expected)` exact-matching.

  **Affected tests**: All ~20+ rejection tests in `llm-adapter.test.ts` for both `LLMInferenceRequest` and `LLMInferenceResult`.

  **Contrast**: `context-item.test.ts`, `action-decision.test.ts`, `execution-grant.test.ts`, and `tool-call-and-result.test.ts` all use exact `{path, code}` tuple matching. `tool-definition.test.ts` and `runtime-policy.test.ts` use the safer `toHaveLength(expected.length)` + `arrayContaining(objectContaining(...))` pattern that at least catches extra issues. Only `llm-adapter.test.ts` uses the raw subset match without length enforcement.

### MEDIUM

- **M1 — Schema validator silently ignores malformed `required` field**

  In `packages/tooling/src/schema-validator.ts`, the `validateAgainstSchema` function:

  ```typescript
  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const prop of required) { ... }
  }
  ```

  When `required` is present but NOT an array (e.g., `{ required: "query" }` — a string, or `{ required: 42 }` — a number), the validator silently skips required-property validation. No error is emitted about the malformed schema. This means a tool author could register a schema with `required` as a string and the required fields would never be enforced — a silent security gap.

  **Mitigation**: `ToolDefinition` contract validation ensures `input_schema` is a plain object but does not validate subfields. The registry's `register()` calls `parseToolDefinition` which accepts `input_schema` as any plain object (including `{}`). A structurally valid `ToolDefinition` can carry a semantically broken `input_schema`. The schema validator should emit an error when `required` is present but not an array, rather than silently skipping.

- **M2 — `RuntimePolicyDTO` mutable interface forces `as` cast from frozen parser output**

  `RuntimePolicyDTO` in `packages/contracts/src/runtime-policy.ts` declares:

  ```typescript
  export interface RuntimePolicyDTO {
    enabled_tools: string[];          // mutable — should be readonly string[]
    enabled_secret_handles: string[];  // mutable — should be readonly string[]
    ...
  }
  ```

  The parser returns `Object.freeze({...}) as RuntimePolicyDTO`, forcing a type assertion because the frozen readonly arrays are not assignable to the mutable interface. This is inconsistent with every other contracts interface (`ToolDefinition`, `ExecutionGrantDTO`, `ContextItem`, `ActionDecision`, etc.) which all use `readonly` for array/object fields.

  **Risk**: Consumers could technically mutate the frozen arrays at the type level (TypeScript won't flag it), resulting in runtime `TypeError` from frozen objects. The interface is a pre-existing type from before the parser was added; updating it to `readonly string[]` would be backward-compatible.

- **M3 — No adversarial review entries for slices 0017–0019**

  Slices 0012–0016 all underwent formal adversarial review with documented findings (H1, H2, M1, M2, L1-L3). Their slice cards have detailed Review Log sections. Slices 0017–0019 were implemented under agent directives without a formal adversarial review pass:

  - Slice 0017: Review Log covers planning-level adversarial review only (C1, H1, H2, M1). No implementation-level adversarial review recorded.
  - Slice 0018: Review Log covers planning-level adversarial review only (H1, H2, M1-M4). No implementation-level adversarial review recorded.
  - Slice 0019: No Review Log section exists at all. The card ends mid-sentence with "## Dependency Wiring" (appears truncated).

  This is a process consistency gap. The implementation quality appears sound, but the governance trail is incomplete. The 0019 slice card truncation is particularly concerning — it suggests the card was never finalized.

- **M4 — Truncated slice card 0019**

  The file `docs/implementation/slices/0019-tooling-registry-implementation.md` ends with:

  ```
  ## Dependency Wiring
  ```

  There is no content after this heading. The card was likely being edited when the implementation was approved and the trailing section was never completed. This is a planning-artifact integrity issue.

- **M5 — `ActionDecision` spec says message is required for "most abort outcomes"; implementation makes it optional for all abort outcomes**

  The spec (`docs/spec/20-contracts/action-decision.md`) states:

  > `message`: Required for `respond`, `clarify`, and **most** `abort` outcomes

  The implementation (`action-decision.ts` `validateMessageByKind`) treats `message` as fully optional for `abort` — accepted when present, not required when absent. This matches the spec's "most abort outcomes" phrasing (implying not all abort outcomes require a message), but the spec leaves open which abort outcomes DO require a message. The implementation errs on the permissive side. This is not a defect per se — it follows the spec's implication — but it's a spec-ambiguity area where a future core-loop validator might need to enforce stricter rules.

- **M6 — `expectPolicyIssues` and `expectToolDefinitionIssues` use `objectContaining` subset matching on individual issues**

  Both helpers assert `toHaveLength(expected.length)` (which catches extra issues) but match individual issues with `expect.objectContaining({path, code})`, which means an issue with extra fields beyond `path` and `code` still passes. This is a mild testing concern — it could hide an implementation adding unexpected fields to issue objects. The `context-item.test.ts` pattern of `issues.map(({path, code}) => ({path, code})).toEqual(expected)` is stricter.

### LOW

- **L1 — `defaults: undefined` behavior in slice 0017 not documented in acceptance criteria**

  The implementation includes a test "accepts defaults explicitly set to undefined" which verifies that `{..., defaults: undefined}` produces a valid `ToolDefinition` with `defaults` being `undefined`. This is correct behavior (the field is optional, and explicit `undefined` means absent), but the slice card acceptance criteria only mention "Absence is valid" — the explicit-undefined case is an implementation detail not documented.

- **L2 — Latent integration gap: `deriveRuntimePolicy` not wired to parser**

  Slice 0018's plan and implementation notes document: "`deriveRuntimePolicy` in `packages/environment/src/runtime-startup-config.ts` currently constructs `RuntimePolicyDTO` without calling a parser. After this slice, a follow-up should wire `parseRuntimePolicyDTO` into the `deriveRuntimePolicy` return path." This integration debt has no corresponding backlog entry or follow-up slice card. Without tracking, it risks being forgotten.

- **L3 — `ToolDefinition` uses `as ToolDefinition` cast on `Object.freeze()` return**

  In `tool-definition.ts`, the parser returns `Object.freeze(result) as ToolDefinition`. This is necessary because the conditional spread for optional `defaults` prevents TypeScript from inferring the full interface shape. In contrast, `ExecutionGrantDTO` (which has all fields required) does not need a cast. This is a known TypeScript limitation, not an implementation error, but it creates a minor consistency gap with the zero-cast pattern used in other modules.

- **L4 — Registry tests use `as ToolDefinition` and `as ToolCallDTO` casts in helpers**

  `makeValidToolDefinition` and `makeValidToolCall` in `registry.test.ts` return their values with `as ToolDefinition` and `as ToolCallDTO` casts. These bypass contract validation in test setup. While pragmatic (the tests separately verify parser behavior), this could hide type-drift between the test helpers and the actual contract shapes if the interfaces change.

- **L5 — Schema validator has no test for `required` field present but not an array**

  The schema validator tests cover valid schemas, missing required properties, wrong types, `additionalProperties`, nested validation, and various edge cases. However, there is no test for the case where `required` is present but not an array (related to M1 above). This gap allows the silent-skip behavior to persist undetected.

- **L6 — Duplicate literal union names across contracts package**

  Both `tool-definition.ts` and `execution-grant.ts` export `NetworkAccess` with identical values (`"deny" | "inherit"`). This is harmless but duplicates the type in the public API. Consistent with the pre-existing pattern noted in audit 0008 (L2: `ContextItemValidationCode` redundantly redeclares `ContentRefValidationCode` literals).

---

## Drift By Category

### Spec drift — NONE FOUND

All eight slices were compared field-by-field and rule-by-rule against their authoritative spec files. No behavioral spec drift was found:

| Slice | Contract | Spec Match | Notes |
|---|---|---|---|
| 0012 | `ContextItem` | ✅ Exact | All 8 fields, 5 layer literals, 3 retention literals, non-coercion rules match |
| 0013 | `ActionDecision` | ✅ Exact | 4 decision kinds, conditional field rules, tool call entry shape match. `abort` message optionality follows spec's "most abort outcomes" phrasing |
| 0014 | `ToolCallDTO` / `ToolResultDTO` | ✅ Exact | All 7 + 9 fields match. Cross-field `timeout_ms === grant.max_runtime_ms` enforced. Empty arguments accepted per `tool-registry.md` authority |
| 0015 | `ExecutionGrantDTO` | ✅ Exact | All 7 fields, 4 path roots, 3 capabilities, 2 approval modes, 2 network policies match |
| 0016 | `LLMInferenceRequest` / `LLMInferenceResult` | ✅ Exact | All 5 + 5 fields match. `inference_policy` subfields correctly deferred. `AvailableToolEntry` shape matches `tool-schema-model.md` |
| 0017 | `ToolDefinition` | ✅ Exact | All 9 fields (8 required + optional `defaults`), 4 side-effect levels, 3 path scopes, 2 network access values match spec |
| 0018 | `RuntimePolicyDTO` | ✅ Exact | All 5 fields, 4 workspace roots, boolean `trusted_local_mode` match spec |
| 0019 | `ToolRegistry` | ✅ Exact | Registration, routing, schema enforcement, projection all match `tool-registry.md` responsibilities |

### Boundary drift — NONE FOUND

- All contracts slices (0012–0018) remain properly scoped to `@argentum/contracts`
- Slice 0019 (`@argentum/tooling`) correctly depends on `@argentum/contracts` via `workspace:*`
- No implementation leaks into out-of-scope areas: grant resolution, execution-driver spawning, artifact persistence, provider-adapter wiring, or retry policy
- Cross-module composition uses only public contracts-package exports or direct intra-package imports

### Internal export-pattern inconsistency (not drift, but noted)

- `parseExecutionGrantAtPath` is exported from its source module (used by `tool-call-and-result.ts`)
- `parseToolCallDTOAtPath` / `parseToolResultDTOAtPath` are exported from their source module
- `parseToolDefinitionAtPath` is exported from its source module
- `parseRuntimePolicyDTOAtPath` / `parseWorkspaceRootsAtPath` are exported from their source module
- `parseActionDecisionAtPath` is NOT exported (internal only — `llm-adapter.ts` uses try/catch fallback)
- `parseContextItemAtPath` is NOT exported (internal only — `llm-adapter.ts` uses `parseContextItemArray` + try/catch)

This inconsistency is a design choice, not a defect. The non-exported at-path parsers force downstream consumers to use try/catch + re-emit patterns, which is functional but loses the clean path-prefix composition available to modules that have direct access to at-path parsers.

### Validation or test drift

- **Test assertion pattern inconsistency across test files** (see H3 and M6 above):
  - `context-item.test.ts`: Exact `{path, code}` tuple matching (strictest) ✅
  - `action-decision.test.ts`: Exact `{path, code}` tuple matching ✅
  - `execution-grant.test.ts`: Exact `{path, code}` tuple matching ✅
  - `tool-call-and-result.test.ts`: Exact matching ✅
  - `tool-definition.test.ts`: `toHaveLength` + `arrayContaining(objectContaining(...))` (safer) ⚠️
  - `runtime-policy.test.ts`: `toHaveLength` + `arrayContaining(objectContaining(...))` (safer) ⚠️
  - `llm-adapter.test.ts`: `arrayContaining(objectContaining(...))` without length check (weakest) ❌

### Planning-artifact drift

- **H2 (above)**: Backlog Next Actions items 4–6 are completed but not marked as such
- **M4 (above)**: Slice 0019 card is truncated (missing "Dependency Wiring" section content)
- **M3 (above)**: Slices 0017–0019 lack implementation-level adversarial review entries
- **L2 (above)**: Latent integration gap (`deriveRuntimePolicy` → parser) is documented but untracked in backlog

### Deferred-decision leakage — NONE FOUND

All eight slices respect frozen MVP rules and deferred decisions:

- Post-MVP role-taxonomy expansion: not implemented (0012)
- Post-MVP tool schema evolution beyond 9 fields: not implemented (0017)
- Provider-specific schema extensions: deferred to `llm_provider` (0017)
- Rich schema validation beyond MVP `type`/`properties`/`required`/`additionalProperties` subset: documented as out-of-scope (0019)
- Automatic tool retries for read-only tools: deferred to follow-up slice (0019)
- Multi-registry/remote-registry topologies: MVP is one local registry (0019)
- Multiple implementations per tool: MVP is one per tool (0019)
- `inference_policy` subfields: deferred to DeepSeek adapter MVP (0016)
- Exact initial tool catalog: deferred (all slices)
- Exact compaction size thresholds: deferred (all slices)
- Fine-grained network policy beyond `deny`/`inherit`: deferred (0015)
- Parallel-execution hints: deferred (0013)

---

## Missing Tests Or Weak Validation

### Slice 0016 (LLM Adapter) — Subset-matching test weakness (H3)

All rejection tests in `llm-adapter.test.ts` use `expect.arrayContaining(expect.objectContaining(...))` without `toHaveLength` enforcement. This is the same pattern identified and fixed in slice 0012's H1. Approximately 20+ tests are affected.

**Recommended fix**: Add `toHaveLength(expectedIssueCount)` before the `arrayContaining` assertion, or switch to the exact `{path, code}` tuple matching pattern used in `context-item.test.ts`.

### Slice 0019 (Schema Validator) — Missing malformed-schema test (L5)

No test covers the case where `required` is present in the schema but is not an array (e.g., a string or number). The validator silently skips required-property validation in this case (M1).

**Recommended fix**: Add a test like:
```
it("returns validation failure when required is present but not an array", () => {
  const result = validateAgainstSchema(
    { foo: "bar" },
    { type: "object", properties: { foo: { type: "string" } }, required: "foo" }
  );
  expect(result.valid).toBe(false);
  // Schema is malformed — validator should report this
});
```

### Slice 0018 (Runtime Policy) — `expectPolicyIssues` subset matching on fields (M6)

Each issue match uses `expect.objectContaining({path, code})` which accepts issues with extra fields. Low risk since `toHaveLength` catches extra issues.

---

## Stale Or Inconsistent Planning Artifacts

1. **Backlog Next Actions** (items 4, 5, 7) need refresh — items 4 and 5 are completed, item 7 is current
2. **Slice 0019 card truncated** — "## Dependency Wiring" section has no content
3. **No adversarial review entries** for slices 0017–0019
4. **Latent integration gap** (`deriveRuntimePolicy` → parser) not tracked in backlog

---

## Deferred-Decision Leakage Or Unsafe Assumptions

**None found.** All eight slices respect the frozen MVP decisions listed in `docs/spec/README.md` and the deferred decisions in `docs/spec/70-roadmap/deferred-decisions.md`.

---

## Repo Readiness Verdict

### `ready-with-risks`

**Rationale**:

- **Code quality**: All 8 slices are implemented with high fidelity to the spec. No spec drift. No boundary violations. 636+ contract tests pass; 44 tooling tests pass. All test gates are non-vacuous.
- **Validation rigor**: Good overall, with one systematic weakness (H3: subset matching in llm-adapter tests) that should be addressed before the next adversarial review cycle.
- **Planning artifacts**: Backlog is partially stale (Next Actions section), and slice 0019 card is truncated. These are documentation issues, not code issues.
- **At-path export gap**: H1 (at-path parsers not re-exported) is a design decision that needs explicit resolution — either re-export or update slice plans.
- **Next-slice readiness**: Slices 0020+ (grant resolution, execution driver) can begin planning immediately. The contracts foundation (0012–0018) and the tool registry (0019) provide a solid base.

### Risks for slices 0020+

1. **H1 (at-path exports)**: If grant resolution or execution-driver slices need nested validation with path-prefix fidelity (e.g., validating `ExecutionGrantDTO` inside a larger structure), they will need at-path parsers from the public API. Resolve the export policy before those slices begin.
2. **M1 (schema validator malformed `required`)**: If tool authors register schemas with non-array `required`, validation will silently fail. Fix before tool-layer integration testing.
3. **L2 (deriveRuntimePolicy integration)**: Wire `parseRuntimePolicyDTO` into the `deriveRuntimePolicy` return path before grant resolution testing begins — otherwise grants may be derived from unvalidated policy data.

---

## Audit Report Path

`docs/implementation/audits/0010-slices-0012-0019-deep-audit.md`
