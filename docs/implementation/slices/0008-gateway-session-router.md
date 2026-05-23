# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: workflow review plus follow-up adversarial review
- Approval date: 2026-05-22
- Phase: 2
- Owner: gateway
- Execution readiness: validated
- Validation note: the `@argentum/gateway` package now exports a focused `resolveSession` entrypoint plus a SQLite-backed session-routing store for deterministic routing and read-only admission-snapshot resolution, gateway tests now include a source-entrypoint smoke for the exported session-router surface, and local validation passed with `pnpm --filter @argentum/gateway test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Gateway session routing and admission-snapshot resolution
- Target package or boundary: `gateway`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/00-overview/framework-overview.md](../../spec/00-overview/framework-overview.md)
  - [docs/spec/00-overview/mvp-scope.md](../../spec/00-overview/mvp-scope.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md)
  - [docs/spec/40-modules/gateway/session-router.md](../../spec/40-modules/gateway/session-router.md)
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md)
  - [docs/spec/50-implementation/dependency-injection-plan.md](../../spec/50-implementation/dependency-injection-plan.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
  - [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md)
- Acceptance criteria:
  - The `gateway` package exposes one focused session-routing entrypoint that accepts channel identity plus channel user identity, derives one deterministic gateway-local routing key, and resolves or creates one internal `session_id`.
  - If the routing key is already known, the entrypoint returns the existing persisted `session_id` rather than allocating a replacement session identity.
  - If the routing key is new, the entrypoint initializes the minimum persisted session metadata required for later gateway queueing and locking work, then returns the new `session_id` with an empty admission snapshot.
  - The same routing key resolves to the same `session_id` across repeated inputs until reset behavior is defined, and distinct routing keys do not alias to the same `session_id`.
  - Concurrent first-use resolution attempts for the same routing key must converge on one shared persisted `session_id` and must not create duplicate session records or split queue and lock state across multiple sessions.
  - The returned result includes only the minimum immutable admission snapshot needed by slice 0006: resolved `session_id`, whether one active turn exists, the current queued-ingress count, and a read-only ordered list of queued-ingress references sufficient to preserve FIFO admission rules without giving this slice queue-mutation ownership.
  - First-use initialization returns a backlog-free snapshot with `has_active_turn = false` and zero queued ingress so later admission work can accept the first ingress without inventing synthetic defaults outside the persistence seam.
  - If first-use initialization fails after a routing-key claim begins, the slice must not leave behind caller-visible partial session state that can resolve without the minimum persisted metadata needed for later admission-snapshot reads.
  - Existing persisted session state is loaded into the returned admission snapshot as read-only data; the result must not expose mutable persistence handles, lock tokens, queue mutation functions, or caller-visible transaction state.
  - The slice uses the approved local SQLite persistence choice without widening into dequeue orchestration, turn creation, or agentic-core execution.
  - The slice remains gateway-local. It does not construct `IngressDTO` or `TurnEnvelope`, acquire or release the session lock, decide queue outcomes, emit `queue.*` or `turn.*` events, or own lock-release behavior after finalization.
- Inputs crossing the boundary:
  - Channel-scoped identity fields needed to derive one deterministic routing key.
  - A gateway-local session-id allocator used only when first-use initialization is required.
  - A gateway-local persistence interface that can atomically resolve or initialize one routing-key-to-session mapping and then read the current admission snapshot for that session.
- Outputs crossing the boundary:
  - A deterministic `session_id` for one routing key.
  - A gateway-local immutable admission snapshot suitable for slice 0006 queue decisions.
  - No `IngressDTO`, `TurnEnvelope`, queue mutation directive, or runtime event outputs.

## Plan

- Implementation prerequisites:
  - Slice 0006 should remain the owner of queue-admission decisions and caller-visible snapshot consumption. Do not start this slice while slice 0006 is still changing the minimum admission snapshot fields.
  - Reuse the approved local SQLite persistence decision already captured in [docs/implementation/bootstrap-decisions.md](../bootstrap-decisions.md); do not reopen the persistence-technology choice inside this slice.
  - Inherit the non-vacuous `@argentum/gateway` package test gate already required by slice 0006. Do not treat this slice as executable while `pnpm --filter @argentum/gateway test` can still pass with zero gateway boundary tests.

- First contracts or interfaces to create:
  - Gateway-local session-routing input type for channel identity and channel user identity.
  - Gateway-local session-resolution result type carrying `session_id` plus an immutable admission snapshot with `has_active_turn`, `queued_ingress_count`, and read-only ordered queued-ingress references.
  - Gateway-local session-id allocator contract used only for first-use initialization.
  - Gateway-local persistence interface for atomic routing-key lookup-or-create and admission-snapshot reads against SQLite-backed storage.
- Minimal implementation steps:
  - Add a focused session-router module under `packages/gateway`.
  - Derive one deterministic routing key from channel identity plus channel user identity and keep the concrete routing-key representation internal to the gateway package.
  - Use the gateway-local persistence seam to atomically resolve or initialize one routing-key-to-session mapping backed by SQLite.
  - Load the current queue and lock state needed for one admission snapshot and return it as detached read-only data rather than as a live persistence handle.
  - Keep queue mutation, lock acquisition, ingress creation, and turn creation out of this implementation so session routing remains a pure identity-and-snapshot seam.
- Required tests:
  - Gateway boundary tests proving the same routing key resolves to the same `session_id` across repeated calls.
  - Gateway boundary tests proving distinct routing keys do not alias to the same session.
  - Gateway boundary tests proving concurrent first-use resolution attempts for the same routing key converge on one persisted `session_id` rather than producing duplicate session records.
  - Gateway boundary tests proving first-use initialization returns the minimum admission snapshot expected by slice 0006 with `has_active_turn = false`, zero queued ingress, and no pre-existing queued references.
  - Gateway boundary tests proving the current SQLite-backed persistence seam preserves one stable `session_id` under same-key first-use contention, without leaving duplicate route or session records.
  - Gateway boundary tests proving failed first-use initialization does not leave behind caller-visible partial session state that resolves without the minimum admission metadata.
  - Gateway boundary tests proving existing persisted lock and queue state is loaded into the returned snapshot without reordering queued references.
  - Gateway boundary tests proving the returned snapshot is detached read-only caller input for later admission work rather than a mutation handle.
  - Gateway boundary tests proving the session-router entrypoint consumes an injected session-id allocator only on first-use initialization and does not allocate a new session id on repeat resolution.
  - Gateway boundary tests proving the slice does not construct `IngressDTO` or `TurnEnvelope`, decide admission outcomes, or emit runtime events.
- Narrow validation step:
  - Before treating this slice as executable, keep the non-vacuous gateway package test gate from slice 0006 in force so `pnpm --filter @argentum/gateway test` cannot pass with zero gateway boundary tests.
  - `pnpm --filter @argentum/gateway test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: validated for this slice. The earlier gate was conditional because this was the first persistence-backed gateway seam; that gate is now satisfied because the package exposes the session-router persistence seam, the same-key first-use concurrency tests exist locally, and the focused gateway validation target is non-vacuous.
- Implementation outcome: validated. The `gateway` package now owns one SQLite-backed session-router seam that derives deterministic routing keys internally, resolves or creates one persisted `session_id`, returns detached immutable admission snapshots, and keeps queue mutation, lock acquisition, ingress construction, and turn creation out of scope.
- Parallel subagent opportunities:
  - Read-only extraction of routing-key and persistence invariants from [docs/spec/40-modules/gateway/session-router.md](../../spec/40-modules/gateway/session-router.md).
  - Read-only extraction of the minimum admission snapshot fields actually required by [docs/implementation/slices/0006-gateway-ingress-admission.md](./0006-gateway-ingress-admission.md).
  - Read-only extraction of which queue and lock facts in [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md) must already be observable in the returned snapshot without giving this slice mutation ownership.
- Out of scope:
  - Session-lock acquisition.
  - Queue-admission decisions.
  - Ingress construction.
  - Queue mutation or dequeue orchestration.
  - Turn creation.
  - Queue draining and lock release.
  - Event emission.
  - Telemetry persistence.
- Deferred decisions that must remain deferred:
  - Session reset semantics beyond deterministic same-key resolution.
  - Concrete SQLite schema details beyond the minimum needed to support deterministic routing and admission snapshot reads.

## Review Log

- Planning review findings:
  - The earlier look-ahead card left the returned admission snapshot too loose, which risked forcing slice 0006 to invent caller-visible queue facts or hidden defaults.
  - The earlier card did not make first-use session-id allocation and lookup-or-create persistence ownership explicit.
  - The earlier card needed a stronger guard that returned session state is detached read-only data rather than a persistence mutation surface.
  - Follow-up review found that the card still needed explicit concurrency safety and partial-initialization guards for same-key first-use resolution.
  - Follow-up review found that the card named a package test command but did not directly inherit the repo's existing non-vacuous gateway test-gate prerequisite.
  - Follow-up adversarial subagent review found no additional blocking drift, boundary, deferred-decision, or validation defects after the concurrency and gateway-test-gate refinements were applied.
- Refinements applied:
  - Kept the slice focused on deterministic identity and snapshot resolution so slice 0006 can later stop depending on a caller-invented session seam.
  - Added an explicit session-id allocator and atomic persistence seam so first-use initialization does not leak hidden identity rules into the gateway entrypoint.
  - Tightened the returned snapshot to immutable session facts only, preserving FIFO-observable queue state without giving this slice queue mutation ownership.
  - Added explicit same-key concurrency and partial-initialization acceptance criteria so deterministic routing is backed by race-safe persistence behavior rather than by a nominal interface claim alone.
  - Added explicit conflict, concurrency, and partial-failure tests so the first persistence-backed gateway slice has a local proof for deterministic same-key resolution.
  - Carried the existing non-vacuous gateway package test gate directly into this card and tightened autopilot to depend on those persistence-race tests, not just on the presence of a persistence seam.
  - Made lock acquisition explicitly out of scope so later gateway admission and turn-lifecycle slices keep the concurrency boundary.
  - Follow-up refinement added a gateway source-entrypoint smoke test, aligned the validation note to the proof actually covered by the test suite, and recorded the current `node:sqlite` adapter choice in bootstrap decisions without widening the slice boundary.
  - Final adversarial review found no blocking issues; the remaining gaps are non-blocking and limited to built export-map coverage plus an optional forced duplicate-routing-key conflict path beyond the current SQLite writer-serialization proof.