# Conventions

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 1 through 6, 28 through 29; Appendix sections 1, 25 through 26; `.github/copilot-instructions.md`
> Intended use: frequent workspace guidance for coding agents and implementers
> Update rule: if the canonical architecture, appendix, or repository instructions change in a way that affects conventions, update this doc in the same change

## Purpose

This document is a derived working surface for common repository conventions. It is not normative. The canonical architecture and appendix remain the sole authoritative source for system behavior and architectural constraints.

## Core Position

The system is:

- task-centric rather than thread-centric
- context-assembled rather than state-bloated
- routed through explicit model policy rather than ad hoc provider calls
- tool-governed rather than implicitly executable
- memory-aware rather than transcript-bound
- autonomous but auditable
- extensible but approval-governed
- designed for Raspberry Pi deployment from the outset

## Primary Goals Summary

- support long-running autonomous operation with durable continuity
- assemble high-signal bounded context for each reasoning turn
- make durable tasks the core continuity unit
- preserve governed autonomy and auditability
- require explicit tool-based execution
- support first-class but approval-gated self-extension
- support bounded subagent delegation
- route LLM work by capability tier and consequence level

## Non-Goals Summary

- a GUI-first product
- local heavy model inference as a core requirement
- thread-bound chat memory as the main continuity model
- a heavy planner or monolithic supervisor graph on the default path
- storing the system's durable truth in long-lived graph state
- allowing self-generated tools to activate without approval

## Workspace Layout

- canonical normative docs live under `docs/`
- derived cross-cutting working docs live under `docs/reference/`
- derived implementation packet docs live under `docs/phases/`
- application code belongs under `src/argentum`
- tests use pytest and live under `tests/unit`, `tests/integration`, and `tests/fixtures`

## Documentation Contract

- `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md` are the sole normative source
- docs under `docs/reference/` are derived working references organized by concern
- docs under `docs/phases/` are derived implementation packets organized by phase
- derived docs may restate or quote canonical content but must not introduce contradictory behavior
- when canonical source behavior changes, update the relevant derived docs in the same change
- derived docs should stay explicitly labeled as non-normative working documents that cite the canonical sections they summarize

## Agent Reading Strategy

- read the active phase doc first
- then read only the 1 to 3 required reference docs listed in that phase doc
- consult the canonical docs only when detail is missing, unclear, or being changed

## Phase Workflow

- Phase 0 is environment bootstrap
- Phase 1 through Phase 4 are implementation phases
- keep `docs/STATUS.md`, `docs/PHASE_INDEX.md`, `docs/CURRENT_PHASE.md`, and the relevant phase doc aligned with actual progress
- after each completed and verified phase, push the repository state to `https://github.com/Itthomas/Argentum.git`

## Design Principles Summary

- separate continuity from prompt context
- rebuild context deliberately for each run
- keep the default path lean
- use LangGraph for orchestration, not total system state
- keep autonomy auditable
- prefer explicit governance over hidden guardrails
- treat model selection as policy, not call-site trivia

## Implementation Guidance Summary

- prefer deterministic logic before invoking LLMs when the task is straightforward
- durable state belongs in the database-backed system of record
- runtime working state should stay narrow and ephemeral
- policies, fallbacks, and routing should be versioned and auditable where practical
- validate structured outputs before they drive high-consequence behavior

## Derived Doc Maintenance

Each phase doc should explicitly state:

- that it is a derived working doc
- which canonical sections it is derived from
- which reference docs must be read alongside it
