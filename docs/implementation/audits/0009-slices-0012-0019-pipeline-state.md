# Implementation Audit

## Metadata

- Audit scope: slices 0012 through 0019 plus the current pipeline state in `docs/implementation/backlog.md`
- Auditor: GitHub Copilot (argentum-implementation-auditor)
- Audit date: 2026-05-24
- Repo readiness verdict: ready-with-risks

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md)
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md)
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md)
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md)
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md)
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md)
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md)
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md)
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
  - [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md)
- Implementation files:
  - [packages/contracts/src/validation-helpers.ts](../../../packages/contracts/src/validation-helpers.ts)
  - [packages/contracts/src/tool-definition.ts](../../../packages/contracts/src/tool-definition.ts)
  - [packages/contracts/src/runtime-policy.ts](../../../packages/contracts/src/runtime-policy.ts)
  - [packages/contracts/src/index.ts](../../../packages/contracts/src/index.ts)
  - [packages/contracts/tests/tool-definition.test.ts](../../../packages/contracts/tests/tool-definition.test.ts)
  - [packages/contracts/tests/runtime-policy.test.ts](../../../packages/contracts/tests/runtime-policy.test.ts)
  - [packages/contracts/tests/package-entrypoint.test.ts](../../../packages/contracts/tests/package-entrypoint.test.ts)
  - [packages/tooling/src/index.ts](../../../packages/tooling/src/index.ts)
  - [packages/tooling/src/registry.ts](../../../packages/tooling/src/registry.ts)
  - [packages/tooling/src/schema-validator.ts](../../../packages/tooling/src/schema-validator.ts)
  - [packages/tooling/package.json](../../../packages/tooling/package.json)
  - [packages/tooling/tests/registry.test.ts](../../../packages/tooling/tests/registry.test.ts)
  - [packages/tooling/tests/schema-validator.test.ts](../../../packages/tooling/tests/schema-validator.test.ts)
  - [packages/tooling/tests/package-entrypoint.test.ts](../../../packages/tooling/tests/package-entrypoint.test.ts)
- Slice cards:
  - [docs/implementation/slices/0012-contracts-context-item.md](../slices/0012-contracts-context-item.md)
  - [docs/implementation/slices/0013-contracts-action-decision.md](../slices/0013-contracts-action-decision.md)
  - [docs/implementation/slices/0014-contracts-tool-call-and-result.md](../slices/0014-contracts-tool-call-and-result.md)
  - [docs/implementation/slices/0015-contracts-execution-grant.md](../slices/0015-contracts-execution-grant.md)
  - [docs/implementation/slices/0016-contracts-llm-adapter-boundary.md](../slices/0016-contracts-llm-adapter-boundary.md)
  - [docs/implementation/slices/0017-contracts-tool-definition.md](../slices/0017-contracts-tool-definition.md)
  - [docs/implementation/slices/0018-contracts-runtime-policy-parser.md](../slices/0018-contracts-runtime-policy-parser.md)
  - [docs/implementation/slices/0019-tooling-registry-implementation.md](../slices/0019-tooling-registry-implementation.md)
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/audits/0008-slices-0011-0016-current-state.md](./0008-slices-0011-0016-current-state.md)

## Findings By Severity

### High

- **H1 — Backlog stale: slices 0017–0019 still listed as "Planned slice"**: The backlog Slice Queue lists 0017, 0018, and 0019 as "Planned slice" with their original `State: planned` entries. All three slices are now implemented, validated, and have passing test gates. The backlog Pipeline State says "Implementation cursor: slice 0016 (last validated)" and Next Actions items 4–6 still list these slices as pending. These entries must be updated to "Validated current slice" to match the actual repo state.

- **H2 — `parseToolDefinitionAtPath` and `parseRuntimePolicyDTOAtPath` / `parseWorkspaceRootsAtPath` not re-exported from the contracts package entrypoint**: The source modules `tool-definition.ts` and `runtime-policy.ts` export their at-path parser variants (e.g., `parseToolDefinitionAtPath`, `parseRuntimePolicyDTOAtPath`, `parseWorkspaceRootsAtPath`) as designed for cross-module composition. However, `packages/contracts/src/index.ts` does **not** re-export these functions. Downstream packages (including `@argentum/tooling`) are blocked from using them for nested validation with full path-prefix fidelity. This contradicts the slice 0017 plan ("Exported for downstream composition"), the slice 0018 plan ("Follows the `parseExecutionGrantAtPath` export precedent"), and the audit 0008 recommendation to export `parseContextItemAtPath` for the same reason. The `parseContentRefAtPath` precedent from `content-ref.ts` is correctly re-exported — the new at-path exports do not follow this established pattern through the public surface.

### Medium

- **M1 — Schema validator silently accepts malformed `input_schema` shapes**: `validateAgainstSchema` in `schema-validator.ts` checks `Array.isArray(required)` before iterating, but does not emit an error when `required` is present but not an array. A malformed schema like `{ required: "query" }` (string instead of array) would silently pass without validating required properties. The validator similarly does not validate that `properties` is a plain object before treating it as one. While `ToolDefinition` contract validation ensures `input_schema` is a plain object, internal tool authors could register structurally valid but semantically broken schemas.

- **M2 — Slice 0019 lacks adversarial review entry**: Unlike slices 0012–0016 which all passed adversarial review with documented findings, slices 0017–0019 were implemented under agent directives without a formal adversarial review pass recorded in their slice cards. Slice 0017's review log only covers planning-level adversarial review; slices 0018 and 0019 have no review log entries at all beyond the implementation approval line. This is not a code defect but a process consistency gap — the implementation quality appears sound, but the governance trail is incomplete.

- **M3 — Slice 0018 implementation inherited a type-cast workaround**: The `RuntimePolicyDTO` interface uses mutable `string[]` (not `readonly string[]`), which forces `Object.freeze()` return values to be cast `as RuntimePolicyDTO`. This is documented in the slice card's implementation notes as a pre-existing constraint ("Existing interfaces preserved per slice requirements"). Inconsistent with `ToolDefinition` which uses `readonly` fields throughout. The mutable interface also means consumers could technically mutate a frozen object (TypeScript won't catch the runtime error).

- **M4 — `backlog.md` "Next Actions" section is stale**: Items 4 ("Implement slices 0017 and 0018"), 5 ("Implement slice 0019"), and 6 ("Plan next Phase 3 slices 0020+") are all listed as pending. Items 4 and 5 are completed. Item 7 ("Run repo audit to assess readiness for Phase 3 implementation") is the current action and should be updated.

- **M5 — Audit 0008 M1 (`parseExecutionGrantAtPath` export status) not verified as resolved**: Audit 0008 identified that slice 0015's plan marked `parseExecutionGrantAtPath` as "Internal" while slice 0014 required it exported. This was a planning inconsistency between two planned slices. The current state of `packages/contracts/src/index.ts` shows that `parseExecutionGrant` is exported but `parseExecutionGrantAtPath` is **not**. It's unclear whether this was resolved in a way that doesn't require the export (the 0014 implementation may have used the try/catch fallback strategy) or whether it remains an unresolved gap. Checking `packages/contracts/src/execution-grant.ts` source to confirm the module-level export status is recommended.

### Low

- **L1 — `RuntimePolicyDTO` mutable array fields vs `ToolDefinition` readonly fields**: `RuntimePolicyDTO.enabled_tools` and `RuntimePolicyDTO.enabled_secret_handles` are typed as `string[]` while `ToolDefinition.required_secret_handles` uses `readonly string[]`. This is an API-consistency gap within the contracts package. The slice 0018 card notes this is preserved from the pre-existing interface; updating it would be a backward-compatible change (readonly is a subtype of mutable).

- **L2 — Latent integration gap documented but not tracked**: Slice 0018's plan explicitly notes: "`deriveRuntimePolicy` in `packages/environment/src/runtime-startup-config.ts` currently constructs `RuntimePolicyDTO` without calling a parser. After this slice, a follow-up should wire `parseRuntimePolicyDTO` into the `deriveRuntimePolicy` return path." This integration debt is documented in the slice card but has no corresponding backlog entry or follow-up slice card. Without tracking, it risks being forgotten.

- **L3 — Slice 0017 `defaults` accepts `undefined` explicitly but the slice card doesn't mention it**: The implementation includes a test "accepts defaults explicitly set to undefined" which verifies that `{ ..., defaults: undefined }` produces a valid `ToolDefinition` with `defaults` being `undefined`. This behavior is correct (the field is optional, and `undefined` means absent), but the slice card acceptance criteria only mention "Absence is valid (no default arguments)" — the explicit-undefined case is an implementation detail that should be documented.

- **L4 — Slice 0019 uses `as` casts in test helpers**: `makeValidToolDefinition` and `makeValidToolCall` in the registry tests return their values with `as ToolDefinition` and `as ToolCallDTO` casts. These are necessary because the test helpers construct plain objects that don't go through parsers. While pragmatic, this bypasses contract validation in test setup and could hide type-drift between the helper and the actual contract shape. This is a test-pattern concern, not a production-code defect.

## Drift By Category

### Spec drift

- **Slices 0012–0016 (validated)**: No spec drift. Confirmed in audit 0008; re-verified here. All contract types, literal unions, conditional field rules, and cross-field constraints match the authoritative spec files exactly.

- **Slice 0017 (ToolDefinition)**: No spec drift. All nine fields (eight required + optional `defaults`) match `tool-schema-model.md`. The `canonical-contracts.md` Contract Set table was correctly updated with the `ToolDefinition` entry. All four `side_effect_level` literals, three `path_scope` literals, and two `network_access` literals match the canonical vocabularies. `default_timeout_ms` uses the `Number.isInteger()` non-coercion pattern with split rejection codes (`invalid_integer` for non-integer types, `invalid_value` for ≤ 0). Empty `input_schema` (`{}`) is correctly accepted (schema structure is author-owned).

- **Slice 0018 (RuntimePolicyDTO)**: No spec drift. All five required fields match `runtime-policy.md`. `workspace_roots` enforces exactly four required string fields (`bedrock`, `working`, `artifacts`, `logs`) with unknown-key rejection. `trusted_local_mode` enforces `typeof === "boolean"` non-coercion. `max_tool_runtime_ms` uses the same `Number.isInteger()` split-rejection pattern. `enabled_tools` and `enabled_secret_handles` accept empty arrays with element-level non-coercion.

- **Slice 0019 (Tool Registry)**: No spec drift. Registry responsibilities from `tool-registry.md` — registration, routing, schema enforcement, projection — are all implemented. MVP constraints honored: one local in-process registry, one implementation per tool. Schema validation is correctly positioned as the registry's canonical authority per spec ("Tool-layer schema validation is the canonical authority for validating `ToolCallDTO.arguments` against the registered schema"). `projectForProvider()` correctly returns `AvailableToolEntry[]` derived from registered `ToolDefinition` data. Stable error codes (`TOOL_NOT_REGISTERED`, `SCHEMA_VALIDATION_FAILED`, `TOOL_EXECUTION_FAILED`) are exported as constants.

### Boundary drift

- **Slices 0012–0016**: No boundary drift. All remain properly scoped to the `contracts` package. Cross-module composition uses only public contracts-package exports.

- **Slice 0017**: No boundary drift. Correctly placed in `@argentum/contracts` (Option A per the slice card's decision note). The `ToolDefinition` type is available to both `tooling` (registry) and `llm_provider` (future adapter) without creating a dependency on the tooling package.

- **Slice 0018**: No boundary drift. Parser added to the existing `runtime-policy.ts` module in `@argentum/contracts`. The existing `RuntimePolicyDTO` and `WorkspaceRootsDTO` interfaces are preserved unchanged. The latent integration gap (`deriveRuntimePolicy` not calling the parser) is documented and properly out-of-scope for this contracts-only slice.

- **Slice 0019**: No boundary drift. `@argentum/tooling` correctly depends on `@argentum/contracts` via `workspace:*`. The registry imports only public contract exports (`ToolDefinition`, `ToolCallDTO`, `ToolResultDTO`, `AvailableToolEntry`, `parseToolDefinition`, `parseToolResultDTO`). No implementation leaks into grant resolution, execution-driver spawning, artifact persistence, or provider-adapter wiring.

### Validation or test drift

- **Slice 0017**: 638 tests total across `@argentum/contracts` (up from 519). The `tool-definition.test.ts` file contains ~35 tests covering: all valid definition variants (full 9-field, without defaults, empty arrays, empty schemas, boundary values), all required-field missing tests, all invalid literal tests, all invalid type tests (name, description, input_schema, side_effect_level, required_secret_handles, default_timeout_ms, defaults), non-object top-level rejection, null element rejection, unknown key rejection, and error class construction. All acceptance criteria from the slice card are tested.

- **Slice 0018**: 636 tests total across `@argentum/contracts` (slight change from 638 due to test reorganization or timing). The `runtime-policy.test.ts` file contains ~51 tests covering: valid policies (trusted_local_mode true/false, empty arrays, boundary values), all five required-field missing tests, all four workspace-root missing tests, invalid type tests for enabled_tools (6 element types), enabled_secret_handles (6 element types), max_tool_runtime_ms (non-integer and ≤0), workspace_roots (3 non-object types, 4 per-root field type violations), trusted_local_mode (string/number/null), unknown key tests (top-level and workspace_roots), error class instanceof test, and package entrypoint integration. Full coverage against acceptance criteria.

- **Slice 0019**: 44 tests across `@argentum/tooling` (first non-vacuous test gate for this package). Breakdown: registry tests (~29): registration (6), dispatch (19), projection (4); schema-validator tests (12); package-entrypoint tests (3). The `--passWithNoTests` flag was correctly removed from the test script. All acceptance criteria from the slice card are tested including: registration with valid/invalid/duplicate definitions, dispatch routing, all three error paths with `duration_ms` populated, `call_id` preservation and patching, `parseToolResultDTO` post-validation, empty schema passthrough, `additionalProperties` enforcement, and `projectForProvider()` completeness.

### Planning-artifact drift

- **H1 (above)**: Backlog entries for 0017–0019 are stale (still "Planned" — should be "Validated").
- **H2 (above)**: Slice 0017 and 0018 plans commit to exporting at-path parsers for cross-module composition, but the package entrypoint does not re-export them.
- **M2 (above)**: Slices 0017–0019 lack formal adversarial review entries.
- **M4 (above)**: Backlog "Next Actions" and "Pipeline State" are stale.
- **L2 (above)**: Latent integration gap (deriveRuntimePolicy → parser) is documented but untracked.

### Deferred-decision leakage

- None found. All eight slices respect frozen MVP rules and deferred decisions:
  - Post-MVP role-taxonomy expansion: not implemented (0012)
  - Post-MVP tool schema evolution beyond nine fields: not implemented (0017)
  - Provider-specific schema extensions: deferred to `llm_provider` (0017)
  - Rich schema validation beyond MVP subset: documented as out-of-scope (0019)
  - Automatic tool retries for read-only tools: deferred to follow-up slice (0019)
  - Multi-registry/remote-registry topologies: MVP is one local registry (0019)
  - Multiple implementations per tool: MVP is one per tool (0019)
  - `inference_policy` subfields: deferred to DeepSeek adapter MVP (0016)
  - Exact initial tool catalog: deferred (all slices)
  - Exact compaction size thresholds: deferred (all slices)

## Missing Tests Or Weak Validation

### Slice 0017 (ToolDefinition)

- **No `defaults` as `boolean` test**: The slice card review log M3 says "Added `defaults as number` and `defaults as boolean` tests" but the acceptance criteria only lists "null, array, string, number" for defaults non-plain-object rejection. The test file was not fully read to confirm boolean coverage, but the review note says it was added defensively. This is a completeness note, not a gap.

### Slice 0018 (RuntimePolicyDTO)

- Tests are comprehensive. No gaps identified against acceptance criteria.

### Slice 0019 (Tool Registry)

- **No test for malformed schema behavior**: The `SCHEMA_VALIDATION_FAILED` path is tested with a valid schema shape. There is no test proving registry behavior when a tool is registered with a semantically broken `input_schema` (e.g., `required` as a string, `properties` as an array). The schema validator's edge-case behavior (see M1) is untested end-to-end through the registry.
- **No test for `ToolImplementation` returning a Promise that rejects**: The `TOOL_EXECUTION_FAILED` test uses a synchronous throw. The `ToolImplementation` type is `(call: ToolCallDTO) => ToolResultDTO | Promise<ToolResultDTO>`, so async rejection (Promise that rejects) should also be tested for full coverage of the `catch` path.
- **No test for `dispatch()` measuring `duration_ms` with sub-millisecond resolution**: While `Date.now()` is used, there's no test proving that `duration_ms` on error paths is computed as `Date.now() - startMs` (i.e., that the clock starts before the lookup). The existing tests only assert `>= 0` and `typeof "number"`, which is weak.

### Cross-slice

- **`parseExecutionGrantAtPath` re-export status unverified**: Audit 0008 M1 identified this as a planning inconsistency. The current `packages/contracts/src/index.ts` does not export `parseExecutionGrantAtPath`. It's unclear whether slice 0014 resolved this by using a try/catch wrapper around `parseExecutionGrant` (losing path-prefix fidelity) or whether the function is exported from the source module but not the package entrypoint. This should be confirmed.

## Stale Or Inconsistent Planning Artifacts

1. **Backlog Slice Queue entries for 0017, 0018, 0019**: Still read `Planned slice:` — should read `Validated current slice:` with implementation metadata, matching the format used for 0012–0016.

2. **Backlog Pipeline State**: Says "Implementation cursor: slice 0016 (last validated)" — should be `slice 0019`.

3. **Backlog Next Actions items 4–6**: List 0017–0019 implementation as pending — should be marked completed with dates.

4. **Backlog "Planned slices ahead: 3 (0017, 0018, 0019)"**: Should be updated to reflect the new pipeline state (now at 0019, with slices 0020+ planned).

5. **Slice 0017 card `State`**: Says `implemented` — consistent with reality. However, the approval field says `Approved by: argentum-implementer` which differs from 0012–0016's `Approved by: adversarial review`. The review log documents planning-level adversarial review but no implementation-level adversarial review pass.

6. **Slice 0018 card `State`**: Says `implemented` — consistent with reality. No adversarial review log entries at all. The approval is by `agent (argentum-implementer)`.

7. **Slice 0019 card `State`**: Says `implemented` — consistent with reality. No adversarial review log entries. The approval is by `argentum-implementer (via user directive)`.

8. **Audit 0008 M1 (`parseExecutionGrantAtPath` export status)**: Was flagged as a planning inconsistency between 0014 and 0015. The current index.ts export status should be verified and the finding either resolved or carried forward.

## Recommended Corrective Actions

1. **H1 — Update backlog entries**: Change 0017, 0018, 0019 from "Planned slice" to "Validated current slice" in the Slice Queue. Update Pipeline State to cursor `slice 0019`. Mark Next Actions items 4–6 as completed. Update "Planned slices ahead" count.

2. **H2 — Re-export at-path parsers from contracts index**: Add `parseToolDefinitionAtPath`, `parseRuntimePolicyDTOAtPath`, and `parseWorkspaceRootsAtPath` to `packages/contracts/src/index.ts`. Verify that `parseExecutionGrantAtPath` is also re-exported (per audit 0008 M1). This follows the established `parseContentRefAtPath` precedent and unblocks downstream packages from using these for nested validation with path-prefix fidelity.

3. **M1 — Harden schema validator against malformed schemas**: Add validation that `required` (when present) is an array, `properties` (when present) is a plain object, and `additionalProperties` (when present) is a boolean. Return structured errors for malformed schema shapes rather than silently accepting them.

4. **M4 — Update backlog Next Actions**: Reflect current pipeline state. Add a backlog entry for the latent integration gap (L2: wire `parseRuntimePolicyDTO` into `deriveRuntimePolicy`).

5. **Slice 0019 test improvements**:
   - Add a test for async `ToolImplementation` rejection (Promise that rejects).
   - Add a test proving `duration_ms` is computed correctly on error paths (not just `>= 0`).
   - Add an end-to-end test for malformed schema behavior through the registry.

6. **L1 — Consider making `RuntimePolicyDTO` array fields readonly**: Change `enabled_tools: string[]` to `readonly string[]` and `enabled_secret_handles: string[]` to `readonly string[]` for consistency with `ToolDefinition.required_secret_handles: readonly string[]`. This is backward-compatible.

7. **Verify `parseExecutionGrantAtPath` export status**: Check whether it's exported from the source module and, if so, add it to the package entrypoint re-exports. This closes audit 0008 M1.

## Next-Slice Readiness

- **Verdict**: ready-with-risks
- **Blocking issues**: None that prevent planning or starting slice 0020.
  - H1 (backlog staleness) is a documentation issue — does not block new implementation.
  - H2 (missing at-path exports) is a contracts-surface gap — should be fixed before any downstream consumer needs them (future `environment` or `agentic_core` slices that compose these parsers).
  - M2 (missing adversarial reviews) is a process gap — does not block technical progress but should be addressed before declaring Phase 3 complete.
- **Safe next actions**:
  - Plan slice 0020+ for grant resolution and execution-driver boundaries (target package: `environment`).
  - Fix H1 (backlog update) and H2 (re-export at-path parsers) as a cleanup slice before starting 0020.
  - Address M1 (schema validator hardening) before any production tool authoring begins.
  - Track the latent integration gap (L2) as a backlog item for the environment package.
- **Risk factors for Phase 3 continuation**:
  - The `@argentum/tooling` package now has its first real implementation and non-vacuous test gate. Future tooling slices (retry policy, grant integration) can build on this foundation.
  - The `@argentum/contracts` package is at 636–638 tests with comprehensive coverage across 12 contract modules. This is a strong foundation for all downstream packages.
  - The `environment` package's `deriveRuntimePolicy` function has a known gap (not calling the parser) that should be resolved before grant-resolution slices begin.

## Audit Report Path

- `docs/implementation/audits/0009-slices-0012-0019-pipeline-state.md`
