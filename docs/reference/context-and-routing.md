# Context And Routing

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 7, 12 through 15; Appendix sections 12 through 13, 19 through 22
> Intended use: working reference for context assembly, model routing, runtime working state, and overflow/fallback behavior
> Update rule: if context assembly, runtime-state, or routing policy changes, update this doc in the same change

## Purpose

This document groups the system's bounded-context and model-routing behavior in one derived working reference.

## Bootstrap Context

- `SOUL.md` is mandatory bootstrap identity context
- it is part of the core prompt bootstrap surface, not ordinary memory and not editable task state
- bootstrap integrity should be checked against controlled deployment state rather than assumed from file presence alone
- runtime access to bootstrap identity material should remain tightly bounded and least-privilege

## Context Assembly Purpose

The context assembler builds the bounded context packet for each reasoning turn. It is the primary mechanism for situational awareness.

## Context Inputs

- normalized event
- resolved task, if any
- `SOUL.md`
- other bootstrap surfaces when defined
- relevant long-term memories
- relevant open-task summaries when applicable
- recent session or task summaries
- current runtime facts
- approval and execution constraints

## Context Output

The context packet should include:

- bootstrap identity context
- runtime facts
- task snapshot
- relevant memory digest
- relevant open-task digest when applicable
- recent continuity digest when applicable
- approval and execution constraints

## Context Constraints

The assembler must not inject:

- the full task ledger
- the full memory corpus
- raw full transcript history by default
- large raw tool outputs unless specifically required

## ContextPacket Working Reference

Key fields:

- `context_packet_id`, `event_id`, `task_id`, `generated_at`
- `runtime_facts`, `bootstrap_context`, `task_snapshot`
- `relevant_open_tasks_digest`, `relevant_memory_digest`, `recent_session_digest`, `recent_artifact_digest`
- `approval_constraints`, `token_budget`, `assembly_notes`

## ContextBudget Working Reference

Key fields:

- `run_class`
- `target_input_tokens`
- `reserved_output_tokens`
- `reserved_tool_schema_tokens`
- section budgets for bootstrap, task snapshot, memory digest, open-task digest, recent session digest, and artifact digest

Run classes:

- `ingress_triage`
- `standard_runtime`
- `deep_planning`
- `approval_reasoning`
- `tool_authoring`
- `heartbeat_maintenance`
- `subagent_execution`

## Budget Enforcement

Prompt construction is a bounded packing problem. The architecture requires:

- target prompt budgets by run class
- reserved output budget
- reserved tool-schema and scaffolding budget
- priority-based trimming or summarization
- bounded recovery when context exceeds provider limits

## Trimming Order

When context exceeds budget, trim or summarize in this order unless run-class policy overrides it:

1. optional artifact details
2. optional open-task digest entries
3. lower-ranked memory entries
4. recent session digest verbosity
5. task snapshot verbosity
6. bootstrap context only as a last resort and only when policy permits

Approval constraints and core runtime facts are non-negotiable for relevant runs.

## Overflow Recovery

On prompt overflow or token-limit rejection:

- reassemble with stricter budgets
- summarize lower-priority sections
- drop optional low-priority sections
- switch to a more appropriate model tier when policy allows

Overflow should not be treated as an unstructured fatal error when bounded recovery is possible.

## LLM Orchestration Responsibilities

- provider abstraction
- capability-aware model routing
- timeout and retry policy
- provider failover behavior
- rate-limit handling
- malformed-response handling
- integration with context budgeting and overflow recovery
- cost and latency governance

## Model Tiers

- `utility`
- `standard`
- `deep_reasoning`
- `critical`

## Operation Types

- `ingress_normalization`
- `task_resolution_support`
- `context_compression`
- `standard_runtime_turn`
- `deep_planning`
- `approval_reasoning`
- `tool_authoring`
- `tool_verification`
- `heartbeat_maintenance`
- `subagent_analysis`
- `subagent_execution`
- `conflict_resolution`

## Recommended Defaults

- `ingress_normalization` -> `utility`
- `task_resolution_support` -> `utility`
- `context_compression` -> `utility`
- `standard_runtime_turn` -> `standard`
- `deep_planning` -> `deep_reasoning`
- `approval_reasoning` -> `deep_reasoning`
- `tool_authoring` -> `critical`
- `tool_verification` -> `critical`
- `heartbeat_maintenance` -> `utility` or `standard` depending on consequence
- `subagent_analysis` -> `standard` or `deep_reasoning` depending on contract
- `subagent_execution` -> `standard`
- `conflict_resolution` -> `critical`

## Deterministic-First Rule

Prefer deterministic parsing and policy logic before invoking an LLM for straightforward tasks such as explicit task ID extraction, approval payload recognition, deduplication checks, or simple directive parsing.

## Fallback Behavior

Supported fallback actions include:

- retry same provider
- retry other provider in the same tier
- downgrade tier
- escalate tier
- reassemble context and retry
- fail operator-visible
- queue for retry

Fallback guidance:

- queue-for-retry behavior should align with durable event retry timing and ownership semantics rather than transient runtime choice alone
- high-consequence failures should prefer explicit durable requeue or operator-visible failure over silent repeated retries

## Provider Health

Provider health tracking should capture:

- health status: `healthy`, `degraded`, `unavailable`
- last success, timeout, and rate limit times
- consecutive failures
- degraded-until window
- notes for operator diagnosis

## RunWorkingState

The runtime working state is ephemeral, not canonical durable truth.

Key fields:

- `run_id`, `event_id`, `task_id`, `claim_id`
- `current_status`, `objective`, `success_criteria`
- `context_packet`, `active_plan`, `current_step`
- `recent_observations`, `recent_tool_results`, `pending_questions`
- `approval_request`, `approval_result`, `reflection_result`, `continuation_decision`
- `last_error`, `artifacts_created`

Runtime status values:

- `initializing`, `executing`, `waiting_approval`, `delegating`, `committing`, `completed`, `failed`

Continuation decisions:

- `continue_now`, `pause_waiting_human`, `schedule_followup`, `complete`, `fail`, `delegate`
