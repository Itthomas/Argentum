# System Technical Appendix

> Status: First Draft
> Date: 2026-04-16
> Purpose: Provide concrete technical schemas, state machines, and policy structures that implement the architecture defined in `System Architecture Specification.md`.

## 1. Scope

This appendix is normative where it defines object boundaries, state-machine behavior, and routing-policy structure.

It is intended to make the architecture directly implementable by supplying:

- canonical durable object schemas
- runtime working-state schema
- claim and lease schema
- approval schema
- parent-child task linkage model
- event schema and idempotency model
- state-machine definitions for tasks, claims, approvals, and subagents
- model-routing policy schema and operation-tier mapping

This appendix does not mandate programming language, ORM choice, or exact storage-engine implementation details beyond the architectural requirements already established.

## 2. Data Model Overview

The system should be built around the following primary durable objects:

1. EventRecord
2. SessionRecord
3. TaskRecord
4. TaskClaimRecord
5. ApprovalRecord
6. MemoryRecord
7. ArtifactRecord
8. GeneratedToolRecord
9. SubagentRecord
10. ModelRoutingPolicy
11. ProviderHealthRecord

The runtime should additionally use one non-canonical but strongly structured ephemeral object:

12. RunWorkingState

## 3. Canonical Schema Conventions

The following field conventions should apply across durable objects.

- all primary identifiers should be globally unique opaque IDs
- all timestamps should be stored in UTC
- all status fields should be enums rather than freeform text
- all external references should be stored explicitly rather than embedded in narrative blobs
- all mutable objects should include `created_at` and `updated_at`
- all operator-visible summaries should remain distinct from raw machine state
- all schemas should allow additive evolution without changing semantic meaning of existing fields

## 4. EventRecord Schema

The event model is the entry point for all work.

```text
EventRecord
- event_id: str
- event_type: EventType
- trigger_mode: TriggerMode
- source_surface: SourceSurface
- source_channel_id: str | null
- source_thread_ref: str | null
- source_user_id: str | null
- source_message_ref: str | null
- authenticated_principal_ref: str | null
- auth_status: EventAuthStatus
- idempotency_key: str | null
- replay_window_key: str | null
- replay_window_expires_at: datetime | null
- payload_text: str | null
- payload_structured: dict | null
- attachment_refs: list[str]
- explicit_task_refs: list[str]
- inferred_task_candidates: list[TaskCandidate]
- approval_response_data: dict | null
- heartbeat_data: dict | null
- cron_data: dict | null
- webhook_data: dict | null
- queue_class: QueueClass | null
- queue_priority: int | null
- queue_owner: str | null
- queued_at: datetime | null
- next_attempt_at: datetime | null
- delivery_attempt_count: int
- processing_status: EventProcessingStatus
- processing_error: str | null
- dead_letter_reason: str | null
- consumed_by_run_id: str | null
- created_at: datetime
- updated_at: datetime
```

### 4.1 EventType

```text
EventType
- user_message
- approval_response
- heartbeat_tick
- cron_trigger
- webhook_trigger
- system_followup
- task_resume_request
- child_completion
- child_failure
```

### 4.2 TriggerMode

```text
TriggerMode
- interactive
- scheduled
- autonomous
- approval_resume
- recovery
```

### 4.3 EventProcessingStatus

```text
EventProcessingStatus
- received
- rejected_unauthenticated
- rejected_unauthorized
- deduplicated
- queued
- consumed
- ignored
- failed
- dead_lettered
```

### 4.4 EventAuthStatus

```text
EventAuthStatus
- not_applicable
- pending
- authenticated
- rejected_unauthenticated
- rejected_unauthorized
```

### 4.5 QueueClass

```text
QueueClass
- interactive
- approval
- scheduled
- recovery
- maintenance
```

### 4.6 Event idempotency and replay rules

- if `idempotency_key` is present, it must be unique within a configured deduplication horizon
- if a duplicate event is detected after successful consumption, the event must not create a second active run
- approval responses must be idempotent against `approval_id` and operator decision payload
- replay-window handling must remain distinct from ordinary event deduplication
- unauthenticated or unauthorized external events must not enter normal queued execution

## 5. SessionRecord Schema

Sessions represent communication continuity and transcript linkage.

```text
SessionRecord
- session_id: str
- session_key: str
- channel_type: ChannelType
- channel_id: str
- peer_id: str | null
- user_id: str | null
- active_thread_ref: str | null
- transcript_ref: str | null
- current_task_id: str | null
- recent_task_ids: list[str]
- approval_capabilities: SessionApprovalCapabilities
- delivery_capabilities: SessionDeliveryCapabilities
- runtime_flags: dict
- latest_activity_at: datetime
- created_at: datetime
- updated_at: datetime
```

### 5.1 ChannelType

```text
ChannelType
- slack_dm
- slack_channel
- webhook
- internal
- scheduled
```

## 6. TaskRecord Schema

Tasks are the canonical durable units of work.

```text
TaskRecord
- task_id: str
- title: str
- objective: str
- normalized_objective: str
- task_type: TaskType
- status: TaskStatus
- priority: int
- confidence_score: float | null
- created_by_event_id: str
- origin_session_ids: list[str]
- origin_thread_refs: list[str]
- assigned_runtime_lane: str | null
- active_run_id: str | null
- parent_task_id: str | null
- child_task_ids: list[str]
- latest_summary: str | null
- latest_summary_at: datetime | null
- success_criteria: list[str]
- continuation_hint: str | null
- blocked_reason: str | null
- pending_approval_id: str | null
- artifact_refs: list[str]
- related_memory_refs: list[str]
- last_operator_confirmation_at: datetime | null
- next_followup_at: datetime | null
- stale_after_at: datetime | null
- abandoned_at: datetime | null
- completed_at: datetime | null
- failed_at: datetime | null
- metadata_json: dict
- created_at: datetime
- updated_at: datetime
```

### 6.1 TaskType

```text
TaskType
- conversation_task
- research_task
- execution_task
- maintenance_task
- followup_task
- child_task
- tool_authoring_task
- approval_task
```

### 6.2 TaskStatus

```text
TaskStatus
- proposed
- active
- waiting_human
- blocked
- scheduled
- completed
- failed
- abandoned
- stalled
- blocked_timeout
- failed_timeout
- expired
- needs_operator_attention
```

### 6.3 Task invariants

- only one non-expired active claim may exist per task
- `pending_approval_id` may be non-null only for approval-waiting states or explicitly approval-blocked states
- a task with `status=completed` or `status=failed` must not retain an active claim
- a task with `status=abandoned` or `status=expired` may be reopened only by explicit state transition logic

## 7. TaskClaimRecord Schema

Claims provide durable execution ownership and lease semantics.

```text
TaskClaimRecord
- claim_id: str
- task_id: str
- run_id: str
- claimed_by: str
- claim_state: ClaimState
- claimed_at: datetime
- last_lease_renewal_at: datetime
- lease_expires_at: datetime
- released_at: datetime | null
- release_reason: ClaimReleaseReason | null
- superseded_by_claim_id: str | null
- created_at: datetime
- updated_at: datetime
```

### 7.1 ClaimState

```text
ClaimState
- active
- released
- expired
- superseded
- invalidated
```

### 7.2 ClaimReleaseReason

```text
ClaimReleaseReason
- completed
- failed
- abandoned
- lease_expired
- runtime_shutdown
- recovery_reclaimed
- operator_cancelled
```

### 7.3 Claim rules

- a claim is acquired only via an atomic transaction against the task row
- a claim is authoritative only while `claim_state=active` and `lease_expires_at > now`
- the active runtime must renew the lease periodically
- if lease renewal stops and expiry passes, the claim becomes reclaimable by maintenance or new runtime claim logic

## 8. ApprovalRecord Schema

Approvals are durable, resumable governance objects.

```text
ApprovalRecord
- approval_id: str
- task_id: str
- run_id: str
- approval_type: ApprovalType
- risk_level: RiskLevel
- requested_action: str
- rationale: str
- constrained_options: list[str]
- request_payload: dict
- eligible_resolver_refs: list[str]
- status: ApprovalStatus
- requested_via_session_id: str | null
- requested_via_message_ref: str | null
- reminder_count: int
- next_reminder_at: datetime | null
- expires_at: datetime | null
- resolved_at: datetime | null
- resolved_by_user_id: str | null
- resolved_by_session_id: str | null
- resolution_payload_hash: str | null
- decision: ApprovalDecision | null
- operator_comment: str | null
- created_at: datetime
- updated_at: datetime
```

### 8.1 ApprovalType

```text
ApprovalType
- tool_activation
- destructive_action
- privileged_execution
- external_side_effect
- policy_exception
```

### 8.2 RiskLevel

```text
RiskLevel
- low
- medium
- high
- critical
```

### 8.3 ApprovalStatus

```text
ApprovalStatus
- pending
- reminded
- approved
- denied
- expired
- cancelled
```

### 8.4 ApprovalDecision

```text
ApprovalDecision
- approve
- deny
- cancel
```

### 8.5 Approval resolution rules

- approval decisions must be authorized against the eligible resolver set or equivalent policy surface
- approval resolution must bind durable operator identity to the applied decision
- payload hashing or equivalent durable comparison should support idempotent handling of repeated equivalent approval responses
- if an operator wants to change the requested action rather than approve, deny, or cancel it, that must occur through a new follow-up instruction or a new approval request rather than through a separate `ApprovalDecision` enum value

## 9. MemoryRecord Schema

```text
MemoryRecord
- memory_id: str
- memory_type: MemoryType
- content: str
- summary: str | null
- embedding_ref: str | null
- source_kind: MemorySourceKind
- source_ref: str | null
- confidence: float | null
- recency_weight: float | null
- tags: list[str]
- metadata_json: dict
- created_at: datetime
- updated_at: datetime
```

### 9.1 MemoryType

```text
MemoryType
- user_profile
- operator_preference
- project_knowledge
- environment_fact
- task_outcome
- procedural_pattern
- followup_commitment
```

### 9.2 MemorySourceKind

```text
MemorySourceKind
- task
- session
- operator
- tool_output
- system
- imported
```

## 10. ArtifactRecord Schema

```text
ArtifactRecord
- artifact_id: str
- artifact_type: ArtifactType
- task_id: str
- run_id: str | null
- storage_ref: str
- description: str | null
- content_hash: str | null
- visibility: ArtifactVisibility
- retention_class: RetentionClass
- expires_at: datetime | null
- archived_at: datetime | null
- purge_after_at: datetime | null
- metadata_json: dict
- created_at: datetime
- updated_at: datetime
```

### 10.1 ArtifactType

```text
ArtifactType
- report
- file
- test_result
- generated_tool_bundle
- external_link
- message_snapshot
- structured_output
```

### 10.2 ArtifactVisibility

```text
ArtifactVisibility
- internal
- operator_visible
- shareable
```

### 10.3 RetentionClass

```text
RetentionClass
- ephemeral
- operational
- operator_record
- compliance
- generated_tool
```

## 11. GeneratedToolRecord Schema

Generated tools require their own durable lifecycle model so staged activation, rollback, disablement, and supersession are enforceable rather than purely narrative.

```text
GeneratedToolRecord
- tool_id: str
- tool_name: str
- version: str
- source_task_id: str
- source_artifact_ref: str
- requested_approval_id: str | null
- lifecycle_state: GeneratedToolLifecycleState
- activation_scope: ToolActivationScope
- capability_summary: str
- schema_ref: str | null
- supersedes_tool_id: str | null
- superseded_by_tool_id: str | null
- rollback_of_tool_id: str | null
- quarantine_until: datetime | null
- activated_at: datetime | null
- disabled_at: datetime | null
- disabled_reason: str | null
- metadata_json: dict
- created_at: datetime
- updated_at: datetime
```

### 11.1 GeneratedToolLifecycleState

```text
GeneratedToolLifecycleState
- proposed
- validating
- verified
- approval_pending
- approved
- quarantined
- limited
- global
- disabled
- superseded
- archived
```

### 11.2 ToolActivationScope

```text
ToolActivationScope
- none
- quarantine
- shadow
- limited
- global
```

### 11.3 Generated tool rules

- approval must not immediately imply global activation
- quarantined or limited activation should be representable durably
- scope widening, rollback, disablement, and supersession should leave an auditable durable trail
- regenerated tools should preserve lineage through supersession or rollback linkage rather than silently replacing prior capability

## 11A. ActivityRecord Schema

Observability and reporting require a durable activity history so routing decisions, autonomous actions, tool execution summaries, recovery actions, and generated-tool lifecycle changes remain queryable after the fact.

```text
ActivityRecord
- activity_id: str
- activity_kind: ActivityKind
- task_id: str | null
- run_id: str | null
- approval_id: str | null
- generated_tool_id: str | null
- provider_id: str | null
- model_name: str | null
- summary: str
- detail: str | null
- fallback_from_provider_id: str | null
- fallback_reason: str | null
- token_count: int | null
- metadata_json: dict
- created_at: datetime
- updated_at: datetime
```

### 11A.1 ActivityKind

```text
ActivityKind
- task_activity
- tool_execution
- autonomous_action
- provider_routing
- generated_tool_lifecycle
- recovery
```

### 11A.2 Activity rules

- provider-routing activity should preserve enough detail to explain fallback or degraded-provider selection
- generated-tool lifecycle activity should preserve tool identity and approval linkage when present
- task or autonomous activity summaries should remain distinct from operator-facing message summaries

## 12. SubagentRecord Schema

```text
SubagentRecord
- subagent_id: str
- parent_task_id: str
- child_task_id: str
- role: SubagentRole
- status: SubagentStatus
- model_policy_ref: str | null
- delegated_objective: str
- expected_output_contract: str
- started_at: datetime | null
- heartbeat_at: datetime | null
- completed_at: datetime | null
- failed_at: datetime | null
- timeout_at: datetime | null
- result_artifact_refs: list[str]
- error_summary: str | null
- metadata_json: dict
- created_at: datetime
- updated_at: datetime
```

### 12.1 SubagentRole

```text
SubagentRole
- analysis
- research
- execution
- validation
- tool_authoring
```

### 12.2 SubagentStatus

```text
SubagentStatus
- proposed
- running
- completed
- failed
- timed_out
- lost
- cancelled
```

## 13. RunWorkingState Schema

This is an ephemeral runtime object, not the canonical durable source of truth.

```text
RunWorkingState
- run_id: str
- event_id: str
- task_id: str
- claim_id: str
- current_status: RunStatus
- objective: str
- success_criteria: list[str]
- context_packet: ContextPacket
- active_plan: RunPlan | null
- current_step: str | null
- recent_observations: list[str]
- recent_tool_results: list[ToolResultSummary]
- pending_questions: list[str]
- approval_request: ApprovalRequestDraft | null
- approval_result: ApprovalDecisionPayload | null
- reflection_result: ReflectionResult | null
- continuation_decision: ContinuationDecision | null
- last_error: str | null
- artifacts_created: list[str]
```

### 13.1 RunStatus

```text
RunStatus
- initializing
- executing
- waiting_approval
- delegating
- committing
- completed
- failed
```

### 13.2 ContinuationDecision

```text
ContinuationDecision
- continue_now
- pause_waiting_human
- schedule_followup
- complete
- fail
- delegate
```

## 14. ContextPacket Schema

```text
ContextPacket
- context_packet_id: str
- event_id: str
- task_id: str | null
- generated_at: datetime
- runtime_facts: RuntimeFacts
- bootstrap_context: BootstrapContext
- task_snapshot: TaskSnapshot | null
- relevant_open_tasks_digest: list[TaskDigest]
- relevant_memory_digest: list[MemoryDigest]
- recent_session_digest: SessionDigest | null
- recent_artifact_digest: list[ArtifactDigest]
- approval_constraints: list[str]
- token_budget: ContextBudget
- assembly_notes: list[str]
```

### 14.1 ContextBudget

```text
ContextBudget
- run_class: RunClass
- target_input_tokens: int
- reserved_output_tokens: int
- reserved_tool_schema_tokens: int
- max_bootstrap_tokens: int
- max_task_snapshot_tokens: int
- max_memory_digest_tokens: int
- max_open_task_digest_tokens: int
- max_recent_session_tokens: int
- max_artifact_digest_tokens: int
```

### 14.2 RunClass

```text
RunClass
- ingress_triage
- standard_runtime
- deep_planning
- approval_reasoning
- tool_authoring
- heartbeat_maintenance
- subagent_execution
```

## 15. Task State Machine

The task state machine is authoritative for legal task lifecycle transitions.

### 15.1 Allowed transitions

```text
proposed -> active
proposed -> scheduled
proposed -> abandoned

active -> waiting_human
active -> blocked
active -> scheduled
active -> completed
active -> failed
active -> stalled
active -> abandoned
active -> needs_operator_attention

waiting_human -> active
waiting_human -> blocked_timeout
waiting_human -> abandoned
waiting_human -> needs_operator_attention

blocked -> active
blocked -> blocked_timeout
blocked -> abandoned
blocked -> failed
blocked -> needs_operator_attention

scheduled -> active
scheduled -> expired
scheduled -> abandoned

stalled -> active
stalled -> abandoned
stalled -> needs_operator_attention

blocked_timeout -> active
blocked_timeout -> abandoned
blocked_timeout -> failed_timeout

needs_operator_attention -> active
needs_operator_attention -> abandoned

completed -> (terminal)
failed -> (terminal)
failed_timeout -> (terminal)
expired -> (terminal unless explicitly reopened)
abandoned -> (terminal unless explicitly reopened)
```

### 15.2 Transition rules

- terminal states may be reopened only by an explicit recovery or operator action path
- entering `waiting_human` requires a linked `ApprovalRecord`
- entering `active` requires an active valid claim
- leaving `active` for any terminal or suspended state should release or finalize the active claim

## 16. Claim State Machine

```text
active -> released
active -> expired
active -> invalidated
active -> superseded

expired -> superseded
expired -> invalidated

released -> (terminal)
superseded -> (terminal)
invalidated -> (terminal)
```

### 16.1 Claim rules

- only one `active` claim may exist per task at any moment
- a new claim may supersede an expired claim, not an active healthy claim
- maintenance may invalidate claims proven inconsistent with task state

## 17. Approval State Machine

```text
pending -> reminded
pending -> approved
pending -> denied
pending -> expired
pending -> cancelled

reminded -> reminded
reminded -> approved
reminded -> denied
reminded -> expired
reminded -> cancelled

approved -> (terminal)
denied -> (terminal)
expired -> (terminal)
cancelled -> (terminal)
```

### 17.1 Approval rules

- reminder count must be durable and monotonic
- expiration must be evaluated against authoritative time source
- approval decisions must be idempotent by `approval_id`

## 18. Subagent State Machine

```text
proposed -> running
proposed -> cancelled

running -> completed
running -> failed
running -> timed_out
running -> lost
running -> cancelled

completed -> (terminal)
failed -> (terminal)
timed_out -> (terminal or retry path)
lost -> (terminal or recovery path)
cancelled -> (terminal)
```

### 18.1 Parent-child handling rules

- parent task must never wait indefinitely on child status alone
- child timeout or `lost` state must trigger parent update policy
- parent update policy must be explicit in runtime logic, not inferred ad hoc

## 19. Generated Tool State Machine

```text
proposed -> validating
proposed -> archived

validating -> verified
validating -> disabled

verified -> approval_pending
verified -> disabled

approval_pending -> approved
approval_pending -> disabled

approved -> quarantined
approved -> limited
approved -> disabled

quarantined -> limited
quarantined -> disabled

limited -> global
limited -> disabled
limited -> superseded

global -> disabled
global -> superseded

disabled -> archived
superseded -> archived

archived -> (terminal)
```

### 19.1 Generated tool rules

- widening activation scope should be explicit and auditable
- rollback should transition the affected tool to `disabled` or `superseded` rather than silently removing it from history
- approval and verification are prerequisites for any activation state beyond `approved`

## 20. Event Consumption State Machine

```text
received -> rejected_unauthenticated
received -> rejected_unauthorized
received -> deduplicated
received -> queued
received -> consumed
received -> ignored
received -> failed

queued -> consumed
queued -> failed
queued -> dead_lettered

failed -> queued
failed -> dead_lettered

deduplicated -> (terminal)
rejected_unauthenticated -> (terminal)
rejected_unauthorized -> (terminal)
ignored -> (terminal)
consumed -> (terminal)
dead_lettered -> (terminal)
```

### 20.1 Event consumption rules

- unauthenticated or unauthorized external events must terminate without entering normal queued execution
- queued events should carry enough durable metadata to support retry timing, ownership, and dead-letter behavior
- queue priority and queue class should be explicit enough to support bounded concurrency and fairness policies

## 21. ModelRoutingPolicy Schema

The model-routing policy is a durable or versioned configuration object controlling capability-aware model assignment.

```text
ModelRoutingPolicy
- policy_id: str
- version: str
- active: bool
- provider_mappings: list[ProviderMapping]
- operation_mappings: list[OperationRoutingRule]
- timeout_profiles: list[TimeoutProfile]
- fallback_profiles: list[FallbackProfile]
- budget_profiles: list[BudgetProfile]
- created_at: datetime
- updated_at: datetime
```

### 21.1 ProviderMapping

```text
ProviderMapping
- provider_id: str
- provider_name: str
- tiers_supported: list[ModelTier]
- default_models_by_tier: dict[ModelTier, str]
- max_context_by_model: dict[str, int]
- supports_streaming: bool
- supports_structured_output: bool
- supports_reasoning_mode: bool
```

### 21.2 ModelTier

```text
ModelTier
- utility
- standard
- deep_reasoning
- critical
```

### 21.3 OperationType

```text
OperationType
- ingress_normalization
- task_resolution_support
- context_compression
- standard_runtime_turn
- deep_planning
- approval_reasoning
- tool_authoring
- tool_verification
- heartbeat_maintenance
- subagent_analysis
- subagent_execution
- conflict_resolution
```

### 21.4 OperationRoutingRule

```text
OperationRoutingRule
- operation_type: OperationType
- default_tier: ModelTier
- escalation_tier: ModelTier | null
- allow_downgrade: bool
- require_structured_output: bool
- latency_sensitive: bool
- high_consequence: bool
- notes: str | null
```

### 21.5 TimeoutProfile

```text
TimeoutProfile
- name: str
- operation_types: list[OperationType]
- request_timeout_seconds: int
- stream_idle_timeout_seconds: int | null
- max_retries: int
```

### 21.6 FallbackProfile

```text
FallbackProfile
- name: str
- operation_types: list[OperationType]
- on_timeout: FallbackAction
- on_rate_limit: FallbackAction
- on_malformed_output: FallbackAction
- on_overflow: FallbackAction
- on_provider_unavailable: FallbackAction
```

### 21.7 FallbackAction

```text
FallbackAction
- retry_same_provider
- retry_other_provider_same_tier
- downgrade_tier
- escalate_tier
- reassemble_context_and_retry
- fail_operator_visible
- queue_for_retry
```

### 21.8 BudgetProfile

```text
BudgetProfile
- name: str
- operation_types: list[OperationType]
- max_cost_class: CostClass
- max_input_tokens: int
- prefer_low_latency: bool
```

### 21.9 CostClass

```text
CostClass
- minimal
- normal
- elevated
- critical
```

## 22. ProviderHealthRecord Schema

```text
ProviderHealthRecord
- provider_id: str
- health_status: ProviderHealthStatus
- last_success_at: datetime | null
- last_timeout_at: datetime | null
- last_rate_limit_at: datetime | null
- consecutive_failures: int
- degraded_until: datetime | null
- notes: str | null
- updated_at: datetime
```

### 22.1 ProviderHealthStatus

```text
ProviderHealthStatus
- healthy
- degraded
- unavailable
```

## 23. Recommended Operation-to-Tier Defaults

```text
ingress_normalization -> utility
task_resolution_support -> utility
context_compression -> utility
standard_runtime_turn -> standard
deep_planning -> deep_reasoning
approval_reasoning -> deep_reasoning
tool_authoring -> critical
tool_verification -> critical
heartbeat_maintenance -> utility or standard depending on consequence
subagent_analysis -> standard or deep_reasoning depending on contract
subagent_execution -> standard
conflict_resolution -> critical
```

## 24. Context Assembly Priority Order

When the context packet exceeds budget, the assembler should trim or summarize in this order unless run-class policy overrides it.

1. optional artifact details
2. optional open-task digest entries
3. lower-ranked memory entries
4. recent session digest verbosity
5. task snapshot verbosity
6. bootstrap context only as a last resort and only if architecture policy explicitly permits trimming beyond mandatory identity surfaces

Approval constraints and core runtime facts should be considered non-negotiable context elements for relevant runs.

## 25. Recovery Policy Table

### 25.1 Stale task claim

- detect expired lease
- mark claim expired
- permit recovery claim
- write recovery activity record

### 25.2 Unanswered approval

- send reminder according to policy
- increment reminder count
- transition to `expired`, `abandoned`, `blocked_timeout`, or `needs_operator_attention` after final threshold

### 25.3 Lost child task

- mark child `lost` or `timed_out`
- write child failure summary
- transition parent according to configured parent-child policy

### 25.4 Prompt overflow

- reassemble context under stricter budget
- retry same or alternative provider according to fallback profile

### 25.5 Provider degradation

- update provider health state
- route subsequent eligible operations to alternative provider if available

## 26. Minimal SQL-Oriented Constraints

The implementation should enforce at least the following durable invariants at the data layer where practical.

- unique active claim per task
- unique event `idempotency_key` within dedupe horizon
- foreign-key integrity between tasks and approvals, claims, artifacts, and subagents
- foreign-key integrity between generated tools and the tasks, artifacts, and approvals that govern them
- index support for `task.status`, `task.next_followup_at`, `claim.lease_expires_at`, `approval.expires_at`, and memory-vector lookup paths
- index support for event retry timing and generated-tool lifecycle lookup paths where those objects are queried operationally

## 27. Recommended Implementation Notes

These are not full implementation mandates, but they are strong recommendations.

- use PostgreSQL transactions for task claim acquisition and state-transition updates
- use `SELECT ... FOR UPDATE` or equivalent transactional row locking when claiming tasks
- store lease expiry durably rather than relying only on in-memory locks
- represent policy objects in versioned configuration so routing behavior is auditable over time
- validate structured outputs before they are allowed to drive high-consequence behavior

## 28. Final Position

This appendix defines the minimum concrete structures needed to keep the system consistent under concurrency, asynchronous ingress, autonomous scheduling, approval pauses, model-provider variability, and subagent delegation.

Any implementation that weakens these schemas or state-machine boundaries should be treated as increasing architectural risk, even if it appears to simplify initial development.