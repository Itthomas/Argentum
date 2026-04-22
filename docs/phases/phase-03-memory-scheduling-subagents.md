# Phase 3: Memory, Scheduling, And Subagents

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 16, 17, 20, 21, 25 through 29; Appendix sections 9 through 11, 17, 20 through 25
> Required reading: `docs/reference/conventions.md`, `docs/reference/durable-data-model.md`, `docs/reference/observability-and-operations.md`
> Intended use: implementation packet for long-term memory, scheduling, stale-state recovery, and bounded delegation

Phase 3 is complete.

Phase 3 is now exit-clean against the verification tasks listed in this packet.

Implemented outcomes:

- canonical Phase 3 enums, durable records, and lifecycle helpers for memories, artifacts, and subagents under `src/argentum/domain/`
- SQLAlchemy tables, metadata registration, and Alembic migration coverage for `memories`, `artifacts`, and `subagents` plus stale-work indexes on `tasks.stale_after_at`
- repository-backed memory filtering and ranking, artifact provenance recording, stale-task and stale-claim inspection, and durable subagent parent-child result handling under `src/argentum/persistence/repositories.py`
- fresh-state heartbeat inspection and stale-work recovery services under `src/argentum/runtime/maintenance.py`
- runtime continuation support for `continue_now`, `schedule_followup`, and durable delegated child-task creation under `src/argentum/runtime/graph.py`
- pytest coverage for memory ranking, stale-state recovery, heartbeat inspection, follow-up scheduling, and parent-child completed, failed, timed-out, and lost outcomes

Verification completed:

- `pytest tests/unit -ra`
- SQLite Alembic smoke upgrade through `20260421_0003` confirming table creation for `memories`, `artifacts`, and `subagents` alongside the earlier durable schema

## Objective

Extend the core system with durable memory retrieval, scheduled and heartbeat-driven continuation, stale-state recovery, and bounded delegated work.

## Canonical Requirements Summary

- long-term memory must be a unified typed store backed by PostgreSQL and pgvector
- heartbeat-triggered work must begin with fresh runtime state rather than reviving a large historical graph state
- stale work must transition through explicit policy outcomes rather than staying in limbo
- subagents must remain bounded workers with explicit parent-child linkage and failure semantics

## Required Reading

1. `docs/reference/conventions.md`
2. `docs/reference/durable-data-model.md`
3. `docs/reference/observability-and-operations.md`

## Scope

- long-term memory typing and retrieval behavior
- heartbeat, cron, and follow-up scheduling
- reaper or sweeper recovery behavior
- subagent parent-child contract and failure handling
- timeout and stale-state policy execution

## Included Subsystems

- Long-Term Memory Layer
- Artifact Layer
- Scheduling and Heartbeat Layer
- Subagent Layer

## Out Of Scope

- initial durable task model from Phase 1
- primary approval lifecycle from Phase 2
- generated tool pipeline and hardening from Phase 4

## Durable Schemas Touched

### MemoryRecord

Phase 3 needs typed memory with:

- `memory_id`, `memory_type`, `content`, `summary`, `embedding_ref`
- `source_kind`, `source_ref`
- `confidence`, `recency_weight`, `tags`, `metadata_json`
- `created_at`, `updated_at`

Retrieval expectations to preserve:

- semantic retrieval by embedding similarity
- typed filtering
- source filtering
- recency-aware ranking
- confidence-aware ranking

### ArtifactRecord

Phase 3 needs durable artifact references with provenance through task and run linkage.

### SubagentRecord

Phase 3 needs bounded parent-child tracking with:

- parent task linkage and child task linkage
- role and status
- delegated objective and expected output contract
- timing and heartbeat fields
- result artifact references and error summary

## State Machines Touched

### Subagent State Machine

Phase 3 must support the `proposed`, `running`, `completed`, `failed`, `timed_out`, `lost`, and `cancelled` states with explicit parent update behavior.

### Recovery Policies

Phase 3 should implement explicit stale-state outcomes for lost child tasks, stale approvals, stale claims, and other suspended work.

## Scheduling Extract

Phase 3 should preserve the supported scheduling forms:

- recurring heartbeat ticks
- cron-based scheduled triggers
- one-shot follow-up scheduling
- task-driven delayed continuation

Heartbeat runs may consult open-task summaries, blocked or waiting tasks, scheduled commitments, and relevant recent memory.

## Parent-Child Handling Extract

Parent tasks must not wait indefinitely for child status alone. Child completion, failure, timeout, lost heartbeat, or malformed output must lead to explicit parent policy such as retry, operator escalation, continue without child, fail parent, or block pending recovery decision.

## Implementation Tasks

- define typed memory persistence and retrieval contracts
- establish heartbeat-triggered run entry points using fresh runtime state
- design recovery logic for stale approvals, stale claims, and lost child tasks
- implement bounded subagent contracts and result handling
- define artifact provenance requirements in code-facing terms

## Failure Modes And Edge Cases

- waiting or blocked work must not remain indefinitely without policy
- child tasks must not silently disappear without updating parent state
- memory retrieval must not collapse into unbounded prompt loading
- heartbeat maintenance must not revive a large historical graph-state object directly

## Verification Tasks

- test memory filtering and ranking behavior at the service boundary
- test stale-state recovery decisions
- test heartbeat-driven inspection and continuation rules
- test parent-child handling for completed, failed, timed-out, and lost child tasks

## Exit Criteria

- memory, scheduling, and delegated work operate through durable policy-driven flows
- no waiting task or child task can remain indefinitely without a defined policy outcome
- recovery behavior is explicit and testable

## Risks And Open Questions

- scheduling behavior can become tangled with runtime logic if boundaries are not preserved
- subagent contracts must remain narrow to avoid duplicating the whole system
