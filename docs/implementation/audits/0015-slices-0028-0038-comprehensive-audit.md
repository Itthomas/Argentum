# Implementation Audit — Slices 0028–0038 Comprehensive Audit

## Metadata

- **Audit scope**: Slices 0028 through 0038, plus pipeline state in `docs/implementation/backlog.md`
- **Cluster**: Phase 4 agentic core (0028–0030, 0034), Phase 5 LLM provider (0031–0033), Phase 6 CLI channel (0035–0036), Phase 6/7 composition & E2E (0037), Phase 7 telemetry (0038)
- **Auditor**: GitHub Copilot (argentum-implementation-auditor)
- **Audit date**: 2026-05-24
- **Audit type**: Deep comprehensive — source-level comparison of implementation vs spec, validation rigor analysis, planning-artifact freshness check, boundary-violation scan, deferred-decision leakage scan, and cross-slice integration-gap analysis
- **Prior audits**: [0011-slices-0020-0029-deep-audit.md](./0011-slices-0020-0029-deep-audit.md), [0014-slices-0030-0038-deep-audit.md](./0014-slices-0030-0038-deep-audit.md)
- **Repo readiness verdict**: `ready-with-risks`

**Note**: This audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow.

---

## Sources Reviewed

### Governing spec files (all treated as authoritative)

- [docs/spec/README.md](../spec/README.md)
- [docs/spec/00-overview/mvp-scope.md](../spec/00-overview/mvp-scope.md)
- [docs/spec/10-architecture/eventing-model.md](../spec/10-architecture/eventing-model.md)
- [docs/spec/10-architecture/runtime-lifecycle.md](../spec/10-architecture/runtime-lifecycle.md)
- [docs/spec/20-contracts/turn-envelope.md](../spec/20-contracts/turn-envelope.md)
- [docs/spec/20-contracts/action-decision.md](../spec/20-contracts/action-decision.md)
- [docs/spec/20-contracts/llm-adapter-contract.md](../spec/20-contracts/llm-adapter-contract.md)
- [docs/spec/20-contracts/stream-event.md](../spec/20-contracts/stream-event.md)
- [docs/spec/20-contracts/context-item.md](../spec/20-contracts/context-item.md)
- [docs/spec/20-contracts/content-ref.md](../spec/20-contracts/content-ref.md)
- [docs/spec/30-core-loop/core-loop-state-machine.md](../spec/30-core-loop/core-loop-state-machine.md)
- [docs/spec/30-core-loop/turn-governor.md](../spec/30-core-loop/turn-governor.md)
- [docs/spec/30-core-loop/compaction-policy.md](../spec/30-core-loop/compaction-policy.md)
- [docs/spec/30-core-loop/validation-and-repair.md](../spec/30-core-loop/validation-and-repair.md)
- [docs/spec/40-modules/llm-provider/provider-abstraction.md](../spec/40-modules/llm-provider/provider-abstraction.md)
- [docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md](../spec/40-modules/llm-provider/deepseek-adapter-mvp.md)
- [docs/spec/40-modules/channel-cli/cli-adapter-mvp.md](../spec/40-modules/channel-cli/cli-adapter-mvp.md)
- [docs/spec/40-modules/channel-cli/terminal-rendering.md](../spec/40-modules/channel-cli/terminal-rendering.md)
- [docs/spec/40-modules/gateway/telemetry.md](../spec/40-modules/gateway/telemetry.md)
- [docs/spec/50-implementation/package-boundaries.md](../spec/50-implementation/package-boundaries.md)
- [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md)
- [docs/spec/70-roadmap/deferred-decisions.md](../spec/70-roadmap/deferred-decisions.md)

### Implementation files (all reviewed)

- `packages/agentic_core/src/compaction-policy.ts` — slice 0028 (~268 lines)
- `packages/agentic_core/src/turn-governor.ts` — slice 0029 (~50 lines)
- `packages/agentic_core/src/validation-repair.ts` — slice 0030 (~163 lines)
- `packages/agentic_core/src/core-loop-orchestrator.ts` — slice 0034 (~420 lines)
- `packages/agentic_core/src/turn-state-machine.ts` — ALLOWED_TRANSITIONS, STEP_INCREMENT_TRANSITIONS
- `packages/agentic_core/src/index.ts` — barrel exports
- `packages/llm_provider/src/llm-provider.ts` — `LLMProvider` + `LLMProviderError` (slice 0031)
- `packages/llm_provider/src/tool-schema-projection.ts` — `projectToolSchemas` + `DeepSeekToolSchema` (slice 0032)
- `packages/llm_provider/src/content-resolver.ts` — `ContentResolver` + `TraceWriter` types (slice 0033)
- `packages/llm_provider/src/deepseek-adapter.ts` — `DeepSeekAdapter` class (~550 lines, slice 0033)
- `packages/llm_provider/src/index.ts` — barrel exports
- `packages/channel_cli/src/cli-input-normalizer.ts` — `normalizeCliInput` + `CliInputError` (slice 0035)
- `packages/channel_cli/src/terminal-renderer.ts` — `renderStreamEvent` (slice 0036)
- `packages/channel_cli/src/index.ts` — barrel exports
- `packages/telemetry/src/telemetry-writer.ts` — `TelemetryWriter` class (~107 lines, slice 0038)
- `packages/telemetry/src/index.ts` — barrel exports
- `apps/runtime/src/composition-root.ts` — `startRuntime` + `RuntimeContext` (slice 0037)
- `apps/runtime/src/mock-llm-provider.ts` — `MockLLMProvider` (slice 0037)
- `apps/runtime/src/index.ts` — barrel exports

### Test files (all reviewed)

- `packages/agentic_core/tests/compaction-policy.test.ts` — 38 tests (slice 0028)
- `packages/agentic_core/tests/turn-governor.test.ts` — ~20 tests (slice 0029)
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

- [0028-agentic-core-compaction-policy.md](../slices/0028-agentic-core-compaction-policy.md)
- [0029-agentic-core-turn-governor.md](../slices/0029-agentic-core-turn-governor.md)
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
- [docs/implementation/audits/0011-slices-0020-0029-deep-audit.md](./0011-slices-0020-0029-deep-audit.md)
- [docs/implementation/audits/0014-slices-0030-0038-deep-audit.md](./0014-slices-0030-0038-deep-audit.md)

---

## Implementation Status Summary

| Slice | Package | State (Code) | State (Card) | Approval (Card) | Tests |
|-------|---------|-------------|-------------|-----------------|-------|
| 0028 | agentic_core | **Implemented** | implemented | approved | 38 |
| 0029 | agentic_core | **Implemented** | implemented | approved | ~20 |
| 0030 | agentic_core | **Implemented** | validated | approved | 32 |
| 0031 | llm_provider | **Implemented** | validated | approved | 15 |
| 0032 | llm_provider | **Implemented** | validated | approved | 9 |
| 0033 | llm_provider | **Implemented** | validated | approved | ~30 |
| 0034 | agentic_core | **Implemented** | validated | approved | ~28 |
| 0035 | channel_cli | **Implemented** | validated | approved | ~17 |
| 0036 | channel_cli | **Implemented** | validated | approved | ~28 |
| 0037 | apps/runtime | **Implemented** | validated | approved | 4 |
| 0038 | telemetry | **Implemented** | implemented (pending validation) | pending | ~17 |

**Key observation**: All 11 slices (0028–0038) have complete, non-trivial implementation code with comprehensive tests. Nine of eleven are approved; slice 0038 remains in pending-validation/approval limbo. No implementation gaps exist.

---

## Resolution of Prior Audit Findings

Before presenting new findings, this audit verifies the status of findings from audits 0011 and 0014:

### From Audit 0011 (slices 0020–0029)

| Finding | Description | Status |
|---------|-------------|--------|
| H1 | Turn Governor abort reason literals | **RESOLVED** — card updated |
| H2 | Turn Governor budget-check priority order | **RESOLVED** — card updated |
| H3 | Turn Governor missing `now` parameter | **RESOLVED** — card updated |
| H4 | Stale slice cards 0021, 0028, 0029 | **RESOLVED** — all three updated |
| H5 | CompactionPolicy API signature deviation | **RESOLVED** — card AC updated |
| H6 | Backlog comprehensively stale | **RESOLVED** — updated 2026-05-24 |
| M1 | `max_tokens_per_step` missing from spec | **RESOLVED** — spec updated (audit 0012) |
| M2 | `ArtifactExternalizer.store()` vs `storeToolArtifact()` | **DOCUMENTED** — adapter needed |
| M3 | Slice 0027 acceptance criteria not updated | **RESOLVED** |
| M4 | Missing adversarial review entries | **RESOLVED** |
| M5 | `startedAt` type changed from `Date` to `number` | **RESOLVED** — card updated |
| M6 | Audit 0010 remediation listed as "in progress" | **RESOLVED** |

### From Audit 0014 (slices 0030–0038)

| Finding | Description | Status |
|---------|-------------|--------|
| H1 | Spec missing `building_context → aborted` | **RESOLVED** — spec updated (see §SD-1 below) |
| H2 | Spec missing `inferring → aborted` + `executing_tools → aborted` | **RESOLVED** — spec updated (see §SD-1 below) |
| H3 | Backlog Slice Queue duplicates for 0030–0033 | **PARTIALLY RESOLVED** — duplicates remain |
| H4 | Slice 0038 approval stalled | **STILL ACTIVE** — see H-0015-1 |
| M1 | Slice 0036 blank approval metadata | **STILL ACTIVE** — see M-0015-1 |
| M2 | `cli-adapter-mvp.md` references `IngressDTO` | **RESOLVED** — spec updated to `ChannelIngressPayload` |
| M3 | No E2E failure-path tests | **STILL ACTIVE** — see M-0015-2 |
| M4 | EpisodicMemory seeding undocumented in slice card | **STILL ACTIVE** — see M-0015-3 |
| M5 | Backlog Pipeline State not updated | **PARTIALLY RESOLVED** — Next Actions items #1–#20 all marked completed, but Pipeline State prose still stale |
| L1 | `normalizeCliInput` kind validation | **STILL ACTIVE** — defensive only, no runtime risk |
| L2 | `MockLLMProvider` hardcoded `decision_id` | **STILL ACTIVE** — single-use context; no current risk |
| L3 | `Gateway.close()` not in slice 0037 AC | **STILL ACTIVE** — low priority |
| L4 | Backlog "Next Actions" #13 stale | **PARTIALLY RESOLVED** — item #20 added but #13 not removed |

---

## Findings By Severity

### HIGH

- **H-0015-1 — Slice 0038 approval remains stalled at "pending" despite complete implementation**

  The slice 0038 card shows `State: implemented (pending validation)`, `Approval: pending`. The implementation is complete with ~17 tests covering: basic write, multi-event write, JSONL format validity, sequential ordering, concurrent write ordering, full field serialization, directory auto-creation, `persistEvents: false` no-op, `flush()` no-op, and a round-trip `parseStreamEvent` test. The backlog correctly identifies 0038 as implemented (item #20), but the card's approval status hasn't been updated.

  This is a carry-forward from audit 0014 H4. No blocking validation issues were identified in either audit.

  **Impact**: The telemetry package cannot be considered production-ready until approval is formalized. Downstream slices that depend on or integrate with telemetry (e.g., event-emission wiring, observability dashboards) may hesitate to proceed without an approved telemetry surface.

- **H-0015-2 — Backlog Slice Queue has duplicate entries for 0030–0033 and stale entries for 0034–0038**

  The Slice Queue section lists slices 0030–0033 twice each: once as "Validated current slice" and again as "Planned slice (approved...)". Slices 0034–0037 are listed only as "Planned slice" despite being fully implemented and approved. Slice 0038 is listed only as "Planned slice (pending approval)" despite being implemented.

  This is a carry-forward from audit 0014 H3. The duplicates create ambiguity — a reader cannot determine from the Slice Queue alone whether 0030–0033 are validated or planned, nor whether 0034–0038 are implemented or still in planning.

  **Impact**: Pipeline management confusion. The Slice Queue is the primary navigation surface for understanding which slices are done vs pending.

### MEDIUM

- **M-0015-1 — Slice 0036 card has blank `Approved by:` and `Approval date:` fields**

  The card shows `Approval: approved` but `Approved by:` and `Approval date:` are empty. All other approved cards (0028–0035, 0037) have populated these fields.

  Carry-forward from audit 0014 M1.

  **Impact**: Minor metadata gap — no traceability for who approved this slice or when.

- **M-0015-2 — No E2E failure-path tests; only happy path covered**

  The E2E test (`apps/runtime/tests/e2e-happy-path.test.ts`) covers the happy path with 4 tests. The orchestrator unit tests (~28) cover: governor abort (wall clock), LLMProviderError abort, unexpected error propagation, repair-and-re-inference, abort decision, event emission sequences, and no-event-emitter operation. However, there are no integration-level E2E tests for:
  - LLM provider failure → turn abort
  - Governor step/repair limit → turn abort
  - Repair exhaustion → turn abort
  - Tool execution failure → turn abort
  - Queue overflow → ingress rejection

  The test strategy spec requires "failure-path tests for repair exhaustion and budget exhaustion" — the unit-level coverage arguably satisfies this, but explicit E2E failure-path tests would strengthen confidence.

  Carry-forward from audit 0014 M3.

  **Impact**: The failure-path coverage exists at the unit level but not at the integration/E2E level.

- **M-0015-3 — `composition-root.ts` EpisodicMemory seeding is undocumented in slice card**

  The composition root seeds episodic memory with a `system:argentum-boot` context item to prevent `EMPTY_CONTEXT_ITEMS` errors on the first inference step. This bootstrapping pattern is not documented in slice 0037's acceptance criteria, plan, or review log.

  Carry-forward from audit 0014 M4.

  **Impact**: Future maintainers may not understand why this seeding exists or whether it can be safely removed.

- **M-0015-4 — Backlog Pipeline State prose is stale despite Next Actions being current**

  The Pipeline State section says:
  - "Implementation cursor: slice 0033 (last validated)" — should be 0038
  - "Planned slices ahead of cursor: 5 (0034, 0035, 0036, 0037, 0038)" — all implemented
  - "Buffer: 5 slices ahead of cursor" — should be 0

  However, the Next Actions list (items #1–#20) correctly marks all planning and implementation items as completed, and the Current Validation State section correctly reflects all package test counts. The Pipeline State prose is internally inconsistent with the rest of the backlog.

  Partially resolved from audit 0014 M5.

  **Impact**: Pipeline visibility is degraded for readers who consult only the Pipeline State section.

- **M-0015-5 — Cross-slice content resolution chain is architecturally incomplete**

  The compaction policy (slice 0028) produces `ContextItem` values where `content_ref` is a reference (locator-based), not inline text. The `ContentRef` uses `locator: callId` and `storage_area: "working"`. However, no code in the current implementation stores the corresponding text content under these locators:
  - For **inline** disposition: the `human_summary` text is never stored — only a `ContentRef` with `locator: callId` is created.
  - For **error_summary** disposition: the error summary text (`"Error [code]: ..."`) is never stored — only a `ContentRef` with suffix `"error"` is created.
  - For **externalized** disposition: the `ArtifactExternalizer.store()` call persists the raw content, but the truncated summary text is not independently stored — only a `ContentRef` with suffix `"summary"` is created.

  The `DeepSeekAdapter` (slice 0033) uses `ContentResolver` to resolve `content_ref` values when building provider-native messages. If the adapter encounters a compaction-produced `ContextItem`, the `ContentResolver` would fail to find content for the locator because nothing stored it.

  This gap does not surface in current tests because:
  - The E2E test uses `MockLLMProvider` which never resolves content_refs.
  - The orchestrator unit tests use mocked LLM providers that return canned decisions without resolving context.
  - The compaction policy's own tests validate `ContextItem` shapes but don't exercise the resolution path.

  **This is not a defect in any single slice** — each slice is internally correct. It is a cross-slice integration gap: the pipeline from compaction → episodic memory → prompt compiler → adapter → content resolution has a missing link at the "store text for compaction references" step.

  **Impact**: When the real DeepSeek adapter is wired into the composition root and a turn uses tool_calls, the adapter will fail to resolve compaction-produced `content_ref` values on the second inference step. This would surface as `LLMProviderError` (content resolution failure). The fix should be applied either in the composition root (an adapter that stores compaction summaries keyed by locator) or in the episodic memory layer (store text alongside context items).

### LOW

- **L-0015-1 — `normalizeCliInput` does not validate `MessagePart.kind`**

  The structural validation checks `message_parts` non-emptiness and `message_parts[0].text` non-emptiness, but does not verify `message_parts[0].kind === "text"`. The kind is hardcoded as `"text" as const`, so a non-text kind would require a programming error.

  Carry-forward from audit 0014 L1.

- **L-0015-2 — `MockLLMProvider` returns hardcoded `decision_id: "mock-decision-001"`**

  Every call returns the same `decision_id`. Fine for single-step E2E tests but would cause `context_id` collisions in episodic memory if the mock were used for multi-step turns with tool_calls.

  Carry-forward from audit 0014 L2.

- **L-0015-3 — `Gateway.close()` method not listed in slice 0037 acceptance criteria**

  The `Gateway` facade has a `close()` method that calls `this.#database.close()`. The composition root calls `gateway.close()` in the `shutdown` function. This method is essential but not enumerated in slice 0037's acceptance criteria.

  Carry-forward from audit 0014 L3.

- **L-0015-4 — `#writeChain` error recovery silently swallows write errors in the chain**

  The `TelemetryWriter.#writeChain` uses `.catch(() => {})` which prevents a single failed write from breaking the chain (subsequent writes still work), but the error is silently swallowed. The individual `writeEvent()` call that failed still rejects (since `writePromise` is returned). This is a deliberate design choice documented in code comments, but the silent catch means the chain-continuation behavior is invisible to external observers.

  **Impact**: No behavioral impact for callers (they get the rejection from `writePromise`). Diagnostic-only.

---

## Drift By Category

### Spec Drift

| ID | Spec File | Previous Finding | Current Status |
|----|-----------|-----------------|----------------|
| SD-1 | `core-loop-state-machine.md` | Missing `building_context → aborted`, `inferring → aborted`, `executing_tools → aborted` (audit 0014 H1/H2) | **RESOLVED** — All three transitions are now documented: item 3 (`building_context → aborted when governor triggers pre-inference abort`), item 5 (`inferring → aborted when the LLM provider fails`), item 11 (`executing_tools → aborted when tool execution or compaction throws an unrecoverable error`) |
| SD-2 | `cli-adapter-mvp.md` | Referenced `IngressDTO` instead of `ChannelIngressPayload` (audit 0014 M2) | **RESOLVED** — Updated to: "Each accepted terminal input is normalized into one `ChannelIngressPayload`... The gateway owns full `IngressDTO` construction" |
| SD-3 | `turn-envelope.md` | Missing `max_tokens_per_step` in budget table (audit 0011 M1) | **RESOLVED** — Spec updated per audit 0012 |

**Verdict**: All previously identified spec drift has been resolved. No new spec drift found. The authoritative spec is now current with the implementation across all 11 slices.

### Boundary Drift

**No boundary violations found.** All 11 slices respect their package boundaries:

- `agentic_core` (0028–0030, 0034): Depends only on `@argentum/contracts` and `@argentum/llm-provider` (for `LLMProvider` interface + `LLMProviderError`). No imports from `environment`, `tooling`, `gateway`, or `channel_cli`.
- `llm_provider` (0031–0033): Depends only on `@argentum/contracts`. `ContentResolver` and `TraceWriter` are pure interface types with no storage implementation. No provider SDK imports (verified by static test).
- `channel_cli` (0035–0036): Depends only on `@argentum/contracts`. No gateway, provider, or agentic_core imports.
- `telemetry` (0038): Depends only on `@argentum/contracts` and Node.js `fs/promises`. No cross-package imports.
- `apps/runtime` (0037): The composition root depends on all packages — correct for a top-level wiring point.

Package dependency DAG is respected exactly as prescribed by `package-boundaries.md`.

### Validation or Test Drift

| Area | Status |
|------|--------|
| Compaction policy tests (38) | **Comprehensive**: inline, externalized, error_summary, truncated flag, custom threshold, boundary, zero-length, deterministic context_id, externalizer failure, immutability, revision logic, parseContextItem round-trip, UTF-8 emoji truncation |
| Turn governor tests (~20) | **Comprehensive**: continue, all three abort reasons, exact-at-limit, over-limit, priority ordering, determinism, immutability, zero budgets, negative startedAt, large values. Uses `vi.useFakeTimers()` + `vi.setSystemTime()` for wall-clock determinism |
| Validation & repair tests (32) | **Comprehensive**: valid decisions (respond/tool_calls/clarify/abort), schema failures (missing decision_id, invalid kind), repair increment, repair exhaustion abort, unexpected error escalation, immutability, repair feedback shape |
| LLM provider interface tests (15) | **Comprehensive**: interface existence, class implementation, object literal implementation, provider-neutrality (no SDK imports), `LLMProviderError` construction, properties, cause chaining, method shape verification |
| Tool schema projection tests (9) | **Comprehensive**: single tool, empty array, ordering preservation, key shape, empty input_schema, no mutation, barrel export, type assignability, no-provider-SDK-import verification (static file read) |
| DeepSeek adapter tests (~30) | **Comprehensive**: basic inference, tool_calls parsing, content resolution, trace writing, error handling, `parseActionDecision` round-trip, `parseLLMInferenceResult` round-trip, message building, role mapping |
| CLI input normalizer tests (~17) | **Comprehensive**: happy path, ChannelIngressPayload shape, whitespace handling, empty rejection, CliInputError properties, structural validation, immutability, timestamp determinism, Unicode, long input, structural compatibility check |
| Terminal renderer tests (~28) | **Comprehensive**: every event kind (llm.*, tool.*, turn.*, validation.*, response.*, queue.*, memory.*, tool.planned, validation.repair_requested), visibility filtering, system prefix, graceful fallback, forward-compatible unknown kinds, boundary test (full sequence) |
| Telemetry writer tests (~17) | **Comprehensive**: single write, multi-write, JSONL validity, sequential ordering, concurrent ordering (promise-chain), full field serialization, directory creation, persistEvents=false, flush no-op, parseStreamEvent round-trip, file naming |
| E2E tests (4) | **Narrow**: happy path only — full turn from CLI input through mock LLM to response, RuntimeContext shape verification, independent sessions, MockLLMProvider field validation |
| Orchestrator unit tests (~28) | **Comprehensive at unit level**: respond happy path, tool_calls→respond, multi-tool sequential, clarify terminal path, abort decision, governor wall-clock abort, repair-and-re-inference, LLMProviderError abort, unexpected error propagation, event emission sequences (respond, tool_calls, abort), no-event-emitter operation, input immutability |

**Test assertion patterns**: All tests use `toEqual` for exact object matching (the strictest pattern), or targeted property assertions (`expect(result.state).toBe("completed")`). No subset-matching issues detected.

### Planning-Artifact Drift

1. **Backlog Slice Queue** — Duplicates for 0030–0033 (both "Validated" and "Planned"). Stale entries for 0034–0038 (listed as "Planned" but are implemented/approved). **(H-0015-2)**
2. **Backlog Pipeline State** — Cursor at "0033", planned count "5" — both stale. **(M-0015-4)**
3. **Slice 0036 Card** — Blank `Approved by:` and `Approval date:` fields. **(M-0015-1)**
4. **Slice 0038 Card** — `State: implemented (pending validation)`, `Approval: pending`. **(H-0015-1)**
5. **Slice 0037 Card** — EpisodicMemory seeding with `system:argentum-boot` not documented in plan or review log. **(M-0015-3)**
6. **Backlog "Next Actions" #13** — "Refill pipeline to 6-7 planned/approved slices ahead of cursor" — all slices are implemented, making this action moot. Still listed.

### Deferred-Decision Leakage

**No deferred-decision leakage detected.** All deferred items from `docs/spec/70-roadmap/deferred-decisions.md` remain properly deferred:
- Exact DeepSeek endpoint and model selection — configured via `DeepSeekAdapterConfig`, not hardcoded
- Exact initial tool catalog — `ToolRegistry` is populated at composition time; no hardcoded catalog
- Exact compaction size thresholds — defaults in `CompactionPolicy` are overridable via `CompactionOptions.sizeThresholdBytes`
- Whether tool exposure per step is full-registry or curated subset — `availableTools` is injected via constructor
- Maintenance-mode semantics for bedrock mutation — no bedrock write paths exist
- Post-MVP interactive approval workflows — not implemented (grant resolver uses only `auto_allow`/`deny`)
- Container isolation — not implemented (execution driver is a no-op stub)
- LLM-based summarization — not implemented (compaction uses rule-based truncation)
- Background summarization worker — excluded by MVP constraints
- Long-term vector memory retrieval — excluded by MVP constraints

---

## Missing Tests Or Weak Validation

### Missing Tests

1. **E2E failure-path tests** (M-0015-2): No integrated tests for LLM provider failure, governor step/repair exhaustion, tool failure, or queue rejection at the E2E level. All failure paths are covered at the unit level only.
2. **Cross-slice content resolution test**: No test validates that compaction-produced `ContextItem` values can be resolved by a `ContentResolver` through to the adapter's message-building pipeline. This is the integration gap described in M-0015-5.
3. **`channel_cli` package entrypoint smoke test**: The `cli-input-normalizer.test.ts` verifies `typeof normalizeCliInput === "function"` via structural compatibility, but there is no dedicated entrypoint test that verifies all barrel exports are callable.

### Weak Validation

1. **`normalizeCliInput` kind validation** (L-0015-1): Does not verify `MessagePart.kind === "text"`. Defensive only — the kind is hardcoded.
2. **Compaction revision for error results**: The `compactError` method always increments `newRevision` regardless of whether the built error summary actually differs from the raw `human_summary`. In practice, the `buildErrorSummary` prefix (`"Error [code]: "` or `"Blocked [code]: "`) always differs from the raw summary, so this always-increment is pragmatically correct. However, if a tool already produced a summary with that exact prefix (a tool bug), the revision would increment unnecessarily. No behavior impact.
3. **Compaction inline ContentRef text not stored** (M-0015-5): The `compactInline` method creates a `ContentRef` with `locator: callId` but never stores the corresponding text. The `ContentResolver` in the adapter would fail to resolve this reference. This is the central integration gap.

---

## Stale Or Inconsistent Planning Artifacts

1. **Backlog Slice Queue** — Duplicates for 0030–0033; stale "Planned" entries for 0034–0038
2. **Backlog Pipeline State** — Cursor, planned count, and buffer description all stale
3. **Backlog "Next Actions" #13** — "Refill pipeline" action is moot
4. **Slice 0036 Card** — Blank approval metadata fields
5. **Slice 0038 Card** — Pending validation/approval despite full implementation
6. **Slice 0037 Card** — Missing documentation of `system:argentum-boot` bootstrapping

---

## Recommended Corrective Actions

1. **Finalize slice 0038 approval** (H-0015-1): The implementation is complete with ~17 passing tests. Either approve the slice or document what validation remains. No blocking issues were found in this audit or audit 0014.

2. **Deduplicate and update Backlog Slice Queue** (H-0015-2): Remove the "Planned slice" duplicates for 0030–0033. Update 0034–0038 entries from "Planned slice" to "Validated current slice" (or "Implemented current slice" for 0038).

3. **Update Backlog Pipeline State prose** (M-0015-4): Set implementation cursor to 0038. Remove stale "planned" references. Update buffer count to 0.

4. **Populate slice 0036 approval metadata** (M-0015-1): Fill in `Approved by:` and `Approval date:`.

5. **Document EpisodicMemory seeding** (M-0015-3): Add a note to slice 0037's plan or review log explaining the `system:argentum-boot` bootstrapping pattern.

6. **Design and implement content resolution bridge** (M-0015-5): The compaction-to-content-resolution chain needs a concrete mechanism for storing compaction summaries keyed by locator so the `ContentResolver` can retrieve them. Options:
   - Add a `storeSummary(callId, text)` method to `ArtifactExternalizer` (or a separate interface)
   - Store summaries in episodic memory alongside `ContextItem` values (content-aware memory)
   - Add an in-memory content map to the composition root that the `ContentResolver` consults

7. **Consider adding E2E failure-path tests** (M-0015-2): At minimum: one governor abort E2E test and one LLM provider failure E2E test to validate the full error-handling pipeline.

8. **Remove stale "Next Actions" item #13**: Remove or replace with a new action to plan slices beyond 0038.

9. **Add `close()` to Gateway facade documentation**: List `close()` in slice 0037's acceptance criteria or the Gateway facade description.

---

## Test Gate Verification

| Package | Slice Range | Test Count (approx.) | Status |
|---------|-------------|---------------------|--------|
| contracts | 0001–0018 | 647 | Non-vacuous |
| environment | 0002, 0020–0022 | 109 | Non-vacuous |
| gateway | 0006–0011 | ~30 | Non-vacuous |
| tooling | 0019, 0023 | 90 | Non-vacuous |
| agentic_core | 0024–0030, 0034 | ~346 (228 + 32 + 28 + 38 + 20) | Non-vacuous |
| llm_provider | 0031–0033 | ~54 | Non-vacuous |
| channel_cli | 0035–0036 | ~45 | Non-vacuous |
| telemetry | 0038 | ~17 | Non-vacuous |
| runtime | 0003, 0037 | ~11 (7 bootstrap + 4 E2E) | Non-vacuous |
| **Total** | | **~1,349** | All packages non-vacuous |

All shell packages (`llm_provider`, `channel_cli`, `telemetry`) have been converted to non-vacuous test gates. No package remains with `export {}` or `--passWithNoTests`.

---

## Audit Verdict Summary

| Dimension | Status |
|-----------|--------|
| Spec drift | **None** — all prior drift resolved. Authoritative spec is current with implementation |
| Boundary violations | **None** — package dependencies respect DAG across all 11 slices |
| Validation quality | **Strong** at unit level; cross-slice content resolution gap (M-0015-5); E2E failure paths absent (M-0015-2) |
| Test coverage | **Comprehensive** at unit level (~1,349 tests); E2E narrow |
| Planning-artifact freshness | **Mixed** — Next Actions current, Current Validation State current, but Slice Queue has duplicates and Pipeline State prose is stale |
| Deferred-decision leakage | **None** — all deferred items remain properly deferred |
| Implementation completeness | **Complete** — all 11 slices (0028–0038) fully implemented and tested |
| Cross-slice integration | **One gap** — content resolution chain incomplete (M-0015-5). Does not surface in current tests but will block real adapter wiring |

**Repo readiness verdict**: `ready-with-risks`

The implementation across slices 0028–0038 is solid: all 11 slices are implemented with comprehensive unit tests, package boundaries are respected, no spec drift remains, and no deferred decisions leaked. The risks are:

1. **Slice 0038 approval limbo** (H-0015-1) — implementation complete but card approval pending. This is a process gap, not a code defect.
2. **Content resolution integration gap** (M-0015-5) — compaction produces references without stored text; the adapter's `ContentResolver` would fail on these references. This will block real adapter wiring.
3. **Planning-artifact staleness** (H-0015-2, M-0015-4) — backlog doesn't accurately reflect pipeline state.

These risks do not block further slice planning (0039+) but the content resolution gap (M-0015-5) **will block** end-to-end integration with a real LLM provider adapter. It should be addressed before or as part of the next integration slice.

---

## Cross-Reference: Prior Audit Status

| Audit | Scope | Verdict | Key Active Issues |
|-------|-------|---------|-------------------|
| 0011 | Slices 0020–0029 | `ready-with-risks` → remediated | All HIGH/MEDIUM resolved |
| 0012 | Post-remediation | `ready` | All findings resolved |
| 0013 | Slices 0030–0033 pipeline | `ready-with-risks` | 3 HIGH (stale cards/backlog, missing spec transitions) |
| 0014 | Slices 0030–0038 deep | `ready-with-risks` | H1/H2 resolved (spec updated); H3/H4/M1/M3/M4/M5 partially resolved |
| **0015** | **Slices 0028–0038 comprehensive** | **`ready-with-risks`** | **H-0015-1 (0038 approval stalled), H-0015-2 (queue duplicates), M-0015-5 (content resolution gap)** |
