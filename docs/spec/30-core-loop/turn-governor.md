# Turn Governor

## Purpose

This document defines the safety and budget controls that bound one turn.

## Governor Responsibilities

- Enforce maximum inference-step count
- Enforce wall-clock runtime ceilings
- Enforce maximum repair attempts
- Convert exhausted budgets into controlled aborts

## MVP Defaults

- `max_inference_steps = 12`
- `max_repair_attempts = 3`
- `max_wall_clock_ms = 600000`

## Ownership

- The gateway stamps the default governor values into `TurnEnvelope.budget` when the turn is created.
- The agentic layer reads and enforces those values during turn execution.
- `repair_attempts_used` is incremented only when the core loop commits a canonical repair attempt after validation failure.
- Default governor values are sourced from `RuntimeConfigDTO.governor`.

## Rules

- The governor evaluates state before each new inference step.
- The governor may stop a turn only through explicit abort semantics.
- Budget exhaustion must emit telemetry before finalization.
- Governor behavior must be deterministic for the same observed inputs.
- `step_count` comparisons are based on completed inference decision cycles, not individual tool calls.
- A turn must abort when `step_count` would exceed `max_inference_steps`.
- A turn must abort when `repair_attempts_used` would exceed `max_repair_attempts`.
- A turn must abort when observed wall-clock runtime exceeds `max_wall_clock_ms`.

## MVP Constraints

- The governor is local to one turn.
- Budget tuning is intentionally loose but still finite in MVP.
- No cross-session fairness or scheduler policy is required.

## Open Questions

- None.