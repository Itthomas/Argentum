# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-26
- Implementation date: 2026-05-26
- Phase: 7 (Hardening)
- Owner: packages/gateway

## Scope

- Slice name: Gateway telemetry event-ordering contract
- Target package or boundary: `packages/gateway` (`@argentum/gateway`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/40-modules/gateway/telemetry.md](../../spec/40-modules/gateway/telemetry.md) — gateway must subscribe to emitted `StreamEvent` values, persist append-only telemetry records, preserve event ordering per turn, and attach correlation identifiers for turn, session, and tool call flows
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — every state transition emits a `turn.*` event
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md) — one turn consumes exactly one accepted ingress; tool execution occurs only inside an active turn
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — telemetry tests for event ordering and minimum payload presence
- Acceptance criteria:
  - Turn-scoped events (`turn.started`, `turn.completed`, `turn.aborted`) emitted through gateway-owned operations carry both `turn_id` (required, non-optional) and `session_id` per the `TurnStreamEvent` contract. The gateway does not emit a turn-scoped event without both correlation IDs present.
  - Session-scoped events (`queue.queued`, `queue.rejected`, `queue.dequeued`) emitted through gateway-owned operations carry `session_id` (required) with `turn_id` optional, per the `SessionStreamEvent` contract.
  - Events emitted within a single turn carry monotonically increasing `sequence` values allocated through `allocateTurnEventMetadata`, so an implementer can reconstruct strict ordering within the turn's lifetime.
  - A focused gateway test proves that a synthetic admission→turn-creation→release/dequeue pipeline produces correctly ordered, fully correlated telemetry events with strictly increasing `sequence` values within the turn.
  - The telemetry writer in `@argentum/telemetry` is not modified; this slice only adds validation at the gateway boundary before events reach the writer.
  - No core-loop contract changes are required.
- Inputs crossing the boundary:
  - `GatewayAdmitInput`, `GatewayReleaseInput` through `Gateway` facade
  - Existing `StreamEvent` shapes from gateway operations
- Outputs crossing the boundary:
  - Gateway-level correlation validation that enriches or validates events before telemetry handoff
  - Focused gateway tests proving ordered, correlated event emission

## Plan

- First contracts or interfaces to create:
  - `GatewayTelemetryCorrelation` type carrying `session_id` (required) and `turn_id` (optional, per `SessionStreamEvent` contract)
  - `assertGatewayTelemetryEvent(event: StreamEvent, correlation: GatewayTelemetryCorrelation): void` — throws if required correlation IDs are missing per the event's scope
  - A monotonic sequence counter that increments per emitted event within a turn's lifetime, wired through `allocateTurnEventMetadata`
- Minimal implementation steps:
  1. Define `GatewayTelemetryCorrelation` with `session_id: string` (required) and `turn_id?: string` (optional). Note: this type is structurally redundant with existing `StreamEventBase` fields but serves as an explicit validation guard at the gateway boundary to ensure correlation IDs are populated before events are handed off.
  2. Add an internal `assertGatewayTelemetryEvent` validation helper called by the `Gateway` facade before each event handoff. The helper validates: turn-scoped events must have `turn_id` and `session_id`; session-scoped events must have `session_id` with `turn_id` optional.
  3. Add a monotonic sequence counter (starting at 1) that increments per emitted event within a turn's lifetime. Wire it through `allocateTurnEventMetadata` so each `GatewayTurnEventMetadata` gets a strictly increasing `sequence` value.
  4. Ensure every gateway-emitted event path (admission, turn creation, release/dequeue) passes through the correlation check.
  5. Add a focused test that runs a synthetic admission→create→release pipeline and asserts every emitted event has correct correlation IDs per scope, events are ordered correctly within the turn, and `sequence` values are strictly increasing.
  6. Keep the change bounded to the gateway package; do not modify `@argentum/telemetry` or `@argentum/contracts`.
  7. Note: wiring `GatewayFinalizingEventAppendSurface` to `TelemetryWriter.writeEvent()` is deferred to a future slice; this slice only adds validation and sequence tracking at the gateway boundary.
- Required tests:
  - Admission events (`queue.queued`, session-scoped) carry `session_id` (required) with `turn_id` optional.
  - Turn-creation events (`turn.started`, turn-scoped) carry both `session_id` and `turn_id` (both required).
  - Release/dequeue events (`queue.dequeued`, session-scoped) carry `session_id` (required) with `turn_id` optional.
  - Events emitted in a synthetic pipeline appear in admission→turn-creation→release/dequeue order.
  - Within a synthetic turn, multiple emitted events have strictly increasing `sequence` values (1, 2, 3, …).
  - A malformed turn-scoped event missing `turn_id` causes the gateway to throw before handoff.
  - Existing gateway tests continue to pass without modification.
- Narrow validation step:
  - `pnpm --filter @argentum/gateway test -- telemetry`
  - `pnpm --filter @argentum/gateway build`

## Execution Strategy

- Autopilot suitability: safe. The slice is bounded to gateway-internal validation with no new cross-package dependencies.
- Parallel subagent opportunities:
  - Read-only extraction of telemetry event-ordering assertions from [docs/spec/40-modules/gateway/telemetry.md](../../spec/40-modules/gateway/telemetry.md) and [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md).
- Out of scope:
  - Modifying the `@argentum/telemetry` package or its writer
  - Adding new telemetry event types
  - Gateway-level event persistence (that remains in `@argentum/telemetry`)
  - End-to-end telemetry replay proofs (those live in runtime E2E tests)
- Deferred decisions that must remain deferred:
  - Centralized metrics backend (explicitly out of MVP scope per the telemetry spec)

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1** — AC 1 and 3 contradicted the `SessionStreamEvent`/`TurnStreamEvent` type system. Rewrote to: turn-scoped events require both `turn_id` and `session_id`; session-scoped events require `session_id` with `turn_id` optional.
  - **H2** — Missing monotonic sequence counter. Added sequence counter wired through `allocateTurnEventMetadata`, plus a required test for strictly increasing `sequence` values within a synthetic turn.
  - **M1** — Noted that wiring `GatewayFinalizingEventAppendSurface` to `TelemetryWriter.writeEvent()` is deferred to a future slice.
  - **M2** — Noted that `GatewayTelemetryCorrelation` is structurally redundant with existing `StreamEventBase` fields but remains useful as an explicit validation guard at the gateway boundary.
- Refinements applied: 2026-05-26 — All HIGH and MEDIUM findings resolved. AC rewritten for correct event type system, monotonic sequence counter added to plan, deferred wiring and type redundancy documented.

- **0047 adversarial review findings** (2026-05-26):
  - **H1** — `assertGatewayTelemetryEvent` is defined but never called in production code. The Gateway facade does not wire the assertion into `admitIngress()`, `createTurnFromHandoff()`, or `releaseActiveTurnAndDequeue()`.
  - **H2** — `createTurnSequenceCounter` is instantiated per call to `createTurnFromHandoff()` but the integration test does not prove multiple `allocateTurnEventMetadata` calls within the same turn lifetime produce strictly increasing sequence values.
- **0047 refinements applied** (2026-05-26):
  - **H1** — Wired `assertGatewayTelemetryEvent` into `Gateway.admitIngress()` (for `queued`/`rejected` dispositions), `Gateway.createTurnFromHandoff()` (for `turn_started_event`), and `Gateway.releaseActiveTurnAndDequeue()` (for `released_with_next` results). Added 3 facade-level tests proving the Gateway facade runs the assertions and that malformed events cause throws.
  - **H2** — Added 2 integration tests proving the same `TurnSequenceCounter` produces strictly increasing sequences (1,2,3,4,5) when `nextSequence()` is called multiple times within a single turn lifetime, simulating the `allocateTurnEventMetadata` pattern across turn.started, progress, and turn.completed events.
  - Focused validation passed: `pnpm --filter @argentum/gateway test -- telemetry` (17/17), `pnpm --filter @argentum/gateway test` (57/57), `pnpm --filter @argentum/gateway build` (clean).

- **0047 post-repair adversarial review** (2026-05-26):
  - Review scope: `packages/gateway/src/gateway-facade.ts` (3 assertion wiring sites), `packages/gateway/tests/telemetry-event-ordering.test.ts` (5 new tests).
  - No CRITICAL, HIGH, MEDIUM, or LOW findings remain.
  - Verified: all three facade wiring sites use correct correlation IDs derived from the same input data as the events they validate. The counter is correctly scoped per-turn via closure in `createTurnFromHandoff()`. All existing 52 tests plus 5 new tests pass. Build is clean. No changes to `@argentum/telemetry` or `@argentum/contracts`.
  - Review verdict: **CLEAN**. H1 and H2 findings are fully resolved.

## Implementation Summary

- **What changed:**
  - Added `packages/gateway/src/gateway-telemetry.ts` with:
    - `GatewayTelemetryCorrelation` type (`session_id: string` required, `turn_id?: string` optional)
    - `assertGatewayTelemetryEvent(event, correlation)` — validates correlation IDs per event scope; throws on mismatch
    - `createTurnSequenceCounter()` — returns a `TurnSequenceCounter` with `nextSequence()` producing 1, 2, 3, … per call
  - Updated `packages/gateway/src/gateway-facade.ts` to:
    - Wire `createTurnSequenceCounter()` into `allocateTurnEventMetadata` so the `turn.started` event receives an incrementing sequence value instead of hardcoded `0`
    - Wire `assertGatewayTelemetryEvent()` into `admitIngress()` (for `queued`/`rejected` dispositions), `createTurnFromHandoff()` (for `turn_started_event`), and `releaseActiveTurnAndDequeue()` (for `released_with_next` results)
  - Updated `packages/gateway/src/index.ts` to export the new telemetry types and functions
  - Added `packages/gateway/tests/telemetry-event-ordering.test.ts` with 17 tests covering:
    - `assertGatewayTelemetryEvent` validation (9 tests: turn-scoped and session-scoped, happy path and error paths)
    - `createTurnSequenceCounter` (2 tests: monotonic increment and counter independence)
    - Full pipeline integration test (1 test: admission→turn-creation→release/dequeue producing correctly ordered, correlated events with sequences 1, 2, 3)
    - Gateway facade telemetry assertion wiring (3 H1 tests: facade methods exercise the assertion; malformed events cause throws)
    - Turn-scoped counter across multiple event allocations (2 H2 tests: counter survives multiple `nextSequence()` calls within a turn, producing strictly increasing values)
  - No changes to `@argentum/telemetry` or `@argentum/contracts`
  - No changes to existing gateway source files beyond the facade and index

- **What validated:**
  - `pnpm --filter @argentum/gateway test -- telemetry` — 17/17 tests pass
  - `pnpm --filter @argentum/gateway test` — 57/57 total tests pass (zero regressions)
  - `pnpm --filter @argentum/gateway build` — clean TypeScript compilation
  - `pnpm --filter @argentum/contracts build` — no impact
  - `pnpm --filter @argentum/environment build` — no impact

- **Remaining risks / deferred work:**
  - Wiring `GatewayFinalizingEventAppendSurface` to `TelemetryWriter.writeEvent()` remains deferred (slice card M1)
  - Turn-scoped events beyond `turn.started` (e.g., `turn.completed`, `turn.aborted`) are not emitted by gateway code today; those will come from the core loop. When they arrive, the correlation guard added here will reject them if IDs are missing.
  - The counter is correctly turn-scoped per `createTurnFromHandoff()` call. Future slices that emit multiple turn-scoped events within a single turn (e.g., `turn.progress`) should reuse the same counter for consistent ordering.
