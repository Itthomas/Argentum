# Current Phase

## Active Phase

Phase 1: Core spine

## Goal

Establish ingress trust handling, queue semantics, durable task continuity, core schemas, claims, and state-machine enforcement on top of the completed Phase 0 deployment boundary.

## Immediate Tasks

- Define code-level representations for `EventRecord`, `SessionRecord`, `TaskRecord`, and `TaskClaimRecord`.
- Choose the initial PostgreSQL persistence and migration approach.
- Implement legal task and claim transition boundaries instead of freeform mutation.
- Define the event intake contract for ingress trust handling, queue ownership, retry behavior, and dead-letter handling.
- Establish Phase 1 verification targets for schema, lifecycle, and claim exclusivity behavior.

## Current Blockers

- No durable schema code exists yet for the Phase 1 objects.
- The persistence and migration stack for PostgreSQL has not been selected yet.

## Definition Of Done

- Phase 1 durable records are represented in code.
- Event, task, and claim transitions are governed rather than ad hoc.
- Claim acquisition preserves exclusive ownership semantics.
- Phase 1 verification targets are automated with pytest where practical.