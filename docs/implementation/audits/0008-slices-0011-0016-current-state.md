# Implementation Audit

## Metadata

- Audit scope: implemented slices 0011 and 0012, plus planned slices 0013 through 0016
- Auditor: GitHub Copilot (argentum-implementation-auditor)
- Audit date: 2026-05-23
- Repo readiness verdict: ready-with-risks

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md)
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md)
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md)
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md)
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md)
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
  - [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md)
- Implementation files:
  - [packages/gateway/src/release-and-dequeue.ts](../../../packages/gateway/src/release-and-dequeue.ts)
  - [packages/gateway/src/active-turn-claim.ts](../../../packages/gateway/src/active-turn-claim.ts)
  - [packages/gateway/src/turn-creation.ts](../../../packages/gateway/src/turn-creation.ts)
  - [packages/gateway/src/index.ts](../../../packages/gateway/src/index.ts)
  - [packages/gateway/tests/release-and-dequeue.test.ts](../../../packages/gateway/tests/release-and-dequeue.test.ts)
  - [packages/contracts/src/context-item.ts](../../../packages/contracts/src/context-item.ts)
  - [packages/contracts/src/index.ts](../../../packages/contracts/src/index.ts)
  - [packages/contracts/tests/context-item.test.ts](../../../packages/contracts/tests/context-item.test.ts)
- Slice cards:
  - [docs/implementation/slices/0011-gateway-lock-release-and-queue-dequeue.md](../slices/0011-gateway-lock-release-and-queue-dequeue.md)
  - [docs/implementation/slices/0012-contracts-context-item.md](../slices/0012-contracts-context-item.md)
  - [docs/implementation/slices/0013-contracts-action-decision.md](../slices/0013-contracts-action-decision.md)
  - [docs/implementation/slices/0014-contracts-tool-call-and-result.md](../slices/0014-contracts-tool-call-and-result.md)
  - [docs/implementation/slices/0015-contracts-execution-grant.md](../slices/0015-contracts-execution-grant.md)
  - [docs/implementation/slices/0016-contracts-llm-adapter-boundary.md](../slices/0016-contracts-llm-adapter-boundary.md)
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/implementation-plan.md](../implementation-plan.md)
  - [docs/implementation/audits/0007-slices-0011-0015-implemented-and-planned.md](./0007-slices-0011-0015-implemented-and-planned.md)

## Findings By Severity

### High

None. All HIGH findings from audit 0007 have been resolved:

- **Audit 0007 H1 (append-surface/post-commit gap) — RESOLVED**: The `finalizing_append_surface.append()` call now occurs inside the SQLite transaction in `releaseAndDequeueInSqlite`. An append throw triggers `rollbackTransaction()` in the catch block, atomically preserving both queue state and claim state. Verified in tests: "rolls back dequeue mutation when append surface fails inside the transaction" (line 422) and "rolls back queue mutations when claiming the dequeued next turn fails after dequeue steps" (line 488).

### Medium

- **M1 — Slice 0015 `parseExecutionGrantAtPath` export status conflicts with 0014 dependency**: The 0014 slice card states it requires `parseExecutionGrantAtPath` to be exported from 0015's module. The 0015 plan marks this function as "Internal" (`Internal parseExecutionGrantAtPath`). The 0014 Dependency Note explicitly calls this out: *"this must be changed to exported before 0014 implementation begins."* If 0015 ships without changing this to exported, 0014 must fall back to a try/catch wrapper around `parseExecutionGrant`, losing path-prefix fidelity. This is a planning-artifact inconsistency between two mutually dependent planned slices.

- **M2 — Slice 0014's shared-validation-helper extraction carries refactoring risk**: Slice 0014's plan includes extracting four byte-identical shared helpers (`expectRecord`, `joinPath`, `pushUnknownKeys`, `isPlainObject`) from 6 existing contract modules into a new `validation-helpers.ts`. This is a cross-module refactoring that touches all existing contracts. If extraction introduces any regression, it could block 0014's own validation gate. The 0014 card correctly scopes the extraction to only the four truly identical helpers, leaving `parseRequiredString`/`parseOptionalString` (which have per-module semantics) untouched. Risk is contained but merits careful review during 0014 implementation.

- **M3 — Slice 0016 path-fidelity limitation for `context_items` nested validation**: `parseContextItemAtPath` is not exported from `context-item.ts` (it is a private function). Slice 0016 must catch `ContextItemValidationError` from `parseContextItemArray` and re-emit issues with a `context_items.` prefix. While `parseContextItemArray` already produces indexed paths like `[0].context_id`, the concatenated result will be `context_items.[0].context_id` — a double-dot path format that is unambiguous but inconsistent with the path format used elsewhere (e.g., `content_ref.ref_id`). Not blocking, but tracked in the 0016 card as a known limitation.

### Low

- **L1 — Duplicated validation helpers across contracts modules** (carried forward from audit 0007 L1): `context-item.ts`, `content-ref.ts`, `stream-event.ts`, `ingress-contract.ts`, `turn-envelope.ts`, and `message-part.ts` each inline their own copies of `expectRecord`, `joinPath`, `pushUnknownKeys`, and `isPlainObject`. Slice 0014 plans to extract these four functions. No behavioral impact but maintenance cost persists until extraction.

- **L2 — `ContextItemValidationCode` redundantly redeclares `ContentRefValidationCode` literals** (carried forward from audit 0007 L2): The union type in `context-item.ts` repeats literal members from `ContentRefValidationCode`. Consistent with the pre-existing `TurnEnvelopeValidationCode` pattern. No runtime harm.

- **L3 — `parseContextItemAtPath` not exported despite established `parseContentRefAtPath` precedent**: The `content-ref.ts` module exports `parseContentRefAtPath` for cross-module composition, and it is used by `context-item.ts`, `turn-envelope.ts`, and will be used by slices 0013, 0014, 0015, 0016. The `context-item.ts` module does not export its equivalent `parseContextItemAtPath`, forcing downstream consumers (slice 0016, future core loop) into try/catch wrappers. This is an API-consistency gap across contracts modules.

## Drift By Category

### Spec drift

- **Slice 0011 (implemented)**: No spec drift. Release semantics correctly implement FIFO oldest-queued dequeue, `queue.dequeued` event payload minimums (`session_id`, `ingress_id`, `queue_length`), authority delegation to slice 0010 seam, claim-lifecycle advancement, and atomic transaction rollback on append failure — all as specified in [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md).

- **Slice 0012 (implemented)**: No spec drift. All `ContextItem` field types, literals, optional semantics, non-coercion rules, and `ContentRef` composition match [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md) exactly.

- **Slices 0013–0016 (planned)**: No spec drift found in planned acceptance criteria. All field tables, literal unions, conditional rules, and cross-field constraints match the authoritative spec. Notably:
  - 0013's `abort` message is correctly optional (spec: "most abort outcomes")
  - 0014's `arguments` correctly accepts empty objects (spec: `object`, tool-layer owns schema validation per `tool-registry.md`)
  - 0014's `timeout_ms` positivity constraint is a correct transitive derivation from `grant.max_runtime_ms`
  - 0016's `inference_policy` correctly defers subfield validation (spec: "deferred to DeepSeek adapter MVP")

### Boundary drift

- **Slice 0011**: Authority consumption properly delegates to slice 0010 (`consumeGatewayTurnCreationAuthorityInCurrentTransaction`). Turn-start handoff creation reuses slice 0009's `createGatewayTurnStartHandoff`. `GatewayFinalizingEventAppendSurface` JSDoc now documents throw-on-failure contract (M2 from audit 0007 resolved). No boundary leakage into core loop, tooling, or provider packages.

- **Slices 0012–0016**: All remain properly scoped to the `contracts` package. No boundary leakage into runtime, gateway, agentic_core, tooling, or llm_provider packages. Cross-module composition (0014 → 0015 grant validation, 0016 → 0013 decision validation, 0016 → 0012 context-item validation) uses only public contracts-package exports with explicit dependency documentation.

### Validation or test drift

- **Slice 0011**: 9 test cases cover all acceptance criteria plus edge cases. Test coverage includes: empty-queue release (no `queue.*` event), FIFO dequeue with `queue.dequeued` payload verification, append-surface failure rollback, claim-failure rollback, metadata-allocation failure rollback, retry-after-transient-failure, durable replay ordering (`queue.dequeued` before terminal `turn.*`), bypassed-authority rejection, and repeated-release-after-success staleness. The append-failure test (line 422) validates both the throw propagation and the queue/claim state preservation after rollback.

- **Slice 0012**: 55 contract tests pass. Coverage includes all canonical literals, non-coercion for all required string fields (`context_id`, `role`, `origin`), `Number.isInteger()` semantics for `token_estimate` (including `NaN`/`Infinity`/negative acceptance), optional `version` presence/absence/non-coercion, nested `ContentRef` validation, bulk-missing, unknown keys, array ordering, empty arrays, all-invalid arrays, immutability, and error class construction.

- **Slices 0013–0016 (planned)**: No implementation tests exist yet. This is expected. Test specifications in each slice card match the density established by slice 0012.

### Planning-artifact drift

- **Backlog**: Current and accurate. All resolved audit 0007 findings (H1, M1, M2, L3) are reflected in the backlog status entries. The next-actions list correctly identifies the parallel-safe relationship between 0013 and 0015.
- **Slice 0011 card**: Status `validated`. Review log documents H1/M2 resolution (2026-05-23). The `approved by: adversarial review follow-up` field is somewhat vague compared to other cards.
- **Slice 0012 card**: Status `implemented`. Implementation log documents all 55 tests and post-implementation adversarial review refinements.
- **Slice 0013 card**: Status `planned`, `Execution readiness: ready`. All adversarial review findings (H1, M1, M2, L1-L3) resolved in tightening pass.
- **Slice 0014 card**: Status `planned`, `Execution readiness: ready-after-dependency`. M1 (`arguments` non-empty) resolved. Dependency on 0015's `parseExecutionGrantAtPath` export documented.
- **Slice 0015 card**: Status `planned`, `Execution readiness: ready`. Second adversarial review passed with MEDIUM findings resolved.
- **Slice 0016 card**: Status `planned`, `Execution readiness: ready-after-dependency`. Dependencies accurately documented (0012 implemented, 0013 must-precede; 0014/0015 NOT dependencies).

### Deferred-decision leakage

- None found. All slices respect frozen MVP rules. The deferred "exact local persistence technology" decision (from [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md)) is resolved via the bootstrap decision for local SQLite and consistently applied. No ad hoc resolution of remaining deferred items:
  - Exact initial tool catalog (deferred)
  - Exact DeepSeek endpoint/model (deferred)
  - Exact compaction size thresholds (deferred)
  - `inference_policy` subfields (deferred to DeepSeek adapter MVP per 0016's acceptance criteria)

## Missing Tests Or Weak Validation

### Slice 0011 (implemented)

- **No caller-visible recovery-path test after append-surface failure**: The append-failure test (line 422) proves the transaction rolls back and queue/claim state is preserved. It does not prove that a caller can reconstruct a dequeue handoff from durable state after a failed attempt. This is a recovery-path gap — the caller knows the operation threw, but has no programmatic path to resume. The "recovers on retry" test (line 356) covers metadata-allocation failure recovery, but not append-failure recovery (append happens inside the transaction; a second attempt with the same authority would see `authority_consumed` status from the first attempt's rollback... actually, rollback would undo the consumption too, so a retry should work). This scenario is not explicitly tested.

### Slice 0012 (implemented)

- Tests are comprehensive (55 tests). No gaps identified against acceptance criteria.

### Slices 0013–0016 (planned)

- No implementation tests exist yet. Expected for planned slices.

## Stale Or Inconsistent Planning Artifacts

- **Slice 0015 `parseExecutionGrantAtPath` export status** (see M1): The 0015 plan marks `parseExecutionGrantAtPath` as "Internal." The 0014 Dependency Note states it "must be changed to exported before 0014 implementation begins." These two cards are inconsistent. The 0015 card should be updated to reflect the export requirement before implementation begins, or the 0014 card should commit to the try/catch fallback.

- **Slice 0014 dependency note references "verified 2026-05-23"**: The note reads "The 0015 plan already commits to exporting `parseExecutionGrantAtPath`. Verified 2026-05-23." However, the current 0015 card text still shows "Internal `parseExecutionGrantAtPath`" — verification appears to have been optimistic or the 0015 card was not updated after verification.

- **Slice 0013 `approved by: planning synthesis`**: Consistent with other planned slices. The adversarial review log documents full resolution of all findings. The approval field could be updated to reflect the adversarial review pass (similar to 0012's "approved by: adversarial review") but this is cosmetic.

## Deferred-Decision Leakage Or Unsafe Assumptions

- None detected. All six slices defer unresolved choices to the spec's deferred-decisions registry. No slice invents answers for post-MVP expansion items (parallel execution, queue coalescing, cross-process locks, role taxonomy expansion, network policy modes beyond `deny`/`inherit`, `inference_policy` subfields, initial tool catalog, compaction thresholds).

## Recommended Corrective Actions

1. **M1 (Slice 0015)**: Update the 0015 slice card to mark `parseExecutionGrantAtPath` as exported (not "Internal") before 0015 implementation begins. This aligns the 0015 card with the 0014 dependency requirement and avoids the try/catch fallback path.

2. **M2 (Slice 0014)**: When extracting shared validation helpers, run `pnpm --filter @argentum/contracts test` after each individual extraction (one helper at a time) rather than extracting all four at once. The existing 178 contract tests provide sufficient regression coverage if applied incrementally.

3. **M3 (Slice 0016)**: Consider one of two approaches for `context_items` path fidelity: (a) export `parseContextItemAtPath` from `context-item.ts` (following the `parseContentRefAtPath` precedent), or (b) document the `context_items.[N]` path format explicitly in the 0016 implementation log and ensure test assertions match this format.

4. **L3 (Slice 0012)**: Export `parseContextItemAtPath` from `context-item.ts` for cross-module composition, matching the `parseContentRefAtPath` precedent. This is a non-breaking addition that simplifies slice 0016 and future core-loop composition.

5. **Slice 0011 test gap**: Add a test proving that a retry after an append-surface failure (using the same authority) successfully releases and dequeues. The current retry test (line 356) only covers metadata-allocation failure, not append failure inside the transaction.

## Next-Slice Readiness

- **Verdict**: ready-with-risks
- **Blocking issues**: None that prevent starting slice 0013 or 0015.
  - M1 (`parseExecutionGrantAtPath` export) must be resolved before 0014 implementation, not before 0013 or 0015.
  - M2 (validation-helper extraction risk) is confined to 0014's implementation scope.
  - M3 (path-fidelity limitation) is a 0016 concern and does not block 0013 or 0015.
  - All audit 0007 HIGH/MEDIUM findings are resolved.
- **Safe next actions**:
  - Start slice 0013 (`ActionDecision`) immediately — contracts-only, no runtime dependencies, established implementation pattern, all adversarial review findings resolved.
  - Start slice 0015 (`ExecutionGrantDTO`) in parallel with 0013 — contracts-only, no cross-dependency on 0013, second adversarial review passed. Update the card to confirm `parseExecutionGrantAtPath` will be exported before implementation begins (see M1).
  - After 0013 lands, start slice 0016 (`LLMInferenceRequest`/`LLMInferenceResult`) — contracts-only, depends only on 0013 (and already-implemented 0012).
  - After 0015 lands AND M1 is resolved, start slice 0014 (`ToolCallDTO`/`ToolResultDTO`).
  - Address L3 (export `parseContextItemAtPath`) before or during 0016 implementation to avoid the try/catch path-fidelity loss.

## Audit Report Path

- `docs/implementation/audits/0008-slices-0011-0016-current-state.md`
