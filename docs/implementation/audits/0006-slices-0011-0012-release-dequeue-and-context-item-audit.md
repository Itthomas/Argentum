# Implementation Audit

## Metadata

- Audit scope: planned slice 0011 and look-ahead slice 0012, with validation-state review of the gateway release/dequeue seam and the next contracts-first slice
- Auditor: GitHub Copilot (GPT-5.4 mini)
- Audit date: 2026-05-23
- Repo readiness verdict: not-ready

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Implementation files:
  - [packages/gateway/src/release-and-dequeue.ts](../../../packages/gateway/src/release-and-dequeue.ts)
  - [packages/gateway/tests/release-and-dequeue.test.ts](../../../packages/gateway/tests/release-and-dequeue.test.ts)
  - [packages/gateway/src/active-turn-claim.ts](../../../packages/gateway/src/active-turn-claim.ts)
  - [packages/gateway/src/turn-creation.ts](../../../packages/gateway/src/turn-creation.ts)
  - [packages/contracts/src/index.ts](../../../packages/contracts/src/index.ts)
  - [packages/contracts/src/stream-event.ts](../../../packages/contracts/src/stream-event.ts)
- Slice cards:
  - [docs/implementation/slices/0011-gateway-lock-release-and-queue-dequeue.md](../slices/0011-gateway-lock-release-and-queue-dequeue.md)
  - [docs/implementation/slices/0012-contracts-context-item.md](../slices/0012-contracts-context-item.md)
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/implementation-plan.md](../implementation-plan.md)
  - [docs/implementation/audits/0005-slices-0011-0016-planned-readiness.md](./0005-slices-0011-0016-planned-readiness.md)

## Findings By Severity

- High:
  - The 0011 release/dequeue implementation swallows append-surface failures after queue mutation has already been committed, so caller-visible event publication can diverge from the durable queue transition. In [packages/gateway/src/release-and-dequeue.ts](../../../packages/gateway/src/release-and-dequeue.ts#L47-L48) the append surface is defined as a `void` method, and in [packages/gateway/src/release-and-dequeue.ts](../../../packages/gateway/src/release-and-dequeue.ts#L168-L170) the code catches and ignores failures from `finalizing_append_surface.append(...)`. That conflicts with the slice requirement for one deterministic append surface with explicit failure signaling in [docs/implementation/slices/0011-gateway-lock-release-and-queue-dequeue.md](../slices/0011-gateway-lock-release-and-queue-dequeue.md#L11).
- Medium:
  - The current validation suite reinforces the same drift instead of fencing it off. [packages/gateway/tests/release-and-dequeue.test.ts](../../../packages/gateway/tests/release-and-dequeue.test.ts#L422) explicitly asserts that append-surface failure after commit still yields a successful `released_with_next` result, which means the test suite will pass even if caller-visible dequeue publication is lost.
- Low:
  - Slice 0012 is still correctly queued, but the repo is not ready to start it because 0011 remains blocked and the contracts slice is still pending re-approval. [docs/implementation/backlog.md](../backlog.md#L25-L26) and [docs/implementation/slices/0012-contracts-context-item.md](../slices/0012-contracts-context-item.md#L5-L6) both reflect that gating. The slice card’s remaining approval gap around optional `version` and normative-source wording remains unresolved at the planning layer, not in code.

## Drift By Category

- Spec drift:
  - 0011 violates the spec-card intent that queue publication and terminal-turn publication use one deterministic append surface with explicit failure signaling. The implementation currently treats append failures as ignorable after the state change has already been committed.
- Boundary drift:
  - The `GatewayFinalizingEventAppendSurface` boundary in [packages/gateway/src/release-and-dequeue.ts](../../../packages/gateway/src/release-and-dequeue.ts#L47-L48) does not express failure as part of the contract, which makes the caller-side append path semantically weaker than the slice card describes.
- Validation or test drift:
  - The append-failure test in [packages/gateway/tests/release-and-dequeue.test.ts](../../../packages/gateway/tests/release-and-dequeue.test.ts#L422) validates the wrong outcome and therefore cannot catch regressions in append/commit coupling.
- Planning-artifact drift:
  - No stale or contradictory planning artifact was found for 0011. The backlog and slice card agree that it remains blocked. 0012 also remains correctly pending re-approval and queued behind 0011.
- Deferred-decision leakage:
  - No deferred-decision leakage was found. The local SQLite persistence choice remains consistent with the bootstrap decisions and with both slice cards.

## Missing Tests Or Weak Validation

- There is no test that asserts a `finalizing_append_surface` failure is surfaced to the caller or represented as an explicit failure result instead of being swallowed.
- There is no regression test that proves a commit-successful dequeue cannot silently lose caller-visible publication while still returning success.
- The existing append-failure test should be replaced, not just supplemented, because it currently certifies the wrong contract shape.

## Stale Or Inconsistent Planning Artifacts

- None that require immediate rewrite.
- The current backlog and slice cards are internally consistent about the state of 0011 and the re-approval requirement for 0012.

## Recommended Corrective Actions

1. In slice 0011, change the release/dequeue path so append-surface failures are not ignored after commit. Either propagate the failure or model an explicit failure result that keeps the append contract truthful.
2. In slice 0011 tests, replace the current append-failure expectation with a regression that fails when publication cannot be completed, and keep the queue-state rollback coverage that already protects the earlier mutation boundary.
3. Keep slice 0012 queued until 0011 is validated again, then re-run the 0012 approval review with the explicit optional `version` acceptance and normative contracts wording already called out in the slice card and backlog.

## Next-Slice Readiness

- Verdict: not-ready
- Blocking issues:
  - Slice 0011 still has an unresolved commit-edge failure-semantic gap around append-surface handling.
  - Slice 0012 remains intentionally blocked behind 0011 validation and its pending re-approval.
- Safe next actions:
  - Fix 0011 append-surface failure handling and rerun the gateway boundary tests.
  - Once 0011 is validated, re-approve 0012 and then start the contracts-first slice sequence.