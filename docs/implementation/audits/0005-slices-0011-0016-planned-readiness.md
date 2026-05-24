# Implementation Audit

## Metadata

- Audit scope: planned slices 0011 through 0016 (gateway release/dequeue seam and contracts look-ahead cluster)
- Auditor: GitHub Copilot (GPT-5.3-Codex)
- Audit date: 2026-05-23
- Repo readiness verdict: ready-with-risks

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md)
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md)
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md)
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md)
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md)
  - [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
  - [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md)
- Implementation files:
  - [packages/gateway/src/index.ts](../../../packages/gateway/src/index.ts)
  - [packages/gateway/src/active-turn-claim.ts](../../../packages/gateway/src/active-turn-claim.ts)
  - [packages/gateway/src/turn-creation.ts](../../../packages/gateway/src/turn-creation.ts)
  - [packages/gateway/tests/active-turn-claim.test.ts](../../../packages/gateway/tests/active-turn-claim.test.ts)
  - [packages/gateway/tests/turn-creation.test.ts](../../../packages/gateway/tests/turn-creation.test.ts)
  - [packages/contracts/src/index.ts](../../../packages/contracts/src/index.ts)
  - [packages/contracts/src/content-ref.ts](../../../packages/contracts/src/content-ref.ts)
  - [packages/contracts/src/runtime-policy.ts](../../../packages/contracts/src/runtime-policy.ts)
  - [packages/contracts/tests/package-entrypoint.test.ts](../../../packages/contracts/tests/package-entrypoint.test.ts)
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
  - [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md)
  - [docs/implementation/audits/0004-slices-0001-0010-with-0011-planned.md](./0004-slices-0001-0010-with-0011-planned.md)

## Findings By Severity

- High:
  - No high-severity drift was found for this scope. The planned cards for 0011 through 0016 remain aligned with authoritative contract and boundary specs.
- Medium:
  - Validation evidence for this scope is still plan-only. There is no implemented release-and-dequeue seam in `@argentum/gateway` and no implemented contract surfaces for `ContextItem`, `ActionDecision`, `ExecutionGrantDTO`, `ToolCallDTO` or `ToolResultDTO`, and `LLMInferenceRequest` or `LLMInferenceResult` in `@argentum/contracts` yet. This is expected from slice status, but it remains the primary readiness risk for starting downstream package work.
  - The gateway lifecycle remains intentionally incomplete until slice 0011 lands. Current implementation and tests cover claim and turn-start creation seams, but do not yet prove lock release during `finalizing`, oldest-queued dequeue promotion, or `queue.dequeued` ordering before caller-owned terminal `turn.*` emission.
- Low:
  - Slice 0012 includes an execution-readiness dependency on slice 0011 stabilization. That dependency is conservative but not strictly required by the `ContextItem` contract spec itself; keeping it hard-coupled can delay contract-first progress without adding contract correctness guarantees.

## Drift By Category

- Spec drift:
  - No material drift found in the planned acceptance criteria for 0011 through 0016 relative to the reviewed spec leaves.
- Boundary drift:
  - No boundary ownership conflicts found in slice definitions. Slice 0011 remains gateway-local and keeps core-loop and archival behavior out of scope; slices 0012 through 0016 remain contracts-only.
- Validation or test drift:
  - Expected drift remains: required tests for slices 0011 through 0016 are not present yet because these slices have not started implementation.
- Planning-artifact drift:
  - Backlog queue, slice statuses, and prior audit state are synchronized for this scope.
  - Minor sequencing conservatism exists where slice 0012 readiness is coupled to 0011 despite being a contracts-only surface.
- Deferred-decision leakage:
  - No unsafe leakage found. Local SQLite persistence is explicitly documented in bootstrap decisions and referenced consistently by slice 0011.

## Missing Tests Or Weak Validation

- Missing by design until slice 0011 implementation:
  - Atomic release-plus-dequeue tests that prevent partial-state exposure.
  - FIFO preservation tests for dequeue under concurrent ingress pressure.
  - Canonical `queue.dequeued` event-shape tests (including payload minimums and allocator-supplied top-level metadata).
  - Event-order tests proving `queue.dequeued` occurs during `finalizing` before caller-owned terminal `turn.completed` or `turn.aborted` emission.
  - Claim-lifecycle tests proving stale prior-turn authority cannot survive a successful release path.
- Missing by design until slices 0012 through 0016 implementation:
  - Contract parser or validator tests for canonical `ContextItem` fields and `ContentRef` composition.
  - Contract parser or validator tests for `ActionDecision` kind-conditioned field requirements and normalized tool-call entries.
  - Contract parser or validator tests for `ExecutionGrantDTO` vocabularies and path-permission entry constraints.
  - Contract parser or validator tests for `ToolCallDTO` and `ToolResultDTO`, including `timeout_ms = grant.max_runtime_ms` MVP invariant.
  - Contract parser or validator tests for `LLMInferenceRequest` and `LLMInferenceResult` composition with canonical nested contracts.

## Stale Or Inconsistent Planning Artifacts

- No blocking stale artifacts found in this scope.
- The backlog ordering remains dependency-safe (`0012 -> 0013 -> 0015 -> 0014 -> 0016`) after 0011.
- Non-blocking improvement opportunity: clarify whether slice 0012 may proceed independently of 0011 when treated strictly as a contracts-only surface.

## Deferred-Decision Leakage Or Unsafe Assumptions

- No unsafe deferred-decision resolution detected.
- Assumption to monitor: slice 0011 references SQLite-backed behavior; this remains safe while it stays tied to [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md) and does not introduce persistence-technology branching in code paths.

## Recommended Corrective Actions

1. Start slice 0011 next and keep implementation bounded to release/dequeue plus persisted claim-lifecycle transition, with atomicity and event-order tests required before slice validation.
2. After 0011 stabilizes, execute contracts slices in the documented dependency order and require package-entrypoint and parser-level tests for each new canonical contract surface.
3. Decide explicitly whether slice 0012 should remain gated on 0011 timing; if not, relax that sequencing note in planning artifacts to preserve contract-first throughput without widening scope.

## Next-Slice Readiness

- Verdict: ready-with-risks
- Blocking issues:
  - No blocking issue prevents starting slice 0011.
- Safe next actions:
  - Implement slice 0011 with focused persistence-failure and ordering coverage first.
  - Keep 0012 through 0016 contract-only and avoid introducing provider, tool-runtime, or grant-resolution behavior into the `contracts` package while those slices land.
