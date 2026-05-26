# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-25
- Phase: 7 (Hardening)
- Owner: apps/runtime
- Execution readiness: ready-when-approved once slice 0041 is validated for the shared runtime tool-call seam.

## Scope

- Slice name: Runtime blocked-grant tool path
- Target package or boundary: `apps/runtime` (`@argentum/runtime`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md) — every tool execution receives an `ExecutionGrantDTO`; deny outcomes must remain inside the execution boundary
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — policy-denied, disabled-tool, and secret-unavailable outcomes are deterministic grant-resolution results
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md) — blocked tool execution must still terminate the turn deterministically and release gateway ownership
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — tool-policy block is a controlled abort outcome
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — failure-path tests must prove blocked conditions terminate deterministically
- Acceptance criteria:
  - The supported `runCliTurn()` seam can exercise one deterministic blocked-grant tool-call path using a fake tool definition that resolves to a deny grant.
  - The runtime does not execute the blocked tool implementation.
  - The blocked path emits an exact `tool.blocked` event whose payload includes `call_id`, `tool_name`, `reason`, and `error_code`, and the blocked result is compacted into the second inference step before the provider returns the terminal abort decision.
  - The blocked path produces a blocked `ToolResultDTO` with `status = "blocked"` and a stable policy-oriented `error_code`; if the public runtime result does not expose this value directly, runtime-local test harness capture is used instead of widening the public API.
  - Rendered output and telemetry capture the blocked reason and `error_code` without inventing new approval modes or leaking secret values.
  - Gateway release still occurs after the blocked terminal path, blocked-turn telemetry is durably persisted for replay, and normal shutdown cleanup continues to flush the telemetry writer without widening the per-turn runtime contract.
  - The slice stays bounded to one blocked-grant cause in the E2E harness. Additional denial reasons may reuse the same boundary later.
- Inputs crossing the boundary:
  - `runCliTurn(rawInput, options?)`
  - One fake tool definition and provider double that selects the blocked tool
  - Existing grant-resolution behavior from `@argentum/environment`
- Outputs crossing the boundary:
  - Focused runtime failure-path tests proving deterministic blocked termination and cleanup

## Plan

- First contracts or interfaces to create:
  - Runtime-local blocked-tool harness helper
  - Runtime-local blocked-result capture helper for asserting `ToolResultDTO.status = "blocked"` without widening the supported runtime API
- Minimal implementation steps:
  1. Register one tool definition that will resolve to a denied grant in the runtime harness.
  2. Drive a tool-call turn whose first inference step selects that tool.
  3. Assert no tool implementation body runs once the deny grant is known.
  4. Assert the blocked path emits `tool.blocked` with `reason` and `error_code`, preserves a blocked `ToolResultDTO`, and carries the blocked summary into the terminal inference step before deterministic abort.
  5. Assert blocked-path output, telemetry, terminal abort, and cleanup behavior.
  6. Keep the slice constrained to one denied-cause harness; do not widen it into a general approval workflow slice.
- Required tests:
  - Blocked tool call aborts the turn deterministically.
  - Blocked tool implementation is never executed.
  - Telemetry captures `tool.blocked` with `call_id`, `tool_name`, `reason`, and `error_code`, followed by the terminal aborted outcome.
  - Runtime-local harness capture proves the blocked path produced `ToolResultDTO.status = "blocked"` with the same stable `error_code` surfaced in telemetry.
  - Runtime-local harness capture proves the blocked `ToolResultDTO` is compacted into the second inference step before the terminal abort decision is returned.
  - Rendered output includes a user-visible blocked or aborted message.
  - Session lock release still occurs after the blocked turn, blocked-turn telemetry is already persisted before shutdown, and normal shutdown cleanup still flushes the telemetry writer.
- Narrow validation step:
  - `pnpm --filter @argentum/runtime test -- blocked`
  - `pnpm --filter @argentum/runtime build`

## Execution Strategy

- Autopilot suitability: conditional. The slice is runtime-local, but it depends on composed behavior across grant resolution, orchestrator terminal handling, rendering, and telemetry.
- Parallel subagent opportunities:
  - Read-only failure-path checklist against [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) and [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md).
- Out of scope:
  - Rich approval workflows
  - Multi-tool blocked paths
  - Secret-bearing success paths
  - Network-policy denial modeling beyond the single blocked harness
- Deferred decisions that must remain deferred:
  - Any approval mode beyond the current MVP `auto_allow` and `deny`
  - Exact initial tool catalog

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - 2026-05-25 HIGH: The initial card used vague `tool.blocked`-class wording and did not require proof that a blocked `ToolResultDTO` with stable policy code drove the terminal path.
  - 2026-05-25 MEDIUM: The initial card did not explicitly note dependency on the runtime tool-call seam from slice 0041.
  - 2026-05-25 implementation review: Post-validation adversarial review returned no CRITICAL, HIGH, MEDIUM, or LOW findings for the runtime blocked-grant implementation.
  - 2026-05-25 MEDIUM: The implemented proof persisted blocked-turn telemetry and verified flush during shutdown cleanup, but the card overstated that the blocked turn itself proved a dedicated telemetry flush step.
  - 2026-05-25 HIGH: The card still overstated direct blocked-path causality for the terminal abort even though the test proved only that the blocked summary reaches the terminal inference step before the provider returns an abort decision.
- Refinements applied:
  - 2026-05-25 review refinement: Added execution-readiness dependency on validated slice 0041.
  - 2026-05-25 review refinement: Replaced vague blocked-path language with exact `tool.blocked` payload requirements plus runtime-local blocked `ToolResultDTO` capture using the same stable `error_code`.
  - 2026-05-25 review refinement: Focused tests now prove the blocked-result path itself, not just a generic abort side effect.
  - 2026-05-25 approval review: Re-review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. The card is approved.
  - 2026-05-25 implementation refinement: The runtime tool executor now emits the authoritative `tool.blocked` event directly with the canonical `call_id`, deny `reason`, and stable `error_code`, while suppressing the orchestrator's incomplete duplicate mapping.
  - 2026-05-25 implementation refinement: Added a runtime-local blocked-grant E2E harness that proves the denied tool implementation never runs, captures the blocked `ToolResultDTO` via compaction spy, and verifies deterministic abort, rendered evidence, persisted telemetry, shutdown-flush cleanup, and gateway release.
  - 2026-05-25 review refinement: Narrowed the card wording so slice 0044 requires proof that blocked evidence is compacted into the second inference step before the provider returns the terminal abort decision, without claiming a stronger direct-causality construction than the harness currently proves.
  - 2026-05-25 adversarial review: Final post-refinement implementation review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. Slice 0044 is validated.