# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-25
- Phase: 7 (Hardening)
- Owner: apps/runtime
- Execution readiness: implemented-and-validated. The existing runtime composition, validation-repair policy, governor semantics, rendering, and telemetry surfaces are already in place upstream; this slice adds the focused end-to-end proof for deterministic repair exhaustion through `runCliTurn()`.

## Scope

- Slice name: Runtime repair-exhaustion end-to-end proof
- Target package or boundary: `apps/runtime` (`@argentum/runtime`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — unrecoverable validation paths terminate in `aborted`
  - [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md) — repair attempts are bounded and deterministic
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md) — bounded runtime remains a frozen MVP rule
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — failure-path tests must prove repair exhaustion and deterministic termination
- Acceptance criteria:
  - The supported `runCliTurn()` seam can execute one deterministic repair-exhaustion scenario end to end.
  - A provider double repeatedly returns decisions that force validation repair until the configured repair budget is exhausted.
  - For a configured repair budget of `N`, the runtime emits exactly `N` `validation.repair_requested` events with deterministic `attempt_number` values `1..N`, then stops requesting additional repairs.
  - After the final allowed repair attempt, the next validation failure terminates the turn through the repair-exhaustion path without an extra `validation.repair_requested` event, without looping indefinitely, and without falling back to a different abort cause such as provider failure or a step or wall-clock limit.
  - Telemetry and rendered output expose the terminal repair-exhaustion path in a replayable way, including terminal validation-failure evidence and turn abort, and runtime cleanup still occurs.
  - The slice stays bounded to repair exhaustion only. Governor wall-clock and step-limit end-to-end proofs remain separate follow-on work.
- Inputs crossing the boundary:
  - `runCliTurn(rawInput, options?)`
  - Provider double that forces repeated repair attempts
  - Existing runtime governor and validation-repair configuration
- Outputs crossing the boundary:
  - Focused runtime E2E tests proving deterministic repair exhaustion and terminal abort behavior

## Plan

- First contracts or interfaces to create:
  - Runtime-local provider double that forces repeat repair attempts
- Minimal implementation steps:
  1. Configure a runtime test harness with a low repair budget.
  2. Inject a provider double that repeatedly triggers repair-required validation outcomes.
  3. Drive `runCliTurn()` until the repair budget is exhausted.
  4. Assert exact `validation.repair_requested` event counts and `attempt_number` ordering for the configured budget, then assert a terminal validation failure and turn abort with no extra repair request after the limit.
  5. Assert deterministic aborted outcome, replayable telemetry, readable terminal output, and normal cleanup.
  6. Keep the slice scoped to repair exhaustion only.
- Required tests:
  - Repair-required responses emit exactly one `validation.repair_requested` event per allowed repair attempt until the configured repair limit is reached.
  - `validation.repair_requested.attempt_number` values advance deterministically from `1` through the configured repair limit with no gaps or extra events.
  - After the limit is reached, the next validation failure aborts the turn deterministically without another `validation.repair_requested` event.
  - Telemetry contains replayable validation-failure and terminal abort evidence proving repair exhaustion rather than provider failure or a different governor path.
  - Rendered output communicates the terminal failure cleanly.
  - Runtime cleanup still runs after the aborted turn.
- Narrow validation step:
  - `pnpm --filter @argentum/runtime test -- repair`
  - `pnpm --filter @argentum/runtime build`

## Execution Strategy

- Autopilot suitability: conditional. The slice is bounded to runtime, but it depends on the interaction among provider doubles, validation-repair, governor behavior, rendering, and telemetry.
- Parallel subagent opportunities:
  - Read-only extraction of repair-exhaustion assertions from [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md) and [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md).
- Out of scope:
  - Wall-clock governor exhaustion
  - Step-limit end-to-end proof
  - Blocked-grant paths
  - Secret-bearing tool execution
- Deferred decisions that must remain deferred:
  - Any governor-policy changes beyond the current frozen MVP defaults

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - 2026-05-25 HIGH: The initial card allowed any abort after repeated repair-required outcomes, but did not prove the exact validation-repair exhaustion path or event counts.
  - 2026-05-25 adversarial review: No CRITICAL or HIGH findings remained after implementation, focused validation, and re-review of the runtime repair-exhaustion path against the owning specs.
- Refinements applied:
  - 2026-05-25 review refinement: Acceptance criteria and tests now require exact `validation.repair_requested` counts and `attempt_number` ordering for a configured repair budget.
  - 2026-05-25 review refinement: The card now requires the terminal path to be the repair-exhaustion boundary with no extra repair request after the limit and no substitution by provider or unrelated governor failure.
  - 2026-05-25 approval review: Re-review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. The card is approved.
  - 2026-05-25 implementation refinement: Added `apps/runtime/tests/repair-exhaustion.e2e.test.ts` with a runtime-local provider double that repeatedly returns canonically invalid decisions through the supported `runCliTurn()` seam under a configured repair budget of `3`.
  - 2026-05-25 validation refinement: The new end-to-end test asserts exact `validation.repair_requested` count and `attempt_number` ordering, explicit terminal `validation.failed` plus `turn.aborted` repair-exhaustion payloads, persisted-versus-in-memory event-kind parity, rendered terminal evidence, and runtime cleanup via released active-turn state and telemetry flush on shutdown.
  - 2026-05-25 MEDIUM: The implemented proof checks persisted-versus-in-memory event-kind parity plus explicit terminal payload assertions, but it does not prove full payload parity for every persisted terminal event.
  - 2026-05-25 review refinement: Narrowed the slice-card wording to match the implemented telemetry proof instead of overstating full persisted-versus-in-memory payload parity.
  - 2026-05-25 adversarial review: Final post-refinement implementation review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. Slice 0045 is validated.
  - 2026-05-25 focused validation: `pnpm --filter @argentum/runtime test -- repair` and `pnpm --filter @argentum/runtime build` passed.