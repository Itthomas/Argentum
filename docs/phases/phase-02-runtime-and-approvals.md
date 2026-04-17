# Phase 2: Runtime And Approvals

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 7, 12 through 15, 22 through 25, 27 through 29; Appendix sections 8, 12 through 13, 16, 19 through 23, 25 through 26
> Required reading: `docs/reference/conventions.md`, `docs/reference/context-and-routing.md`, `docs/reference/governance-and-approvals.md`
> Intended use: implementation packet for bounded context assembly, model routing, runtime working state, and approval pause/resume

## Objective

Build the bounded reasoning loop around the durable task layer: context assembly, operation-aware model routing, lean LangGraph execution, controlled commits, and approval pause/resume.

## Canonical Requirements Summary

- every reasoning turn should begin from a curated bounded context packet assembled from durable sources
- prompt construction must be budget-aware and recover gracefully from overflow
- runtime working state must remain intentionally small and non-canonical
- runtime model access must flow through the orchestration layer rather than direct provider calls
- governed actions must support durable, resumable approvals rather than prompt-only safety
- bootstrap identity handling for `SOUL.md` must be bounded by explicit runtime access and integrity expectations rather than left as a philosophical invariant

## Required Reading

1. `docs/reference/conventions.md`
2. `docs/reference/context-and-routing.md`
3. `docs/reference/governance-and-approvals.md`

## Scope

- context packet assembly and trimming rules
- model routing policy and provider abstractions
- LangGraph runtime working-state boundaries
- approval creation, delivery hooks, and resumable decision handling
- run-level commit output definitions

## Included Subsystems

- Context Assembly Layer
- LLM Orchestration Layer
- Task Runtime Layer
- Approval and Governance Layer

## Out Of Scope

- core durable object and claim foundations from Phase 1
- long-term memory ranking implementation details beyond retrieval inputs
- heartbeat and stale-state reaper behavior
- subagent lifecycle implementation
- generated tool activation workflow

## Durable Schemas Touched

### ApprovalRecord

Phase 2 needs a durable approval object that carries:

- linkage: `approval_id`, `task_id`, `run_id`
- request semantics: `approval_type`, `risk_level`, `requested_action`, `rationale`, `constrained_options`, `request_payload`
- state and delivery: `status`, `requested_via_session_id`, `requested_via_message_ref`
- reminder and resolution handling: `reminder_count`, `next_reminder_at`, `expires_at`, `resolved_at`, `resolved_by_user_id`, `decision`, `operator_comment`
- timestamps: `created_at`, `updated_at`

### ModelRoutingPolicy

Phase 2 needs a versioned routing object containing:

- provider mappings
- operation mappings
- timeout profiles
- fallback profiles
- budget profiles

### ProviderHealthRecord

Phase 2 needs the provider-health shape sufficient to avoid routing into persistently degraded providers.

## Runtime Working State Extract

Phase 2 should implement the narrow `RunWorkingState` idea, including:

- `run_id`, `event_id`, `task_id`, `claim_id`
- `current_status`, `objective`, `success_criteria`
- `context_packet`, `active_plan`, `current_step`
- `recent_observations`, `recent_tool_results`, `pending_questions`
- `approval_request`, `approval_result`, `reflection_result`, `continuation_decision`
- `last_error`, `artifacts_created`

This state is ephemeral and must not become the durable system of record.

## Context Packet Extract

Phase 2 should implement the bounded context model around:

- bootstrap context, including `SOUL.md`
- runtime facts
- task snapshot
- memory and open-task digests where applicable
- recent session or artifact digests when applicable
- approval constraints
- explicit token budget

## Bootstrap Identity Extract

Phase 2 should explicitly own the runtime-facing behavior for the bootstrap identity surface, including:

- how the active `SOUL.md` version is located or selected
- how runtime read access differs from operator edit authority
- how integrity or provenance checks are surfaced to context assembly and runtime logic
- what the runtime should do if the bootstrap identity surface fails integrity expectations

## Routing Policy Extract

Phase 2 should implement or encode:

- model tiers: `utility`, `standard`, `deep_reasoning`, `critical`
- operation types such as ingress normalization, context compression, runtime turns, approval reasoning, and tool authoring
- structured output requirements for schema-sensitive operations
- timeout and fallback behavior by operation class

Recommended defaults to preserve:

- standard runtime turns default to `standard`
- deep planning and approval reasoning prefer `deep_reasoning`
- tool authoring and tool verification prefer `critical`

## Approval Lifecycle Extract

Phase 2 must preserve the durable approval lifecycle:

- `pending` can move through `reminded`, `approved`, `denied`, `expired`, or `cancelled`
- reminder count must be durable and monotonic
- decision application must be idempotent by `approval_id`
- unanswered approvals must not suspend tasks forever without policy follow-up

The retained approval decision model is `approve`, `deny`, or `cancel`. If an operator wants to change the requested action, that should occur through a follow-up instruction or a new approval request rather than a separate `modify` decision enum.

## Approval Trust Extract

Phase 2 should explicitly define:

- how approval responders are authenticated
- how eligible approvers are authorized per governed action class
- how authenticated operator identity is bound to the durable approval resolution
- how replay handling differs from ordinary deduplication for approval responses

## Runtime Constraints To Preserve

- runtime turns must not bypass authoritative task claim requirements
- model access must flow through the routing layer
- large transcripts or full durable stores must not be loaded into runtime state by default
- competing runtimes for the same task remain invalid

## Implementation Tasks

- define `ContextPacket` and `ContextBudget` assembly behavior
- establish operation-to-tier routing policy objects and defaults
- implement lean runtime-state boundaries around LangGraph
- define approval request, reminder, and resumption flow boundaries
- specify run commit surfaces for task summary, artifacts, and approvals

## Failure Modes And Edge Cases

- prompt overflow must reassemble or retry rather than fail unstructured when safe recovery exists
- malformed model output must be handled through structured validation and fallback policy
- approval decisions must not be applied twice
- runtime must refuse meaningful execution without an authoritative task claim
- runtime should surface bootstrap identity integrity failure as a governed operational problem rather than silently degrading

## Verification Tasks

- test context-budget trimming order
- test operation routing defaults and escalation paths
- test approval lifecycle and idempotent decision application
- test runtime refusal to execute without an authoritative task claim

## Exit Criteria

- runtime turns depend on explicit context packets and routing policy
- governed actions can pause for approval and resume safely
- Phase 2 behavior is covered by deterministic tests where possible

## Risks And Open Questions

- LangGraph integration must not become a hidden source of durable truth
- routing policy should remain configuration-driven rather than hard-coded at call sites
