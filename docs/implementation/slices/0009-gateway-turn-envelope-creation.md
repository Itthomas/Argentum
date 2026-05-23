# Slice Card

## Status

- State: planned
- Approval: approved
- Approved by: adversarial review follow-up
- Approval date: 2026-05-22
- Phase: 2
- Owner: gateway
- Execution readiness: look-ahead only; depends on validated slice 0006 for the accepted-admission seam, slice 0007 for the canonical `TurnEnvelope` contract, and the explicit gateway-owned exclusive turn-creation authority plus preservation-handoff seam planned in [docs/implementation/slices/0010-gateway-exclusive-turn-creation-authority.md](./0010-gateway-exclusive-turn-creation-authority.md). This card itself now owns the shared gateway-local turn-start handoff contract that later queued-ingress dequeue work in slice 0011 must reuse. The non-vacuous gateway boundary-test gate introduced before gateway execution work starts remains required.
- Implementation precondition note: no additional bootstrap decision is required because the local persistence choice is already recorded in [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md), but this slice must not begin while the upstream gateway-owned exclusive turn-creation authority seam in [docs/implementation/slices/0010-gateway-exclusive-turn-creation-authority.md](./0010-gateway-exclusive-turn-creation-authority.md) is still changing shape.

## Scope

- Slice name: Gateway turn-start handoff to turn creation
- Target package or boundary: `gateway`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/00-overview/mvp-scope.md](../../spec/00-overview/mvp-scope.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md)
  - [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md)
  - [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/50-implementation/dependency-injection-plan.md](../../spec/50-implementation/dependency-injection-plan.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `gateway` package exposes one focused turn-creation entrypoint that accepts one gateway-local turn-start handoff, startup-derived governor defaults, a gateway-owned turn-metadata allocator, and allocator-supplied turn-event metadata.
  - The gateway-local turn-start handoff is owned by this slice and carries one canonical ingress already authorized to start the next turn for its session together with one matching gateway-local exclusive turn-creation authority. The handoff may be produced either directly from the accepted branch of slice 0006 plus slice 0010 authority or from slice 0011 when the oldest queued ingress is dequeued and promoted to the next turn-start candidate.
  - The entrypoint consumes only the gateway-local turn-start handoff and must not accept a bare canonical ingress, channel payload, queued outcome, rejected outcome, or detached exclusive authority.
  - The exclusive turn-creation authority inside the handoff must be bound to the same `session_id` as the carried ingress and must be the only authority accepted for creating a new `TurnEnvelope`; missing, mismatched, stale, or duplicate authority must not permit overlapping turn creation for the same session.
  - The entrypoint constructs and returns one immutable canonical `TurnEnvelope` imported from `@argentum/contracts` with `session_id` and `ingress_id` preserved from the gateway-local turn-start handoff, initial `state = accepted`, `step_count = 0`, `repair_attempts_used = 0`, `compaction_revision = 0`, empty `context_refs`, and stamped governor defaults.
  - The created `TurnEnvelope.budget` copies `max_inference_steps`, `max_repair_attempts`, and `max_wall_clock_ms` from validated startup governor defaults and initializes `repair_attempts_used = 0` without inventing hidden gateway fallback values.
  - The created `TurnEnvelope` consumes allocator-supplied `turn_id`, `created_at`, and `updated_at` values instead of introducing hidden gateway clock or identifier state.
  - The entrypoint emits exactly one canonical `turn.started` `StreamEvent` with `scope = turn`, allocator-supplied `event_id`, monotonic turn-scoped `sequence`, UTC `timestamp`, `visibility`, required `turn_id`, and the minimum payload required by [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md): `session_id`, `ingress_id`, and `state`.
  - One turn-start handoff produces exactly one `TurnEnvelope` and one `turn.started` event through this slice; the slice must not create additional turn artifacts, mutate queue state, or emit later `turn.*` events.
  - The slice remains limited to accepted-ingress handoff. It does not execute the core loop, emit later `turn.*` events, dequeue queued ingress, acquire or release the session lock, or persist telemetry.
- Inputs crossing the boundary:
  - One gateway-local turn-start handoff carrying the canonical ingress and matching exclusive turn-creation authority needed to start exactly one new turn.
  - Validated governor defaults derived from runtime startup output.
  - Gateway-local turn-metadata allocator for `turn_id`, `created_at`, and `updated_at`.
  - Gateway-local turn-event metadata allocator for canonical top-level `StreamEvent` fields.
- Outputs crossing the boundary:
  - One canonical `TurnEnvelope` for the ingress carried by the turn-start handoff.
  - One canonical `turn.started` `StreamEvent`.
  - No core-loop execution outputs, queue-mutation directives, queue-drain directives, lock-transition effects, or finalization behavior.

## Plan

- Implementation prerequisites:
  - Reuse the approved local SQLite persistence choice already captured in [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md); do not reopen persistence technology or broader turn archival design inside this slice.
  - Start this slice only after slice 0007 exports the canonical `TurnEnvelope` contract and slice 0010 stabilizes one explicit exclusive turn-creation authority seam together with its preservation-handoff boundary for lost same-session claim races.
  - Inherit the non-vacuous `@argentum/gateway` package test gate already required by slice 0006; do not treat this slice as implementation-ready while `pnpm --filter @argentum/gateway test` can still pass with zero boundary tests.

- First contracts or interfaces to create:
  - Gateway-local turn-start handoff type that carries one canonical ingress together with the matching exclusive turn-creation authority in the only gateway-local shape allowed to start a turn.
  - Gateway-local turn-creation input type that composes one turn-start handoff, governor defaults, and allocator seams.
  - Gateway-local result type carrying the created `TurnEnvelope` and `turn.started` event.
  - Gateway-local turn-metadata allocator seam for turn identity and timestamp fields.
  - Gateway-local event-metadata allocator seam for turn-scoped event fields.
- Minimal implementation steps:
  - Add a focused turn-creation module under `packages/gateway`.
  - Import the canonical `TurnEnvelope` and `StreamEvent` surfaces from `@argentum/contracts`.
  - Define the shared gateway-local turn-start handoff contract in this slice and require both the direct accepted-ingress path and the later queue-dequeue path to reuse it instead of inventing separate turn-start inputs.
  - Consume only one matching turn-start handoff so turn creation cannot bypass queue-admission or one-active-turn policy.
  - Verify the exclusive turn-creation authority inside the handoff matches the carried ingress `session_id` before creating any new turn artifact.
  - Stamp the initial turn state and governor budget deterministically from the carried ingress plus validated startup defaults, preserving upstream `session_id` and `ingress_id` rather than recomputing them.
  - Use allocator-provided turn identity and timestamp fields for the new `TurnEnvelope` and allocator-provided top-level event fields for `turn.started`.
  - Populate the `turn.started` payload with the minimum canonical fields from the created turn and emit only the first turn-scoped event needed to hand off to later agentic-core execution.
  - Keep queue mutation, lock transitions, persistence writes, and core-loop orchestration outside this entrypoint so the slice stays a pure turn-start handoff to turn-creation seam.
- Required tests:
  - Gateway boundary tests proving only the shared gateway-local turn-start handoff can create a turn and that bare ingress, queued outcome, rejected outcome, or detached authority inputs are rejected.
  - Gateway boundary tests proving the slice requires one matching exclusive turn-creation authority inside the handoff and preserves the upstream `session_id` and `ingress_id` in the returned canonical `TurnEnvelope`.
  - Gateway boundary tests proving missing, mismatched, stale, or duplicate authority cannot create overlapping active turns for the same session.
  - Gateway boundary tests proving a valid direct accepted-ingress handoff and a valid dequeued-ingress handoff both create the same canonical `TurnEnvelope` shape with the required initial field values.
  - Gateway boundary tests proving the returned `TurnEnvelope` satisfies the public `@argentum/contracts` validator rather than only a gateway-local field check.
  - Gateway boundary tests proving governor defaults are copied from validated startup input rather than hidden gateway defaults.
  - Gateway boundary tests proving emitted `turn.started` events satisfy the public `StreamEvent` validator, required payload minimums, allocator-supplied top-level event fields, and `scope = turn` plus required `turn_id` semantics.
  - Gateway boundary tests proving the created `TurnEnvelope` uses allocator-supplied `turn_id`, `created_at`, and `updated_at` values.
  - Gateway boundary tests proving exactly one `turn.started` event is emitted per valid turn-start handoff and no extra turn artifacts are returned.
  - Gateway boundary tests proving the slice does not execute further state transitions, mutate queue state, change lock state, dequeue backlog, or emit later `turn.*` events.
- Narrow validation step:
  - `pnpm --filter @argentum/gateway test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: conditional. The slice is bounded, but only after slices 0006 and 0007 are validated, slice 0010 stabilizes the exclusive turn-creation authority plus preservation-handoff seam, this card's shared turn-start handoff contract is fixed, and the gateway package has a non-vacuous boundary-test gate.
- Parallel subagent opportunities:
  - Read-only extraction of initial turn-state and budget-stamping rules from [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) and [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md).
  - Read-only extraction of `turn.started` event minimums from [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md).
  - Read-only extraction of the minimum accepted-admission fields and one-active-turn invariants this slice may depend on from [docs/implementation/slices/0006-gateway-ingress-admission.md](./0006-gateway-ingress-admission.md), [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md), and [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md).
- Out of scope:
  - Session routing.
  - Queue admission.
  - Session-lock acquisition.
  - Core-loop execution.
  - Lock release and dequeue behavior.
  - Telemetry persistence.
  - Finalization and archival.
- Deferred decisions that must remain deferred:
  - Any broader event sequencing or persistence model beyond the single turn-start handoff.

## Review Log

- Adversarial review findings:
  - Initial draft left too much hidden gateway state around turn timestamps, turn identity, and turn-scoped event sequencing.
  - Initial draft allowed the entrypoint to accept a bare canonical ingress, which would make it easier to bypass the queue-admission outcome seam introduced by slice 0006.
  - Follow-up adversarial review found no additional blocking planning defects after allocator ownership and the accepted-admission dependency were made explicit.
  - Planning refresh found that the card lacked an explicit exclusive turn-creation authority seam, which left room for overlapping active turns even though the gateway spec requires one-active-turn safety.
  - Planning refresh found that the initial budget-stamping fields, the minimum `turn.started` payload fields, and direct use of the public `TurnEnvelope` validator needed to be named directly in acceptance criteria and tests.
  - Final adversarial follow-up found no remaining blocking planning defects after the exclusive turn-creation authority seam and public contract-validation requirements were added.
  - Follow-up slice review found that the downstream queue-dequeue card needed one shared turn-start handoff contract rather than a separate dequeue-only handoff shape, so this card now owns that gateway-local contract.
  - Follow-up adversarial subagent review after the shared turn-start handoff refinement found no remaining blocking planning defect in this card.
- Refinements applied:
  - Required the entrypoint to consume the accepted branch from slice 0006 so turn creation remains downstream of admission policy rather than a parallel path.
  - Replaced implicit clock and sequence ownership with explicit turn-metadata and turn-event metadata allocators.
  - Kept the slice centered on the one gateway-to-core handoff artifact pair: `TurnEnvelope` plus `turn.started`.
  - Replaced the over-broad slice 0008 dependency with one explicit gateway-local exclusive turn-creation authority seam so the card models concurrency safety directly rather than through session-router spillover.
  - Added direct acceptance and test coverage for budget-field stamping, upstream identity preservation, the minimum `turn.started` payload, and public `@argentum/contracts` validation of the created `TurnEnvelope`.
  - Replaced the earlier accepted-ingress-only input surface with one shared gateway-local turn-start handoff contract so both the direct accepted path and the later queue-dequeue path can feed turn creation without inventing a second incompatible seam.