# Phase 1: Core Spine

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 8 through 11, 25 through 29; Appendix sections 4 through 7, 14 through 18, 24 through 26
> Required reading: `docs/reference/conventions.md`, `docs/reference/durable-data-model.md`, `docs/reference/state-machines.md`
> Intended use: implementation packet for the durable foundation of ingress, tasks, claims, and lifecycle enforcement

## Implementation Status

Phase 1 is complete.

Implemented outcomes:

- durable enum and record definitions for events, sessions, tasks, and claims under `src/argentum/domain/`
- governed task and claim transition helpers plus active-claim exclusivity enforcement
- ingress intake policy evaluation for authentication rejection, queue assignment, retry, and dead-letter handling
- SQLAlchemy table mappings, session helpers, repository scaffolding, and Alembic migration baseline under `src/argentum/persistence/` and `alembic/`
- pytest coverage for schema invariants, ingress policy behavior, lifecycle rules, and persistence-backed claim acquisition

Verification completed:

- `pytest tests/unit -ra`
- Alembic migration smoke test against SQLite confirming table creation for `events`, `sessions`, `tasks`, and `task_claims`

## Objective

Establish the minimum durable foundation of the system: ingress normalization boundaries, session and task continuity, claim and lease semantics, and enforceable task-state rules.

## Canonical Requirements Summary

- event ingress is a normalization and routing boundary, not a deep-reasoning layer
- sessions provide communication continuity, not canonical task continuity
- tasks are the canonical durable unit of work
- only one active authoritative runtime execution may hold a task claim at a time
- task lifecycle must be governed through explicit legal transitions rather than freeform status changes
- critical durable state must survive restart
- ingress trust-boundary handling, queue ownership, retry behavior, and bounded concurrency are part of the durable execution spine rather than optional operational detail

## Required Reading

1. `docs/reference/conventions.md`
2. `docs/reference/durable-data-model.md`
3. `docs/reference/state-machines.md`

## Scope

- event ingress normalization contracts
- durable event, session, task, and claim modeling
- task resolution boundaries
- task lifecycle and claim-state enforcement
- foundational persistence constraints and indexing expectations

## Included Subsystems

- Event Ingress Layer
- Session Layer
- Task Ledger Layer
- core commit semantics needed for Phase 1 durability

## Out Of Scope

- context packet construction
- model-tier routing and provider failover logic
- approval delivery and pause/resume
- long-term memory retrieval
- scheduling, heartbeat, and subagents
- generated tool activation

## Durable Schemas Touched

### EventRecord

Phase 1 needs the event model fields for identity, source metadata, deduplication, routing input, and processing status. The minimum working implementation should preserve:

- identity and source: `event_id`, `event_type`, `trigger_mode`, `source_surface`, `source_channel_id`, `source_thread_ref`, `source_user_id`, `source_message_ref`
- authentication and replay: `authenticated_principal_ref`, `auth_status`, `idempotency_key`, `replay_window_key`, `replay_window_expires_at`
- payload and task linkage: `payload_text`, `payload_structured`, `explicit_task_refs`, `inferred_task_candidates`
- queue and processing: `queue_class`, `queue_priority`, `queue_owner`, `queued_at`, `next_attempt_at`, `delivery_attempt_count`, `processing_status`, `processing_error`, `dead_letter_reason`, `consumed_by_run_id`
- timestamps: `created_at`, `updated_at`

### SessionRecord

Phase 1 needs the session model fields that track communication continuity and recent task linkage:

- `session_id`, `session_key`, `channel_type`, `channel_id`
- `peer_id`, `user_id`, `active_thread_ref`, `transcript_ref`
- `current_task_id`, `recent_task_ids`
- `approval_capabilities`, `delivery_capabilities`, `runtime_flags`
- `latest_activity_at`, `created_at`, `updated_at`

### TaskRecord

Phase 1 needs the task model as the canonical durable unit of work. The initial implementation should preserve:

- identity and objective: `task_id`, `title`, `objective`, `normalized_objective`, `task_type`
- lifecycle and priority: `status`, `priority`, `confidence_score`
- origin and continuity: `created_by_event_id`, `origin_session_ids`, `origin_thread_refs`
- execution linkage: `assigned_runtime_lane`, `active_run_id`
- hierarchy: `parent_task_id`, `child_task_ids`
- durable state: `latest_summary`, `latest_summary_at`, `success_criteria`, `continuation_hint`, `blocked_reason`, `pending_approval_id`
- references and scheduling: `artifact_refs`, `related_memory_refs`, `last_operator_confirmation_at`, `next_followup_at`, `stale_after_at`
- terminal timestamps and metadata: `abandoned_at`, `completed_at`, `failed_at`, `metadata_json`, `created_at`, `updated_at`

Task invariants carried into Phase 1:

- only one non-expired active claim may exist per task
- completed or failed tasks must not retain an active claim
- abandoned or expired tasks may reopen only through explicit transition logic

### TaskClaimRecord

Phase 1 needs claim durability and lease semantics:

- `claim_id`, `task_id`, `run_id`, `claimed_by`, `claim_state`
- `claimed_at`, `last_lease_renewal_at`, `lease_expires_at`
- `released_at`, `release_reason`, `superseded_by_claim_id`
- `created_at`, `updated_at`

## State Machines Touched

### Task State Machine

Phase 1 must enforce the legal transitions rather than storing arbitrary status labels.

### Claim State Machine

Phase 1 must support active, released, expired, superseded, and invalidated claims with explicit rules around recovery and exclusivity.

### Event Consumption State Machine

Phase 1 must track event consumption outcomes so duplicates and partially handled events do not create competing execution paths.

## Task Resolution Boundaries

Incoming events should support:

- exact task match when explicit references are present
- high-confidence auto-attachment where appropriate
- ambiguous candidate handling that asks for confirmation when needed
- new task creation when no durable match is appropriate

Task resolution is a routing and continuity operation. It should not mutate broad task state beyond association and new task creation.

## Event Intake Contract Extract

Phase 1 must carry the architectural event-intake contract into implementation planning. At minimum, it should define:

- which event classes may execute inline versus enter queued handling
- how queue ownership is established and released
- retry and backoff expectations
- dead-letter conditions
- priority handling between interactive, approval, scheduled, recovery, and maintenance work
- fairness and starvation expectations on constrained hardware

## Ingress Trust-Boundary Extract

Phase 1 should own the ingress-side trust boundary up to the point where a valid event is admitted into normal execution handling. That includes:

- authentication of external event sources
- early rejection of unauthenticated or unauthorized requests
- replay-window handling separate from ordinary deduplication
- least-privilege treatment of ingress-facing secrets and credentials

## Persistence Constraints To Carry Forward

- unique active claim per task
- unique event `idempotency_key` within the dedupe horizon where practical
- foreign-key integrity between tasks and related approvals, claims, artifacts, and subagents
- index support for `task.status`, `task.next_followup_at`, and `claim.lease_expires_at`

## Implementation Tasks

- define code-level representations for the Phase 1 durable records
- establish enum definitions for statuses, trigger modes, and task types
- design the claim-acquisition path with atomic task-row coordination
- define legal task-transition helpers instead of freeform status mutation
- decide the migration and persistence approach consistent with PostgreSQL
- identify the minimal observability needed for claim and event handling

## Failure Modes And Edge Cases

- duplicate ingress events must not create a second active run
- unauthenticated or unauthorized external events must not enter normal queued execution
- stale claims must be distinguishable from active healthy claims
- task status changes must not bypass claim requirements
- runtime recovery must not rely on in-memory assumptions about prior ownership

## Additional Verification Tasks

- test unauthenticated and unauthorized event rejection paths
- test queue ownership and retry timing behavior at the policy level
- test priority and bounded-concurrency behavior where the chosen design exposes those controls

## Verification Tasks

- test legal and illegal task transitions
- test single-active-claim enforcement
- test stale-claim recovery preconditions
- test idempotent event handling behavior at the model or service boundary
- test terminal-state claim release expectations

## Exit Criteria

- Phase 1 durable records are represented in code
- state transitions are governed, not ad hoc
- claims have an implementation path that preserves exclusive ownership
- verification targets are automated with pytest where practical

## Risks And Open Questions

- ORM and migration decisions could introduce churn if chosen before the Phase 1 object boundaries are clear
- the line between pure schema validation and runtime service logic should stay explicit to avoid bloated models
