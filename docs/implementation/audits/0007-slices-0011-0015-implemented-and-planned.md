# Implementation Audit

## Metadata

- Audit scope: implemented slices 0011 and 0012, plus planned slices 0013 through 0015
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
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
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
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/implementation-plan.md](../implementation-plan.md)
  - [docs/implementation/audits/0006-slices-0011-0012-release-dequeue-and-context-item-audit.md](./0006-slices-0011-0012-release-dequeue-and-context-item-audit.md)
  - [docs/implementation/audits/0005-slices-0011-0016-planned-readiness.md](./0005-slices-0011-0016-planned-readiness.md)

## Findings By Severity

### High

- **H1 — Append-surface/post-commit gap in slice 0011 release-and-dequeue**: The `releaseActiveTurnAndDequeue` function in [packages/gateway/src/release-and-dequeue.ts](../../../packages/gateway/src/release-and-dequeue.ts#L168) calls `finalizing_append_surface.append()` after the SQLite transaction has already committed inside the store. If `append()` throws, the dequeue mutation is durably committed (queue head removed, new claim state written) but the caller loses the `released_with_next` result entirely — no handoff, no new authority, and no dequeued ingress identity is returned to the caller. The durable replay log (`gateway_finalizing_event_log`) does preserve the `queue.dequeued` event in transaction order, but there is no caller-accessible recovery path exposed by the module. This is a partial remediation of audit 0006's H1 (changed from swallowed to thrown), but the caller still faces a committed state change with no returned handoff.

  The slice acceptance criteria require: *"If persistence fails after release work begins, the slice must not leave behind caller-visible partial state such as an unlocked session with the dequeued ingress removed but no dequeue handoff."* The current implementation leaves behind exactly this: dequeued ingress removed, new claim written, no handoff returned to caller.

### Medium

- **M1 — `ToolCallDTO.arguments` non-empty constraint conflicts with `ActionDecision` empty-arguments acceptance in planned slice 0014**: Slice 0014's acceptance criteria specifies `arguments` must be non-empty ("at least one own key"), while the upstream `ActionDecision` contract in slice 0013 explicitly accepts empty objects `{}` for `tool_calls` array entries ("parameterless tool call is valid per spec"). The authoritative spec for `ToolCallDTO` ([docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md)) states `arguments` type is "object" with no non-empty constraint. The core-loop mapping from `ActionDecision.tool_calls` to `ToolCallDTO` creation will face a transformation gap unless this inconsistency is resolved before 0014 implementation.

- **M2 — `GatewayFinalizingEventAppendSurface` contract does not express failure in its type signature**: The interface in [packages/gateway/src/release-and-dequeue.ts](../../../packages/gateway/src/release-and-dequeue.ts#L47-L48) declares `append(event): void`, but the runtime behavior (and tests) expect it to throw on failure. The type does not communicate that callers must handle append failures. While TypeScript does not have checked exceptions, explicitly documenting throw behavior in the interface JSDoc or changing the return to a result type would close the contract gap.

### Low

- **L1 — Duplicated validation helpers across contracts modules**: `context-item.ts`, `content-ref.ts`, `stream-event.ts`, and `ingress-contract.ts` each inline their own copies of `parseStringValue`, `expectRecord`, `pushUnknownKeys`, `joinPath`, etc. This is acknowledged in slice 0014's plan as a "future refactor candidate" but grows with each new contract module. No behavioral drift from this duplication, but maintenance cost increases.

- **L2 — `ContextItemValidationCode` redundantly redeclares `ContentRefValidationCode` literals**: The union type in [packages/contracts/src/context-item.ts](../../../packages/contracts/src/context-item.ts#L34-L39) repeats literal members already declared in `ContentRefValidationCode`. This is consistent with the pre-existing `TurnEnvelopeValidationCode` pattern and causes no runtime harm, but inflates the type-space and requires manual synchronization if `ContentRefValidationCode` changes.

- **L3 — Backlog ordering could reflect parallel-safe relationship between 0013 and 0015**: The backlog lists slices 0013 → 0015 → 0014 as a sequential chain. Slice 0015's card explicitly states it "can run before, after, or in parallel with 0013." The backlog could note this parallelism opportunity without changing the safe sequential ordering.

## Drift By Category

### Spec drift

- **Slices 0011, 0012 (implemented)**: No material spec drift found. Slice 0011 correctly implements FIFO oldest-queued dequeue, `queue.dequeued` event payload minimums (`session_id`, `ingress_id`, `queue_length`), authority delegation to slice 0010 seam, and claim-lifecycle advancement. Slice 0012 correctly enforces all `ContextItem` field types, literals, optional semantics, and `ContentRef` composition exactly as specified in [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md).

- **Slice 0014 (planned)**: Potential spec drift in `ToolCallDTO.arguments` non-empty constraint (see M1). The spec says "object" with no non-empty requirement. The slice card adds "at least one own key" not present in the authoritative spec.

### Boundary drift

- **Slice 0011**: The `GatewayFinalizingEventAppendSurface` type signature (`void` return) under-expresses the failure contract (see M2). The runtime correctly delegates authority consumption to slice 0010 and does not fork authority validation. Output types (`GatewayTurnStartHandoff`, `GatewayDequeuedStreamEvent`) match the shared shapes owned by slices 0009 and 0004 respectively.

- **Slices 0012–0015**: All remain properly scoped to the `contracts` package with no boundary leakage into runtime, gateway, tooling, or provider packages.

### Validation or test drift

- **Slice 0011**: The append-failure test in [packages/gateway/tests/release-and-dequeue.test.ts](../../../packages/gateway/tests/release-and-dequeue.test.ts#L422-L485) correctly validates that the throw propagates and that the queue is drained. However, it does not validate that the lost handoff can be recovered — it only asserts the drained-queue aftermath. The test was updated from audit 0006 (which flagged it as validating the wrong outcome) and now correctly expects the throw, but does not cover the caller-recovery path.

- **Slice 0012**: No validation drift. All 55 tests pass and cover every acceptance criterion.

### Planning-artifact drift

- **Backlog and slice cards**: All consistent. Slice 0011 card status is `validated`, slice 0012 is `implemented`, slices 0013–0015 are `planned`/`approved`. The backlog next-actions list correctly reflects current state.

- **Slice 0011 review log**: Contains post-implementation adversarial review findings inline. The findings are accurately paired with refinements. No stale or contradictory statements.

### Deferred-decision leakage

- None found. All slices respect frozen MVP rules. Local SQLite persistence (bootstrap-decision) is consistently referenced. No ad hoc resolution of deferred decisions from [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md).

## Missing Tests Or Weak Validation

### Slice 0011 (implemented)

- **No caller-recovery test after append-surface failure**: The append-failure test proves the throw propagates and the queue is drained, but does not prove a caller can reconstruct the handoff from durable state. A recovery-path test (e.g., re-reading claim state and replay log after an append throw and constructing a new handoff) would close the gap identified in H1.
- **No test for the crash-after-dequeue-but-before-caller-uses-handoff scenario**: The durable replay log stores the event, but no test proves that a restarted process can read `gateway_finalizing_event_log` and `gateway_sessions` to reconstruct the dequeue handoff.

### Slice 0012 (implemented)

- Tests are comprehensive (55 tests). No gaps identified against acceptance criteria. Coverage includes all canonical literals, non-coercion for all field types, optional field presence/absence, nested `ContentRef` validation, bulk-missing, unknown keys, array ordering, empty arrays, all-invalid arrays, immutability, and error class construction.

### Slices 0013–0015 (planned, not implemented)

- No implementation tests exist yet. This is expected. The test specifications in each slice card are detailed and match the density established by slice 0012.

## Stale Or Inconsistent Planning Artifacts

- **Backlog**: Current and accurate. No stale slice statuses.
- **Slice 0011 card**: Review log is thorough but lengthy (200+ lines). The `approved by: adversarial review follow-up` field is a bit vague compared to other cards which name the specific review round.
- **Slice 0012 card**: Correctly marked `implemented` with implementation date 2026-05-23 and 55 tests noted.
- **Slice 0013 card**: Review log shows all adversarial findings (H1, M1, M2, L1-L3) fully resolved. `Execution readiness: ready` is accurate given 0012 is now implemented.
- **Slice 0014 card**: `Execution readiness: ready-after-dependency` is accurate. The `arguments` non-empty issue (M1) should be resolved before implementation begins.
- **Slice 0015 card**: `Execution readiness: ready` is accurate. Can proceed in parallel with 0013.

## Deferred-Decision Leakage Or Unsafe Assumptions

- None detected. All slices defer unresolved choices to the spec's deferred-decisions registry. No slice invents answers for post-MVP expansion items (parallel execution, queue coalescing, cross-process locks, role taxonomy expansion, network policy modes beyond `deny`/`inherit`).

## Recommended Corrective Actions

1. **H1 (Slice 0011)**: Consider one of two approaches: (a) move the caller-facing `finalizing_append_surface.append()` call inside the SQLite transaction so append failure triggers rollback, or (b) change the append surface to return a result type instead of throwing, and have the release function return a partial-success variant that includes the handoff even when append fails. Either approach should be accompanied by a caller-recovery test.

2. **M1 (Slice 0014)**: Resolve the `arguments` non-empty constraint before implementing slice 0014. Either (a) remove the non-empty constraint from the 0014 acceptance criteria to match the spec, or (b) document explicitly how the core-loop mapping from `ActionDecision.tool_calls` to `ToolCallDTO` will handle empty-arguments parameterless tool calls, and update the spec if needed.

3. **M2 (Slice 0011)**: Add JSDoc to `GatewayFinalizingEventAppendSurface.append()` documenting that it throws on failure. Alternatively, change the return type to a result discriminated union.

4. **L1/L2 (Contracts)**: After slices 0013–0015 land, extract shared validation helpers to `packages/contracts/src/validation-helpers.ts` as a non-blocking cleanup.

5. **L3 (Backlog)**: Optionally annotate the backlog next-actions to note that 0013 and 0015 can run in parallel.

## Next-Slice Readiness

- **Verdict**: ready-with-risks
- **Blocking issues**: None that prevent starting slice 0013 or 0015.
  - H1 (append-surface/post-commit gap) is a gateway concern that does not affect contracts-only slices 0013, 0015, or 0016.
  - M1 (`arguments` non-empty) must be resolved before slice 0014 implementation, not before 0013 or 0015.
- **Safe next actions**:
  - Start slice 0013 (`ActionDecision`) immediately — it is a contracts-only surface with no runtime dependencies and an established implementation pattern.
  - Start slice 0015 (`ExecutionGrantDTO`) in parallel with or immediately after 0013 — it is also a contracts-only surface with no cross-dependency on 0013.
  - Resolve M1 before starting slice 0014 (`ToolCallDTO`/`ToolResultDTO`).
  - Address H1 in slice 0011 before any downstream gateway work that depends on the release-and-dequeue seam.

## Audit Report Path

- `docs/implementation/audits/0007-slices-0011-0015-implemented-and-planned.md`
