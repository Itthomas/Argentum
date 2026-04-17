# Greenfield Project Instructions

## Project Overview

This is a greenfield autonomous agent system built around LangGraph, PostgreSQL, pgvector, Slack, durable task continuity, curated context assembly, and a governed self-extension model.

Repository URL: `https://github.com/Itthomas/Argentum.git`

Treat this project as a new system. Do not assume continuity with any prior implementation, prior deployment layout, prior runtime identity, or prior documentation set unless a greenfield document explicitly says otherwise.

## Key Docs

Read these first when they exist:

- `docs/System Architecture Specification.md`
- `docs/System Technical Appendix.md`
- `docs/STATUS.md`
- `docs/PHASE_INDEX.md`
- `docs/CURRENT_PHASE.md`

The canonical architecture documents and the active workflow-tracking documents live under `docs/`.

Derived working references live under `docs/reference/`, and derived implementation packets live under `docs/phases/`.
For implementation work, read the active phase doc first, then the explicitly listed reference docs for that phase before falling back to the canonical documents.

## Instruction And Workflow Files

- For VS Code local agent work, always read `docs/CURRENT_PHASE.md` before implementation and then load the active phase packet under `docs/phases/`.
- Path-specific rules live under `.github/instructions/` and should be treated as the primary working guidance for matching file classes.
- Reusable workflow entry points live under `.github/prompts/` and `.github/skills/`.
- Keep these instruction files lean; they should direct work, not duplicate large architecture sections.
- If a path-specific instruction conflicts with the canonical architecture or appendix, the canonical docs win.

## Deployment Access

- The intended deployment target is a Raspberry Pi 5 reachable over SSH.
- For remote validation, bootstrap, and test runs on the Pi, use the `admin` account with key-based auth unless the greenfield deployment docs explicitly change that.
- Preferred SSH command: `ssh -i ~/.ssh/id_agentic admin@xx-vitae-xx`
- The remote deployment workspace path is not established yet and should be created during Phase 0 bootstrap.
- Phase 0 bootstrap must create a dedicated restricted runtime user for the agent and a workspace subtree writable by that user, while development and bootstrap work continue through the `admin` account.
- Final test validation should be performed on the Pi once the greenfield deployment path and service layout exist. Local runs are advisory only.

## Phased Workflow

- Phase 0 is Environment Bootstrap and should establish the Pi workspace directory, the restricted runtime user, and the initial deployment filesystem boundaries before implementation phases proceed.
- Phase 1 through Phase 4 are the implementation phases tracked under `docs/phases/`.
- After each completed and verified phase, push the repository state to `https://github.com/Itthomas/Argentum.git`.

## Working Rules

- Read the architecture spec before making structural changes.
- Read the technical appendix before changing durable schemas, task lifecycle behavior, approval flow, claim handling, or model-routing behavior.
- Prefer extending the documented architecture over inventing parallel patterns.
- Keep the default execution path lean. Do not introduce a heavy planner or oversized shared state unless the architecture explicitly requires it.
- Preserve the separation between session continuity, task continuity, long-term memory, and prompt context.
- Treat model selection, timeout behavior, and provider failover as policy concerns, not scattered call-site decisions.
- Keep `docs/STATUS.md`, `docs/PHASE_INDEX.md`, `docs/CURRENT_PHASE.md`, and the relevant file under `docs/phases/` aligned with actual progress.

## Coding Conventions

### Workspace Layout

- Application code belongs under `src/argentum`.
- Tests use pytest and live under `tests/unit`, `tests/integration`, and `tests/fixtures`.
- Canonical architecture and workflow documents live under `docs/`.

### Python

- Use `from __future__ import annotations` in source files.
- Add full type hints on function signatures and return types.
- Use Pydantic models for durable schemas and structured payloads unless a document explicitly permits another shape.
- Use `logging.getLogger(__name__)` for module loggers.

### Async and Runtime

- Prefer `async def` for runtime, orchestration, and I/O-heavy paths.
- Use `await` for LLM calls, database work, Slack/API calls, and other external I/O.
- Enforce timeout behavior explicitly for tool execution and model calls.

### State and Architecture

- Durable state belongs in the database-backed system of record, not in long-lived in-memory graph state.
- LangGraph runtime state should stay narrow and ephemeral.
- Task claims, approvals, and task status transitions must follow the documented state machines.
- New autonomous behaviors must leave an auditable trail.

## Testing Expectations

- Add or update tests for behavior changes that affect schemas, lifecycle transitions, approvals, routing, or tool execution.
- Keep tests deterministic where possible.
- Prefer focused unit tests for policy and state-machine behavior before broader integration coverage.
- When greenfield phase docs exist, align validation with those docs.

## Documentation Expectations

- When architecture-relevant behavior changes, update `docs/System Architecture Specification.md` and/or `docs/System Technical Appendix.md` if the change affects documented contracts.
- When workflow or milestone state changes, update `docs/STATUS.md`, `docs/CURRENT_PHASE.md`, and the relevant phase doc. Update `docs/PHASE_INDEX.md` when phase sequencing, verification gates, or phase scope changes.
- When cross-cutting derived guidance changes, update the relevant file under `docs/reference/` in the same change.
- When file-class rules or reusable local-agent workflows change, update the relevant file under `.github/instructions/`, `.github/prompts/`, or `.github/skills/` in the same change.
- Keep instruction files lean; avoid duplicating large architecture sections here.

## Default Architectural Anchors

- Durable tasks are the core continuity unit.
- Context is assembled per run from durable sources.
- Approvals are durable and resumable.
- Claims and leases are the concurrency authority for active task execution.
- Subagents are bounded delegated workers, not a second hidden runtime.
- Tool creation is a first-class capability but remains governed.