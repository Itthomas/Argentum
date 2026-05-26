# Implementation Audit — Slices 0030–0038 + Pipeline State

## Metadata

- **Audit scope**: Slices 0030 (Validation & Repair), 0031 (LLM Provider Interface), 0032 (Tool Schema Projection), 0033 (DeepSeek Adapter), 0034 (Core Loop Orchestrator), 0035 (CLI Input Normalization), 0036 (Terminal Rendering), 0037 (Composition Root & E2E), 0038 (Telemetry Event Persistence), plus current pipeline state in `docs/implementation/backlog.md`
- **Cluster**: Phase 4 agentic core (0030, 0034), Phase 5 LLM provider (0031–0033), Phase 6 CLI channel (0035–0036), Phase 6/7 composition & E2E (0037), Phase 7 telemetry (0038)
- **Auditor**: GitHub Copilot (argentum-implementation-auditor)
- **Audit date**: 2026-05-24
- **Audit type**: Implementation-vs-spec comparison, planning-artifact freshness check, boundary-violation scan, deferred-decision leakage scan, test-gap analysis
- **Prior audit**: [0013-slices-0030-0033-pipeline-state.md](./0013-slices-0030-0033-pipeline-state.md)
- **Repo readiness verdict**: `ready-with-risks`

**Note**: This audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow.

---

## Sources Reviewed

### Governing spec files (all treated as authoritative)

- [docs/spec/README.md](../spec/README.md)
- [docs/spec/00-overview/mvp-scope.md](../spec/00-overview/mvp-scope.md)
- [docs/spec/10-architecture/eventing-model.md](../spec/10-architecture/eventing-model.md)
- [docs/spec/10-architecture/runtime-lifecycle.md](../spec/10-architecture/runtime-lifecycle.md)
- [docs/spec/10-architecture/system-context.md](../spec/10-architecture/system-context.md)
- [docs/spec/20-contracts/canonical-contracts.md](../spec/20-contracts/canonical-contracts.md)
- [docs/spec/20-contracts/turn-envelope.md](../spec/20-contracts/turn-envelope.md)
- [docs/spec/20-contracts/action-decision.md](../spec/20-contracts/action-decision.md)
- [docs/spec/20-contracts/llm-adapter-contract.md](../spec/20-contracts/llm-adapter-contract.md)
- [docs/spec/20-contracts/stream-event.md](../spec/20-contracts/stream-event.md)
- [docs/spec/20-contracts/ingress-contract.md](../spec/20-contracts/ingress-contract.md)
- [docs/spec/30-core-loop/core-loop-state-machine.md](../spec/30-core-loop/core-loop-state-machine.md)
- [docs/spec/30-core-loop/validation-and-repair.md](../spec/30-core-loop/validation-and-repair.md)
- [docs/spec/40-modules/llm-provider/provider-abstraction.md](../spec/40-modules/llm-provider/provider-abstraction.md)
- [docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md](../spec/40-modules/llm-provider/deepseek-adapter-mvp.md)
- [docs/spec/40-modules/llm-provider/provider-normalization.md](../spec/40-modules/llm-provider/provider-normalization.md)
- [docs/spec/40-modules/channel-cli/cli-adapter-mvp.md](../spec/40-modules/channel-cli/cli-adapter-mvp.md)
- [docs/spec/40-modules/channel-cli/terminal-rendering.md](../spec/40-modules/channel-cli/terminal-rendering.md)
- [docs/spec/40-modules/gateway/telemetry.md](../spec/40-modules/gateway/telemetry.md)
- [docs/spec/50-implementation/package-boundaries.md](../spec/50-implementation/package-boundaries.md)
- [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md)
- [docs/spec/70-roadmap/deferred-decisions.md](../spec/70-roadmap/deferred-decisions.md)

### Implementation files (all reviewed)

- `packages/agentic_core/src/validation-repair.ts` — slice 0030 (163 lines)
- `packages/agentic_core/src/core-loop-orchestrator.ts` — slice 0034 (~420 lines)
- `packages/agentic_core/src/turn-state-machine.ts` — `ALLOWED_TRANSITIONS` map
- `packages/agentic_core/src/index.ts` — barrel exports
- `packages/llm_provider/src/llm-provider.ts` — `LLMProvider` + `LLMProviderError` (slice 0031)
- `packages/llm_provider/src/tool-schema-projection.ts` — `projectToolSchemas` + `DeepSeekToolSchema` (slice 0032)
- `packages/llm_provider/src/content-resolver.ts` — `ContentResolver` + `TraceWriter` types (slice 0033)
- `packages/llm_provider/src/deepseek-adapter.ts` — `DeepSeekAdapter` class, ~550 lines (slice 0033)
- `packages/llm_provider/src/index.ts` — barrel exports
- `packages/channel_cli/src/cli-input-normalizer.ts` — `normalizeCliInput` + `CliInputError` (slice 0035)
- `packages/channel_cli/src/terminal-renderer.ts` — `renderStreamEvent` (slice 0036)
- `packages/channel_cli/src/index.ts` — barrel exports
- `packages/telemetry/src/telemetry-writer.ts` — `TelemetryWriter` class (slice 0038)
- `packages/telemetry/src/index.ts` — barrel exports
- `packages/gateway/src/gateway-facade.ts` — `Gateway` facade class (slice 0037 dependency)
- `packages/gateway/src/index.ts` — barrel exports
- `apps/runtime/src/composition-root.ts` — `startRuntime` + `RuntimeContext` (slice 0037)
- `apps/runtime/src/mock-llm-provider.ts` — `MockLLMProvider` (slice 0037)
- `apps/runtime/src/index.ts` — barrel exports

### Test files (all reviewed)

- `packages/agentic_core/tests/validation-repair.test.ts` — 32 tests (slice 0030)
- `packages/agentic_core/tests/core-loop-orchestrator.test.ts` — ~28 tests (slice 0034)
- `packages/llm_provider/tests/llm-provider.test.ts` — 15 tests (slice 0031)
- `packages/llm_provider/tests/tool-schema-projection.test.ts` — 9 tests (slice 0032)
- `packages/llm_provider/tests/deepseek-adapter.test.ts` — ~30 tests (slice 0033)
- `packages/channel_cli/tests/cli-input-normalizer.test.ts` — ~17 tests (slice 0035)
- `packages/channel_cli/tests/terminal-renderer.test.ts` — ~28 tests (slice 0036)
- `packages/telemetry/tests/telemetry-writer.test.ts` — ~17 tests (slice 0038)
- `apps/runtime/tests/e2e-happy-path.test.ts` — 4 tests (slice 0037)

### Slice cards

- [0030-agentic-core-validation-repair-policy.md](../slices/0030-agentic-core-validation-repair-policy.md)
- [0031-llm-provider-abstraction-interface.md](../slices/0031-llm-provider-abstraction-interface.md)
- [0032-llm-provider-tool-schema-projection.md](../slices/0032-llm-provider-tool-schema-projection.md)
- [0033-llm-provider-deepseek-adapter.md](../slices/0033-llm-provider-deepseek-adapter.md)
- [0034-agentic-core-core-loop-orchestrator.md](../slices/0034-agentic-core-core-loop-orchestrator.md)
- [0035-channel-cli-input-normalization.md](../slices/0035-channel-cli-input-normalization.md)
- [0036-channel-cli-terminal-rendering.md](../slices/0036-channel-cli-terminal-rendering.md)
- [0037-runtime-composition-root-e2e-happy-path.md](../slices/0037-runtime-composition-root-e2e-happy-path.md)
- [0038-telemetry-event-persistence.md](../slices/0038-telemetry-event-persistence.md)

### Workflow artifacts

- [docs/implementation/backlog.md](../backlog.md)
- [docs/implementation/audits/0013-slices-0030-0033-pipeline-state.md](./0013-slices-0030-0033-pipeline-state.md)
- [docs/implementation/audits/0012-post-remediation-state.md](./0012-post-remediation-state.md)

---

## Implementation Status Summary

| Slice | Package | State (Code) | State (Card) | Approval (Card) | Tests (approx.) |
|-------|---------|-------------|-------------|-----------------|-----------------|
| 0030 | agentic_core | **Implemented** | validated | approved | 32 |
| 0031 | llm_provider | **Implemented** | validated | approved | 15 |
| 0032 | llm_provider | **Implemented** | validated | approved | 9 |
| 0033 | llm_provider | **Implemented** | validated | approved | ~30 |
| 0034 | agentic_core | **Implemented** | validated | approved | ~28 |
| 0035 | channel_cli | **Implemented** | validated | approved | ~17 |
| 0036 | channel_cli | **Implemented** | validated | approved | ~28 |
| 0037 | apps/runtime | **Implemented** | validated | approved | 4 |
| 0038 | telemetry | **Implemented** | implemented (pending validation) | pending | ~17 |

**Key observation**: All nine slices (0030–0038) have complete, non-trivial implementation code with comprehensive tests. The implementation pipeline has advanced significantly since audit 0013 — slices 0034–0038 are now fully implemented where they were previously only planned. Slice 0038 is the only slice with a pending approval. The backlog has not been updated to reflect all slices as implemented.

---

## Findings By Severity

### HIGH

- **H1 — Spec `core-loop-state-machine.md` missing `building_context → aborted` and `inferring → aborted` transitions**

  The implementation in `turn-state-machine.ts` includes both transitions:
  - `["building_context", new Set(["inferring", "aborted"])]`
  - `["inferring", new Set(["validating", "aborted"])]`

  The orchestrator (slice 0034) uses `building_context → aborted` for governor pre-inference aborts and `inferring → aborted` for LLM provider failures. However, the authoritative spec file `docs/spec/30-core-loop/core-loop-state-machine.md` only lists:
  - `building_context -> inferring` (not `aborted`)
  - `inferring -> validating` (not `aborted`)

  Slice 0034's card explicitly declares this spec update as a prerequisite: *"Per 2026-05-24 human decision (Option A), this spec must be updated to include `building_context → aborted` (governor pre-inference abort) and `inferring → aborted` (provider failure)."* The code implements these transitions correctly, but the spec has not been updated.

  **Impact**: Future implementers referencing the spec will see an incomplete state machine that does not match the implemented behavior. The spec is the authoritative source of truth per project guidelines.

- **H2 — Spec `core-loop-state-machine.md` missing `executing_tools → aborted` transition**

  The implementation includes `["executing_tools", new Set(["compacting", "aborted"])]` in `ALLOWED_TRANSITIONS`. The orchestrator (slice 0034) uses this transition when tool execution fails mid-cycle (tool returns error, executor throws, etc.). The spec only lists `executing_tools -> compacting`.

  This is a third transition gap in the state machine spec. Unlike H1, this transition was not explicitly declared as a prerequisite in any slice card — it appears to have been added during implementation without a corresponding spec update.

  **Impact**: Same as H1 — spec drift between the implemented state machine and the authoritative spec.

- **H3 — Backlog Slice Queue has duplicate entries for slices 0030–0033**

  The Slice Queue section of `docs/implementation/backlog.md` lists slices 0030–0033 twice each: once as "Validated current slice" and again as "Planned slice (approved...)". Example:
  - `Validated current slice: [docs/implementation/slices/0030-agentic-core-validation-repair-policy.md]`
  - `Planned slice (approved, CRITICAL C1/C2 resolved 2026-05-24): [docs/implementation/slices/0030-agentic-core-validation-repair-policy.md]`

  This creates ambiguity about the current state of these slices. The implementation code and slice cards confirm all four are validated and implemented.

  **Impact**: Pipeline management confusion — a reader cannot determine from the Slice Queue alone whether 0030–0033 are validated or planned.

- **H4 — Slice 0038 approval status is stalled at "pending" despite full implementation**

  The slice 0038 card shows `State: implemented (pending validation)`, `Approval: pending`. The code is fully implemented with ~17 tests. The backlog Pipeline State says `0038: State: implemented (pending validation)` but provides no action item to unblock the pending state. The "Next Actions" section (#20) says "Pipeline buffer stands at 5 slices ahead of cursor (0034–0038)" — treating 0038 as ahead-of-cursor rather than implemented.

  **Impact**: Slice 0038 is in limbo — implemented but neither validated nor approved. This blocks the telemetry package from being considered production-ready and creates uncertainty about whether the pipeline is truly at 5 ahead-of-cursor or 0 ahead-of-cursor (if all slices are implemented).

### MEDIUM

- **M1 — Slice 0036 card header has blank "Approved by" and "Approval date"**

  The card shows `Approval: approved` but `Approved by:` and `Approval date:` are empty. All other approved cards (0030–0035, 0037) have populated these fields.

  **Impact**: Minor metadata gap — no traceability for who approved this slice or when.

- **M2 — `cli-adapter-mvp.md` spec still references `IngressDTO` instead of `ChannelIngressPayload`**

  The spec says: *"Each accepted terminal input is normalized into one `IngressDTO` containing exactly one `MessagePart` with `kind = text`."* The implementation (per CRITICAL C1 resolution, Option A) uses `ChannelIngressPayload` (omitting `ingress_id` and `session_id`), with the gateway constructing the final `IngressDTO`. The slice 0035 card documents this decision, but the authoritative spec has not been updated.

  **Impact**: Spec drift — the spec describes a different contract boundary than what is implemented. This was an approved architectural decision but the spec update was overlooked.

- **M3 — No E2E failure-path tests; only happy path covered**

  The test strategy spec requires *"failure-path tests for repair exhaustion and budget exhaustion"* and *"end-to-end happy-path CLI tests for one full turn."* The E2E test (`apps/runtime/tests/e2e-happy-path.test.ts`) covers the happy path with 4 tests (full turn, RuntimeContext shape verification, independent sessions, MockLLMProvider validation). The orchestrator unit tests (~28 tests) cover governor abort, LLMProviderError, repair cycles, safety counters, and abort decisions at the unit level. However, there are no integration-level E2E tests for:
  - LLM provider failure → turn abort
  - Governor step limit → turn abort
  - Governor wall clock → turn abort
  - Repair exhaustion → turn abort
  - Tool execution failure → turn abort
  - Queue overflow → ingress rejection

  **Impact**: The failure-path coverage exists at the unit level but not at the integration/E2E level. The test strategy's requirement for "failure-path tests" could be interpreted as satisfied by the orchestrator unit tests, but explicit E2E failure-path tests would strengthen confidence in the full pipeline's error handling.

- **M4 — `composition-root.ts` EpisodicMemory seeding is undocumented in slice card**

  The composition root seeds episodic memory with a `system:argentum-boot` context item to prevent `EMPTY_CONTEXT_ITEMS` errors from the prompt compiler on the first inference step. This is a practical bootstrapping workaround but is not documented in slice 0037's acceptance criteria, plan, or review log.

  **Impact**: Future maintainers may not understand why this seeding exists or whether it can be safely removed when ingress context handling is improved.

- **M5 — Backlog Pipeline State section not updated to reflect all slices as implemented**

  The Pipeline State says *"7 slices planned this session (0030–0033 implemented; 0034–0038 planned)"* and *"Implementation cursor: slice 0033 (last validated)."* In reality, all slices 0030–0038 are implemented. The implementation cursor should be at slice 0038 (or beyond). The "Planned slices ahead of cursor: 5 (0034, 0035, 0036, 0037, 0038)" is stale — these are now implemented.

  **Impact**: Pipeline visibility is degraded. A reader consulting the backlog would believe 5 slices remain to be implemented when they are already done.

### LOW

- **L1 — `normalizeCliInput` does not validate `MessagePart.kind`**

  The structural validation checks that `message_parts` is non-empty and `message_parts[0].text` is non-empty after trimming. However, it does not verify that `message_parts[0].kind === "text"`. The kind is hardcoded as `"text" as const` in the implementation, so a non-text kind would require a programming error, not a runtime data issue. No behavior impact.

- **L2 — `MockLLMProvider` returns hardcoded `decision_id: "mock-decision-001"`**

  Every call to `MockLLMProvider.infer()` returns the same `decision_id`. This is fine for single-step E2E tests but would cause `context_id` collisions in episodic memory if the mock were used for multi-step turns (the orchestrator would store multiple entries with identical `context_id` values). The mock is explicitly single-use for the E2E happy path.

- **L3 — `Gateway` facade `close()` method not listed in slice 0037 acceptance criteria**

  The `Gateway` facade class has a `close()` method that calls `this.#database.close()`. The composition root calls `gateway.close()` in the `shutdown` function. This method is essential for graceful teardown but is not enumerated in slice 0037's acceptance criteria or the "Gateway facade class" description in the plan.

- **L4 — Backlog "Next Actions" item #13 says "Refill pipeline to 6-7 planned/approved slices ahead of cursor"**

  This action item is stale — all slices 0030–0038 are now implemented, so the pipeline buffer concept (ahead-of-cursor) is moot. The next planning action should focus on slices beyond 0038.

---

## Drift By Category

### Spec Drift

| ID | Spec File | Issue | Implemented Behavior |
|----|-----------|-------|---------------------|
| SD-1 | `core-loop-state-machine.md` | Missing `building_context → aborted` | Present in `turn-state-machine.ts`; used by orchestrator for governor pre-inference abort |
| SD-2 | `core-loop-state-machine.md` | Missing `inferring → aborted` | Present in `turn-state-machine.ts`; used by orchestrator for LLM provider failure |
| SD-3 | `core-loop-state-machine.md` | Missing `executing_tools → aborted` | Present in `turn-state-machine.ts`; used by orchestrator for tool execution failure |
| SD-4 | `cli-adapter-mvp.md` | References `IngressDTO` as channel output | Channel returns `ChannelIngressPayload`; gateway constructs `IngressDTO` (per approved C1 resolution) |

**Verdict**: Three state machine transitions are missing from the authoritative spec. The CLI spec references an outdated contract boundary. No spec drift was found in the contract layer, validation policy, provider abstraction, or telemetry specs.

### Boundary Drift

No boundary violations detected. Package dependencies follow the DAG pattern prescribed by `package-boundaries.md`:
- `channel_cli` depends only on `contracts` — no provider or gateway imports
- `llm_provider` depends only on `contracts` — no gateway, agentic_core, or channel imports
- `agentic_core` depends on `contracts` and `llm_provider` (for `LLMProvider` interface + `LLMProviderError`) — correct dependency direction
- `telemetry` depends only on `contracts` — no cross-package implementation imports
- `apps/runtime` depends on all packages — the composition root is the top-level wiring point

The `composition-root.ts` imports `resolveGrant` from `@argentum/environment` to build the `ToolCallExecutor` bridge. This is a documented boundary crossing (the runtime package wires environment capabilities into the tool execution bridge) and follows the package-boundaries intent.

### Validation or Test Drift

- **Test coverage is strong at the unit level**: All implemented modules have focused tests covering happy paths, error paths, edge cases, and contract compliance.
- **E2E test coverage is narrow**: Only the happy path (respond decision) is tested at the E2E level. Failure paths are covered at the unit level but not integrated end-to-end.
- **`normalizeCliInput` structural validation is minimal**: Checks `message_parts` non-emptiness and `text` non-emptiness but does not validate `kind === "text"`. The kind is hardcoded, so this is not a runtime risk.
- **Contract round-trip tests exist**: `deepseek-adapter.test.ts` includes `parseActionDecision` and `parseLLMInferenceResult` round-trip tests. `telemetry-writer.test.ts` includes `parseStreamEvent` round-trip tests.

### Planning-Artifact Drift

- **Backlog Slice Queue**: Duplicate entries for 0030–0033 (validated + planned)
- **Backlog Pipeline State**: "0034–0038 planned" — all are now implemented
- **Backlog Implementation Cursor**: "slice 0033 (last validated)" — should be 0038
- **Slice 0036 Card**: Blank "Approved by" and "Approval date" despite approved status
- **Slice 0038 Card**: "pending validation" and "pending approval" despite implementation completion
- **Next Actions**: Several items reference planning/completing slices that are now done (e.g., #11 "Plan Phase 5 slice 0032", #12 "Plan Phase 5 slice 0033", #13 "Refill pipeline")

### Deferred-Decision Leakage

**No deferred-decision leakage detected.** All deferred items from `docs/spec/70-roadmap/deferred-decisions.md` remain properly deferred:
- Exact DeepSeek endpoint and model selection — configured via `DeepSeekAdapterConfig`, not hardcoded
- Exact initial tool catalog — `ToolRegistry` is populated at composition time; no hardcoded catalog
- Exact compaction size thresholds — defaults in `CompactionPolicy` are overridable
- Whether tool exposure per step is full-registry or curated subset — `availableTools` is injected via constructor
- Maintenance-mode semantics for bedrock mutation — no bedrock write paths exist

---

## Missing Tests Or Weak Validation

### Missing Tests

1. **E2E failure-path tests** (M3 above): No integrated tests for LLM provider failure, governor exhaustion, repair exhaustion, tool failure, or queue rejection at the E2E level.
2. **`channel_cli` package entrypoint smoke test**: The slice 0035 card specifies verifying exports (`typeof normalizeCliInput === "function"`, etc.) but the test file focuses on behavior tests. A simple entrypoint smoke test is absent.

### Weak Validation

1. **`normalizeCliInput` kind validation** (L1 above): Does not verify `MessagePart.kind === "text"`.
2. **`MockLLMProvider` idempotency** (L2 above): Returns identical `decision_id` for every call.
3. **`DeepSeekAdapter.buildMessages()` non-null assertion**: The `this.config.resolveContent!` assertion is technically sound (guarded by the earlier throw on missing resolver) but fragile to refactoring.

---

## Stale Or Inconsistent Planning Artifacts

1. **Backlog Slice Queue** — Duplicate entries for 0030–0033 (appear as both "Validated current slice" and "Planned slice")
2. **Backlog Pipeline State** — Says 0034–0038 are "planned" but all are implemented; cursor at "0033" should be "0038"
3. **Backlog Next Actions** — Items #11, #12, #13, #14, #17 reference planning actions already completed
4. **Slice 0036 Card** — Blank `Approved by:` and `Approval date:` fields
5. **Slice 0038 Card** — `State: implemented (pending validation)` and `Approval: pending` — needs resolution
6. **Spec `core-loop-state-machine.md`** — Missing 3 transitions (see H1, H2)
7. **Spec `cli-adapter-mvp.md`** — References `IngressDTO` instead of `ChannelIngressPayload` (see M2)

---

## Recommended Corrective Actions

1. **Update `docs/spec/30-core-loop/core-loop-state-machine.md`** to add three missing transitions:
   - `building_context → aborted` (governor pre-inference abort)
   - `inferring → aborted` (provider failure)
   - `executing_tools → aborted` (tool execution failure)
   
   These are already implemented and tested in `turn-state-machine.ts` and `core-loop-orchestrator.ts`.

2. **Update `docs/spec/40-modules/channel-cli/cli-adapter-mvp.md`** to reflect the `ChannelIngressPayload` contract (replace `IngressDTO` with `ChannelIngressPayload` in the normalization rule).

3. **Deduplicate the Backlog Slice Queue** — Remove the "Planned slice" duplicate entries for 0030–0033. Update "Validated current slice" entries to include 0034–0038.

4. **Update Backlog Pipeline State** — Set implementation cursor to 0038. Mark all slices 0030–0038 as implemented. Remove stale "planned" references.

5. **Clean up Backlog Next Actions** — Remove completed planning items. Add action to plan slices beyond 0038 and/or finalize 0038 approval.

6. **Resolve Slice 0038 approval** — Either approve the slice (it is fully implemented with tests) or document what validation remains.

7. **Populate Slice 0036 approval metadata** — Fill in `Approved by:` and `Approval date:`.

8. **Document EpisodicMemory seeding** — Add a note to slice 0037's plan or review log explaining the `system:argentum-boot` bootstrapping pattern.

9. **Consider adding E2E failure-path tests** — At minimum: one governor abort E2E test and one LLM provider failure E2E test to validate the full error-handling pipeline.

10. **Add `close()` to Gateway facade documentation** — List `close()` in slice 0037's acceptance criteria or the Gateway facade description.

---

## Next-Slice Readiness

- **Verdict**: `ready-with-risks`
- **Blocking issues**:
  - H1/H2: Spec `core-loop-state-machine.md` is 3 transitions behind implementation. The next slice that references the state machine spec will see an incomplete diagram.
  - M2: Spec `cli-adapter-mvp.md` references the wrong contract boundary.
  - Backlog is comprehensively stale for the current pipeline state.
- **Safe next actions**:
  - Plan slices beyond 0038 (Phase 8+ hardening, additional tool implementations, multi-turn integration tests)
  - Finalize and approve slice 0038
  - Run `pnpm test` to confirm 1,200+ tests pass across all packages
  - Remediate H1/H2 (spec update) before any new slice references the state machine spec
  - Remediate backlog staleness to restore pipeline visibility

---

## Test Gate Verification

| Package | Slice Range | Test Count (approx.) | Status |
|---------|-------------|---------------------|--------|
| contracts | 0001–0018 | 647 | Non-vacuous |
| environment | 0002, 0020–0022 | 109 | Non-vacuous |
| gateway | 0006–0011 | ~30 | Non-vacuous |
| tooling | 0019, 0023 | 90 | Non-vacuous |
| agentic_core | 0024–0030, 0034 | ~288 (was 260 + 28 new) | Non-vacuous |
| llm_provider | 0031–0033 | ~54 | Non-vacuous |
| channel_cli | 0035–0036 | ~45 | Non-vacuous |
| telemetry | 0038 | ~17 | Non-vacuous |
| runtime | 0003, 0037 | ~11 (7 bootstrap + 4 E2E) | Non-vacuous |
| **Total** | | **~1,291** | All packages non-vacuous |

All shell packages (`llm_provider`, `channel_cli`, `telemetry`) have been converted to non-vacuous test gates. No package remains with `export {}` or `--passWithNoTests`.

---

## Audit Verdict Summary

| Dimension | Status |
|-----------|--------|
| Spec drift | **3 transitions + 1 contract boundary** missing from spec (H1, H2, M2) |
| Boundary violations | **None** — package dependencies respect DAG |
| Validation quality | **Strong** at unit level; E2E failure paths absent (M3) |
| Test coverage | **Comprehensive** at unit level (~1,291 tests); E2E narrow |
| Planning-artifact freshness | **Poor** — backlog stale across Slice Queue, Pipeline State, and Next Actions (H3, H4, M5) |
| Deferred-decision leakage | **None** — all deferred items remain properly deferred |
| Implementation completeness | **Complete** — all 9 slices (0030–0038) fully implemented and tested |

**Repo readiness verdict**: `ready-with-risks`

The implementation is solid: all nine slices are implemented with comprehensive tests, boundaries are respected, and no deferred decisions leaked. The risks are confined to documentation and planning artifacts — the spec is behind the code on state machine transitions, and the backlog misrepresents the pipeline state. These do not block further implementation but should be remediated before the next audit cycle to prevent accumulating drift.
