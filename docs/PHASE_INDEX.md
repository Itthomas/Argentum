# Phase Index

## Overview

This index maps the implementation phases derived from the canonical architecture and technical appendix. The phases follow dependency order so that durable state, orchestration policy, and verification gates are established before higher-autonomy features are introduced.

Each phase is supported by derived cross-cutting working references under `docs/reference/`. Those references are non-normative and must remain aligned with the canonical architecture and appendix.

## Phase 0: Environment Bootstrap

- Objective: establish the initial Raspberry Pi deployment boundary, including the remote workspace directory, restricted runtime user, and filesystem ownership model.
- Depends on: workspace scaffold only.
- Major deliverables: Pi workspace path creation, restricted agent runtime user, writable agent-owned subtree, and documented bootstrap validation steps.
- Verification gate: remote access verified through `admin`, runtime user created with limited write scope, and deployment workspace boundaries confirmed.
- Status: active

## Phase 1: Core Spine

- Objective: establish ingress trust handling, queue semantics, durable task continuity, core schemas, claims, and state-machine enforcement.
- Depends on: Phase 0.
- Major deliverables: event/session/task/claim foundations, ingress authentication and authorization handling, queue ownership and retry semantics, persistence model direction, core invariants, claim protocol, and basic verification strategy.
- Verification gate: durable schema coverage, event trust and retry tests, state-transition tests, and claim exclusivity tests.
- Status: planned

## Phase 2: Runtime And Approvals

- Objective: implement context assembly, model-routing policy, lean runtime flow, controlled commits, bootstrap identity handling, and approval pause/resume.
- Depends on: Phase 1.
- Major deliverables: bounded context packet assembly, operation-tier routing, LangGraph runtime loop, approval records, approval resolver validation, bootstrap identity handling, and resume handling.
- Verification gate: runtime flow tests, approval lifecycle tests, approval authorization tests, and prompt-budget policy coverage.
- Status: planned

## Phase 3: Memory, Scheduling, And Subagents

- Objective: add long-term memory retrieval, heartbeat/scheduling, stale-state recovery, and bounded subagent delegation.
- Depends on: Phase 2.
- Major deliverables: memory layer, reaper behavior, scheduling flows, child-task lifecycle handling, and parent-child policy enforcement.
- Verification gate: stale-state recovery tests, heartbeat maintenance tests, and subagent lifecycle tests.
- Status: planned

## Phase 4: Self-Extension And Hardening

- Objective: implement governed tool generation, staged activation, rollback and disablement handling, provider health handling, and deeper observability.
- Depends on: Phase 3.
- Major deliverables: tool-authoring pipeline, policy validation, generated-tool lifecycle tracking, staged activation controls, provider fallback visibility, hardening, and operational reporting.
- Verification gate: tool pipeline verification, lifecycle and rollback tests, provider fallback behavior tests, and recovery/observability checks.
- Status: planned