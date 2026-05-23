# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: workflow synthesis plus adversarial review
- Approval date: 2026-05-22
- Phase: 1
- Owner: contracts
- Execution readiness: validated
- Validation note: focused `@argentum/contracts` stream-event boundary tests are present, and local validation passed with `pnpm --filter @argentum/contracts test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Stream-event contract and minimum payload validation
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/40-modules/gateway/telemetry.md](../../spec/40-modules/gateway/telemetry.md)
  - [docs/spec/50-implementation/logging-plan.md](../../spec/50-implementation/logging-plan.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports a canonical `StreamEvent` type surface and a stable parse or validate entrypoint for event-shaped input.
  - Validation enforces the required top-level `StreamEvent` fields, including `scope`, `visibility`, append-only payload object shape, the conditional `turn_id` requirement when `scope = turn`, integer `sequence`, and UTC timestamp string validation for `timestamp`.
  - Validation rejects unknown top-level fields, wrong primitive types, non-object payloads, and invalid enum values without introducing hidden defaults or provider-specific fields.
  - The contracts layer treats `kind` as an open canonical string so later spec-defined event kinds can be added without redefining the contract surface, while still enforcing the documented MVP minimum payload fields for the kinds named in [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md).
  - The contracts layer preserves the eventing-model scope split by requiring `queue.*` events to validate as session-scoped and the other required MVP event families to validate as turn-scoped.
  - The slice remains contract-only. It does not implement telemetry persistence, event emission ordering, or channel rendering.
- Inputs crossing the boundary:
  - Event-shaped values produced by gateway, agentic-core, tooling, or provider-adjacent callers before telemetry persistence or channel rendering.
- Outputs crossing the boundary:
  - Typed `StreamEvent` and minimum payload contract exports for telemetry and channel consumers.
  - A stable contract-owned parser or validator entrypoint reused by later telemetry and event-emission slices.

## Plan

- First contracts or interfaces to create:
  - `StreamEvent` type export
  - Event-scope and visibility contract types
  - Contract-owned parser or validator entrypoint for `StreamEvent`
  - Minimum payload contract surfaces for the required MVP event kinds or families
- Minimal implementation steps:
  - Add the canonical `StreamEvent` contract surface to `@argentum/contracts`.
  - Encode the top-level field rules from the stream-event spec, including conditional `turn_id` validation, integer `sequence`, and UTC timestamp validation.
  - Keep `kind` open for future spec-defined expansion and encode the minimum payload requirements only for the documented MVP event kinds while allowing additive payload fields.
  - Keep validation strict at the contract boundary and avoid telemetry-local or provider-local DTOs.
  - Export only the stable contract surface needed by later telemetry, gateway, agentic-core, tooling, and channel slices.
- Required tests:
  - Contract validation tests for valid session-scoped `queue.*` events.
  - Contract validation tests for valid turn-scoped `turn.*`, `validation.*`, `llm.*`, `tool.*`, `memory.*`, and `response.*` events.
  - Contract validation tests proving `turn_id` is required for turn-scoped events and not required for session-scoped queue events.
  - Contract validation tests rejecting unknown top-level fields, invalid `scope` values, invalid `visibility` values, non-object payloads, wrong primitive types, non-integer `sequence` values, and malformed or non-UTC `timestamp` values.
  - Contract validation tests proving each required MVP event kind enforces its documented minimum payload fields while permitting extra payload fields.
  - Contract validation tests rejecting `queue.*` events with turn scope and rejecting non-queue required event families with session scope.
  - Contract validation tests proving non-MVP event kinds still validate against the top-level `StreamEvent` contract without being forced into a closed enum, while documented MVP kinds continue to enforce their minimum payload fields.
  - Boundary-focused tests that exercise the public exported validator or parser entrypoint rather than schema internals.
  - Boundary-focused compatibility tests proving the validated contract preserves the correlation identifiers and payload minima needed by later telemetry JSON-lines persistence.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test` after adding slice-specific tests that fail when missing; do not treat a zero-test pass as sufficient validation for this slice.
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: conditional. The slice is still a single-package, contract-first candidate, but it is only safe for autopilot once slice-specific tests are present and the validation run proves them rather than passing vacuously.
- Parallel subagent opportunities:
  - Read-only extraction of exact field and scope rules from [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md) and [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - Read-only extraction of minimum payload cases from [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md) for test planning
- Out of scope:
  - Telemetry package persistence implementation
  - JSON-lines file layout or log rotation behavior
  - Runtime event sequencing logic beyond contract-level field validation
  - Event production inside gateway, agentic-core, tooling, provider, or channel packages
  - Metrics backends or observability dashboards
  - Any non-event canonical contract work outside the stream-event slice
- Deferred decisions that must remain deferred:
  - Concrete telemetry storage lifecycle details beyond append-only flat structured logs
  - Any post-MVP metrics or centralized observability backend

## Review Log

- Adversarial review findings:
  - Initial review required clarifying that `turn_id` is not required for session-scoped events rather than forbidding it outright.
  - Initial review required explicit top-level validation coverage for integer `sequence` and UTC `timestamp`.
  - Initial review required the `kind` contract to stay open to later spec-defined expansion instead of implying a closed MVP-only enum.
  - Initial review required a non-vacuous validation gate because the current package test script allows zero-test success.
  - Follow-up subagent adversarial review found no additional blocking drift, boundary, validation, or deferred-decision issues after the refinements in this card.
- Refinements applied:
  - Selected a contracts-owned slice because the current `contracts` package does not yet expose `StreamEvent`, making a telemetry-package slice depend on a missing upstream contract.
  - Kept the slice contract-only so telemetry persistence and event emission remain separate owning boundaries.
  - Bound scope to minimum payload validation for the MVP-required event kinds instead of broader event-production or logging behavior.
  - Reworded the `turn_id` requirement so session-scoped events are not over-constrained beyond the canonical contract.
  - Added explicit `sequence` and `timestamp` validation obligations to the acceptance criteria, implementation steps, and tests.
  - Clarified that `kind` remains an open canonical string with MVP minimum-payload enforcement limited to documented event kinds.
  - Tightened the validation gate and downgraded autopilot from safe to conditional until real slice-specific tests exist.
  - Restored approval after the follow-up adversarial review found no remaining blockers for the planning slice.
