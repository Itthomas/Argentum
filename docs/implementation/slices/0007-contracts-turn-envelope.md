# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: adversarial review follow-up
- Approval date: 2026-05-22
- Phase: 2
- Owner: contracts
- Execution readiness: validated
- Validation note: the `@argentum/contracts` package exports the canonical `ContentRef`, `TurnState`, `TurnBudget`, and `TurnEnvelope` surfaces, the package test gate now covers direct content-reference validation plus turn-envelope composition and published entrypoint smoke coverage, and local validation passed with `pnpm --filter @argentum/contracts test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Canonical turn-envelope contract and nested content-reference validation
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/00-overview/mvp-scope.md](../../spec/00-overview/mvp-scope.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md)
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md)
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md)
  - [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `ContentRef`, `TurnState`, `TurnBudget`, and `TurnEnvelope` type surfaces plus stable parse or validate entrypoints that later gateway and agentic-core slices can import directly.
  - The exported contract surface enforces immutable turn identity fields, integer governor budget fields, non-negative counters, UTC timestamps for `created_at` and `updated_at`, and optional `final_outcome` as a field-level string without embedding transition logic or inventing a final-outcome enum.
  - The exported contract surface restricts `state` to the canonical MVP turn-state set from [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) and does not invent gateway-local or provider-local states.
  - `TurnEnvelope.context_refs` composes the canonical `ContentRef` contract for nested items, preserves context membership as a contract concern, and does not replace nested references with gateway-local or provider-local shapes.
  - The slice remains contract-only. It does not create turns, stamp runtime governor defaults, emit `turn.*` events, or enforce allowed transition order beyond field-level canonical validation.
- Inputs crossing the boundary:
  - Turn-envelope-shaped values produced by the gateway-owned turn-creation seam named in [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md).
  - Nested content-reference-shaped values that later gateway and agentic-core slices attach to `context_refs`.
  - Budget-shaped values sourced from later gateway use of validated runtime governor defaults.
- Outputs crossing the boundary:
  - Typed `ContentRef`, `TurnState`, `TurnBudget`, and `TurnEnvelope` contract exports reused by gateway, agentic_core, and telemetry.
  - Stable contract-owned parser or validator entrypoints and validation issue surfaces for direct `ContentRef` input and turn-envelope input.

## Plan

- First contracts or interfaces to create:
  - `ContentRef` type export for canonical persisted-content references reused across boundaries.
  - Contract-owned parser or validator entrypoint for `ContentRef`.
  - `TurnState` literal-union export derived from the canonical core-loop state machine.
  - `TurnEnvelope` type export for the canonical unit of turn execution.
  - `TurnBudget` type export for the stamped governor budget surface.
  - Contract-owned parser or validator entrypoints for `TurnEnvelope` and nested budget data.
  - Public index exports for the new turn-envelope contract surfaces.
- Minimal implementation steps:
  - Add a content-reference contract module under `packages/contracts` that validates the canonical `kind`, `storage_area`, `locator`, and `retention` rules needed by `TurnEnvelope.context_refs` and rejects unknown keys.
  - Add a turn-envelope contract module under `packages/contracts` that validates the canonical field set, state literals, budget structure, timestamp rules, and unknown-key rejection for the top-level envelope and nested budget object.
  - Compose the canonical `ContentRef` validator for `context_refs` instead of validating nested references as opaque objects.
  - Keep `final_outcome` optional and field-level only so later gateway and agentic-core slices remain responsible for lifecycle semantics and completion taxonomy.
  - Keep turn creation, runtime-default stamping, and event emission entirely outside the contracts package so the gateway remains the only producer of new `TurnEnvelope` values.
  - Export only the stable public contract surfaces from `packages/contracts/src/index.ts`.
- Required tests:
  - Contract validation tests for valid direct `ContentRef` parsing across the canonical `kind`, `storage_area`, and `retention` combinations allowed by the spec.
  - Contract validation tests for a valid newly accepted turn envelope.
  - Contract validation tests for a valid finalized turn envelope that includes `final_outcome` as an optional string field without requiring a contract-local outcome enum.
  - Contract validation tests for valid `ContentRef` values reused through `TurnEnvelope.context_refs`.
  - Contract validation tests rejecting missing required top-level turn-envelope fields, including `turn_id`, `session_id`, `ingress_id`, `state`, `step_count`, `budget`, `context_refs`, `compaction_revision`, `created_at`, and `updated_at`.
  - Contract validation tests rejecting missing required budget fields, including `max_inference_steps`, `max_repair_attempts`, `max_wall_clock_ms`, and `repair_attempts_used`.
  - Contract validation tests for invalid state values, invalid timestamps, wrong primitive types, negative counters, non-array `context_refs`, invalid nested `ContentRef` items, and unknown top-level or nested budget fields.
  - Boundary-focused tests that exercise the public exports from `@argentum/contracts` rather than schema internals, including at least one package-entrypoint test that proves downstream callers can import the new turn-envelope surfaces directly.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: not applicable after validation. The slice was bounded to the `contracts` package and validated with package-scoped tests plus workspace typecheck on 2026-05-22.
- Parallel subagent opportunities:
  - Read-only extraction of turn-state and budget edge cases from [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) and [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md).
  - Read-only downstream scan of [docs/implementation/slices/0009-gateway-turn-envelope-creation.md](./0009-gateway-turn-envelope-creation.md) to confirm the public export surface needed by the next turn-handoff slice stays minimal.
- Out of scope:
  - Turn creation policy inside the gateway.
  - Session routing, lock ownership, or queue admission behavior.
  - State-transition enforcement logic.
  - `turn.*` event emission.
  - Runtime-config loading or governor-default derivation.
  - Any `final_outcome` taxonomy beyond preserving the field as an optional canonical string.
  - Any queue, lock, or session-persistence behavior.
- Deferred decisions that must remain deferred:
  - None beyond the existing spec-defined contract surface.

## Risks And Sequencing Notes

- Primary planning risk: widening this slice into gateway-owned turn creation would collapse the boundary named in [docs/spec/40-modules/gateway/gateway-spec.md](../../spec/40-modules/gateway/gateway-spec.md).
- Primary contract risk: inventing a closed `final_outcome` literal set here would exceed the current leaf spec, which only defines the field as an optional string.
- Sequencing note: this slice is implemented and locally validated. Downstream gateway and agentic-core slices should consume the exported `ContentRef` and `TurnEnvelope` contract surface directly rather than introducing temporary boundary-local shapes.

## Review Log

- Adversarial review findings:
  - Initial draft hid a direct nested dependency because `TurnEnvelope.context_refs` is a canonical cross-boundary `ContentRef` array rather than an opaque object list.
  - Follow-up adversarial review found no additional blocking planning defects after the nested `ContentRef` dependency was made explicit.
  - Slice-refresh review found that the card needed an explicit gateway-ownership citation and a guard against implying a canonical `final_outcome` enum that the spec does not define.
  - Final approval review found two remaining medium-severity issues: the card over-specified turn timestamp format beyond the leaf spec, and the required tests did not explicitly name missing-field rejection for the envelope and nested budget.
  - Post-implementation review found two current-state boundary gaps: the `ContentRef` locator rule was not enforced strongly enough for a storage-area-relative contract, and the turn-envelope timestamp fallback still admitted textual non-zero-offset forms through loose UTC or GMT parsing.
  - Follow-up adversarial review after the contract refinements found no remaining blocking drift in the slice card or implementation, and the slice remained approved in validated state.
- Refinements applied:
  - Folded `ContentRef` into the same upstream contracts slice as a direct nested dependency so later gateway and agentic-core work does not need to invent a temporary reference shape.
  - Kept the slice contract-only so gateway turn creation and agentic-core transition enforcement remain separate later slices.
  - Added the gateway module spec as an authority so the producer boundary for new `TurnEnvelope` values stays explicit.
  - Synchronized the execution-strategy note to the validated state so the card no longer describes autopilot gating for work that is already complete.
  - Relaxed the timestamp wording from UTC ISO-8601 to UTC timestamp so the card matches the turn-envelope leaf spec exactly.
  - Added explicit required-field rejection tests for the top-level envelope and nested budget so the contract validation target is complete enough for approval.
  - Tightened `ContentRef.locator` validation to reject obvious absolute-path and URI-style locators so the canonical contract stays scoped relative to `storage_area`.
  - Tightened turn-envelope UTC timestamp validation and added focused regression tests so non-zero-offset textual forms no longer pass the canonical contract validator.