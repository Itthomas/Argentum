# Eventing Model

## Purpose

This document defines how runtime events are categorized and used.

## Event Roles

- Rendering: events consumed by a channel module for user-facing output
- Telemetry: events written to logs for debugging, replay, and inspection
- Internal coordination: events used to expose state transitions without creating hidden side channels

## Event Families

- `turn.*`: creation, state changes, completion, abort
- `validation.*`: parser failures, schema failures, repair attempts
- `llm.*`: inference start, inference finish, adapter failure
- `tool.*`: call planned, call started, call finished, call blocked
- `memory.*`: compaction started, compaction committed
- `response.*`: user-visible response emission and completion
- `queue.*`: ingress queued, dequeued, and rejected

## Event Scopes

- `queue.*` events are session-scoped in MVP.
- All other required MVP event families are turn-scoped.

## Rules

- Event names must be stable and machine-readable.
- Event payloads must reference large artifacts instead of embedding them.
- Rendering logic must key off event kinds and visibility rather than inspect private module state.
- Event emission must not become an alternative control plane.

## Open Questions

- None at the MVP event-contract level.