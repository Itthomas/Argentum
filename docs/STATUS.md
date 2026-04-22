# STATUS

## Current Phase

Phase 4: Self-Extension And Hardening

## Repo State

Workspace scaffolded for phased implementation.
Canonical architecture and appendix documents live under `docs/`.
Python package namespace established as `argentum`.
Phase 4 generated-tool lifecycle, async runtime orchestration, and observability foundations are now implemented in Python with Pydantic, SQLAlchemy, Alembic, LangGraph, and pytest coverage.

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
- Added Phase 3 enums, Pydantic records, and lifecycle helpers for memories, artifacts, follow-up scheduling, and subagents.
- Added Phase 3 repositories for memory retrieval, artifact provenance, stale-work inspection, follow-up scheduling, and subagent parent-child handling.
- Implemented heartbeat inspection and stale-work recovery services that reconstruct fresh maintenance state from durable records.
- Extended the runtime to loop `continue_now` turns within a bounded run, persist scheduled follow-ups, and create durable delegated child-task and subagent records.
- Added the Phase 3 Alembic migration for `memories`, `artifacts`, and `subagents` plus the stale-work lookup indexes required by recovery and heartbeat inspection.
- Verified Phase 3 with focused and full pytest coverage plus a SQLite Alembic smoke upgrade through `20260421_0003`.
- Converted the orchestration boundary to async for `TaskRuntime.run()` and `LLMOrchestrator.invoke_operation()`.
- Added Phase 4 durable records, lifecycle handling, repositories, and migration support for `generated_tools` and `activity_records`.
- Added observability reporting services for provider-routing visibility, generated-tool lifecycle history, and task activity history.
- Added Alembic-backed integration tests for approval-gated generated-tool activation and async runtime fallback visibility.
- Tightened generated-tool activation so quarantined, limited, and global states require a linked durable approval already resolved as `approved`.
- Switched Alembic configuration to environment-backed URL resolution and removed the deprecated path-separator warning during migration-backed tests.
- Deployed the curated bootstrap identity to the Pi and verified the protected runtime-visible hash path.

## In Progress

- Continuing Phase 4 implementation on top of the new generated-tool and observability foundations.

## Upcoming

- Define tool proposal, validation, verification, approval, and staged activation boundaries.
- Expand provider degradation handling beyond the current routing-activity visibility layer.
- Add richer operator-facing summaries and cost visibility on top of the new activity history.
- Harden restart and recovery handling for interrupted high-consequence operations.

## Known Issues

- No CI, lint, or formatting tooling has been added yet.

## Technical Debt

- Packaging is still intentionally lean and will need expansion as the runtime and approval stack grow.
- Memory retrieval currently validates the service boundary and ranking policy locally; PostgreSQL and pgvector deployment hardening still needs environment-backed verification.

## Risks And Blockers

- Phase 4 self-extension work increases risk if validation, approval, and staged activation boundaries are weak.
- Provider fallback visibility now exists through durable routing activity, but higher-level operator summaries and cost visibility still need to be expanded.

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
- Phase 3 memory, scheduling, and subagents: complete
- Phase 3 migration smoke test: complete
- Phase 4 generated-tool and observability foundations: complete
- Phase 4 integration tests: passing
- Automated tests: passing
- Phase 4 implementation: in progress