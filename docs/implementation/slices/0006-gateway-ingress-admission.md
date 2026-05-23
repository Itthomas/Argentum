# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: workflow synthesis plus adversarial review
- Approval date: 2026-05-22
- Phase: 2
- Owner: gateway
- Execution readiness: validated
- Validation note: the `@argentum/gateway` package test script now uses a non-vacuous `vitest run` gate, and local validation passed with `pnpm --filter @argentum/gateway test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Gateway ingress creation and queue-admission policy
- Target package or boundary: `gateway`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/ingress-contract.md](../../spec/20-contracts/ingress-contract.md)
  - [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md)
  - [docs/spec/40-modules/gateway/session-router.md](../../spec/40-modules/gateway/session-router.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/50-implementation/dependency-injection-plan.md](../../spec/50-implementation/dependency-injection-plan.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `gateway` package exposes one focused ingress-admission entrypoint that consumes startup-derived `gatewayDefaults`, a resolved `session_id`, normalized channel payload fields for one ingress, a gateway-local ingress-id allocator, a caller-supplied snapshot of the current session admission state, and a gateway-local queue-event metadata allocator already positioned at the next monotonic session event sequence.
  - The entrypoint constructs and returns the canonical `IngressDTO` imported from `@argentum/contracts`; this slice must not define a gateway-private ingress DTO, parser, or validator.
  - The entrypoint creates an immutable `IngressDTO` before it returns any `accepted`, `queued`, or `rejected` outcome.
  - When the session snapshot shows one active turn and fewer than the configured queued-ingress limit, the new ingress is queued and the returned outcome includes a session-scoped `queue.queued` `StreamEvent` with the required minimum payload fields.
  - When the session snapshot shows one active turn and the queue is already at the configured limit, the newest ingress is rejected deterministically without displacing earlier queued ingress and the returned outcome includes a session-scoped `queue.rejected` `StreamEvent` with the required minimum payload fields.
  - When the session snapshot shows no active turn and no queued ingress, the outcome is `accepted`, no `queue.*` event is emitted, and the slice does not yet create a `TurnEnvelope` or emit `turn.*` events.
  - When the session snapshot shows no active turn but queued ingress already exists, the new ingress is still queued behind the existing backlog unless the queue is already at the configured limit; this slice must not bypass earlier queued ingress and thereby preserves FIFO behavior before dequeue orchestration exists.
  - When the session snapshot shows no active turn, queued ingress already exists, and the queue is already at the configured limit, the newest ingress is rejected deterministically rather than accepted ahead of the backlog.
  - The slice consumes the validated startup-derived queue settings without introducing hidden gateway defaults or configuration side channels.
  - The slice never mutates, reorders, or replaces pre-existing queued ingress records. It returns only the disposition for the new ingress and, when applicable, an append-only queue mutation directive for that ingress while leaving the caller-owned admission snapshot unchanged.
  - Queue events emitted by this slice satisfy the canonical `StreamEvent` top-level contract by consuming allocator-supplied `event_id`, monotonic session-scoped `sequence`, UTC `timestamp`, and `visibility` values rather than inventing hidden sequencing state inside the gateway.
  - The slice remains limited to ingress creation and queue-admission outcomes. It does not implement session routing persistence, queue draining, lock release, turn creation, or telemetry persistence.
- Inputs crossing the boundary:
  - Startup-derived `gatewayDefaults` passed from the composition root after successful runtime bootstrap.
  - A resolved `session_id` from a caller-owned session-routing seam.
  - Normalized channel input needed to construct one `IngressDTO`, excluding `session_id` and gateway-assigned `ingress_id`.
  - A gateway-local ingress-id allocator that yields one new canonical `ingress_id` before admission outcome selection.
  - A caller-supplied session admission snapshot carrying `has_active_turn` plus a read-only ordered queued-ingress backlog ahead of the new ingress.
  - A gateway-local queue-event metadata allocator that yields the next canonical top-level `StreamEvent` fields for one session-scoped queue event.
- Outputs crossing the boundary:
  - One immutable `IngressDTO` created before admission outcome selection.
  - A gateway-owned admission result describing `accepted`, `queued`, or `rejected` disposition.
  - An append-only queue mutation directive for the new ingress or an explicit no-mutation result when nothing should be appended, with an explicit reported post-decision queue length.
  - Session-scoped `queue.*` `StreamEvent` values for queued and rejected outcomes.
  - No `TurnEnvelope`, turn-creation directive, or `turn.*` event output from this slice.

## Plan

- Implementation prerequisites:
  - Resolved: the `@argentum/gateway` package test script no longer uses `--passWithNoTests`, so `pnpm --filter @argentum/gateway test` is a non-vacuous gateway boundary-test gate.

- First contracts or interfaces to create:
  - No new cross-package ingress contract surface; reuse canonical `IngressDTO` and `StreamEvent` exports from `@argentum/contracts`.
  - Gateway-local ingress-admission input type that accepts a resolved `session_id`, normalized channel payload fields, and a gateway-owned ingress-id allocator.
  - Gateway-local session-admission snapshot type with `has_active_turn` plus a read-only ordered queue snapshot needed for one deterministic decision and explicit post-decision queue-length reporting.
  - Gateway-local admission-result union that returns the created `IngressDTO`, the outcome, any emitted queue event, and either an append-newest directive or an explicit no-mutation directive for the new ingress without returning a `TurnEnvelope` or turn-creation directive.
  - Gateway-local queue-event metadata allocator contract that supplies `event_id`, session-scoped `sequence`, UTC `timestamp`, and `visibility` for canonical queue events without coupling the slice to telemetry persistence.
- Minimal implementation steps:
  - Add a focused ingress-admission function or service under `packages/gateway`.
  - Import the canonical ingress-contract surface from `@argentum/contracts`, obtain a gateway-assigned `ingress_id`, and construct the immutable `IngressDTO` immediately from the resolved session identity and normalized channel input.
  - Consume `gatewayDefaults.max_queued_ingress_per_session` and `gatewayDefaults.queue_overflow_policy` when selecting `accepted`, `queued`, or `rejected` outcomes, with `accepted` reserved for sessions that are both unlocked and currently backlog-free.
  - Read the caller-supplied snapshot only through the explicit gateway-local session-admission interface and return queue mutation intent only for the new ingress so existing queued backlog remains caller-owned and cannot be displaced or mutated by this slice.
  - Emit canonical session-scoped `queue.queued` and `queue.rejected` events that satisfy the `StreamEvent` contract and minimum payload rules by using the queue-event metadata allocator while leaving turn-scoped event emission for later slices.
  - Keep persistence writes, queue draining, and `TurnEnvelope` creation outside this slice by depending only on caller-supplied state and app-local injected helpers.
- Required tests:
  - Gateway boundary test proving the returned ingress value uses the canonical `IngressDTO` contract imported from `@argentum/contracts` rather than a gateway-private shape.
  - Gateway boundary test proving `IngressDTO` is created before an `accepted` outcome is returned for an unlocked session with an empty queue.
  - Gateway boundary test proving the slice consumes a gateway-owned ingress-id allocator and stamps the allocated `ingress_id` into the returned canonical `IngressDTO` before selecting any admission outcome.
  - Gateway boundary test proving an unlocked session with existing queued backlog still returns `queued` so the new ingress does not bypass earlier queued work.
  - Gateway boundary test proving a locked session below the queue cap returns `queued`, emits a session-scoped `queue.queued` event with `session_id`, `ingress_id`, and `queue_length` payload fields, and reports the post-decision queue length correctly.
  - Gateway boundary test proving a locked session at the queue cap returns `rejected` and emits a session-scoped `queue.rejected` event with `session_id`, `ingress_id`, `queue_length`, and `reason` payload fields.
  - Gateway boundary test proving a session with no active turn, existing queued backlog, and queue length already at the configured limit still returns `rejected` rather than bypassing the backlog.
  - Gateway boundary test proving reject-newest overflow returns an explicit no-mutation result for the new ingress, does not append to the provided queue snapshot, and leaves the reported queue length at the configured limit.
  - Gateway boundary test proving the admission entrypoint consumes injected `gatewayDefaults` rather than introducing hidden fallback queue settings.
  - Gateway boundary test proving accepted outcomes emit no `queue.*` event because queue state did not change.
  - Gateway boundary test proving accepted outcomes return no `TurnEnvelope`, no turn-creation directive, and no `turn.*` event because turn instantiation is outside this slice.
  - Gateway boundary test proving queued and rejected events remain `scope = session` and satisfy the public `StreamEvent` validator rather than a gateway-private DTO.
  - Gateway boundary test proving emitted queue events carry the allocator-supplied `sequence`, `timestamp`, and `visibility` values so session-scoped event ordering is explicit rather than hidden.
  - Gateway boundary test proving the caller-supplied session admission snapshot remains unchanged across accepted, queued, and rejected outcomes.
- Narrow validation step:
  - Before treating slice validation as complete, remove `--passWithNoTests` from the `@argentum/gateway` package test script so the package-level test gate fails when boundary tests are missing.
  - `pnpm --filter @argentum/gateway test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe. The slice became safe for autopilot once the `@argentum/gateway` package test gate became non-vacuous, and the implemented slice is now locally validated.
- Parallel subagent opportunities:
  - Read-only extraction of queue-admission edge cases from [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md) and [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - Read-only extraction of queue-event scope and minimum payload requirements from [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md), [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md), and [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
- Out of scope:
  - Defining, parsing, or validating the canonical `IngressDTO` contract inside the gateway package
  - Deterministic session-key routing and persistence-backed session lookup
  - SQLite schema design or transaction boundaries for queue state
  - Queue draining after lock release or `queue.dequeued` emission
  - `TurnEnvelope` creation and stamping `governorDefaults` into turn budgets
  - Turn-scoped event emission, telemetry persistence, or channel rendering
  - Queue coalescing, session reset behavior, or cross-host coordination
- Deferred decisions that must remain deferred:
  - Concrete SQLite persistence model for session metadata, queue rows, and lock coordination
  - Session reset semantics beyond deterministic routing for the same key
  - Dequeue orchestration after turn finalization and archival handoff

## Review Log

- Adversarial review findings:
  - Initial review found that the card left the `no active turn but queued backlog exists` case implicit, which could allow FIFO drift across implementations.
  - Initial review found that the earlier queue-state input was too weak to support a meaningful non-displacement guarantee for reject-newest overflow.
  - Initial review found that queue-event sequencing ownership was underspecified even though emitted `StreamEvent` values require monotonic session-scoped `sequence`.
  - Follow-up subagent adversarial review found no additional blocking drift, boundary, deferred-decision, or validation issues after the FIFO, queue-mutation, and event-sequencing refinements.
  - Audit 0001 found that the gateway ingress-admission slice was not implementation-ready because the canonical `IngressDTO` boundary is not yet implemented or exported from `@argentum/contracts`, and because the `@argentum/gateway` test command can still pass with zero tests.
  - Post-audit subagent adversarial review found no additional planning defects after the explicit ingress-contract prerequisite, backlog sequencing blocker, and non-vacuous gateway validation gate were added.
  - Follow-up slice review found that the package-level validation gate still needed one exact non-vacuous rule, the session-admission seam still needed explicit minimum fields, and the card was missing explicit no-turn and snapshot-immutability tests.
  - Follow-up adversarial review after slice 0005 validation found no remaining upstream boundary defect in the card; the remaining execution blocker is the vacuous gateway package test gate.
  - Post-implementation slice review found no blocking implementation drift; the remaining follow-up was to synchronize the stale blocked status and backlog state after validation.
- Refinements applied:
  - Chose a gateway-owned slice because `gatewayDefaults` from the runtime bootstrap context are the narrowest validated startup outputs that can drive concrete runtime behavior without widening into provider, tooling, or telemetry ownership.
  - Bound the slice to caller-supplied session state so it can prove ingress creation and queue-overflow policy before SQLite persistence and session-router implementation exist.
  - Kept `accepted` outcomes free of `TurnEnvelope` creation so `governorDefaults` stamping remains a later gateway slice instead of coupling admission and turn instantiation too early.
  - Required queue-event outputs to satisfy the canonical `StreamEvent` contract so later telemetry and channel slices can consume them without a gateway-private event DTO.
  - Made the admission rules exhaustive so new ingress is accepted only when the session is both unlocked and backlog-free, preserving FIFO when queued work already exists.
  - Strengthened the caller-supplied queue snapshot and admission result so the slice can prove append-only behavior for the new ingress without owning queue persistence.
  - Replaced the vague event-metadata seam with an explicit queue-event metadata allocator that supplies canonical top-level `StreamEvent` fields, including monotonic session sequence.
  - Added explicit execution blockers so the slice cannot start before upstream slice 0005 lands and the gateway validation command proves real boundary tests.
  - Removed unrelated planning-artifact cleanup from the slice-local prerequisites so execution readiness depends only on gateway and upstream contract conditions.
  - Added a gateway-owned ingress-id allocator seam so the slice can satisfy the canonical ingress contract without inventing hidden ID state.
  - Tightened the required tests around no-turn outputs, backlog-at-cap rejection without an active turn, and caller-snapshot immutability across all outcomes.
  - Narrowed the remaining execution blocker and autopilot gate to the non-vacuous `@argentum/gateway` package test requirement after slice 0005 became implemented and validated.