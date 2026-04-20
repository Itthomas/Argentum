# Current Phase

## Active Phase

Phase 2: Runtime And Approvals

## Goal

Build the bounded reasoning loop around the durable task layer: context assembly, operation-aware model routing, lean LangGraph execution, controlled commits, and approval pause/resume.

## Immediate Tasks

- Define `ContextPacket` and `ContextBudget` assembly behavior.
- Establish operation-to-tier routing policy objects and defaults.
- Implement lean runtime working-state boundaries around LangGraph.
- Define approval request, reminder, and resumption flow boundaries.
- Specify run commit surfaces for task summary, artifacts, and approvals.

## Current Blockers

- No Phase 2 approval or routing schemas exist yet.
- No runtime orchestration layer exists above the Phase 1 durable spine.

## Definition Of Done

- Runtime turns depend on explicit context packets and routing policy.
- Governed actions can pause for approval and resume safely.
- Phase 2 behavior is covered by deterministic tests where practical.