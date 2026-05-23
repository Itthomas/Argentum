# Slice Card

## Status

- State: planned
- Approval: approved
- Approved by: adversarial review follow-up
- Approval date: 2026-05-22
- Phase: 2
- Owner: gateway
- Execution readiness: look-ahead only; start after slice 0010 stabilizes the opaque active-turn authority lifecycle and slice 0009 fixes the shared gateway-local turn-start handoff contract that this slice must return for dequeued ingress.
- Implementation precondition note: no additional bootstrap decision is required because the local SQLite persistence choice is already recorded in [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md), but this slice must not begin while the gateway-local release context available during `finalizing` or the shared turn-start handoff owned by slice 0009 is still changing shape.

## Scope

- Slice name: Gateway active-turn release and queued-ingress dequeue handoff
- Target package or boundary: `gateway`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/00-overview/mvp-scope.md](../../spec/00-overview/mvp-scope.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/ingress-contract.md](../../spec/20-contracts/ingress-contract.md)
  - [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `gateway` package exposes one focused release-and-dequeue entrypoint that accepts only one caller-owned gateway-local active-turn release authority for a currently active turn plus one caller-owned gateway-local finalizing release context that is available during `finalizing` before lock release and archival handoff complete.
  - The entrypoint must not accept a bare `session_id`, bare `turn_id`, caller-synthesized queue reference, or any release request detached from the gateway-local active-turn authority established upstream.
  - If the active turn is successfully released and no queued ingress exists, the entrypoint atomically clears active-turn ownership for the session and returns one explicit released-without-next result. No `queue.*` event is emitted when queue state does not change.
  - If queued ingress exists, the entrypoint atomically releases the current active turn and dequeues exactly the oldest queued ingress for the same session. Newer queued ingress and newly arriving ingress must not bypass that oldest queued item.
  - A successful dequeue returns one gateway-local turn-start handoff in the exact shared shape owned by slice 0009, carrying the dequeued canonical ingress now promoted onto the next valid turn-start path together with one matching opaque exclusive turn-creation authority. This slice must not invent a dequeue-only handoff shape that would require a second adapter seam before turn creation.
  - A successful dequeue emits exactly one canonical `queue.dequeued` `StreamEvent` with `scope = session`, allocator-supplied `event_id`, monotonic session-scoped `sequence`, UTC `timestamp`, `visibility`, and the minimum payload required by [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md): `session_id`, `ingress_id`, and `queue_length`.
  - When a `queue.dequeued` event is emitted for a released turn, the event is produced during `finalizing` after successful release and dequeue but before the caller-owned `turn.completed` or `turn.aborted` event is emitted for that same turn. This slice still does not emit `turn.*` events itself.
  - Stale, duplicate, missing, or mismatched release authority must not clear the active turn, dequeue ingress, or emit `queue.dequeued`.
  - If persistence fails after release work begins, the slice must not leave behind caller-visible partial state such as an unlocked session with the dequeued ingress removed but no dequeue handoff, or a removed queue head with no matching `queue.dequeued` event output.
  - The slice remains limited to gateway lock release and queued-ingress handoff. It does not execute the core loop, emit `turn.*` events, archive turns, persist telemetry, construct `TurnEnvelope`, or decide fresh external ingress admission outcomes.
- Inputs crossing the boundary:
  - One caller-owned gateway-local active-turn release authority for the currently active session and turn.
  - One caller-owned gateway-local finalizing release context carrying the minimum active-turn identity and terminal branch information needed to release the session during `finalizing` without reopening core-loop state ownership or waiting for archival completion.
  - One gateway-local persistence interface owned by this slice that can atomically release active-turn ownership, inspect the ordered queued-ingress backlog, remove exactly the oldest queued ingress when present, and materialize the shared turn-start handoff for the next turn.
  - One gateway-local queue-event metadata allocator that yields canonical top-level `StreamEvent` fields for a session-scoped `queue.dequeued` event.
- Outputs crossing the boundary:
  - One explicit released-without-next result when the active turn is released and no queued ingress remains.
  - One gateway-local turn-start handoff carrying the oldest queued ingress identity plus one matching exclusive authority in the same shared shape consumed by slice 0009.
  - One session-scoped canonical `queue.dequeued` `StreamEvent` only when queue state changes.
  - One explicit no-release result for stale, duplicate, malformed, or otherwise invalid release requests.
  - No canonical `TurnEnvelope`, no `turn.*` event output, no archival output, and no direct fresh-admission decision output.

## Plan

- Implementation prerequisites:
  - Start this slice only after slice 0010 stabilizes the opaque authority lifecycle strongly enough that a downstream release operation can prove it is releasing the currently active turn rather than a caller-synthesized identity tuple.
  - Keep slice 0009 as the owner of the shared gateway-local turn-start handoff contract plus turn creation, and keep the core-loop package as the owner of turn-state transitions and terminal outcome selection. Do not collapse finalization, lock release, queue draining, and turn creation into one entrypoint.
  - Inherit the non-vacuous `@argentum/gateway` package test gate already established by slice 0006. Do not treat this slice as executable while `pnpm --filter @argentum/gateway test` can still pass without the release, FIFO, and partial-failure tests named below.

- First contracts or interfaces to create:
  - Gateway-local finalizing release context type that is available before `finalizing` completes and carries only the minimum turn identity and terminal-branch data needed for release.
  - Gateway-local release-request input type that composes the active-turn release authority with the caller-owned finalizing release context.
  - Gateway-local release-result union that returns either one released-without-next result, one shared turn-start handoff plus `queue.dequeued` event, or one explicit no-release outcome.
  - Gateway-local persistence interface for atomic active-turn release and oldest-queued-ingress dequeue against SQLite-backed storage.
  - Gateway-local queue-event metadata allocator contract for canonical `queue.dequeued` top-level event fields.
- Minimal implementation steps:
  - Add a focused release-and-dequeue module under `packages/gateway`.
  - Consume only the gateway-local active-turn authority and caller-owned finalizing release context rather than any caller-reconstructed session or queue identifiers.
  - Use the SQLite-backed gateway persistence seam to atomically release the current active turn and either return an explicit no-next result or remove exactly the oldest queued ingress for the same session.
  - Materialize the shared gateway-local turn-start handoff owned by slice 0009 for the oldest queued ingress when queue state changes so downstream turn creation can proceed without reopening a same-session race window or inventing an adapter seam.
  - Emit the canonical session-scoped `queue.dequeued` event only when a queued ingress is actually removed, using allocator-supplied event metadata and the required minimum payload fields, and return it on the same finalizing-time path before the caller emits the terminal turn event for the released turn.
  - Keep turn completion events, archival scheduling, telemetry persistence, and next-turn `TurnEnvelope` creation outside this entrypoint so the slice stays a pure gateway lock-release and dequeue seam.
- Required tests:
  - Gateway boundary tests proving only a matching live active-turn release authority can release the current turn.
  - Gateway boundary tests proving stale, duplicate, missing, or mismatched release authority leaves active-turn state and queue state unchanged.
  - Gateway boundary tests proving successful release with an empty queue returns an explicit released-without-next result and emits no `queue.*` event.
  - Gateway boundary tests proving successful release with queued backlog dequeues exactly the oldest queued ingress and preserves FIFO order for the remaining backlog.
  - Gateway boundary tests proving the returned turn-start handoff is in the exact shared shape consumed by slice 0009, is bound to the same session as the released turn, and carries the dequeued ingress identity needed for downstream turn creation without leaking persistence internals.
  - Gateway boundary tests proving a successful dequeue emits one canonical `queue.dequeued` event that satisfies the public `StreamEvent` validator and includes `session_id`, `ingress_id`, and `queue_length` payload minimums.
  - Gateway boundary tests proving allocator-supplied `event_id`, `sequence`, `timestamp`, and `visibility` values are used for `queue.dequeued` rather than hidden gateway sequencing state.
  - Gateway integration tests proving the returned turn-start handoff can be consumed directly by slice 0009 without an intermediate adapter seam.
  - Gateway integration tests proving `queue.dequeued` is observable before the caller-owned `turn.completed` or `turn.aborted` event for the same finalizing path.
  - Gateway boundary tests proving release plus dequeue does not expose a caller-visible unlocked same-session gap that would let newer ingress bypass the oldest queued ingress.
  - Gateway boundary tests proving persistence failure during release or dequeue does not orphan the queue head, drop the active-turn release result, or return a turn-start handoff without the matching state change.
  - Gateway boundary tests proving the slice returns no `TurnEnvelope`, emits no `turn.*` events, performs no archival work, and makes no fresh admission decision.
  - Gateway boundary tests proving repeated release attempts after a successful release do not dequeue a second ingress or emit duplicate `queue.dequeued` events.
- Narrow validation step:
  - `pnpm --filter @argentum/gateway test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: conditional. The owner and validation target are clear, but this is a persistence-backed release-and-promotion seam and should not run on autopilot until slices 0010 and 0009 stabilize the shared turn-start handoff plus downstream authority lifecycle, and the gateway package has the focused FIFO, event-ordering, and partial-failure tests named above.
- Parallel subagent opportunities:
  - Read-only extraction of lock-release ordering invariants from [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md), [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md), and [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md).
  - Read-only extraction of `queue.dequeued` event minimums from [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md) and [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md).
  - Read-only extraction of the opaque authority fields and lifecycle constraints this slice inherits from [docs/implementation/slices/0010-gateway-exclusive-turn-creation-authority.md](./0010-gateway-exclusive-turn-creation-authority.md) and [docs/implementation/slices/0009-gateway-turn-envelope-creation.md](./0009-gateway-turn-envelope-creation.md).
- Out of scope:
  - Core-loop finalization logic and terminal outcome selection.
  - `turn.completed` or `turn.aborted` event emission.
  - `TurnEnvelope` creation for the next turn.
  - Session routing and fresh ingress admission.
  - Queue overflow and rejection policy.
  - Telemetry persistence and archival orchestration.
  - Session reset, queue coalescing, or cross-process lock coordination.
- Deferred decisions that must remain deferred:
  - The concrete archival pipeline after lock release beyond the spec rule that archival must not delay release.
  - Any richer lock lease, timeout, or cross-process coordination policy beyond the MVP's local one-active-turn invariant.
  - Any post-MVP queue coalescing or session reset behavior.

## Risks And Sequencing Notes

- Primary planning risk: leaving this seam implicit would create a gap between core-loop finalization and the gateway FIFO guarantee that queued ingress is processed after lock release.
- Primary implementation risk: widening this slice into turn creation or core-loop finalization would collapse gateway and agentic-core ownership into one persistence-heavy entrypoint.
- Primary concurrency risk: releasing the active turn without an atomic oldest-queued handoff would create a same-session race window where newer ingress could bypass preserved backlog.
- Sequencing note: this card is downstream of slices 0010 and 0009 on top of the now-validated slice 0008 session-routing seam. Keep it inactive until those upstream gateway seams stabilize.

## Review Log

- Adversarial review findings:
  - Planning synthesis found that the current slice queue stops at turn creation and leaves the spec-required lock-release and queued-ingress drain seam unplanned.
  - Planning synthesis found that a release-only slice would reopen a same-session race window unless the dequeue handoff or reservation remains explicit and gateway-local.
  - Follow-up slice review found that the card left the dequeue output incompatible with slice 0009 and described release inputs as arriving after `finalizing`, which would weaken the spec-required release timing.
  - Follow-up adversarial subagent review after the shared handoff and finalizing-time release refinements found no remaining blocking planning defect in this card.
- Refinements applied:
  - Kept the slice centered on one gateway-owned persistence boundary: releasing the active turn and handing off the oldest queued ingress.
  - Replaced the dequeue-only handoff with the exact shared turn-start handoff owned by slice 0009 so queued ingress can re-enter turn creation without an extra adapter seam.
  - Replaced the post-finalizing terminal-summary input with one finalizing-time release context so lock release remains explicitly inside `finalizing` before archival work begins.
  - Added explicit event-ordering requirements and tests so `queue.dequeued` remains observable before the caller-owned terminal turn event for the released turn.
  - Kept turn finalization, archival, and next-turn `TurnEnvelope` creation out of scope so the boundary remains narrow and testable.