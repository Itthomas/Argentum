---
description: "Use when planning Argentum implementation phases, converting spec docs into backlog slices, sequencing work across packages, or deciding where autopilot and subagents should be used."
name: "Argentum Planning"
---
# Argentum Planning Guidance

Use this guidance when the task is planning rather than coding.

## Required Inputs

- Read the spine in [docs/spec/README.md](../../docs/spec/README.md).
- Read the owning leaf spec for the target slice.
- Read the matching acceptance criteria in the leaf or implementation docs.

## Planning Output Shape

Every slice should state:

- Target package or boundary
- Owning spec files
- Acceptance criteria
- Inputs and outputs across the boundary
- Required tests
- Focused validation step
- Explicit out-of-scope items
- Whether autopilot is suitable
- Whether parallel subagents are useful and safe

Persist planning artifacts in the repo:

- Record bootstrap prerequisites in [docs/implementation/bootstrap-decisions.md](../../docs/implementation/bootstrap-decisions.md)
- Record the active queue in [docs/implementation/backlog.md](../../docs/implementation/backlog.md)
- Write one slice card per planned slice under [docs/implementation/slices](../../docs/implementation/slices)

## Slice Rules

- Prefer contract-first slices before orchestration slices.
- Prefer one bounded implementation seam per slice.
- Separate read-only planning work from code-editing work.
- Use parallel subagents for independent planning, risk review, and test extraction, not for overlapping edits.
- In this repo, autopilot means using the `argentum-implementer` agent or `/implement-argentum-slice` prompt to execute a bounded slice end-to-end.
- Use autopilot only when the slice has a named owning module, acceptance criteria, and a narrow validation target.
- If bootstrap prerequisites are still unresolved, stop and update the bootstrap decision record instead of planning a coding slice.

## Sequencing Heuristic

1. Shared contracts and config validation
2. Environment and persistence seams needed for deterministic tests
3. Gateway session routing, queueing, and turn creation
4. Tool registry, grants, and execution driver
5. Agentic core state machine, memory, and compaction
6. LLM adapter normalization
7. CLI channel and end-to-end wiring

Do not widen scope to deferred decisions just to keep momentum.