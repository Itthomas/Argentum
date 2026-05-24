# Implementation Audit — Post-Remediation State (Slices 0020–0031)

## Metadata

- **Audit scope**: Slices 0020–0031 post comprehensive remediation of audit 0011 findings
- **Cluster**: Phase 3 (0020–0023), Phase 4 agentic core (0024–0030), Phase 5 LLM provider start (0031)
- **Auditor**: GitHub Copilot (argentum-implementation-auditor)
- **Audit date**: 2026-05-24
- **Audit type**: Post-remediation verification — source-level comparison of implementation vs spec, planning-artifact freshness check, boundary-violation scan, deferred-decision leakage scan
- **Prior audit**: [0011-slices-0020-0029-deep-audit.md](./0011-slices-0020-0029-deep-audit.md)
- **Repo readiness verdict**: `ready-with-risks`

**Note**: This audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow.

---

## Sources Reviewed

### Governing spec files (all treated as authoritative)

- [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen MVP decisions
- [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `TurnEnvelope` and `TurnBudget` shapes
- [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md)
- [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md)
- [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md)
- [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md)
- [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md)
- [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md)
- [docs/spec/20-contracts/tool-definition.md](../../spec/20-contracts/tool-definition.md)
- [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md)
- [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
- [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md)
- [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md)
- [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md)
- [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md)
- [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md)
- [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md)
- [docs/spec/40-modules/tool-layer/retry-policy.md](../../spec/40-modules/tool-layer/retry-policy.md)
- [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md)
- [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md)
- [docs/spec/40-modules/agentic-layer/episodic-memory.md](../../spec/40-modules/agentic-layer/episodic-memory.md)
- [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md)
- [docs/spec/40-modules/agentic-layer/context-selection.md](../../spec/40-modules/agentic-layer/context-selection.md)
- [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md)
- [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
- [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md)

### Implementation files (all reviewed)

- `packages/environment/src/grant-resolver.ts`
- `packages/environment/src/execution-driver.ts`
- `packages/environment/src/artifact-store.ts`
- `packages/environment/src/index.ts`
- `packages/tooling/src/retry-policy.ts`
- `packages/tooling/src/index.ts`
- `packages/agentic_core/src/turn-state-machine.ts`
- `packages/agentic_core/src/episodic-memory.ts`
- `packages/agentic_core/src/prompt-compiler.ts`
- `packages/agentic_core/src/context-selector.ts`
- `packages/agentic_core/src/compaction-policy.ts`
- `packages/agentic_core/src/turn-governor.ts`
- `packages/agentic_core/src/index.ts`
- `packages/contracts/src/turn-envelope.ts`
- `packages/contracts/src/index.ts`
- `packages/llm_provider/src/index.ts` — still `export {};` (shell)

### Test files (all reviewed)

- `packages/environment/tests/grant-resolver.test.ts`
- `packages/environment/tests/execution-driver.test.ts`
- `packages/environment/tests/artifact-store.test.ts`
- `packages/tooling/tests/retry-policy.test.ts`
- `packages/agentic_core/tests/turn-state-machine.test.ts`
- `packages/agentic_core/tests/episodic-memory.test.ts`
- `packages/agentic_core/tests/prompt-compiler.test.ts`
- `packages/agentic_core/tests/context-selector.test.ts`
- `packages/agentic_core/tests/compaction-policy.test.ts`
- `packages/agentic_core/tests/turn-governor.test.ts`
- `packages/contracts/tests/turn-envelope.test.ts`

### Slice cards

- [0020-environment-grant-resolver.md](../slices/0020-environment-grant-resolver.md)
- [0021-environment-execution-driver-interface.md](../slices/0021-environment-execution-driver-interface.md)
- [0022-environment-artifact-store.md](../slices/0022-environment-artifact-store.md)
- [0023-tooling-retry-policy-handler.md](../slices/0023-tooling-retry-policy-handler.md)
- [0024-agentic-core-turn-state-machine.md](../slices/0024-agentic-core-turn-state-machine.md)
- [0025-agentic-core-episodic-memory.md](../slices/0025-agentic-core-episodic-memory.md)
- [0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md)
- [0027-agentic-core-context-selection-policy.md](../slices/0027-agentic-core-context-selection-policy.md)
- [0028-agentic-core-compaction-policy.md](../slices/0028-agentic-core-compaction-policy.md)
- [0029-agentic-core-turn-governor.md](../slices/0029-agentic-core-turn-governor.md)
- [0030-agentic-core-validation-repair-policy.md](../slices/0030-agentic-core-validation-repair-policy.md)
- [0031-llm-provider-abstraction-interface.md](../slices/0031-llm-provider-abstraction-interface.md)

### Workflow artifacts

- [docs/implementation/backlog.md](../backlog.md)
- [docs/implementation/audits/0011-slices-0020-0029-deep-audit.md](./0011-slices-0020-0029-deep-audit.md)

---

## Audit 0011 Remediation Verification

All six HIGH findings and all six MEDIUM findings from audit 0011 were verified as resolved:

| Finding | Severity | Remediation | Verified |
|---------|----------|-------------|----------|
| H1 — Governor abort reason literals | HIGH | Card 0029 updated to match implementation (`step_limit_exceeded`, `repair_limit_exceeded`, `wall_clock_exceeded`) | ✅ |
| H2 — Governor budget-check priority order | HIGH | Card 0029 updated to match implementation (steps → repairs → wall clock) | ✅ |
| H3 — Governor missing `now` parameter | HIGH | Card 0029 updated: `evaluateGovernor(envelope, startedAt: number)`, fake timers for determinism | ✅ |
| H4 — Slice cards 0021/0028/0029 stale | HIGH | All three cards updated to `State: implemented`, `Approval: approved` | ✅ |
| H5 — CompactionPolicy API signature deviation | HIGH | Card 0028 AC updated to match implementation (`compact(result, currentRevision, externalizer?)`, `store()`) | ✅ |
| H6 — Backlog comprehensively stale | HIGH | Next Actions, Audit Findings, Pipeline State refreshed | ✅ |
| M1 — `max_tokens_per_step` missing from spec | MEDIUM | **Documented as requiring human spec edit. Not yet fixed in spec.** | ⚠️ |
| M2 — `ArtifactExternalizer.store()` vs `storeToolArtifact()` mismatch | MEDIUM | Documented in slice 0028 card. Adapter shim needed. | ✅ |
| M3 — Slice 0027 AC not updated for layer_filtered | MEDIUM | "Layer filtering" bullet added to 0027 AC | ✅ |
| M4 — No adversarial review for 0021/0028/0029 | MEDIUM | Review logs populated in all three cards | ✅ |
| M5 — Governor `startedAt` type `Date` → `number` | MEDIUM | Card 0029 updated to `startedAt: number` | ✅ |
| M6 — Audit 0010 H1 remediation listed as "in progress" | MEDIUM | Backlog updated to reflect resolved state | ✅ |

**Post-remediation review findings** (reported by user as found and fixed):
- 0030 H1 (missing retention field) — resolved in card
- 0030 H2 (abort path increment) — resolved in card
- 0027 H1 (stale test section) — resolved in card
- 0028 M2–M3 (stale prose) — resolved in card
- 0027 M1–M3 (missing test entries) — resolved in card

These post-remediation findings are not visible in the current slice card state, confirming they were fixed.

---

## Implementation Status Summary

| Slice | Package | State (Code) | State (Card) | Approval (Card) | Tests |
|-------|---------|-------------|-------------|-----------------|-------|
| 0020 | environment | Implemented | implemented | approved | 25 grant-resolver |
| 0021 | environment | Implemented | implemented | approved | 38 execution-driver |
| 0022 | environment | Implemented | implemented | approved | 35 artifact-store |
| 0023 | tooling | Implemented | implemented | approved | 40 retry-policy |
| 0024 | agentic_core | Implemented | implemented | approved | 71 turn-state-machine |
| 0025 | agentic_core | Implemented | implemented | approved | 24 episodic-memory |
| 0026 | agentic_core | Implemented | implemented | approved | ~33 prompt-compiler |
| 0027 | agentic_core | Implemented | implemented | approved | 33 context-selector |
| 0028 | agentic_core | Implemented | implemented | approved | 38 compaction-policy |
| 0029 | agentic_core | Implemented | implemented | approved | 20 turn-governor |
| 0030 | agentic_core | **Not implemented** | planned | approved | — |
| 0031 | llm_provider | **Not implemented** | planned | **pending** | — |

**Key observation**: All 10 implemented slices (0020–0029) have aligned card state and approval status with their implementation. Slice 0030 is correctly marked as `planned` with `approved` status. Slice 0031 is correctly marked as `planned` but its card-level `Approval: pending` conflicts with the backlog's representation of it as "Approved."

---

## Findings By Severity

### HIGH

**None.** All audit 0011 HIGH findings (H1–H6) are verified resolved. The implementation code, slice cards, and workflow artifacts are aligned for slices 0020–0029.

### MEDIUM

- **M1 (CONTINUING from audit 0011) — `max_tokens_per_step` still missing from authoritative spec `turn-envelope.md`**

  The `packages/contracts/src/turn-envelope.ts` `TurnBudget` interface includes:
  ```typescript
  readonly max_tokens_per_step?: number;
  ```
  The contract test file (`turn-envelope.test.ts`) has 6 dedicated tests for this field. The slice card 0029 references it. The backlog documents it as a contract amendment.

  However, `docs/spec/20-contracts/turn-envelope.md` Budget Fields table still lists only 4 fields:
  - `max_inference_steps`
  - `max_repair_attempts`
  - `max_wall_clock_ms`
  - `repair_attempts_used`

  `max_tokens_per_step` is absent from the spec table.

  **Impact**: Spec drift. The authoritative spec document does not reflect the current contract surface. Any implementer reading only the spec would not know `max_tokens_per_step` exists. This was documented in audit 0011 as "Requires spec edit — orchestrator cannot edit `docs/spec/`. Human action needed." The finding remains open.

  **Status**: DOCUMENTED, NOT YET FIXED. Requires human edit to `docs/spec/20-contracts/turn-envelope.md`.

- **M2 — Backlog Pipeline State and slice 0031 card disagree on approval status**

  The backlog Pipeline State section states:
  > - Planned slices ahead: 2 (0030, 0031 — **both approved** and ready for implementation)
  >   - **0031** (LLM Provider Interface): **Approved**, ready for implementation

  The slice 0031 card header states:
  ```
  - State: planned
  - Approval: pending
  - Approved by:
  - Approval date:
  ```

  The card's Review Log is also empty — no findings or refinements recorded.

  **Impact**: Planning-artifact inconsistency. The backlog states 0031 is approved and ready; the card says approval is pending. A downstream agent consulting the backlog would believe 0031 is ready for implementation; one consulting the card would believe approval has not been granted.

- **M3 — Slice 0031 Review Log is empty**

  The Review Log section of the slice 0031 card contains no findings or refinements:
  ```
  - Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - Refinements applied:
  ```
  Both bullets are blank. While the slice is in `planned` state, the planning-level review that would justify `Approval: approved` (if the backlog is correct) or identify blocking issues (if `pending` is correct) has not been recorded.

  **Impact**: Governance-trail gap. The approval status is ambiguous because there is no recorded review to support either state. This makes it impossible for an implementer to know whether the slice is ready to implement or requires further planning review.

### LOW

- **L1 — Backlog Pipeline State contains stale "4 HIGH remain unresolved" reference**

  The Pipeline State section says:
  > - **Latest audit**: 0011 (`ready-with-risks` — 6 HIGH, 6 MEDIUM; **4 HIGH remain unresolved**)

  However, the Audit Findings section immediately below shows ALL 6 HIGH findings as RESOLVED, and ALL 6 MEDIUM findings as either RESOLVED or DOCUMENTED. The "4 HIGH remain unresolved" language is a leftover from before remediation — all HIGH findings are now resolved.

  **Impact**: Minor internal inconsistency within the backlog document. Someone skimming only the Pipeline State could mistakenly believe blocking HIGH issues remain.

- **L2 — `agentic_core/src/index.ts` does not export `validateAndRepair` or `ValidationOutcome`**

  The barrel export file (`packages/agentic_core/src/index.ts`) exports all symbols from slices 0024–0029 but has no entry for slice 0030's planned `validateAndRepair` function or `ValidationOutcome` type. No `validation-repair.ts` file exists in the source tree.

  **Context**: This is expected — slice 0030 is `State: planned`, not implemented. The card correctly reflects this. Noted for completeness; not a defect.

- **L3 — `llm_provider/src/index.ts` still contains only `export {};`**

  The `@argentum/llm-provider` package barrel still has the shell placeholder `export {};`. No `llm-provider.ts` or any other source module exists.

  **Context**: This is expected — slice 0031 is `State: planned`. The card correctly reflects this. Noted for completeness; not a defect.

---

## Drift By Category

### Spec drift

| Finding | Severity | Description |
|---------|----------|-------------|
| M1 | MEDIUM | `max_tokens_per_step` in `TurnBudget` code but missing from spec `turn-envelope.md` Budget Fields table (CONTINUING from audit 0011) |

**All other slices 0020–0029**: No spec drift found. All implementations faithfully follow their slice card acceptance criteria and the governing spec documents. Turn governor abort reasons, priority order, and `startedAt` type are aligned between implementation and cards. CompactionPolicy API signature is aligned.

### Boundary drift

**No boundary violations found.** All implemented slices respect their package boundaries:

- `environment` (0020–0022): Only consumes `@argentum/contracts` and Node.js built-ins (`node:fs/promises`, `node:path`, `node:crypto`, `node:buffer`).
- `tooling` (0023): Only consumes `@argentum/contracts` and internal `./registry.js`.
- `agentic_core` (0024–0029): Only consumes `@argentum/contracts` and Node.js `crypto`/`buffer`. No cross-imports to `environment`, `tooling`, `gateway`, or `llm_provider`. No provider-native types imported anywhere.

**Cross-package interface gap (previously documented)**: `ArtifactExternalizer.store()` (in `agentic_core`) and `storeToolArtifact()` (in `environment`) have incompatible signatures. This is documented in audit 0011 M2 and slice 0028 card. Not a boundary violation — `agentic_core` does not import from `environment`.

### Validation or test drift

| Area | Status |
|------|--------|
| Grant resolver tests (25) | ✅ Aligned with card AC |
| Execution driver tests (38) | ✅ Aligned with card AC |
| Artifact store tests (35) | ✅ Aligned with card AC, includes `parseContentRef` round-trip |
| Retry policy tests (40) | ✅ Exhaustive 24-combination matrix |
| Turn state machine tests (71) | ✅ All 12 transitions covered |
| Episodic memory tests (24) | ✅ Aligned with card AC |
| Prompt compiler tests (~33) | ✅ Aligned with card AC |
| Context selector tests (33) | ✅ Includes `layer_filtered` behavior, ingress prioritization, round-trip validation |
| Compaction policy tests (38) | ✅ Covers inline/externalized/error dispositions, threshold boundary, revision logic |
| Turn governor tests (20) | ✅ Covers all three abort reasons, priority order, determinism, immutability. Uses `vi.useFakeTimers()` per documented pattern |

**Test assertion pattern**: All governor tests use `toEqual` for exact object matching — the strictest pattern. No subset-matching issues.

### Planning-artifact drift

| Finding | Severity | Description |
|---------|----------|-------------|
| M2 | MEDIUM | Backlog Pipeline State says 0031 is "Approved" but slice card says `Approval: pending` |
| M3 | MEDIUM | Slice 0031 Review Log is empty — no planning review recorded |
| L1 | LOW | Backlog Pipeline State retains stale "4 HIGH remain unresolved" language |

**Resolved from audit 0011**: Slice cards 0021/0028/0029 are no longer stale (all show `State: implemented`, `Approval: approved`). Slice 0027 AC now includes `layer_filtered` behavior. Review logs are populated for all implemented slices. Backlog Next Actions and Audit Findings sections are refreshed.

### Deferred-decision leakage

**None found.** All 10 implemented slices operate within frozen MVP constraints:

- Grant resolver: `auto_allow`/`deny` only — no interactive approval workflows
- Execution driver: no-op stub with documented limitations — no subprocess spawning
- Artifact store: local filesystem only — no cloud/blob storage assumptions
- Retry policy: one retry for read-only tools — no multi-retry or write-tool retry
- Turn state machine: exactly 12 spec transitions — no future state assumptions
- Episodic memory: in-process only — no persistence backend assumptions
- Prompt compiler: canonical types only — no provider-native type leakage
- Context selector: layer-based rules — no learned ranking assumptions
- Compaction policy: rule-based truncation — no LLM summarization assumptions
- Turn governor: reads budget from envelope — no hardcoded defaults

Slice 0030 (planned) and 0031 (planned) also respect deferred decisions per their cards.

---

## Missing Tests Or Weak Validation

### Slice 0030 (Validation & Repair) — Not yet implemented

- No `validation-repair.ts` source file exists.
- No validation-repair tests exist.
- The barrel `packages/agentic_core/src/index.ts` has no validation-repair exports.

**Status**: Expected — slice is `State: planned`. The card acceptance criteria have been updated per CRITICAL C1/C2 resolution. Implementation is the next step.

### Slice 0031 (LLM Provider Abstraction) — Not yet implemented

- No `llm-provider.ts` source file exists.
- No llm-provider tests exist.
- The barrel `packages/llm_provider/src/index.ts` contains only `export {};`.

**Status**: Expected — slice is `State: planned`, `Approval: pending`. Implementation awaits approval and prioritization.

### Cross-slice integration gap (previously documented)

- **No integration test between `ArtifactExternalizer` interface and `storeToolArtifact`**: The signature mismatch (M2 from audit 0011) means these modules cannot be directly connected without an adapter. No test demonstrates the adapter pattern. This will need resolution in the core-loop wiring slice.

---

## Stale Or Inconsistent Planning Artifacts

1. **Backlog Pipeline State vs slice 0031 card approval** (M2): Pipeline State says "both approved"; slice 0031 card says `Approval: pending`.
2. **Backlog Pipeline State "4 HIGH remain unresolved"** (L1): Stale language from pre-remediation state.
3. **Slice 0031 Review Log empty** (M3): No planning-level or adversarial review recorded.
4. **Spec `turn-envelope.md` Budget Fields table** (M1): Missing `max_tokens_per_step` — requires human spec edit.

**Artifacts verified as current:**
- All slice cards 0020–0029 have accurate `State` and `Approval` fields matching implementation.
- Backlog Slice Queue entries are accurate for all 31 slices.
- Backlog Next Actions reflect current state (audit 0011 remediation complete, slices 0030–0031 planned).
- Backlog Audit Findings section accurately reflects resolved state for all audit 0011 items.

---

## Deferred-Decision Leakage Or Unsafe Assumptions

**None found.** All 12 slices (10 implemented + 2 planned) operate within frozen MVP constraints and respect all deferred decisions listed in `docs/spec/70-roadmap/deferred-decisions.md`:

- Exact local persistence technology: not assumed by any slice
- Exact initial tool catalog: all slices operate on abstract `ToolDefinition[]`
- Exact DeepSeek endpoint/model: no provider-specific types imported
- Exact compaction size thresholds: configurable via `CompactionOptions.sizeThresholdBytes`
- Maintenance-mode semantics for bedrock mutation: not relevant to implemented slices
- Tool exposure per step (full-registry vs curated): not assumed by any slice

---

## Recommended Corrective Actions

### Should fix before next implementation slice

1. **M1 — Update `docs/spec/20-contracts/turn-envelope.md`**: Add `max_tokens_per_step` (optional, integer) to the Budget Fields table. **Human action required** — the orchestrator cannot edit `docs/spec/`.

2. **M2 — Resolve slice 0031 approval status**: Either update the slice 0031 card to `Approval: approved` (if the backlog's assertion is correct) or update the backlog Pipeline State to reflect `pending` (if the card is correct). The two artifacts must agree.

3. **M3 — Populate slice 0031 Review Log**: Record at minimum a planning-level review entry. If the slice is approved, record the approval rationale and date.

### Nice to fix

4. **L1 — Remove "4 HIGH remain unresolved" from backlog Pipeline State**: Update the audit summary line to reflect the post-remediation state (e.g., "all HIGH resolved, 1 MEDIUM documented and requiring spec edit").

---

## Next-Slice Readiness

- **Verdict**: `ready-with-risks`
- **Blocking issues**: None. All audit 0011 HIGH findings are resolved. The single outstanding MEDIUM (M1 — `max_tokens_per_step` missing from spec) is documented and does not block implementation of slice 0030 or 0031.
- **Risks to note**:
  - M1 (spec incomplete for `max_tokens_per_step`): Low risk. The code is correct and well-tested. The gap is in the spec documentation only. Does not block implementation.
  - M2 (0031 approval inconsistency): Medium risk. An implementer picking up slice 0031 needs clarity on whether it is approved. Resolve the backlog/card inconsistency before implementing.
  - Cross-slice `ArtifactExternalizer` ↔ `storeToolArtifact` adapter (M2 from audit 0011): Will need resolution in the core-loop wiring slice. Not a blocker for slice 0030 or 0031.
- **Safe next implementation actions**:
  - Implement slice 0030 (validation & repair policy) — card is `approved`, all dependencies are in place, spec is clear, CRITICAL C1/C2 resolved. The slice has no dependency on the `max_tokens_per_step` spec gap or the 0031 approval ambiguity.
  - Implement slice 0031 (LLM provider abstraction) — after resolving the approval ambiguity (M2). The interface definition is well-specified, dependencies are clear, and the slice creates the first real module in an empty shell package.
- **Test gate status**: contracts (647), environment (109), gateway (~30), tooling (90), agentic_core (228), runtime (7) — all non-vacuous. 1,100+ total tests pass.

---

## Audit Report Path

`docs/implementation/audits/0012-post-remediation-state.md`
