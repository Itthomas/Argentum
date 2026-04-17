# Durable Data Model

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 8 through 11, 16 through 17, 20, 25 through 27; Appendix sections 2 through 12, 26 through 27
> Intended use: working reference for durable objects, invariants, and persistence-facing implementation
> Update rule: if durable schemas, invariants, or storage-facing constraints change, update this doc in the same change

## Purpose

This document groups the canonical durable objects and key invariants in one working reference. It is derived and non-normative.

## Schema Conventions

- primary identifiers should be globally unique opaque IDs
- timestamps should be stored in UTC
- status fields should use enums rather than freeform text
- external references should be stored explicitly rather than embedded in narrative blobs
- mutable objects should include `created_at` and `updated_at`
- operator-visible summaries should remain distinct from raw machine state
- schemas should support additive evolution without changing the semantic meaning of existing fields

## Primary Durable Objects

1. `EventRecord`
2. `SessionRecord`
3. `TaskRecord`
4. `TaskClaimRecord`
5. `ApprovalRecord`
6. `MemoryRecord`
7. `ArtifactRecord`
8. `GeneratedToolRecord`
9. `SubagentRecord`
10. `ModelRoutingPolicy`
11. `ProviderHealthRecord`

## EventRecord

Purpose: entry point record for all external and internal work.

Core fields:

- identity and source: `event_id`, `event_type`, `trigger_mode`, `source_surface`, `source_channel_id`, `source_thread_ref`, `source_user_id`, `source_message_ref`
- trust and replay: `authenticated_principal_ref`, `auth_status`, `idempotency_key`, `replay_window_key`, `replay_window_expires_at`
- payload and routing: `payload_text`, `payload_structured`, `attachment_refs`, `explicit_task_refs`, `inferred_task_candidates`, `approval_response_data`, `heartbeat_data`, `cron_data`, `webhook_data`
- queue and processing: `queue_class`, `queue_priority`, `queue_owner`, `queued_at`, `next_attempt_at`, `delivery_attempt_count`, `processing_status`, `processing_error`, `dead_letter_reason`, `consumed_by_run_id`
- timestamps: `created_at`, `updated_at`

Key enums:

- `EventType`: `user_message`, `approval_response`, `heartbeat_tick`, `cron_trigger`, `webhook_trigger`, `system_followup`, `task_resume_request`, `child_completion`, `child_failure`
- `TriggerMode`: `interactive`, `scheduled`, `autonomous`, `approval_resume`, `recovery`
- `EventProcessingStatus`: `received`, `rejected_unauthenticated`, `rejected_unauthorized`, `deduplicated`, `queued`, `consumed`, `ignored`, `failed`, `dead_lettered`
- `EventAuthStatus`: `not_applicable`, `pending`, `authenticated`, `rejected_unauthenticated`, `rejected_unauthorized`
- `QueueClass`: `interactive`, `approval`, `scheduled`, `recovery`, `maintenance`

Key rules:

- `idempotency_key` should be unique within the dedupe horizon when present
- replay-window handling remains separate from ordinary deduplication
- duplicate consumed events must not create a second active run
- unauthenticated or unauthorized external events should terminate before normal queued execution

## SessionRecord

Purpose: communication continuity and transcript linkage, not canonical task continuity.

Core fields:

- `session_id`, `session_key`, `channel_type`, `channel_id`
- `peer_id`, `user_id`, `active_thread_ref`, `transcript_ref`
- `current_task_id`, `recent_task_ids`
- `approval_capabilities`, `delivery_capabilities`, `runtime_flags`
- `latest_activity_at`, `created_at`, `updated_at`

Key enum:

- `ChannelType`: `slack_dm`, `slack_channel`, `webhook`, `internal`, `scheduled`

## TaskRecord

Purpose: canonical durable unit of work.

Core fields:

- identity and objective: `task_id`, `title`, `objective`, `normalized_objective`, `task_type`
- lifecycle and priority: `status`, `priority`, `confidence_score`
- origin and continuity: `created_by_event_id`, `origin_session_ids`, `origin_thread_refs`
- execution linkage: `assigned_runtime_lane`, `active_run_id`
- hierarchy: `parent_task_id`, `child_task_ids`
- durable state: `latest_summary`, `latest_summary_at`, `success_criteria`, `continuation_hint`, `blocked_reason`, `pending_approval_id`
- references: `artifact_refs`, `related_memory_refs`
- operator and scheduling fields: `last_operator_confirmation_at`, `next_followup_at`, `stale_after_at`
- terminal timestamps: `abandoned_at`, `completed_at`, `failed_at`
- metadata and timestamps: `metadata_json`, `created_at`, `updated_at`

Key enums:

- `TaskType`: `conversation_task`, `research_task`, `execution_task`, `maintenance_task`, `followup_task`, `child_task`, `tool_authoring_task`, `approval_task`
- `TaskStatus`: `proposed`, `active`, `waiting_human`, `blocked`, `scheduled`, `completed`, `failed`, `abandoned`, `stalled`, `blocked_timeout`, `failed_timeout`, `expired`, `needs_operator_attention`

Task invariants:

- only one non-expired active claim may exist per task
- `pending_approval_id` may be non-null only for approval-waiting or explicitly approval-blocked states
- a task with `status=completed` or `status=failed` must not retain an active claim
- a task with `status=abandoned` or `status=expired` may be reopened only by explicit state-transition logic

## TaskClaimRecord

Purpose: durable ownership and lease semantics for task execution.

Core fields:

- `claim_id`, `task_id`, `run_id`, `claimed_by`, `claim_state`
- `claimed_at`, `last_lease_renewal_at`, `lease_expires_at`
- `released_at`, `release_reason`, `superseded_by_claim_id`
- `created_at`, `updated_at`

Key enums:

- `ClaimState`: `active`, `released`, `expired`, `superseded`, `invalidated`
- `ClaimReleaseReason`: `completed`, `failed`, `abandoned`, `lease_expired`, `runtime_shutdown`, `recovery_reclaimed`, `operator_cancelled`

Claim rules:

- claims are acquired through an atomic transaction against the task row
- a claim is authoritative only while active and not expired
- the active runtime must renew the lease periodically
- expired claims become reclaimable by maintenance or new runtime claim logic

## ApprovalRecord

Purpose: durable, resumable governance object.

Core fields include:

- identity and linkage: `approval_id`, `task_id`, `run_id`
- type and risk: `approval_type`, `risk_level`
- payload and rationale: `requested_action`, `rationale`, `constrained_options`, `request_payload`, `eligible_resolver_refs`
- state: `status`, `decision`, `operator_comment`
- delivery and reminder handling: `requested_via_session_id`, `requested_via_message_ref`, `reminder_count`, `next_reminder_at`, `expires_at`
- resolution: `resolved_at`, `resolved_by_user_id`, `resolved_by_session_id`, `resolution_payload_hash`
- timestamps: `created_at`, `updated_at`

Key enums:

- `ApprovalType`: `tool_activation`, `destructive_action`, `privileged_execution`, `external_side_effect`, `policy_exception`
- `RiskLevel`: `low`, `medium`, `high`, `critical`
- `ApprovalStatus`: `pending`, `reminded`, `approved`, `denied`, `expired`, `cancelled`
- `ApprovalDecision`: `approve`, `deny`, `cancel`

Approval resolution guidance:

- approval responders should be authorized against the eligible resolver set or equivalent policy surface
- repeated equivalent approval responses should remain idempotent through payload hashing or equivalent durable comparison
- operator-requested changes to the requested action should occur through a new instruction or approval request rather than a `modify` decision enum

## MemoryRecord

Purpose: typed long-term memory.

Key fields:

- `memory_id`, `memory_type`, `content`, `summary`, `embedding_ref`
- `source_kind`, `source_ref`
- `confidence`, `recency_weight`, `tags`, `metadata_json`
- `created_at`, `updated_at`

Key enums:

- `MemoryType`: `user_profile`, `operator_preference`, `project_knowledge`, `environment_fact`, `task_outcome`, `procedural_pattern`, `followup_commitment`
- `MemorySourceKind`: `task`, `session`, `operator`, `tool_output`, `system`, `imported`

## ArtifactRecord

Purpose: durable outputs produced or referenced by the system.

Key fields:

- `artifact_id`, `artifact_type`, `task_id`, `run_id`, `storage_ref`
- `description`, `content_hash`, `visibility`, `retention_class`, `expires_at`, `archived_at`, `purge_after_at`, `metadata_json`
- `created_at`, `updated_at`

Key enums:

- `ArtifactType`: `report`, `file`, `test_result`, `generated_tool_bundle`, `external_link`, `message_snapshot`, `structured_output`
- `ArtifactVisibility`: `internal`, `operator_visible`, `shareable`
- `RetentionClass`: `ephemeral`, `operational`, `operator_record`, `compliance`, `generated_tool`

## GeneratedToolRecord

Purpose: durable lifecycle record for generated tools so staged activation, rollback, disablement, and supersession are enforceable and auditable.

Key fields:

- `tool_id`, `tool_name`, `version`
- `source_task_id`, `source_artifact_ref`, `requested_approval_id`
- `lifecycle_state`, `activation_scope`, `capability_summary`, `schema_ref`
- `supersedes_tool_id`, `superseded_by_tool_id`, `rollback_of_tool_id`
- `quarantine_until`, `activated_at`, `disabled_at`, `disabled_reason`
- `metadata_json`, `created_at`, `updated_at`

Key enums:

- `GeneratedToolLifecycleState`: `proposed`, `validating`, `verified`, `approval_pending`, `approved`, `quarantined`, `limited`, `global`, `disabled`, `superseded`, `archived`
- `ToolActivationScope`: `none`, `quarantine`, `shadow`, `limited`, `global`

## SubagentRecord

Purpose: durable parent-child delegation tracking.

Key fields:

- `subagent_id`, `parent_task_id`, `child_task_id`, `role`, `status`
- `model_policy_ref`, `delegated_objective`, `expected_output_contract`
- `started_at`, `heartbeat_at`, `completed_at`, `failed_at`, `timeout_at`
- `result_artifact_refs`, `error_summary`, `metadata_json`
- `created_at`, `updated_at`

Key enums:

- `SubagentRole`: `analysis`, `research`, `execution`, `validation`, `tool_authoring`
- `SubagentStatus`: `proposed`, `running`, `completed`, `failed`, `timed_out`, `lost`, `cancelled`

## Policy And Health Objects

`ModelRoutingPolicy` contains:

- provider mappings
- operation mappings
- timeout profiles
- fallback profiles
- budget profiles

`ProviderHealthRecord` contains:

- `provider_id`, `health_status`
- `last_success_at`, `last_timeout_at`, `last_rate_limit_at`
- `consecutive_failures`, `degraded_until`, `notes`, `updated_at`

## SQL-Oriented Constraints

- unique active claim per task
- unique event `idempotency_key` within the dedupe horizon
- foreign-key integrity between tasks and approvals, claims, artifacts, subagents, and generated tools where linked
- index support for `task.status`, `task.next_followup_at`, `claim.lease_expires_at`, `approval.expires_at`, event retry timing, generated-tool lifecycle lookup paths, and memory-vector lookup paths