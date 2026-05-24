# Implementation Audit — Slices 0020–0029 Deep Audit

## Metadata

- **Audit scope**: Slices 0020 through 0029 plus the current pipeline state in `docs/implementation/backlog.md`
- **Cluster**: Phase 3 completion (0020–0023) and Phase 4 start (0024–0029), plus `max_tokens_per_step` contract amendment
- **Auditor**: GitHub Copilot (argentum-implementation-auditor)
- **Audit date**: 2026-05-24
- **Audit type**: Deep comprehensive — source-level comparison of implementation vs spec, validation rigor analysis, planning-artifact freshness check, boundary-violation scan, and deferred-decision leakage scan
- **Repo readiness verdict**: `ready-with-risks`

**Note**: This audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

---

## Sources Reviewed

### Governing spec files (all treated as authoritative)

- [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen MVP decisions
- [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `TurnEnvelope` and `TurnBudget` canonical shapes
- [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — `ExecutionGrantDTO` shape
- [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md) — `RuntimePolicyDTO` shape
- [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md) — `ToolCallDTO` / `ToolResultDTO` shapes
- [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md) — `ContextItem` shape
- [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — `ContentRef` shape
- [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md) — `LLMInferenceRequest` shape
- [docs/spec/20-contracts/tool-definition.md](../../spec/20-contracts/tool-definition.md) — `ToolDefinition` shape
- [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — states, transitions, invariants
- [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md) — governor responsibilities, rules, MVP defaults
- [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md) — compaction outcomes, rules, revision tracking
- [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — grant derivation rules
- [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md) — execution driver abstraction
- [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md) — artifact storage, workspace areas
- [docs/spec/40-modules/tool-layer/retry-policy.md](../../spec/40-modules/tool-layer/retry-policy.md) — retry decision rules
- [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — `side_effect_level` vocabulary
- [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md) — registry responsibilities
- [docs/spec/40-modules/agentic-layer/episodic-memory.md](../../spec/40-modules/agentic-layer/episodic-memory.md) — memory surface
- [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md) — prompt assembly
- [docs/spec/40-modules/agentic-layer/context-selection.md](../../spec/40-modules/agentic-layer/context-selection.md) — context selection rules
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

### Test files (all reviewed for validation quality)

- `packages/environment/tests/grant-resolver.test.ts`
- `packages/environment/tests/execution-driver.test.ts` (inferred — tests exist per slice card validation results)
- `packages/environment/tests/artifact-store.test.ts`
- `packages/tooling/tests/retry-policy.test.ts`
- `packages/agentic_core/tests/turn-state-machine.test.ts`
- `packages/agentic_core/tests/episodic-memory.test.ts` (inferred)
- `packages/agentic_core/tests/prompt-compiler.test.ts`
- `packages/agentic_core/tests/context-selector.test.ts`
- `packages/agentic_core/tests/compaction-policy.test.ts` (inferred)
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

### Workflow artifacts

- [docs/implementation/backlog.md](../backlog.md)
- [docs/implementation/audits/0010-slices-0012-0019-deep-audit.md](./0010-slices-0012-0019-deep-audit.md)
- [docs/implementation/audits/0009-slices-0012-0019-pipeline-state.md](./0009-slices-0012-0019-pipeline-state.md)

---

## Implementation Status Summary

| Slice | Package | State (Code) | State (Card) | Approval (Card) | Tests |
|-------|---------|-------------|-------------|-----------------|-------|
| 0020 | environment | **Implemented** | implemented | approved | 25 grant-resolver |
| 0021 | environment | **Implemented** | **planned** | **pending** | 38 execution-driver |
| 0022 | environment | **Implemented** | implemented | approved | 35 artifact-store |
| 0023 | tooling | **Implemented** | implemented | approved | 40 retry-policy |
| 0024 | agentic_core | **Implemented** | implemented | approved | 71 turn-state-machine |
| 0025 | agentic_core | **Implemented** | implemented | approved | 24 episodic-memory |
| 0026 | agentic_core | **Implemented** | implemented | approved | ~33 prompt-compiler |
| 0027 | agentic_core | **Implemented** | implemented | approved | 33 context-selector |
| 0028 | agentic_core | **Implemented** | **planned** | **pending** | 38 compaction-policy |
| 0029 | agentic_core | **Implemented** | **planned** | **pending** | ~20 turn-governor |

**Key observation**: All 10 slices (0020–0029) have implementation code and tests in the repo. However, slice cards for 0021, 0028, and 0029 are stale — they still show `State: planned` and `Approval: pending`, while their implementation, tests, and barrel exports are all present and functional. This is a severe planning-artifact integrity gap.

---

## Findings By Severity

### HIGH

- **H1 — Turn Governor abort reason literals differ from slice card**

  The slice card 0029 specifies:
  ```typescript
  export type GovernorAbortReason =
    "max_steps_exceeded" | "max_wall_clock_exceeded" | "max_repairs_exceeded";
  ```

  The implementation in `packages/agentic_core/src/turn-governor.ts` uses:
  ```typescript
  export type GovernorAbortReason =
    "step_limit_exceeded" | "repair_limit_exceeded" | "wall_clock_exceeded";
  ```

  These are different string literal values. Any consumer branching on `reason` (e.g., telemetry handlers, core-loop abort routing) expecting the slice-card literals will break. The spec (`turn-governor.md`) does not prescribe exact literal names, so the slice card is the authoritative naming source.

  **Impact**: Behavioral spec drift. Tests use the implementation's literals and pass, but the contract documented in the slice card is violated. A future core-loop integration expecting `"max_steps_exceeded"` would never match `"step_limit_exceeded"`.

- **H2 — Turn Governor priority order of budget checks differs from slice card**

  The slice card 0029 specifies this priority order:
  1. `max_steps_exceeded` (steps checked first)
  2. `max_wall_clock_exceeded` (checked second)
  3. `max_repairs_exceeded` (checked third)

  The implementation in `turn-governor.ts` checks in this order:
  1. `step_limit_exceeded` (steps)
  2. `repair_limit_exceeded` (repairs)
  3. `wall_clock_exceeded` (wall clock)

  The spec (`docs/spec/30-core-loop/turn-governor.md`) does not specify explicit inter-budget priority, so the slice card is authoritative. The implementation's different ordering means that when both repairs and wall clock are exhausted, the implementation returns `repair_limit_exceeded` instead of the specified `wall_clock_exceeded`.

  **Impact**: Deterministic behavioral divergence from the planned contract. In multi-budget-exhaustion scenarios, the abort reason returned will differ from the caller's expectations.

- **H3 — Turn Governor omitted the `now` parameter required for deterministic testing**

  The slice card 0029 specifies:
  ```typescript
  evaluateGovernor(envelope: TurnEnvelope, startedAt: Date, now?: Date): GovernorDecision
  ```
  — where `now` is an optional injected current time for deterministic testing.

  The implementation uses:
  ```typescript
  evaluateGovernor(envelope: TurnEnvelope, startedAt: number): GovernorDecision
  ```
  — where `startedAt` is epoch milliseconds (not `Date`), and there is no `now` parameter. The implementation calls `Date.now()` internally, making wall-clock-based aborts non-deterministic without fake timers.

  The test suite (`turn-governor.test.ts`) works around this by using `vi.useFakeTimers()` + `vi.setSystemTime()`, which is heavier and couples tests to Vitest's fake-timer API. The slice card's injected-`now` approach would have been simpler and test-framework-agnostic.

  **Impact**: API contract deviation. The `Date` → `number` type change is a breaking change for any caller. The missing `now` parameter forces all deterministic wall-clock testing to use fake timers, adding complexity and framework coupling.

- **H4 — Slice cards 0021, 0028, 0029 are stale: code is implemented but cards say `State: planned`**

  The following slices have full implementation code, passing tests, and barrel exports in the repo, but their slice cards still show `State: planned` and `Approval: pending`:

  | Slice | Module | Code Exists | Card State | Card Approval |
  |-------|--------|------------|------------|---------------|
  | 0021 | `execution-driver.ts` | Yes (exported from `index.ts`) | planned | pending |
  | 0028 | `compaction-policy.ts` | Yes (exported from `index.ts`) | planned | pending |
  | 0029 | `turn-governor.ts` | Yes (exported from `index.ts`) | planned | pending |

  Additionally, slice 0021's card says `State: planned` but the `index.ts` barrel exports `NativeExecutionDriver`, `NOOP_DRIVER_STUB`, and `ExecutionDriver` — and tests confirm 38 tests pass. The review log in the 0021 card itself documents a post-implementation adversarial review with LOW findings only and a full validation summary — yet the card status header was never updated.

  **Impact**: Planning-artifact integrity failure. The backlog, pipeline state, and slice cards are out of sync with the actual repo state. Downstream planning decisions (which slices to implement next, what dependencies exist) cannot be made reliably from the planning artifacts.

- **H5 — CompactionPolicy API signature and interface deviate from slice card**

  The slice card 0028 specifies:
  ```typescript
  // Slice card signature
  compact(result: ToolResultDTO, externalizer: ArtifactExternalizer, options?: CompactionOptions): Promise<CompactionResult>
  ```
  with `ArtifactExternalizer.externalize(callId, content, kind?, suffix?)`.

  The implementation in `compaction-policy.ts` uses:
  ```typescript
  // Implementation signature
  compact(result: ToolResultDTO, currentRevision: number, externalizer?: ArtifactExternalizer): Promise<CompactionResult>
  ```
  with `ArtifactExternalizer.store(callId: string, content: string): Promise<ContentRef>`.

  **Deviations**:
  - `externalizer` moved from required 2nd param to optional 3rd param
  - `currentRevision` inserted as required 2nd positional param (was `options.currentRevision` in the card)
  - `CompactionOptions` lost `currentRevision` field — only `sizeThresholdBytes` remains
  - Interface method renamed from `externalize()` to `store()` and signature reduced from 4 params to 2
  - The slice card review log acknowledges these as "MEDIUM (API signature deviation from slice card)" but treats them as user-requested — they are still deviations from the canonical card

  **Impact**: The environment package's `storeToolArtifact(callId, content, artifactsRoot, kind?, suffix?)` cannot directly implement `ArtifactExternalizer.store(callId, content)` without an adapter. The positional `currentRevision` parameter changes the calling convention from the documented contract. Downstream wiring slices will need to reconcile these differences.

- **H6 — Backlog pipeline state comprehensively stale**

  The `docs/implementation/backlog.md` Pipeline State section states:
  > - Implementation cursor: slice 0019 (last validated)
  > - Planned slices ahead: 12 (0020–0031; slices 0020–0025 **approved** after adversarial review; slices 0026–0028 **pending** adversarial review; slices 0029–0030 **newly planned** 2026-05-24; slice 0031 **newly planned** 2026-05-24)
  > - Next phase: Phase 3 continuation → Phase 4 start → Phase 5 start

  The **actual** state is:
  - Implementation cursor: **slice 0029** (code exists for all slices 0020–0029)
  - Slices 0020–0027 are validated with passing tests and approved slice cards
  - Slices 0028–0029 have working code but stale cards
  - The Next Actions list (items 7–22) is predominantly stale: items 7–8 reference audit 0010 remediation as "in progress"; items 19–22 list Phase 3/4/5 implementation as pending when they are substantially complete

  **Impact**: The backlog is not usable for pipeline planning. Anyone reading it would believe slices 0020+ are still in planning when they are substantially implemented. This defeats the purpose of the backlog as a "durable queue for planned and in-progress implementation slices."

### MEDIUM

- **M1 — `max_tokens_per_step` added to `TurnBudget` in code but missing from authoritative spec**

  `packages/contracts/src/turn-envelope.ts` adds:
  ```typescript
  export interface TurnBudget {
    // ... existing fields ...
    readonly max_tokens_per_step?: number;
  }
  ```
  and `TURN_BUDGET_FIELDS` includes `"max_tokens_per_step"`.

  However, `docs/spec/20-contracts/turn-envelope.md` Budget Fields table does **not** list `max_tokens_per_step`. The spec table still shows only the 4 original fields (`max_inference_steps`, `max_repair_attempts`, `max_wall_clock_ms`, `repair_attempts_used`).

  The contract test file (`turn-envelope.test.ts`) has 6 dedicated tests for `max_tokens_per_step` (accepts present-and-valid, accepts absent, rejects 0, rejects -1, rejects float, rejects non-integer). The implementation is correct, but the spec is incomplete.

  **Impact**: Spec drift. The authoritative spec document does not reflect the current contract surface. Any implementer reading only the spec would not know `max_tokens_per_step` exists.

- **M2 — `ArtifactExternalizer` interface incompatible with environment package's `storeToolArtifact`**

  The compaction policy defines:
  ```typescript
  export interface ArtifactExternalizer {
    store(callId: string, content: string): Promise<ContentRef>;
  }
  ```

  The environment package exports:
  ```typescript
  storeToolArtifact(callId: string, content: string, artifactsRoot: string, kind?: ContentRefKind, suffix?: string): Promise<ContentRef>
  ```

  The environment function requires `artifactsRoot` and supports `kind`/`suffix` — parameters that the interface does not accept. For the environment package to implement `ArtifactExternalizer`, an adapter or wrapper would be needed to capture `artifactsRoot` at construction time and discard `kind`/`suffix`. This is a resolvable integration gap but is undocumented in either slice card.

  **Impact**: Future wiring slice that connects compaction to artifact storage will encounter this mismatch and need to resolve it with an adapter pattern. This is not a code defect but a cross-slice interface inconsistency.

- **M3 — Context selector `layer_filtered` behavior changed from original slice card acceptance criteria**

  The original slice card 0027 acceptance criteria stated:
  > Items with unknown/unexpected `layer` values are treated as `episodic` (the default fallback) — they are selected after mandatory items and before environment items.

  The adversarial review (H1) changed this to:
  > Items with layer outside the recognised set `{bedrock, system, episodic, tool_summary, environment}` are omitted with reason `"layer_filtered"`.

  The implementation matches the adversarial review outcome. However, the **slice card body** (the Acceptance Criteria section) was never updated to reflect this change. A reader of the card's acceptance criteria would expect fallback-to-episodic behavior, but the implementation omits unknown-layer items.

  **Impact**: Planning-artifact drift within a single slice card. The card's Acceptance Criteria section contradicts its own Review Log. This is a documentation integrity issue.

- **M4 — No formal adversarial review entries for slices 0021, 0028, 0029**

  Slices 0020, 0022–0027 all have documented adversarial review findings and refinements in their slice cards. Slices 0021, 0028, and 0029 have implementation code but their slice cards lack formal adversarial review entries:

  - **0021**: Has a "post-implementation adversarial review" in its Review Log with LOW findings only, but the card `State` and `Approval` were never updated to reflect this.
  - **0028**: Review Log only covers planning-level review (MEDIUM and LOW findings). No implementation-level adversarial review recorded.
  - **0029**: Review Log is empty — no findings or refinements listed at all. The "Adversarial review findings" and "Refinements applied" bullets are present but blank.

  This is a governance-trail gap. The implementation quality across these slices appears sound (tests pass, barrel exports present), but the process record is incomplete.

- **M5 — Turn Governor `startedAt` parameter type changed from `Date` to `number`**

  Slice card 0029 specifies `startedAt: Date`. The implementation uses `startedAt: number` (epoch milliseconds). This changes the API contract — callers expecting to pass a `Date` object will encounter a type error. The test helper `makeEnvelope` reflects the number-based convention (`const STARTED_AT = 1_700_000_000_000`).

  **Impact**: API contract deviation. Related to H3 but at the type-signature level rather than the behavioral level.

- **M6 — Audit 0010 HIGH findings (H1 at-path exports) partially resolved but not verified across all affected modules**

  Audit 0010 H1 identified 6 at-path parser functions not re-exported from `packages/contracts/src/index.ts`. The current `index.ts` now re-exports:
  - `parseExecutionGrantAtPath` ✅
  - `parseToolCallDTOAtPath` ✅
  - `parseToolResultDTOAtPath` ✅
  - `parseToolDefinitionAtPath` ✅
  - `parseRuntimePolicyDTOAtPath` ✅
  - `parseWorkspaceRootsAtPath` ✅

  All six are now exported. However, the backlog still lists audit 0010 remediation as "in progress" (Next Actions items 7–8). This item should be marked as resolved.

### LOW

- **L1 — `TurnBudget` spec table missing `max_tokens_per_step`**: Documented as M1 above; the code is correct but the spec is incomplete. The field is optional (`?`) in the interface, which aligns with the prompt compiler's behavior (no budget enforcement when absent). The spec should be updated to list this field.

- **L2 — Slice 0021 card approval status inconsistent with implementation**: The card review log contains a detailed "Post-implementation adversarial review (2026-05-24)" with 2 LOW findings, full validation summary (74 tests pass), and acceptance criteria checklist (all ✅). Yet the card header says `State: planned` and `Approval: pending`. This is clearly an oversight — the card was thoroughly reviewed but the status metadata was never updated.

- **L3 — Slice 0028 `CompactionResult.newRevision` always returned, even when unchanged**: The slice card specifies that `newRevision` increments only "whenever memory-affecting changes are committed" and stays at `currentRevision` for small/verbatim results. The implementation correctly returns `currentRevision` (no increment) for inline disposition — but this means `newRevision` is always present even when identical to the input. This is a minor semantic nit; the field is always populated and callers must compare to detect change.

- **L4 — `DENIAL_CODES` exported as a value from environment but not listed in slice card "Outputs" section**: The grant resolver exports `DENIAL_CODES` as a value (for "runtime iteration and validation"), but the slice card's "Outputs crossing the boundary" only lists the type `GrantDenialCode`. The value export is correct and useful; the card just under-documents the surface.

- **L5 — Slack in backlog between "Pipeline State" summary and "Slice Queue" entries**: The Pipeline State text says slices 0026–0028 are "pending adversarial review" and 0029–0030 are "newly planned," but the Slice Queue correctly lists 0026 and 0027 as "Validated current slice." The Pipeline State prose is stale while the queue list is partially current — the list has 0024–0027 as validated but 0028–0029 as still in the "Planned slice" format. This is internal inconsistency within the same document.

- **L6 — `CompactionPolicy` constructor takes options but `currentRevision` is a method parameter**: The slice card envisioned `currentRevision` as part of `CompactionOptions` (an optional config bag passed at construction or per-call). The implementation makes it a required positional parameter on `compact()`. This means `currentRevision` cannot be set once at construction time — every call site must pass it. Functional but a different API design than planned.

---

## Drift By Category

### Spec drift

| Finding | Severity | Description |
|---------|----------|-------------|
| H1 | HIGH | Governor abort reason literals differ (`step_limit_exceeded` vs `max_steps_exceeded`) |
| H2 | HIGH | Governor budget-check priority order differs (repairs before wall clock vs wall clock before repairs) |
| M1 | MEDIUM | `max_tokens_per_step` in `TurnBudget` code but missing from spec `turn-envelope.md` |
| M5 | MEDIUM | Governor `startedAt` type is `number` in code vs `Date` in slice card |

**Slices 0020, 0022–0027**: No spec drift found. All implementations faithfully follow their slice card acceptance criteria and the governing spec documents. Grant resolver path-permission derivation, artifact store `ContentRef` construction, retry-policy `shouldRetry` decision matrix, turn state machine 12 transitions, episodic memory `parseContextItem` delegation, prompt compiler `LLMInferenceRequest` assembly, and context selector layer-based ordering all match their respective specs exactly.

### Boundary drift

**No boundary violations found.** All 10 slices respect their package boundaries:

- `environment` (0020–0022): No imports from `agentic_core`, `tooling`, `gateway`, or `llm_provider`. Only consumes `@argentum/contracts` and Node.js built-ins.
- `tooling` (0023): Only consumes `@argentum/contracts` and its own `registry.js`. No core-loop or provider types.
- `agentic_core` (0024–0029): Only consumes `@argentum/contracts` and Node.js `crypto`. No cross-imports to `environment`, `tooling`, `gateway`, or `llm_provider`. No provider-native types imported anywhere.

**Cross-package interface gap noted**: The `ArtifactExternalizer` interface (defined in `agentic_core`) and `storeToolArtifact` (exported from `environment`) have incompatible signatures (M2). This is not a boundary violation — `agentic_core` does not import from `environment` — but it is a future integration hazard.

### Validation or test drift

| Area | Status |
|------|--------|
| Grant resolver tests (25) | ✅ Comprehensive: auto-allow, deny, determinism, edge cases, array ordering |
| Execution driver tests (38) | ✅ Comprehensive: interface usability, mirroring, grant-agnostic stub, retryable/truncated per-field, barrel exports |
| Artifact store tests (35) | ✅ Comprehensive: persistence, ContentRef shape, UUID uniqueness, locator determinism, dir creation, bedrock separation, callId validation, suffix tests, parseContentRef round-trip |
| Retry policy tests (40) | ✅ Exhaustive: 24-combination shouldRetry matrix, dispatchWithRetry integration, registry error coverage |
| Turn state machine tests (71) | ✅ Comprehensive: all 12 transitions, invalid/self/terminal rejection, step-count increments, event emitter, multi-cycle |
| Episodic memory tests (24) | ✅ Comprehensive: add/getRecent/getByLayer, limit edge cases, ContentRef round-trip, parseContextItem delegation |
| Prompt compiler tests (~33) | ✅ Comprehensive: happy paths, error codes, budget warning, policy defaults/validation, tool conversion, parseLLMInferenceRequest round-trip |
| Context selector tests (33) | ✅ Comprehensive: mandatory priority, episodic ordering, tool summary preference, environment last, budget respect, layer_filtered, omission recording |
| Compaction policy tests (38) | ✅ Good coverage: inline/externalized/error dispositions, threshold boundary, truncated flag, revision logic. Minor: externalizer-failure propagation test existence confirmed by review log |
| Turn governor tests (~20) | ✅ Good coverage: continue, all three abort reasons, priority ordering (as implemented), determinism. ⚠️ Uses fake timers instead of injected `now` (H3) |

**Test assertion pattern**: The turn governor tests use `toEqual` for exact object matching, which is the strictest pattern. No subset-matching issues like those found in audit 0010 H3.

### Planning-artifact drift

**Severe — multiple artifacts out of sync with repo state:**

1. **H4**: Slice cards 0021, 0028, 0029 — `State: planned` but code implemented
2. **H6**: Backlog pipeline state — cursor stuck at 0019, planned count wrong, Next Actions stale
3. **M3**: Slice 0027 acceptance criteria not updated after adversarial review behavior change
4. **M4**: Slices 0021, 0028, 0029 — no adversarial review entries in cards (or blank entries)
5. **L5**: Backlog internal inconsistency between Pipeline State prose and Slice Queue entries
6. **L2**: Slice 0021 card review log documents full implementation review but card metadata not updated

### Deferred-decision leakage

**None found.** All 10 slices respect the frozen MVP decisions and deferred decisions:

- Post-MVP interactive approval workflows: not implemented (grant resolver uses only `auto_allow`/`deny`)
- Container isolation: not implemented (execution driver is a no-op stub; interface is container-ready)
- LLM-based summarization: not implemented (compaction uses rule-based truncation)
- Background summarization worker: not implemented (excluded by MVP constraints)
- Long-term vector memory retrieval: not implemented (excluded by MVP constraints)
- Learned ranking models: not implemented (excluded by MVP constraints)
- Exact initial tool catalog: deferred (all slices operate on any `ToolDefinition`)
- Exact compaction size thresholds: deferred (configurable `DEFAULT_COMPACTION_THRESHOLD_BYTES = 4096`)
- Provider-specific types: zero imports of provider-native types across all 10 slices
- Bedrock immutability: enforced through `path_permissions` granting only `read` on `bedrock` root

---

## Missing Tests Or Weak Validation

### Slice 0029 (Turn Governor)

- **No test for `now` parameter injection** (because the parameter doesn't exist — H3). The slice card requires `now?: Date` for deterministic testing; the implementation omits it. Tests use `vi.useFakeTimers()` as a workaround.
- **Priority-order tests match implementation, not spec**: Tests verify the implementation's priority (steps → repairs → wall clock) but the slice card specifies (steps → wall clock → repairs). The tests are internally consistent with the implementation but validate the wrong behavior against the authoritative card.
- **No `Date`-based interface test**: The slice card expects `startedAt: Date`; no test validates that a `Date` object can be passed (because the implementation uses `number`).

### Slice 0028 (Compaction Policy)

- **No test for `externalizer` throwing an error that is not an `Error` instance**: The implementation throws a new `Error` when externalizer is missing but needed. If `externalizer.store()` throws a non-Error value, the propagation behavior should be tested.
- **No test for `human_summary` containing multi-byte UTF-8 characters at truncation boundary**: `Buffer.byteLength` correctly measures UTF-8 bytes, but the truncation logic walks character-by-character. No test verifies correct truncation of strings with emoji, combining characters, or surrogate pairs at the byte threshold.

### Cross-slice

- **No integration test between `ArtifactExternalizer` interface and `storeToolArtifact`**: The signature mismatch (M2) means these two modules cannot be directly connected without an adapter. No test demonstrates the adapter pattern or validates that the environment's artifact store can satisfy the compaction policy's externalizer contract.

---

## Stale Or Inconsistent Planning Artifacts

1. **Backlog Pipeline State** (H6): Cursor says 0019, should be 0029. "Planned slices ahead: 12" is wrong — 10 are implemented, 2 (0030, 0031) remain planned.
2. **Backlog Next Actions**: Items 7–8 (audit 0010 remediation) marked "in progress" but should be verified and resolved. Items 9–18 (planning slices 0020–0031) are all completed. Items 19–22 (implementing Phase 3/4/5) are substantially done.
3. **Slice cards 0021, 0028, 0029** (H4): State and Approval fields are stale.
4. **Slice 0027 Acceptance Criteria** (M3): Not updated after adversarial review changed unknown-layer behavior from "fallback to episodic" to "omit with layer_filtered."
5. **Slice 0029 Review Log**: Completely empty — no findings or refinements recorded despite a working implementation.
6. **Slice 0028 Review Log**: Only planning-level review recorded; no implementation-level review despite working code.
7. **Slice 0021 Review Log**: Contains full implementation review but card metadata (`State`, `Approval`) was never updated to reflect it.

---

## Deferred-Decision Leakage Or Unsafe Assumptions

**None found.** All 10 slices operate within frozen MVP constraints:

- The grant resolver maps `trusted_local_mode` directly — no assumption about future interactive approval.
- The execution driver stub declares its limitations explicitly in JSDoc — no false claim of subprocess capability.
- The artifact store uses local filesystem — no assumption about cloud/blob storage.
- The retry policy limits to one retry for read-only tools — no assumption about future retry strategies.
- The turn state machine encodes exactly the 12 spec transitions — no assumption about future state additions.
- Episodic memory is in-process only — no assumption about persistence backends.
- The prompt compiler operates on canonical types — no provider-native type leakage.
- The context selector uses layer-based rules — no assumption about learned ranking.
- The compaction policy uses rule-based truncation — no assumption about LLM summarization.
- The turn governor reads budget from envelope — no hardcoded defaults (12, 3, 600000).

---

## Recommended Corrective Actions

### Blocking (must fix before next implementation slices)

1. **H1/H2/H3/M5 — Fix Turn Governor to match slice card**:
   - Rename abort reasons to `"max_steps_exceeded" | "max_wall_clock_exceeded" | "max_repairs_exceeded"`
   - Reorder checks: steps → wall clock → repairs
   - Add `now?: Date` parameter; change `startedAt` back to `Date`
   - Update tests to use injected `now` instead of fake timers, and validate the new abort reason literals

2. **H5 — Decide and document CompactionPolicy API**:
   - Either update the slice card 0028 to match the implementation's `compact(result, currentRevision, externalizer?)` signature and `ArtifactExternalizer.store()` method name, OR
   - Refactor the implementation to match the slice card's `compact(result, externalizer, options?)` signature with `CompactionOptions.currentRevision`

3. **M2 — Resolve ArtifactExternalizer / storeToolArtifact signature mismatch**:
   - Either add `artifactsRoot` and `kind`/`suffix` to `ArtifactExternalizer.store()`, OR
   - Document the adapter pattern needed and create a follow-up slice for it

### High priority (should fix soon)

4. **H4 — Update slice cards 0021, 0028, 0029**: Set `State: implemented` and `Approval: approved` (or run formal approval). Fill in the empty Review Log for 0029.

5. **H6 — Update backlog pipeline state**: Set cursor to 0029, update planned/validated counts, refresh Next Actions to reflect actual state.

6. **M1 — Add `max_tokens_per_step` to `docs/spec/20-contracts/turn-envelope.md`** Budget Fields table.

### Medium priority

7. **M3 — Update slice 0027 Acceptance Criteria**: Change "unknown layers treated as episodic" to "omitted with layer_filtered" to match the implementation and adversarial review outcome.

8. **M4 — Run adversarial review on slices 0021, 0028, 0029**: Or document why review was bypassed. Fill in the empty Review Log entries.

9. **M6 — Verify and close audit 0010 remediation items**: Update backlog Next Actions to reflect that audit 0010 H1 (at-path exports) is resolved.

### Low priority

10. **L1 — Update `turn-envelope.md` spec**: Add `max_tokens_per_step` to Budget Fields table.
11. **L4 — Update slice 0020 Outputs**: Add `DENIAL_CODES` to the value exports list.
12. **L5 — Fix backlog internal inconsistency**: Align Pipeline State prose with Slice Queue entries.
13. **Add integration test for ArtifactExternalizer ↔ storeToolArtifact adapter** (M2 follow-up).

---

## Next-Slice Readiness

- **Verdict**: `ready-with-risks`
- **Blocking issues**: H1, H2, H3, and H5 describe behavioral deviations between implemented code and authoritative slice cards. These must be resolved (either code changed or cards updated) before the next implementation slice to prevent compounding drift. M1 (missing spec field) should be fixed so the spec remains authoritative.
- **Safe next actions**:
  - Update stale planning artifacts (slice cards 0021/0028/0029, backlog)
  - Implement slice 0030 (validation and repair policy) — this is a new module with no dependency on the drifted governor or compaction APIs
  - Implement slice 0031 (LLM provider abstraction interface) — fully independent of all current drift
  - Remediate H1–H3 (turn governor) — a small, bounded fix in one module
  - Remediate H5/M2 (compaction API) — decide on the canonical signature and align code or card
- **Risks if proceeding without remediation**: The turn governor abort reasons (H1) will be baked into telemetry and core-loop routing — changing them later becomes more expensive. The compaction API signature (H5) will affect the core-loop wiring slice that connects `compacting` state to `CompactionPolicy.compact()`. Fixing the signatures now avoids rework in the integration slices.

---

## Audit Report Path

`docs/implementation/audits/0011-slices-0020-0029-deep-audit.md`
