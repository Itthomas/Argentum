# STATUS

## Current Phase

Phase 3: Memory, Scheduling, And Subagents

## Repo State

Workspace scaffolded for phased implementation.
Canonical architecture and appendix documents live under `docs/`.
Python package namespace established as `argentum`.
Phase 2 runtime and approval foundations are implemented in Python with Pydantic, SQLAlchemy, Alembic, LangGraph, and pytest coverage.

## Completed

- Created the `docs/`, `docs/phases/`, `src/`, and `tests/` workspace structure.
- Moved the canonical architecture documents under `docs/`.
- Added planning and phase-tracking documents.
- Initialized minimal Python project metadata for `argentum`.
- Added the derived cross-cutting reference docs under `docs/reference/`.
- Expanded the phase docs into richer implementation packets with explicit required readings.
- Remediated the canonical architecture spec to clarify bootstrap integrity, external trust boundaries, queue semantics, artifact retention, staged tool activation, and least-privilege secret access.
- Remediated the technical appendix to add enforceable queue/auth fields, approval-resolution constraints, artifact retention fields, and generated-tool lifecycle records.
- Rebalanced the affected phase and reference docs to align with the remediated canonical contracts.
- Completed Phase 0 on the Raspberry Pi by creating `/srv/argentum`, the restricted runtime user `argentum`, the protected bootstrap identity path, and the bounded runtime-writable subtree under `/srv/argentum/var`.
- Verified `admin` SSH access, runtime write access within `/srv/argentum/var`, and runtime write failure outside the permitted subtree and against `SOUL.md`.
- Revalidated the Phase 0 Pi deployment boundary from this workspace on 2026-04-20, including protected-path ownership checks and runtime-user write/deny probes.
- Selected SQLAlchemy 2, Alembic, and psycopg as the initial PostgreSQL persistence and migration stack.
- Implemented Phase 1 domain enums, durable Pydantic records, governed task and claim lifecycle helpers, and ingress intake policy evaluation.
- Added SQLAlchemy ORM tables, session helpers, claim and event repository scaffolding, and the initial Alembic migration for `events`, `sessions`, `tasks`, and `task_claims`.
- Completed the missing Phase 1 repository behaviors for idempotent event handling and coordinated terminal-state claim release.
- Automated Phase 1 verification for schema invariants, ingress rejection and retry behavior, lifecycle enforcement, claim exclusivity, idempotent event handling, and terminal-state claim release expectations with pytest.
- Smoke-tested the initial Alembic migration against SQLite to confirm the schema creates `events`, `sessions`, `tasks`, and `task_claims` plus `alembic_version`.
- Added Phase 2 enums and durable Pydantic records for approvals, routing policy, provider health, bounded context packets, and runtime working state.
- Added approval lifecycle handling, approval and routing repositories, and the Phase 2 Alembic migration for `approvals`, `model_routing_policies`, and `provider_health`.
- Implemented bounded context assembly with explicit budget trimming order and bootstrap-identity integrity handling.
- Implemented operation-aware routing policy defaults, provider-health-aware route selection, and an orchestration boundary for model access.
- Implemented a lean LangGraph runtime path that refuses execution without an authoritative claim, pauses durably for approval, resumes after approval resolution, and persists terminal task transitions through the Phase 1 durable spine.
- Verified Phase 2 with focused and full pytest coverage plus a SQLite Alembic smoke upgrade through `20260420_0002`.

## In Progress

- Preparing Phase 3 implementation for memory retrieval, scheduling, stale-state recovery, and bounded subagents.

## Upcoming

- Define typed memory persistence and retrieval contracts.
- Add heartbeat, cron, and follow-up scheduling entry points.
- Design recovery behavior for stale approvals, stale claims, and lost child tasks.
- Implement bounded subagent parent-child tracking and result handling.

## Known Issues

- No CI, lint, or formatting tooling has been added yet.
- The placeholder bootstrap identity content in `/srv/argentum/config/bootstrap/SOUL.md` still needs to be replaced before runtime enablement.

## Technical Debt

- Packaging is still intentionally lean and will need expansion as the runtime and approval stack grow.
- The current runtime path is intentionally narrow and does not yet include Phase 3 memory retrieval, scheduling, or delegated-worker lifecycle behavior.

## Risks And Blockers

- Phase 3 scheduling and stale-state recovery could become entangled with runtime logic if the boundaries are not preserved.
- Subagent contracts must remain narrow so delegated workers do not duplicate the whole system runtime.
- The placeholder bootstrap identity content still blocks real runtime enablement even though the integrity path now exists.

## Verification Status

- Workspace scaffold: complete
- Documentation scaffold: complete
- Canonical remediation pass: complete
- Derived-doc synchronization: complete
- Python project metadata: complete
- Phase 0 defaults selected: complete
- Phase 0 remote bootstrap: complete
- Phase 0 remote revalidation: complete
- Phase 1 domain models and lifecycle rules: complete
- Phase 1 ingress and persistence foundations: complete
- Phase 1 gate coverage: complete
- Phase 2 runtime and approvals: complete
- Phase 2 migration smoke test: complete
- Automated tests: passing
- Phase 3 implementation: not started