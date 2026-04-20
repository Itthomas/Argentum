# STATUS

## Current Phase

Phase 2: Runtime And Approvals

## Repo State

Workspace scaffolded for phased implementation.
Canonical architecture and appendix documents live under `docs/`.
Python package namespace established as `argentum`.
Phase 1 durable foundations are implemented in Python with Pydantic, SQLAlchemy, Alembic, psycopg, and pytest coverage.

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
- Selected SQLAlchemy 2, Alembic, and psycopg as the initial PostgreSQL persistence and migration stack.
- Implemented Phase 1 domain enums, durable Pydantic records, governed task and claim lifecycle helpers, and ingress intake policy evaluation.
- Added SQLAlchemy ORM tables, session helpers, claim and event repository scaffolding, and the initial Alembic migration for `events`, `sessions`, `tasks`, and `task_claims`.
- Automated Phase 1 verification for schema invariants, ingress rejection and retry behavior, lifecycle enforcement, and claim exclusivity with pytest.
- Smoke-tested the initial Alembic migration against SQLite to confirm the schema creates `events`, `sessions`, `tasks`, and `task_claims` plus `alembic_version`.

## In Progress

- Preparing Phase 2 implementation for context assembly, routing policy, runtime orchestration, and approvals.

## Upcoming

- Define the bounded context-packet and budget model.
- Implement routing-policy objects and operation-tier defaults.
- Add approval durability, lifecycle handling, and resumable decision application.
- Establish the first lean runtime flow that refuses execution without an authoritative claim.

## Known Issues

- No Phase 2 runtime loop, approval records, or model-routing layer exists yet.
- No CI, lint, or formatting tooling has been added yet.
- The placeholder bootstrap identity content in `/srv/argentum/config/bootstrap/SOUL.md` still needs to be replaced before runtime enablement.

## Technical Debt

- Packaging is still intentionally lean and will need expansion as the runtime and approval stack grow.
- The current repositories and migration baseline establish the durable spine, but they do not yet provide full async runtime integration.

## Risks And Blockers

- Runtime state could drift into becoming a second durable store unless Phase 2 keeps LangGraph state narrow and ephemeral.
- Approval pause and resume logic must stay idempotent to avoid duplicate governed actions.
- Bootstrap identity handling still needs a concrete runtime integrity path before execution features are enabled.

## Verification Status

- Workspace scaffold: complete
- Documentation scaffold: complete
- Canonical remediation pass: complete
- Derived-doc synchronization: complete
- Python project metadata: complete
- Phase 0 defaults selected: complete
- Phase 0 remote bootstrap: complete
- Phase 1 domain models and lifecycle rules: complete
- Phase 1 ingress and persistence foundations: complete
- Automated tests: started and passing
- Runtime implementation: not started