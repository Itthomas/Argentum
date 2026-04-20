# Current Phase

## Active Phase

Phase 3: Memory, Scheduling, And Subagents

## Goal

Extend the core system with durable memory retrieval, scheduled and heartbeat-driven continuation, stale-state recovery, and bounded delegated work.

## Immediate Tasks

- Define typed memory persistence and retrieval contracts.
- Establish heartbeat-triggered and follow-up-triggered run entry points using fresh runtime state.
- Design recovery logic for stale approvals, stale claims, and lost child tasks.
- Implement bounded subagent contracts and parent-child result handling.
- Define artifact provenance requirements in code-facing terms.

## Current Blockers

- No Phase 3 memory, artifact, or subagent schemas exist yet.
- No heartbeat or recovery orchestration layer exists above the Phase 2 runtime.

## Definition Of Done

- Memory, scheduling, and delegated work operate through durable policy-driven flows.
- No waiting task or child task can remain indefinitely without a defined policy outcome.
- Phase 3 behavior is covered by deterministic tests where practical.