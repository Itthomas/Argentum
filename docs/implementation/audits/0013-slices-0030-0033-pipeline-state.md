# Implementation Audit — Slices 0030–0033 + Pipeline State

## Metadata

- **Audit scope**: Slices 0030 (Validation & Repair), 0031 (LLM Provider Interface), 0032 (Tool Schema Projection), 0033 (DeepSeek Adapter), 0034 (Core Loop Orchestrator — planned), 0035 (CLI Input Normalization — planned), plus current pipeline state in `docs/implementation/backlog.md`
- **Cluster**: Phase 4 agentic core (0030, 0034), Phase 5 LLM provider (0031–0033), Phase 6 CLI (0035)
- **Auditor**: GitHub Copilot (argentum-implementation-auditor)
- **Audit date**: 2026-05-24
- **Audit type**: Implementation-vs-spec comparison, planning-artifact freshness check, boundary-violation scan, deferred-decision leakage scan, test-gap analysis
- **Prior audit**: [0012-post-remediation-state.md](./0012-post-remediation-state.md)
- **Repo readiness verdict**: `ready-with-risks`

**Note**: This audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow.

---

## Sources Reviewed

### Governing spec files (all treated as authoritative)

- [docs/spec/README.md](../spec/README.md) — entrypoint authority; frozen MVP decisions
- [docs/spec/20-contracts/turn-envelope.md](../spec/20-contracts/turn-envelope.md) — `TurnEnvelope`, `TurnBudget` shapes
- [docs/spec/20-contracts/canonical-contracts.md](../spec/20-contracts/canonical-contracts.md) — contract set and normalization boundary
- [docs/spec/20-contracts/action-decision.md](../spec/20-contracts/action-decision.md) — `ActionDecision` contract
- [docs/spec/20-contracts/llm-adapter-contract.md](../spec/20-contracts/llm-adapter-contract.md) — `LLMInferenceRequest`/`LLMInferenceResult`
- [docs/spec/30-core-loop/validation-and-repair.md](../spec/30-core-loop/validation-and-repair.md) — validation layers, repair rules, recovery paths
- [docs/spec/30-core-loop/core-loop-state-machine.md](../spec/30-core-loop/core-loop-state-machine.md) — state transitions, step semantics, invariants
- [docs/spec/40-modules/llm-provider/provider-abstraction.md](../spec/40-modules/llm-provider/provider-abstraction.md) — provider responsibilities and rules
- [docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md](../spec/40-modules/llm-provider/deepseek-adapter-mvp.md) — DeepSeek adapter requirements
- [docs/spec/40-modules/llm-provider/provider-normalization.md](../spec/40-modules/llm-provider/provider-normalization.md) — normalization strategy
- [docs/spec/50-implementation/package-boundaries.md](../spec/50-implementation/package-boundaries.md)
- [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md)
- [docs/spec/70-roadmap/deferred-decisions.md](../spec/70-roadmap/deferred-decisions.md)

### Implementation files (all reviewed)

- `packages/agentic_core/src/validation-repair.ts` — slice 0030 implementation
- `packages/agentic_core/src/turn-state-machine.ts` — `ALLOWED_TRANSITIONS` map
- `packages/agentic_core/src/index.ts` — barrel exports
- `packages/llm_provider/src/llm-provider.ts` — `LLMProvider` interface + `LLMProviderError` (slice 0031)
- `packages/llm_provider/src/tool-schema-projection.ts` — `projectToolSchemas` + `DeepSeekToolSchema` (slice 0032)
- `packages/llm_provider/src/content-resolver.ts` — `ContentResolver` + `TraceWriter` types (slice 0033)
- `packages/llm_provider/src/deepseek-adapter.ts` — `DeepSeekAdapter` class (slice 0033)
- `packages/llm_provider/src/index.ts` — barrel exports (all 0031–0033 surfaces)
- `packages/channel_cli/src/index.ts` — still `export {};` (shell)
- `packages/contracts/src/index.ts` — contract barrel (no `ChannelIngressPayload`)

### Test files (all reviewed)

- `packages/agentic_core/tests/validation-repair.test.ts` — 32 tests (slice 0030)
- `packages/llm_provider/tests/llm-provider.test.ts` — 15 tests (slice 0031)
- `packages/llm_provider/tests/tool-schema-projection.test.ts` — 9 tests (slice 0032)
- `packages/llm_provider/tests/deepseek-adapter.test.ts` — ~30 tests (slice 0033)
- `packages/channel_cli/tests/` — directory does NOT exist (slice 0035 not implemented)

### Slice cards

- [0030-agentic-core-validation-repair-policy.md](../slices/0030-agentic-core-validation-repair-policy.md)
- [0031-llm-provider-abstraction-interface.md](../slices/0031-llm-provider-abstraction-interface.md)
- [0032-llm-provider-tool-schema-projection.md](../slices/0032-llm-provider-tool-schema-projection.md)
- [0033-llm-provider-deepseek-adapter.md](../slices/0033-llm-provider-deepseek-adapter.md)
- [0034-agentic-core-core-loop-orchestrator.md](../slices/0034-agentic-core-core-loop-orchestrator.md)
- [0035-channel-cli-input-normalization.md](../slices/0035-channel-cli-input-normalization.md)

### Workflow artifacts

- [docs/implementation/backlog.md](../backlog.md)
- [docs/implementation/audits/0012-post-remediation-state.md](./0012-post-remediation-state.md)

---

## Implementation Status Summary

| Slice | Package | State (Code) | State (Card) | Approval (Card) | Tests (approx.) |
|-------|---------|-------------|-------------|-----------------|-----------------|
| 0030 | agentic_core | **Implemented** | implemented | approved | 32 (validation-repair) |
| 0031 | llm_provider | **Implemented** | **planned** ⚠️ | approved | 15 (llm-provider) |
| 0032 | llm_provider | **Implemented** | **planned** ⚠️ | approved | 9 (tool-schema-projection) |
| 0033 | llm_provider | **Implemented** | **planned** ⚠️ | approved | ~30 (deepseek-adapter) |
| 0034 | agentic_core | Not implemented | planned | **pending** ⚠️ | — |
| 0035 | channel_cli | Not implemented | planned | approved | — |

**Key observation**: Slices 0031, 0032, and 0033 have real, non-trivial implementation code in `packages/llm_provider/` with comprehensive tests (~54 total), but all three slice cards still show `State: planned`. The backlog similarly treats these slices as unimplemented. Slice 0030 is correctly marked as implemented. Slices 0034 and 0035 are correctly not yet implemented, but 0034's card-level approval status is inconsistent with the backlog.

---

## Findings By Severity

### HIGH

- **H1 — Slice cards 0031, 0032, 0033 are stale: `State: planned` but code is fully implemented**

  The `packages/llm_provider/` package contains complete, tested implementations for all three slices:
  - `llm-provider.ts`: `LLMProvider` interface + `LLMProviderError` class with comprehensive JSDoc (slice 0031)
  - `tool-schema-projection.ts`: `projectToolSchemas()` + `DeepSeekToolSchema` type (slice 0032)
  - `content-resolver.ts`: `ContentResolver` + `TraceWriter` types (slice 0033)
  - `deepseek-adapter.ts`: `DeepSeekAdapter` class implementing `LLMProvider` with all four normalization paths, HTTP calls, trace capture, error handling (slice 0033)
  - `index.ts`: exports all five runtime symbols + four type-only exports

  Yet ALL three slice cards still show:
  ```
  - State: planned
  ```
  With no `Implemented:` date, no implementation summary section, and no verified test counts.

  Similarly, the **Review Log** sections show adversarial review findings and refinement notes but do not record implementation completion.

  **Impact**: Any agent or implementer consulting the slice cards would believe these slices are not yet built. This could lead to re-implementation, duplicate work, or incorrect dependency ordering.

- **H2 — Backlog pipeline state comprehensively stale**

  The `docs/implementation/backlog.md` Pipeline State section contains multiple stale entries:

  | Backlog Claim | Actual State |
  |---|---|
  | `Implementation cursor: slice 0029 (last validated)` | Slice 0030 is implemented and validated |
  | `Planned slices ahead: 6 (0030, 0031, 0032, 0033, 0034, 0035)` | 0030–0033 are implemented; only 0034–0035 remain planned |
  | `5 approved and ready for implementation (0030–0033, 0035)` | 0030–0033 are already implemented, not "ready for implementation" |
  | `Shell packages remaining: llm_provider, telemetry` | `llm_provider` is no longer a shell (~54 tests, 5 source files) |
  | `Test gates: ... 1,121 total` | Does not include ~54 `llm_provider` tests |
  | `10 slices implemented this session (0020–0029)` | At least 13 slices are now implemented (0020–0033) |
  | `Latest audit: 0012 (ready — 0 HIGH, 0 MEDIUM, 0 LOW)` | This audit (0013) supersedes with new findings |

  **Impact**: The backlog is the durable queue for implementation planning. Stale pipeline state means downstream orchestration decisions will be made on incorrect information.

- **H3 — Slice 0034 prerequisite: `ALLOWED_TRANSITIONS` missing `building_context→aborted` and `inferring→aborted`**

  Slice 0034 (Core Loop Orchestrator) Prerequisites section states:
  > Slice 0024 (turn state machine) must be updated before this slice can be implemented. The ALLOWED_TRANSITIONS map must include two new edges:
  > - `["building_context", new Set(["inferring", "aborted"])]` — currently only `["building_context", new Set(["inferring"])]`
  > - `["inferring", new Set(["validating", "aborted"])]` — currently only `["inferring", new Set(["validating"])]`

  The current `ALLOWED_TRANSITIONS` in `packages/agentic_core/src/turn-state-machine.ts` (lines 36–50):
  ```typescript
  ["building_context", new Set<TurnState>(["inferring"])],
  ["inferring", new Set<TurnState>(["validating"])],
  ```

  Neither `aborted` target is present. The authoritative spec `docs/spec/30-core-loop/core-loop-state-machine.md` Allowed Transition Order also does NOT list:
  - `building_context → aborted` (governor pre-inference abort)
  - `inferring → aborted` (provider failure)

  This is a **blocking prerequisite** for slice 0034. The spec and code must both be updated per the 2026-05-24 human decision (Option A) before the orchestrator can implement these transition paths.

  **Impact**: Slice 0034 cannot be implemented until the state machine is amended. Any attempt to implement the orchestrator with governor pre-inference aborts or provider-failure aborts would produce `TransitionError` at runtime.

### MEDIUM

- **M1 — `ChannelIngressPayload` type not yet added to `@argentum/contracts`**

  Slice 0035 Plan step 1 requires creating `packages/contracts/src/channel-ingress-payload.ts` with the `ChannelIngressPayload` type definition. This type does not exist in the contracts package yet. The slice card's Execution readiness line states "The upstream contract dependencies (`IngressDTO`, `MessagePart`, `ChannelIngressPayload`) are available from `@argentum/contracts`" — this is **incorrect** for `ChannelIngressPayload`. It must be created as step 1 of slice 0035 implementation. This is a slice-card accuracy issue, not a code defect (slice 0035 is not yet implemented).

- **M2 — `channel_cli` package has zero scaffolding**

  The `@argentum/channel-cli` package is a pure shell:
  - `src/index.ts`: `export {};`
  - `package.json`: no `@argentum/contracts` dependency, `"test": "vitest run --passWithNoTests"`
  - `tsconfig.json`: no `references` to contracts
  - `tests/`: directory does not exist

  None of the scaffolding prerequisites from slice 0035 Plan (add `workspace:*` dep, tsconfig reference, change test script, create vitest config) have been done. This is acceptable since the slice is not implemented, but the slice card should not claim "ready-when-approved" when the package scaffolding is incomplete.

- **M3 — Slice 0030 implementation has `unexpected_validation_error` abort path not documented in card acceptance criteria**

  The `validateAndRepair()` function (validation-repair.ts lines 78–85) catches non-`ActionDecisionValidationError` exceptions and returns:
  ```typescript
  { outcome: "abort", reason: `unexpected_validation_error: ${String(error)}`, updatedEnvelope: { ...envelope } }
  ```
  This is a reasonable defensive guard, but the slice card's acceptance criteria only document two abort reasons:
  - `reason: "repair_attempts_exhausted"` (repairs exhausted)
  - Implicit abort from `decision.kind === "abort"` (routed by core loop)

  The `"unexpected_validation_error"` abort path is not described in the card's `ValidationOutcome` documentation. The card should be updated to document this defensive path, or the implementation should be adjusted.

- **M4 — `agentic_core` tsconfig.json missing `llm_provider` project reference**

  Slice 0034 requires importing `LLMProvider` and `LLMProviderError` from `@argentum/llm-provider`. The current `packages/agentic_core/tsconfig.json` only has:
  ```json
  "references": [{ "path": "../contracts" }]
  ```
  It needs `{ "path": "../llm_provider" }` added. Similarly, `packages/agentic_core/package.json` needs `"@argentum/llm-provider": "workspace:*"` in `dependencies`. These are prerequisites for slice 0034 implementation.

- **M5 — Backlog test counts do not include `llm_provider` tests**

  The backlog states "1,121 total" tests but `llm_provider` has ~54 additional tests (15 llm-provider + 9 tool-schema-projection + ~30 deepseek-adapter). The actual test count across all packages is likely ~1,435+ (1,121 existing + 32 validation-repair + ~54 llm_provider + growth in other packages).

### LOW

- **L1 — Slice 0034 card `Approval: pending` vs backlog `Approved`**

  The slice 0034 card header says:
  ```
  - Approval: pending
  - Approved by:
  - Approval date:
  ```
  But the backlog Pipeline State says:
  > 0034 (Core Loop Orchestrator): Planned — CRITICAL C1/C2 resolved 2026-05-24
  
  And the Slice Queue says:
  > Planned slice (pending upstream slices 0030/0031 and 0024 transition update; CRITICAL C1/C2 resolved 2026-05-24)
  
  The card should reflect that CRITICAL findings are resolved even if full approval is gated on prerequisites.

- **L2 — Slice 0035 card claims `ChannelIngressPayload` is "available from @argentum/contracts"**

  The Execution readiness line states: "The upstream contract dependencies (`IngressDTO`, `MessagePart`, `ChannelIngressPayload`) are available from `@argentum/contracts`." But `ChannelIngressPayload` does not exist in the contracts package. It must be created as the first implementation step. The readiness statement should say "will be added" rather than "are available."

- **L3 — `llm_provider` package.json has no `@argentum/contracts` version constraint**

  The `llm_provider/package.json` correctly declares `"@argentum/contracts": "workspace:*"` and the code works. However, the `agentic_core/package.json` pattern of keeping only contracts as a dependency is followed correctly. No action needed — noted for completeness.

---

## Drift By Category

### Spec drift

- **None detected for slices 0030–0033.** The implementation follows the authoritative spec files:
  - `validation-repair.ts` delegates validation entirely to `parseActionDecision()` per spec rule "The core loop validates only canonical contracts"
  - `llm-provider.ts` interface consumes only `@argentum/contracts` types per canonical normalization boundary
  - `deepseek-adapter.ts` keeps provider-native repair internal per spec rule "Keep provider-native repair and malformed-output recovery internal to the adapter"
  - Response normalization paths (A→B→C→D) follow the spec's required behavior for native tool calling, JSON mode, and parsed-text fallback
- **Spec gap for slice 0034**: `core-loop-state-machine.md` does not document `building_context→aborted` or `inferring→aborted` transitions. This is a prerequisite spec update, not a drift (the spec hasn't been amended yet).
- **Resolved from prior audit**: `max_tokens_per_step` is now present in `docs/spec/20-contracts/turn-envelope.md` Budget Fields table. Audit 0012 M1 is **closed**.

### Boundary drift

- **None detected.** All implementations respect package boundaries:
  - `agentic_core/validation-repair.ts` imports only from `@argentum/contracts` and internal `./episodic-memory.js`
  - `llm_provider/` imports only from `@argentum/contracts` and internal modules; no provider SDKs, no tool execution, no session management
  - The `DeepSeekAdapter` receives `apiKey` via constructor injection (does not resolve secrets)
  - `ContentResolver` and `TraceWriter` are injected interfaces, keeping the adapter decoupled from storage I/O

### Validation or test drift

- **Slice 0030**: 32 tests cover all acceptance criteria paths — valid decisions (4 kinds), schema failures (5 variants), repair feedback shape/content/storage (6 tests), counter increments/exhaustion (6 tests), sequential repair (1 test), immutability (4 tests), edge cases (max_repair=0, tool_calls on non-tool_calls kind). **Adequate.**
- **Slice 0031**: 15 tests cover interface existence, implementability (class + object literal), mock invocation, provider-neutrality, error construction (6 tests), throw/catch cycle, entrypoint smoke. **Adequate.**
- **Slice 0032**: 9 tests cover single projection, empty input, ordering preservation, output shape keys, empty input_schema, immutability, barrel export, type assignability, no-SDK-import static check. **Adequate.**
- **Slice 0033**: ~30 tests covering interface conformance, constructor defaults + endpoint normalization, message building (roles, unrecognized roles, recognized roles passthrough), missing ContentResolver, tool projection (with/without tools), auth header, native tool calling (single, multiple, ordering, unparseable args), JSON mode (respond, tool_calls, malformed fallthrough), parsed text (plain text, markdown fence extraction), trace capture (with/without TraceWriter), HTTP errors, and round-trip parser validation for all normalization paths. **Adequate and thorough.**
- **Slice 0035**: No tests — not yet implemented. **Expected.**
- **`llm_provider` parser round-trip tests**: The deepseek-adapter tests include `parseLLMInferenceResult()` and `parseActionDecision()` validation for every normalization path, as required by slice 0033 card H2 resolution. **Verified present.**

### Planning-artifact drift

- **H1 (above)**: Slice cards 0031, 0032, 0033 say `State: planned` but code is implemented — **HIGH drift**
- **H2 (above)**: Backlog pipeline state comprehensively stale — **HIGH drift**
- **L1 (above)**: Slice 0034 card approval inconsistency — **LOW drift**
- **L2 (above)**: Slice 0035 card inaccurate readiness statement — **LOW drift**
- **Slice 0030 card**: Correctly shows `State: implemented`, has full Implementation Summary, 32 tests verified. **Fresh.**
- **Audit 0012 M2 (0031 approval mismatch)**: The 0031 card now shows `Approval: approved`. **Resolved.**

### Deferred-decision leakage

- **None detected.** All implementations respect deferred decisions:
  - DeepSeek endpoint and model: accepted as constructor config (`DeepSeekAdapterConfig.endpoint`, `.model`), not hardcoded
  - No provider SDK imported (verified by static analysis test in tool-schema-projection)
  - Tool exposure per step: caller-provided (`available_tools` array), adapter is agnostic to registry vs curated subset
  - Compaction size thresholds: not assumed by any implemented module
  - Local persistence technology: not assumed; trace persistence is injected via `TraceWriter`
  - API key: injected, not resolved from environment by the adapter

---

## Missing Tests Or Weak Validation

- **Slice 0030 — undocumented abort path**: The `unexpected_validation_error` abort path has no dedicated test. The implementation handles it (lines 78–85 of validation-repair.ts), but no test case explicitly triggers a non-`ActionDecisionValidationError` exception from `parseActionDecision()`. This path would only be reached by a programming error in `parseActionDecision` itself (e.g., throwing `TypeError`), so a dedicated test may be impractical, but the behavior should at least be documented in the card.

- **Slice 0034**: No tests — not implemented. **Expected.**
- **Slice 0035**: No tests — not implemented. **Expected.**

---

## Stale Or Inconsistent Planning Artifacts

1. **Slice cards 0031, 0032, 0033**: State field says `planned`; should say `implemented` with implementation date, test counts, and an Implementation Summary section (as slice 0030 has).
2. **Backlog Pipeline State section**: Multiple stale claims (see H2 above). Needs refresh: cursor, slice counts, shell package list, test totals, implemented-slice count.
3. **Backlog Slice Queue**: Entries for 0031–0033 say "Planned slice (approved)" — should say "Validated current slice" with implementation metadata.
4. **Backlog `llm_provider` shell status**: Listed under "Shell packages remaining" — should be removed.
5. **Slice 0034 card**: `Approval: pending` header vs backlog treating it as planned/approved. Card should reflect CRITICAL C1/C2 resolution status.
6. **Slice 0035 card**: Claims `ChannelIngressPayload` is "available from @argentum/contracts" — it is not yet created.

---

## Recommended Corrective Actions

1. **Update slice cards 0031, 0032, 0033** to `State: implemented` with implementation dates, test counts, and Implementation Summary sections following the pattern established in slice 0030's card.
2. **Refresh backlog Pipeline State**: update implementation cursor to 0033, list only 0034–0035 as planned, remove `llm_provider` from shell packages, update test counts to include llm_provider (~54 tests), update implemented-slice count (13 slices: 0020–0033 excluding 0034–0035).
3. **Update `ALLOWED_TRANSITIONS`** in `packages/agentic_core/src/turn-state-machine.ts` to add `building_context→aborted` and `inferring→aborted` edges (prerequisite for slice 0034). Update the spec `docs/spec/30-core-loop/core-loop-state-machine.md` to document these transitions.
4. **Update slice 0034 card**: set `Approval` to reflect CRITICAL C1/C2 resolved status, note the state-machine-update prerequisite status.
5. **Fix slice 0035 card**: correct the Execution readiness line to note that `ChannelIngressPayload` must be created, not that it's already available.
6. **Document or remove `unexpected_validation_error` abort path** in slice 0030 card acceptance criteria.
7. **Add `@argentum/llm-provider` workspace dependency and tsconfig reference** to `packages/agentic_core/` (prerequisite for slice 0034).

---

## Next-Slice Readiness

- **Verdict**: `ready-with-risks`
- **Blocking issues**:
  - **H3**: `ALLOWED_TRANSITIONS` and spec missing two transition edges needed by slice 0034 — **must be resolved before 0034 implementation**
  - **H1**: Slice cards 0031–0033 stale — does not block implementation but misleads planning
  - **H2**: Backlog stale — does not block implementation but misleads orchestration
- **Safe next actions**:
  - Implement slice 0035 (CLI Input Normalization) — has no code dependencies on the state machine update; only needs `ChannelIngressPayload` type added to contracts first
  - Refresh planning artifacts (cards 0031–0033, backlog) — safe read/write operations
  - Update `ALLOWED_TRANSITIONS` and spec — small, bounded change to turn-state-machine.ts and core-loop-state-machine.md
