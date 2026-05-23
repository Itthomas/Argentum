# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: planning synthesis
- Approval date: 2026-05-22
- Phase: 2
- Owner: gateway
- Execution readiness: validated
- Validation note: the `@argentum/gateway` package now exports a focused `claimActiveTurn` entrypoint plus a SQLite-backed active-turn claim store that records one exclusive same-session claim and returns either an opaque authority, a preservation handoff, or an explicit no-authority result. Local validation passed with `pnpm --filter @argentum/gateway test` plus `pnpm typecheck` on 2026-05-22.
- Implementation completion note: this slice completed against the existing local SQLite persistence decision in [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md) and now serves as the validated upstream seam for slice 0009 turn-start handoff to turn creation.

## Scope

- Slice name: Gateway active-turn claim and exclusive turn-creation authority
- Target package or boundary: `gateway`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/ingress-contract.md](../../spec/20-contracts/ingress-contract.md)
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md)
  - [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md)
  - [docs/spec/40-modules/gateway/session-router.md](../../spec/40-modules/gateway/session-router.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `gateway` package exposes one focused active-turn claim entrypoint that accepts only the `accepted` branch from slice 0006 together with a gateway-local persistence seam owned by this slice that can atomically record one active-turn claim for the same session.
  - The entrypoint must not accept a bare canonical `IngressDTO`, a queued or rejected admission result, or any caller-synthesized session identifier detached from the accepted-ingress outcome.
  - On success, the entrypoint atomically records active-turn ownership for the accepted ingress session before returning one gateway-local exclusive turn-creation authority value that remains bound to the accepted `session_id` and `ingress_id` for later consumption by slice 0009.
  - Concurrent claim attempts for the same session converge on at most one successful authority. Stale, duplicate, missing, or conflicting claims must not leave behind split or ambiguous active-turn state.
  - If a previously accepted ingress loses the claim because another turn became active first, the entrypoint returns one explicit gateway-local preservation handoff that carries the accepted ingress identity forward for caller-owned queue preservation or re-admission handling without dropping that ingress or bypassing FIFO behavior.
  - A failed or conflicting claim does not construct a `TurnEnvelope`, emit `queue.*` or `turn.*` events, dequeue backlog, or mutate queued-ingress ordering directly. The slice may return only the explicit preservation handoff needed to keep the accepted ingress on a spec-safe path back to caller-owned queue handling.
  - If persistence fails after claim work begins, the slice must not leave behind caller-visible partial lock state that grants a new active turn without also returning the matching exclusive authority.
  - The authority remains gateway-local and opaque. This slice does not introduce a new canonical cross-package contract for lock state or turn-creation authority.
  - The slice remains limited to active-turn claiming and preservation handoff. It does not resolve sessions, create ingress values, create `TurnEnvelope` values, release the session lock, drain queued ingress after finalization, persist telemetry, or define post-failure retry policy beyond the gateway-local preservation result.
- Inputs crossing the boundary:
  - One gateway-owned accepted admission result from slice 0006 containing the canonical accepted `IngressDTO`.
  - The read-only routing and admission snapshot outputs established by slice 0008.
  - One gateway-local persistence interface owned by this slice that can atomically claim active-turn ownership for a session and return either an opaque authority handle or one preservation handoff result suitable for later queue-safe handling.
  - Optional gateway-local claim metadata or token allocation only if needed to materialize an opaque authority value without exposing persistence internals.
- Outputs crossing the boundary:
  - One gateway-local exclusive turn-creation authority bound to the accepted ingress session and ingress identity.
  - One explicit gateway-local preservation handoff when the session can no longer be claimed exclusively without dropping the accepted ingress.
  - One explicit no-authority result only for stale, duplicate, malformed, or otherwise invalid claim requests that do not represent a newly accepted ingress requiring preservation.
  - No canonical `TurnEnvelope`, no runtime event outputs, and no direct queue mutation output from this slice.

## Plan

- Implementation prerequisites:
  - Start this slice only after slice 0008 makes the SQLite-backed routing and admission-snapshot seam explicit enough for this slice to consume deterministic session and queue facts without reopening session-router ownership.
  - Keep slice 0006 as the owner of admission decisions and slice 0009 as the owner of canonical `TurnEnvelope` plus `turn.started` creation. Do not collapse those seams into this slice.
  - Inherit the non-vacuous `@argentum/gateway` package test gate already established by slice 0006. Do not treat this slice as executable while `pnpm --filter @argentum/gateway test` can still pass without the race-focused boundary tests named below.

- First contracts or interfaces to create:
  - Gateway-local input type that narrows the accepted-admission result from slice 0006 to the only branch that may request active-turn claiming.
  - Gateway-local exclusive turn-creation authority type that later slice 0009 can match back to one accepted ingress session without exposing raw SQLite rows or mutation handles.
  - Gateway-local preservation-handoff type that carries one already accepted ingress back to caller-owned queue preservation or re-admission handling when a same-session claim loses the race.
  - Gateway-local claim-result union that returns either one authority value, one preservation handoff, or one explicit no-authority outcome for invalid requests that do not require ingress preservation.
  - Gateway-local persistence interface owned by this slice for atomic same-session active-turn claiming and opaque authority-materialization.
- Minimal implementation steps:
  - Add a focused active-turn-claim module under `packages/gateway`.
  - Consume only the accepted branch from slice 0006 and derive all session and ingress identity from that result instead of accepting caller-reconstructed identity data.
  - Build the first claim-capable gateway persistence seam in this slice on top of the routing and snapshot data established by slice 0008 rather than treating slice 0008 as the owner of mutation-capable claim behavior.
  - Use the SQLite-backed gateway persistence seam to atomically compare-and-set the session from no active turn to one claimed active turn.
  - Return one opaque exclusive turn-creation authority on success, one preservation handoff on same-session claim conflict for a still-valid accepted ingress, and one explicit no-authority result only for stale or malformed claim attempts that do not require preservation.
  - Keep turn creation, `turn.started` emission, direct queue mutation, queue draining, and lock release outside this entrypoint so the slice stays a pure concurrency and authority seam with a queue-safe preservation handoff.
- Required tests:
  - Gateway boundary tests proving only the accepted branch from slice 0006 can request an active-turn claim.
  - Gateway boundary tests proving the returned authority is bound to the same accepted `session_id` and `ingress_id` rather than caller-synthesized identity values.
  - Gateway boundary tests proving concurrent same-session claim attempts converge on exactly one successful authority and explicit conflict results for the losers.
  - Gateway boundary tests proving duplicate or stale re-claim attempts do not create a second active-turn authority for the same session.
  - Gateway boundary tests proving an already accepted ingress that loses the same-session claim race returns a preservation handoff instead of a terminal drop path.
  - Gateway boundary tests proving the preservation handoff carries enough gateway-local identity to let caller-owned queue preservation or re-admission logic keep FIFO intact without requiring this slice to mutate the queue directly.
  - Gateway boundary tests proving the split 0006-to-0010 seam does not drop or orphan ingress across accepted-then-conflicted same-session races.
  - Gateway boundary tests proving persistence failure during claim does not leave behind caller-visible partial active-turn state or a detached authority handle.
  - Gateway boundary tests proving conflicting claims return no `TurnEnvelope`, no direct queue mutation directive, and no `queue.*` or `turn.*` events.
  - Gateway boundary tests proving the slice exposes an opaque gateway-local authority surface rather than leaking persistence rows, lock tokens, or transaction handles.
  - Gateway boundary tests proving a successful claim updates the same-session active-turn state strongly enough that a second claim attempt fails until a later slice releases the lock.
- Narrow validation step:
  - `pnpm --filter @argentum/gateway test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: validated for this slice. The gateway package now has focused same-session race, duplicate-claim, preservation-handoff, rollback, and source-entrypoint tests for the implemented claim seam.
- Implementation outcome: validated. The `gateway` package now owns one active-turn claim module that accepts only the `accepted` admission branch, claims active-turn state in SQLite, returns one gateway-local exclusive turn-creation authority on success, preserves losing accepted ingress on same-session races, and rejects duplicate or invalid claims without constructing turn or queue artifacts.
- Parallel subagent opportunities:
  - Read-only extraction of one-active-turn and lock-release invariants from [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md) and [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md).
  - Read-only extraction of the accepted-admission fields and no-turn-creation guarantees this slice inherits from [docs/implementation/slices/0006-gateway-ingress-admission.md](./0006-gateway-ingress-admission.md).
  - Read-only extraction of which session and queue facts slice 0008 returns as read-only snapshot data so this slice does not reopen session-router ownership.
  - Read-only extraction of the minimum authority fields slice 0009 must consume from [docs/implementation/slices/0009-gateway-turn-envelope-creation.md](./0009-gateway-turn-envelope-creation.md).
- Out of scope:
  - Session routing or routing-key persistence.
  - Ingress construction and queue-admission policy.
  - Canonical `TurnEnvelope` creation.
  - `turn.started` event emission.
  - Queue draining after finalization.
  - Direct queue mutation inside the claim entrypoint.
  - Lock release, archival handoff, or any dequeue orchestration.
  - Telemetry persistence and channel rendering.
- Deferred decisions that must remain deferred:
  - Concrete lock-release sequencing after finalization beyond the runtime-lifecycle guarantee that release happens before archival work begins.
  - Any richer lock lease, timeout, or cross-process coordination policy beyond the MVP's local one-active-turn invariant.

## Risks And Sequencing Notes

- Primary planning risk: skipping this slice would leave slice 0009 dependent on an unnamed concurrency seam, which weakens the gateway plan around the one-active-turn invariant.
- Primary implementation risk: widening this slice into queue mutation or `TurnEnvelope` creation would collapse the gateway's admission, locking, and turn-start boundaries into one persistence-heavy entrypoint.
- Primary concurrency risk: treating claim conflict as a terminal no-authority outcome for an already accepted ingress would violate the queue-preservation guarantee in [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md), so the preservation handoff must remain explicit.
- Sequencing note: this card is a phase-2 look-ahead prerequisite for slice 0009, but it is not the next active slice while slice 0007 remains the current upstream contract priority.

## Review Log

- Adversarial review findings:
  - Initial review found that the card could orphan an already accepted ingress by returning a terminal no-authority result after a same-session claim conflict.
  - Initial review found that the sequencing note overstated slice 0008 by implying the session-router seam would also own the mutation-capable claim behavior needed here.
  - Follow-up adversarial review after the preservation-handoff and seam-ownership refinements found no remaining blocking planning defect in this card.
  - Final implementation-follow-up adversarial review after the concurrency-proof refinements found no blocking drift from the approved slice boundary or governing specs.
- Refinements applied:
  - Replaced the terminal conflict path with one explicit gateway-local preservation handoff so accepted ingress remains on a queue-safe path instead of being dropped between slices 0006 and 0010.
  - Made this slice, rather than slice 0008, the owner of the first claim-capable persistence seam while keeping 0008 limited to routing plus read-only admission snapshots.
  - Added boundary-test requirements for accepted-then-conflicted same-session races and for preservation-handoff sufficiency so the split 0006-to-0010 seam proves ingress is not orphaned.