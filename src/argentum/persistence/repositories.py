from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import re
from uuid import uuid4

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from argentum.domain.enums import (
    ActivityKind,
    ApprovalDecision,
    ApprovalStatus,
    ClaimReleaseReason,
    ClaimState,
    EventProcessingStatus,
    GeneratedToolLifecycleState,
    SubagentStatus,
    TaskStatus,
    ToolActivationScope,
)
from argentum.domain.ingress import EventIntakePolicy, apply_intake_decision, evaluate_event_intake
from argentum.domain.lifecycle import (
    ApprovalLifecycleError,
    ClaimLifecycleError,
    GeneratedToolLifecycleError,
    SubagentLifecycleError,
    transition_approval_status,
    transition_claim_state,
    transition_generated_tool_state,
    transition_subagent_status,
    transition_task_status,
)
from argentum.domain.models import (
    ActivityRecord,
    ApprovalDecisionPayload,
    ApprovalRecord,
    ArtifactRecord,
    EventRecord,
    GeneratedToolRecord,
    MemoryRecord,
    ModelRoutingPolicy,
    ProviderHealthRecord,
    SubagentRecord,
    TaskClaimRecord,
    TaskRecord,
)

from .tables import (
    ActivityTable,
    ApprovalTable,
    ArtifactTable,
    EventTable,
    GeneratedToolTable,
    MemoryTable,
    ModelRoutingPolicyTable,
    ProviderHealthTable,
    SubagentTable,
    TaskClaimTable,
    TaskTable,
)


@dataclass(slots=True, frozen=True)
class ClaimAcquisitionRequest:
    task_id: str
    claim_id: str
    run_id: str
    claimed_by: str
    claim_duration: timedelta
    claimed_at: datetime


@dataclass(slots=True, frozen=True)
class TerminalTaskTransitionRequest:
    task_id: str
    claim_id: str
    terminal_status: TaskStatus
    release_reason: ClaimReleaseReason
    transitioned_at: datetime


@dataclass(slots=True, frozen=True)
class TerminalTaskTransitionResult:
    task: TaskRecord
    claim: TaskClaimRecord


@dataclass(slots=True, frozen=True)
class EventPersistenceResult:
    event: EventRecord
    created: bool
    deduplicated: bool


@dataclass(slots=True, frozen=True)
class ApprovalTaskTransitionRequest:
    task_id: str
    claim_id: str
    approval_id: str
    transitioned_at: datetime


@dataclass(slots=True, frozen=True)
class FollowupTaskTransitionRequest:
    task_id: str
    claim_id: str
    next_followup_at: datetime
    transitioned_at: datetime
    continuation_hint: str | None = None
    stale_after_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class BlockedTaskTransitionRequest:
    task_id: str
    claim_id: str
    transitioned_at: datetime
    blocked_reason: str
    stale_after_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class MemorySearchRequest:
    query_text: str
    memory_types: list[str] | None = None
    source_kind: str | None = None
    source_ref: str | None = None
    limit: int = 10


@dataclass(slots=True, frozen=True)
class StaleTaskTransitionRequest:
    task_id: str
    target_status: TaskStatus
    transitioned_at: datetime
    blocked_reason: str | None = None
    continuation_hint: str | None = None
    next_followup_at: datetime | None = None
    stale_after_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class StaleClaimTransitionRequest:
    claim_id: str
    transitioned_at: datetime
    task_status: TaskStatus = TaskStatus.STALLED
    blocked_reason: str | None = None


def _task_table_to_record(task: TaskTable) -> TaskRecord:
    return TaskRecord.model_validate(
        {
            "task_id": task.task_id,
            "title": task.title,
            "objective": task.objective,
            "normalized_objective": task.normalized_objective,
            "task_type": task.task_type,
            "status": task.status,
            "priority": task.priority,
            "confidence_score": float(task.confidence_score) if task.confidence_score is not None else None,
            "created_by_event_id": task.created_by_event_id,
            "origin_session_ids": task.origin_session_ids,
            "origin_thread_refs": task.origin_thread_refs,
            "assigned_runtime_lane": task.assigned_runtime_lane,
            "active_run_id": task.active_run_id,
            "parent_task_id": task.parent_task_id,
            "child_task_ids": task.child_task_ids,
            "latest_summary": task.latest_summary,
            "latest_summary_at": task.latest_summary_at,
            "success_criteria": task.success_criteria,
            "continuation_hint": task.continuation_hint,
            "blocked_reason": task.blocked_reason,
            "pending_approval_id": task.pending_approval_id,
            "artifact_refs": task.artifact_refs,
            "related_memory_refs": task.related_memory_refs,
            "last_operator_confirmation_at": task.last_operator_confirmation_at,
            "next_followup_at": task.next_followup_at,
            "stale_after_at": task.stale_after_at,
            "abandoned_at": task.abandoned_at,
            "completed_at": task.completed_at,
            "failed_at": task.failed_at,
            "metadata_json": task.metadata_json,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
        }
    )


def _task_record_to_table(task: TaskRecord) -> TaskTable:
    return TaskTable(
        task_id=task.task_id,
        title=task.title,
        objective=task.objective,
        normalized_objective=task.normalized_objective,
        task_type=task.task_type,
        status=task.status,
        priority=task.priority,
        confidence_score=task.confidence_score,
        created_by_event_id=task.created_by_event_id,
        origin_session_ids=task.origin_session_ids,
        origin_thread_refs=task.origin_thread_refs,
        assigned_runtime_lane=task.assigned_runtime_lane,
        active_run_id=task.active_run_id,
        parent_task_id=task.parent_task_id,
        child_task_ids=task.child_task_ids,
        latest_summary=task.latest_summary,
        latest_summary_at=task.latest_summary_at,
        success_criteria=task.success_criteria,
        continuation_hint=task.continuation_hint,
        blocked_reason=task.blocked_reason,
        pending_approval_id=task.pending_approval_id,
        artifact_refs=task.artifact_refs,
        related_memory_refs=task.related_memory_refs,
        last_operator_confirmation_at=task.last_operator_confirmation_at,
        next_followup_at=task.next_followup_at,
        stale_after_at=task.stale_after_at,
        abandoned_at=task.abandoned_at,
        completed_at=task.completed_at,
        failed_at=task.failed_at,
        metadata_json=task.metadata_json,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _claim_table_to_record(claim: TaskClaimTable) -> TaskClaimRecord:
    return TaskClaimRecord.model_validate(
        {
            "claim_id": claim.claim_id,
            "task_id": claim.task_id,
            "run_id": claim.run_id,
            "claimed_by": claim.claimed_by,
            "claim_state": claim.claim_state,
            "claimed_at": claim.claimed_at,
            "last_lease_renewal_at": claim.last_lease_renewal_at,
            "lease_expires_at": claim.lease_expires_at,
            "released_at": claim.released_at,
            "release_reason": claim.release_reason,
            "superseded_by_claim_id": claim.superseded_by_claim_id,
            "created_at": claim.created_at,
            "updated_at": claim.updated_at,
        }
    )


def _event_table_to_record(event: EventTable) -> EventRecord:
    return EventRecord.model_validate(
        {
            "event_id": event.event_id,
            "event_type": event.event_type,
            "trigger_mode": event.trigger_mode,
            "source_surface": event.source_surface,
            "source_channel_id": event.source_channel_id,
            "source_thread_ref": event.source_thread_ref,
            "source_user_id": event.source_user_id,
            "source_message_ref": event.source_message_ref,
            "authenticated_principal_ref": event.authenticated_principal_ref,
            "auth_status": event.auth_status,
            "idempotency_key": event.idempotency_key,
            "replay_window_key": event.replay_window_key,
            "replay_window_expires_at": event.replay_window_expires_at,
            "payload_text": event.payload_text,
            "payload_structured": event.payload_structured,
            "attachment_refs": event.attachment_refs,
            "explicit_task_refs": event.explicit_task_refs,
            "inferred_task_candidates": event.inferred_task_candidates,
            "approval_response_data": event.approval_response_data,
            "heartbeat_data": event.heartbeat_data,
            "cron_data": event.cron_data,
            "webhook_data": event.webhook_data,
            "queue_class": event.queue_class,
            "queue_priority": event.queue_priority,
            "queue_owner": event.queue_owner,
            "queued_at": event.queued_at,
            "next_attempt_at": event.next_attempt_at,
            "delivery_attempt_count": event.delivery_attempt_count,
            "processing_status": event.processing_status,
            "processing_error": event.processing_error,
            "dead_letter_reason": event.dead_letter_reason,
            "consumed_by_run_id": event.consumed_by_run_id,
            "created_at": event.created_at,
            "updated_at": event.updated_at,
        }
    )


def _event_record_to_table(event: EventRecord) -> EventTable:
    return EventTable(
        event_id=event.event_id,
        event_type=event.event_type,
        trigger_mode=event.trigger_mode,
        source_surface=event.source_surface,
        source_channel_id=event.source_channel_id,
        source_thread_ref=event.source_thread_ref,
        source_user_id=event.source_user_id,
        source_message_ref=event.source_message_ref,
        authenticated_principal_ref=event.authenticated_principal_ref,
        auth_status=event.auth_status,
        idempotency_key=event.idempotency_key,
        replay_window_key=event.replay_window_key,
        replay_window_expires_at=event.replay_window_expires_at,
        payload_text=event.payload_text,
        payload_structured=event.payload_structured,
        attachment_refs=event.attachment_refs,
        explicit_task_refs=event.explicit_task_refs,
        inferred_task_candidates=[candidate.model_dump(mode="json") for candidate in event.inferred_task_candidates],
        approval_response_data=event.approval_response_data,
        heartbeat_data=event.heartbeat_data,
        cron_data=event.cron_data,
        webhook_data=event.webhook_data,
        queue_class=event.queue_class,
        queue_priority=event.queue_priority,
        queue_owner=event.queue_owner,
        queued_at=event.queued_at,
        next_attempt_at=event.next_attempt_at,
        delivery_attempt_count=event.delivery_attempt_count,
        processing_status=event.processing_status,
        processing_error=event.processing_error,
        dead_letter_reason=event.dead_letter_reason,
        consumed_by_run_id=event.consumed_by_run_id,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


def _approval_table_to_record(approval: ApprovalTable) -> ApprovalRecord:
    return ApprovalRecord.model_validate(
        {
            "approval_id": approval.approval_id,
            "task_id": approval.task_id,
            "run_id": approval.run_id,
            "approval_type": approval.approval_type,
            "risk_level": approval.risk_level,
            "requested_action": approval.requested_action,
            "rationale": approval.rationale,
            "constrained_options": approval.constrained_options,
            "request_payload": approval.request_payload,
            "eligible_resolver_refs": approval.eligible_resolver_refs,
            "status": approval.status,
            "requested_via_session_id": approval.requested_via_session_id,
            "requested_via_message_ref": approval.requested_via_message_ref,
            "reminder_count": approval.reminder_count,
            "next_reminder_at": approval.next_reminder_at,
            "expires_at": approval.expires_at,
            "resolved_at": approval.resolved_at,
            "resolved_by_user_id": approval.resolved_by_user_id,
            "resolved_by_session_id": approval.resolved_by_session_id,
            "resolution_payload_hash": approval.resolution_payload_hash,
            "decision": approval.decision,
            "operator_comment": approval.operator_comment,
            "created_at": approval.created_at,
            "updated_at": approval.updated_at,
        }
    )


def _approval_record_to_table(approval: ApprovalRecord) -> ApprovalTable:
    return ApprovalTable(
        approval_id=approval.approval_id,
        task_id=approval.task_id,
        run_id=approval.run_id,
        approval_type=approval.approval_type,
        risk_level=approval.risk_level,
        requested_action=approval.requested_action,
        rationale=approval.rationale,
        constrained_options=approval.constrained_options,
        request_payload=approval.request_payload,
        eligible_resolver_refs=approval.eligible_resolver_refs,
        status=approval.status,
        requested_via_session_id=approval.requested_via_session_id,
        requested_via_message_ref=approval.requested_via_message_ref,
        reminder_count=approval.reminder_count,
        next_reminder_at=approval.next_reminder_at,
        expires_at=approval.expires_at,
        resolved_at=approval.resolved_at,
        resolved_by_user_id=approval.resolved_by_user_id,
        resolved_by_session_id=approval.resolved_by_session_id,
        resolution_payload_hash=approval.resolution_payload_hash,
        decision=approval.decision,
        operator_comment=approval.operator_comment,
        created_at=approval.created_at,
        updated_at=approval.updated_at,
    )


def _policy_table_to_record(policy: ModelRoutingPolicyTable) -> ModelRoutingPolicy:
    return ModelRoutingPolicy.model_validate(
        {
            "policy_id": policy.policy_id,
            "version": policy.version,
            "active": policy.active,
            "provider_mappings": policy.provider_mappings,
            "operation_mappings": policy.operation_mappings,
            "timeout_profiles": policy.timeout_profiles,
            "fallback_profiles": policy.fallback_profiles,
            "budget_profiles": policy.budget_profiles,
            "created_at": policy.created_at,
            "updated_at": policy.updated_at,
        }
    )


def _policy_record_to_table(policy: ModelRoutingPolicy) -> ModelRoutingPolicyTable:
    return ModelRoutingPolicyTable(
        policy_id=policy.policy_id,
        version=policy.version,
        active=policy.active,
        provider_mappings=[mapping.model_dump(mode="json") for mapping in policy.provider_mappings],
        operation_mappings=[mapping.model_dump(mode="json") for mapping in policy.operation_mappings],
        timeout_profiles=[profile.model_dump(mode="json") for profile in policy.timeout_profiles],
        fallback_profiles=[profile.model_dump(mode="json") for profile in policy.fallback_profiles],
        budget_profiles=[profile.model_dump(mode="json") for profile in policy.budget_profiles],
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


def _provider_health_table_to_record(provider_health: ProviderHealthTable) -> ProviderHealthRecord:
    return ProviderHealthRecord.model_validate(
        {
            "provider_id": provider_health.provider_id,
            "health_status": provider_health.health_status,
            "last_success_at": provider_health.last_success_at,
            "last_timeout_at": provider_health.last_timeout_at,
            "last_rate_limit_at": provider_health.last_rate_limit_at,
            "consecutive_failures": provider_health.consecutive_failures,
            "degraded_until": provider_health.degraded_until,
            "notes": provider_health.notes,
            "updated_at": provider_health.updated_at,
        }
    )


def _generated_tool_table_to_record(generated_tool: GeneratedToolTable) -> GeneratedToolRecord:
    return GeneratedToolRecord.model_validate(
        {
            "tool_id": generated_tool.tool_id,
            "tool_name": generated_tool.tool_name,
            "version": generated_tool.version,
            "source_task_id": generated_tool.source_task_id,
            "source_artifact_ref": generated_tool.source_artifact_ref,
            "requested_approval_id": generated_tool.requested_approval_id,
            "lifecycle_state": generated_tool.lifecycle_state,
            "activation_scope": generated_tool.activation_scope,
            "capability_summary": generated_tool.capability_summary,
            "schema_ref": generated_tool.schema_ref,
            "supersedes_tool_id": generated_tool.supersedes_tool_id,
            "superseded_by_tool_id": generated_tool.superseded_by_tool_id,
            "rollback_of_tool_id": generated_tool.rollback_of_tool_id,
            "quarantine_until": generated_tool.quarantine_until,
            "activated_at": generated_tool.activated_at,
            "disabled_at": generated_tool.disabled_at,
            "disabled_reason": generated_tool.disabled_reason,
            "metadata_json": generated_tool.metadata_json,
            "created_at": generated_tool.created_at,
            "updated_at": generated_tool.updated_at,
        }
    )


def _generated_tool_record_to_table(generated_tool: GeneratedToolRecord) -> GeneratedToolTable:
    return GeneratedToolTable(
        tool_id=generated_tool.tool_id,
        tool_name=generated_tool.tool_name,
        version=generated_tool.version,
        source_task_id=generated_tool.source_task_id,
        source_artifact_ref=generated_tool.source_artifact_ref,
        requested_approval_id=generated_tool.requested_approval_id,
        lifecycle_state=generated_tool.lifecycle_state,
        activation_scope=generated_tool.activation_scope,
        capability_summary=generated_tool.capability_summary,
        schema_ref=generated_tool.schema_ref,
        supersedes_tool_id=generated_tool.supersedes_tool_id,
        superseded_by_tool_id=generated_tool.superseded_by_tool_id,
        rollback_of_tool_id=generated_tool.rollback_of_tool_id,
        quarantine_until=generated_tool.quarantine_until,
        activated_at=generated_tool.activated_at,
        disabled_at=generated_tool.disabled_at,
        disabled_reason=generated_tool.disabled_reason,
        metadata_json=generated_tool.metadata_json,
        created_at=generated_tool.created_at,
        updated_at=generated_tool.updated_at,
    )


def _activity_table_to_record(activity: ActivityTable) -> ActivityRecord:
    return ActivityRecord.model_validate(
        {
            "activity_id": activity.activity_id,
            "activity_kind": activity.activity_kind,
            "task_id": activity.task_id,
            "run_id": activity.run_id,
            "approval_id": activity.approval_id,
            "generated_tool_id": activity.generated_tool_id,
            "provider_id": activity.provider_id,
            "model_name": activity.model_name,
            "summary": activity.summary,
            "detail": activity.detail,
            "fallback_from_provider_id": activity.fallback_from_provider_id,
            "fallback_reason": activity.fallback_reason,
            "token_count": activity.token_count,
            "metadata_json": activity.metadata_json,
            "created_at": activity.created_at,
            "updated_at": activity.updated_at,
        }
    )


def _activity_record_to_table(activity: ActivityRecord) -> ActivityTable:
    return ActivityTable(
        activity_id=activity.activity_id,
        activity_kind=activity.activity_kind,
        task_id=activity.task_id,
        run_id=activity.run_id,
        approval_id=activity.approval_id,
        generated_tool_id=activity.generated_tool_id,
        provider_id=activity.provider_id,
        model_name=activity.model_name,
        summary=activity.summary,
        detail=activity.detail,
        fallback_from_provider_id=activity.fallback_from_provider_id,
        fallback_reason=activity.fallback_reason,
        token_count=activity.token_count,
        metadata_json=activity.metadata_json,
        created_at=activity.created_at,
        updated_at=activity.updated_at,
    )


def _memory_table_to_record(memory: MemoryTable) -> MemoryRecord:
    confidence = float(memory.confidence) if isinstance(memory.confidence, Decimal) else memory.confidence
    recency_weight = float(memory.recency_weight) if isinstance(memory.recency_weight, Decimal) else memory.recency_weight
    return MemoryRecord.model_validate(
        {
            "memory_id": memory.memory_id,
            "memory_type": memory.memory_type,
            "content": memory.content,
            "summary": memory.summary,
            "embedding_ref": memory.embedding_ref,
            "source_kind": memory.source_kind,
            "source_ref": memory.source_ref,
            "confidence": confidence,
            "recency_weight": recency_weight,
            "tags": memory.tags,
            "metadata_json": memory.metadata_json,
            "created_at": memory.created_at,
            "updated_at": memory.updated_at,
        }
    )


def _memory_record_to_table(memory: MemoryRecord) -> MemoryTable:
    return MemoryTable(
        memory_id=memory.memory_id,
        memory_type=memory.memory_type,
        content=memory.content,
        summary=memory.summary,
        embedding_ref=memory.embedding_ref,
        source_kind=memory.source_kind,
        source_ref=memory.source_ref,
        confidence=memory.confidence,
        recency_weight=memory.recency_weight,
        tags=memory.tags,
        metadata_json=memory.metadata_json,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
    )


def _artifact_table_to_record(artifact: ArtifactTable) -> ArtifactRecord:
    return ArtifactRecord.model_validate(
        {
            "artifact_id": artifact.artifact_id,
            "artifact_type": artifact.artifact_type,
            "task_id": artifact.task_id,
            "run_id": artifact.run_id,
            "storage_ref": artifact.storage_ref,
            "description": artifact.description,
            "content_hash": artifact.content_hash,
            "visibility": artifact.visibility,
            "retention_class": artifact.retention_class,
            "expires_at": artifact.expires_at,
            "archived_at": artifact.archived_at,
            "purge_after_at": artifact.purge_after_at,
            "metadata_json": artifact.metadata_json,
            "created_at": artifact.created_at,
            "updated_at": artifact.updated_at,
        }
    )


def _artifact_record_to_table(artifact: ArtifactRecord) -> ArtifactTable:
    return ArtifactTable(
        artifact_id=artifact.artifact_id,
        artifact_type=artifact.artifact_type,
        task_id=artifact.task_id,
        run_id=artifact.run_id,
        storage_ref=artifact.storage_ref,
        description=artifact.description,
        content_hash=artifact.content_hash,
        visibility=artifact.visibility,
        retention_class=artifact.retention_class,
        expires_at=artifact.expires_at,
        archived_at=artifact.archived_at,
        purge_after_at=artifact.purge_after_at,
        metadata_json=artifact.metadata_json,
        created_at=artifact.created_at,
        updated_at=artifact.updated_at,
    )


def _subagent_table_to_record(subagent: SubagentTable) -> SubagentRecord:
    return SubagentRecord.model_validate(
        {
            "subagent_id": subagent.subagent_id,
            "parent_task_id": subagent.parent_task_id,
            "child_task_id": subagent.child_task_id,
            "role": subagent.role,
            "status": subagent.status,
            "model_policy_ref": subagent.model_policy_ref,
            "delegated_objective": subagent.delegated_objective,
            "expected_output_contract": subagent.expected_output_contract,
            "started_at": subagent.started_at,
            "heartbeat_at": subagent.heartbeat_at,
            "completed_at": subagent.completed_at,
            "failed_at": subagent.failed_at,
            "timeout_at": subagent.timeout_at,
            "result_artifact_refs": subagent.result_artifact_refs,
            "error_summary": subagent.error_summary,
            "metadata_json": subagent.metadata_json,
            "created_at": subagent.created_at,
            "updated_at": subagent.updated_at,
        }
    )


def _subagent_record_to_table(subagent: SubagentRecord) -> SubagentTable:
    return SubagentTable(
        subagent_id=subagent.subagent_id,
        parent_task_id=subagent.parent_task_id,
        child_task_id=subagent.child_task_id,
        role=subagent.role,
        status=subagent.status,
        model_policy_ref=subagent.model_policy_ref,
        delegated_objective=subagent.delegated_objective,
        expected_output_contract=subagent.expected_output_contract,
        started_at=subagent.started_at,
        heartbeat_at=subagent.heartbeat_at,
        completed_at=subagent.completed_at,
        failed_at=subagent.failed_at,
        timeout_at=subagent.timeout_at,
        result_artifact_refs=subagent.result_artifact_refs,
        error_summary=subagent.error_summary,
        metadata_json=subagent.metadata_json,
        created_at=subagent.created_at,
        updated_at=subagent.updated_at,
    )


def _tokenize_for_memory_search(value: str | None) -> set[str]:
    if value is None:
        return set()
    return {token for token in re.findall(r"[a-z0-9_]+", value.lower()) if len(token) > 1}


def active_claims_for_task_statement(task_id: str, *, as_of: datetime) -> Select[tuple[TaskClaimTable]]:
    return (
        select(TaskClaimTable)
        .where(TaskClaimTable.task_id == task_id)
        .where(TaskClaimTable.claim_state == ClaimState.ACTIVE)
        .where(TaskClaimTable.lease_expires_at > as_of)
    )


class ClaimRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def acquire_claim(self, request: ClaimAcquisitionRequest) -> TaskClaimTable:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()

        existing_active_claim = self._session.execute(
            active_claims_for_task_statement(request.task_id, as_of=request.claimed_at).with_for_update()
        ).scalar_one_or_none()
        if existing_active_claim is not None:
            raise ClaimLifecycleError(f"task {request.task_id} already has an active claim")

        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            TaskStatus.ACTIVE,
            active_run_id=request.run_id,
            transition_time=request.claimed_at,
            pending_approval_id=None,
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.pending_approval_id = transitioned_task.pending_approval_id
        task.updated_at = transitioned_task.updated_at

        claim = TaskClaimTable(
            claim_id=request.claim_id,
            task_id=request.task_id,
            run_id=request.run_id,
            claimed_by=request.claimed_by,
            claim_state=ClaimState.ACTIVE,
            claimed_at=request.claimed_at,
            last_lease_renewal_at=request.claimed_at,
            lease_expires_at=request.claimed_at + request.claim_duration,
            created_at=request.claimed_at,
            updated_at=request.claimed_at,
        )
        self._session.add(claim)
        self._session.flush()
        return claim

    def verify_authoritative_claim(self, task_id: str, claim_id: str, *, as_of: datetime) -> TaskClaimRecord:
        claim = self._session.get(TaskClaimTable, claim_id)
        if claim is None or claim.task_id != task_id:
            raise ClaimLifecycleError(f"claim {claim_id} is not linked to task {task_id}")
        claim_record = _claim_table_to_record(claim)
        if claim_record.claim_state != ClaimState.ACTIVE:
            raise ClaimLifecycleError(f"claim {claim_id} is not active")
        lease_expires_at = claim_record.lease_expires_at
        if lease_expires_at.tzinfo is None:
            lease_expires_at = lease_expires_at.replace(tzinfo=UTC)
        if lease_expires_at <= as_of:
            raise ClaimLifecycleError(f"claim {claim_id} is expired")
        return claim_record

    def transition_task_to_waiting_human(self, request: ApprovalTaskTransitionRequest) -> TerminalTaskTransitionResult:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()
        claim = self._session.execute(
            select(TaskClaimTable).where(TaskClaimTable.claim_id == request.claim_id).with_for_update()
        ).scalar_one()

        if claim.task_id != request.task_id:
            raise ClaimLifecycleError(
                f"claim {request.claim_id} does not belong to task {request.task_id}"
            )

        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            TaskStatus.WAITING_HUMAN,
            transition_time=request.transitioned_at,
            pending_approval_id=request.approval_id,
        )
        claim_record = _claim_table_to_record(claim)
        transitioned_claim = transition_claim_state(
            claim_record,
            ClaimState.EXPIRED,
            transition_time=request.transitioned_at,
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.pending_approval_id = transitioned_task.pending_approval_id
        task.updated_at = transitioned_task.updated_at

        claim.claim_state = transitioned_claim.claim_state
        claim.updated_at = transitioned_claim.updated_at
        claim.lease_expires_at = request.transitioned_at

        self._session.flush()
        return TerminalTaskTransitionResult(task=transitioned_task, claim=transitioned_claim)

    def transition_task_to_scheduled(self, request: FollowupTaskTransitionRequest) -> TerminalTaskTransitionResult:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()
        claim = self._session.execute(
            select(TaskClaimTable).where(TaskClaimTable.claim_id == request.claim_id).with_for_update()
        ).scalar_one()

        if claim.task_id != request.task_id:
            raise ClaimLifecycleError(f"claim {request.claim_id} does not belong to task {request.task_id}")

        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            TaskStatus.SCHEDULED,
            transition_time=request.transitioned_at,
            pending_approval_id=None,
        ).model_copy(
            update={
                "next_followup_at": request.next_followup_at,
                "stale_after_at": request.stale_after_at,
                "continuation_hint": request.continuation_hint,
            }
        )
        claim_record = _claim_table_to_record(claim)
        transitioned_claim = transition_claim_state(
            claim_record,
            ClaimState.EXPIRED,
            transition_time=request.transitioned_at,
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.pending_approval_id = transitioned_task.pending_approval_id
        task.next_followup_at = transitioned_task.next_followup_at
        task.stale_after_at = transitioned_task.stale_after_at
        task.continuation_hint = transitioned_task.continuation_hint
        task.updated_at = transitioned_task.updated_at

        claim.claim_state = transitioned_claim.claim_state
        claim.updated_at = transitioned_claim.updated_at
        claim.lease_expires_at = request.transitioned_at

        self._session.flush()
        return TerminalTaskTransitionResult(task=transitioned_task, claim=transitioned_claim)

    def transition_task_to_blocked(self, request: BlockedTaskTransitionRequest) -> TerminalTaskTransitionResult:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()
        claim = self._session.execute(
            select(TaskClaimTable).where(TaskClaimTable.claim_id == request.claim_id).with_for_update()
        ).scalar_one()

        if claim.task_id != request.task_id:
            raise ClaimLifecycleError(f"claim {request.claim_id} does not belong to task {request.task_id}")

        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            TaskStatus.BLOCKED,
            transition_time=request.transitioned_at,
            pending_approval_id=None,
        ).model_copy(update={"blocked_reason": request.blocked_reason, "stale_after_at": request.stale_after_at})
        claim_record = _claim_table_to_record(claim)
        transitioned_claim = transition_claim_state(
            claim_record,
            ClaimState.EXPIRED,
            transition_time=request.transitioned_at,
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.pending_approval_id = transitioned_task.pending_approval_id
        task.blocked_reason = transitioned_task.blocked_reason
        task.stale_after_at = transitioned_task.stale_after_at
        task.updated_at = transitioned_task.updated_at

        claim.claim_state = transitioned_claim.claim_state
        claim.updated_at = transitioned_claim.updated_at
        claim.lease_expires_at = request.transitioned_at

        self._session.flush()
        return TerminalTaskTransitionResult(task=transitioned_task, claim=transitioned_claim)

    def expire_stale_claim(self, request: StaleClaimTransitionRequest) -> TerminalTaskTransitionResult:
        claim = self._session.execute(
            select(TaskClaimTable).where(TaskClaimTable.claim_id == request.claim_id).with_for_update()
        ).scalar_one()
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == claim.task_id).with_for_update()
        ).scalar_one()

        claim_record = _claim_table_to_record(claim)
        if claim_record.claim_state != ClaimState.ACTIVE:
            raise ClaimLifecycleError(f"claim {request.claim_id} is not active")

        transitioned_claim = transition_claim_state(
            claim_record,
            ClaimState.EXPIRED,
            transition_time=request.transitioned_at,
        )
        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            request.task_status,
            transition_time=request.transitioned_at,
            pending_approval_id=task_record.pending_approval_id,
        ).model_copy(update={"blocked_reason": request.blocked_reason})

        claim.claim_state = transitioned_claim.claim_state
        claim.updated_at = transitioned_claim.updated_at
        claim.lease_expires_at = request.transitioned_at

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.pending_approval_id = transitioned_task.pending_approval_id
        task.blocked_reason = transitioned_task.blocked_reason
        task.updated_at = transitioned_task.updated_at

        self._session.flush()
        return TerminalTaskTransitionResult(task=transitioned_task, claim=transitioned_claim)

    def transition_task_to_terminal(self, request: TerminalTaskTransitionRequest) -> TerminalTaskTransitionResult:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()
        claim = self._session.execute(
            select(TaskClaimTable).where(TaskClaimTable.claim_id == request.claim_id).with_for_update()
        ).scalar_one()

        if claim.task_id != request.task_id:
            raise ClaimLifecycleError(
                f"claim {request.claim_id} does not belong to task {request.task_id}"
            )

        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            request.terminal_status,
            transition_time=request.transitioned_at,
            pending_approval_id=None,
        )
        claim_record = _claim_table_to_record(claim)
        transitioned_claim = transition_claim_state(
            claim_record,
            ClaimState.RELEASED,
            transition_time=request.transitioned_at,
            release_reason=request.release_reason,
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.pending_approval_id = transitioned_task.pending_approval_id
        task.completed_at = transitioned_task.completed_at
        task.failed_at = transitioned_task.failed_at
        task.abandoned_at = transitioned_task.abandoned_at
        task.updated_at = transitioned_task.updated_at

        claim.claim_state = transitioned_claim.claim_state
        claim.released_at = transitioned_claim.released_at
        claim.release_reason = transitioned_claim.release_reason
        claim.updated_at = transitioned_claim.updated_at

        self._session.flush()
        return TerminalTaskTransitionResult(task=transitioned_task, claim=transitioned_claim)


class EventRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def record_event(self, event: EventRecord) -> EventPersistenceResult:
        existing_event = None
        if event.idempotency_key is not None:
            existing_event = self._session.execute(
                select(EventTable).where(EventTable.idempotency_key == event.idempotency_key)
            ).scalar_one_or_none()
        if existing_event is None:
            existing_event = self._session.get(EventTable, event.event_id)

        if existing_event is not None:
            return EventPersistenceResult(
                event=_event_table_to_record(existing_event),
                created=False,
                deduplicated=True,
            )

        persisted_event = _event_record_to_table(event)
        self._session.add(persisted_event)
        self._session.flush()
        return EventPersistenceResult(event=_event_table_to_record(persisted_event), created=True, deduplicated=False)

    def apply_intake_policy(
        self,
        event: EventRecord,
        *,
        policy: EventIntakePolicy | None = None,
        queue_owner: str | None = None,
        now: datetime | None = None,
    ) -> EventRecord:
        decision = evaluate_event_intake(event, policy=policy, now=now)
        return apply_intake_decision(event, decision, queue_owner=queue_owner, now=now)

    def mark_event_consumed(self, event_id: str, *, consumed_by_run_id: str, now: datetime | None = None) -> None:
        when = now or datetime.now(tz=UTC)
        event = self._session.get(EventTable, event_id)
        if event is None:
            raise LookupError(f"event {event_id} not found")
        if event.processing_status == EventProcessingStatus.CONSUMED:
            if event.consumed_by_run_id != consumed_by_run_id:
                raise ValueError(
                    f"event {event_id} already consumed by run {event.consumed_by_run_id}"
                )
            event.updated_at = when
            return
        event.processing_status = EventProcessingStatus.CONSUMED
        event.consumed_by_run_id = consumed_by_run_id
        event.queue_owner = None
        event.updated_at = when


class ApprovalRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create_approval(self, approval: ApprovalRecord) -> ApprovalRecord:
        persisted = _approval_record_to_table(approval)
        self._session.add(persisted)
        self._session.flush()
        return _approval_table_to_record(persisted)

    def get_approval(self, approval_id: str) -> ApprovalRecord | None:
        approval = self._session.get(ApprovalTable, approval_id)
        if approval is None:
            return None
        return _approval_table_to_record(approval)

    def record_reminder(self, approval_id: str, *, next_reminder_at: datetime | None, now: datetime) -> ApprovalRecord:
        approval = self._session.execute(
            select(ApprovalTable).where(ApprovalTable.approval_id == approval_id).with_for_update()
        ).scalar_one()
        approval_record = _approval_table_to_record(approval)
        reminded = transition_approval_status(
            approval_record,
            ApprovalStatus.REMINDED,
            transition_time=now,
            next_reminder_at=next_reminder_at,
        )

        approval.status = reminded.status
        approval.reminder_count = reminded.reminder_count
        approval.next_reminder_at = reminded.next_reminder_at
        approval.updated_at = reminded.updated_at
        self._session.flush()
        return reminded

    def resolve_approval(self, payload: ApprovalDecisionPayload) -> ApprovalRecord:
        approval = self._session.execute(
            select(ApprovalTable).where(ApprovalTable.approval_id == payload.approval_id).with_for_update()
        ).scalar_one()
        approval_record = _approval_table_to_record(approval)

        if approval_record.status in {
            ApprovalStatus.APPROVED,
            ApprovalStatus.DENIED,
            ApprovalStatus.CANCELLED,
            ApprovalStatus.EXPIRED,
        }:
            if (
                approval_record.decision == payload.decision
                and approval_record.resolution_payload_hash == payload.resolution_payload_hash
                and approval_record.resolved_by_user_id == payload.resolved_by_user_id
                and approval_record.resolved_by_session_id == payload.resolved_by_session_id
            ):
                return approval_record
            raise ApprovalLifecycleError(f"approval {payload.approval_id} already resolved")

        status_by_decision = {
            ApprovalDecision.APPROVE: ApprovalStatus.APPROVED,
            ApprovalDecision.DENY: ApprovalStatus.DENIED,
            ApprovalDecision.CANCEL: ApprovalStatus.CANCELLED,
        }
        resolved = transition_approval_status(
            approval_record,
            status_by_decision[payload.decision],
            transition_time=payload.occurred_at,
            decision=payload.decision,
            resolved_by_user_id=payload.resolved_by_user_id,
            resolved_by_session_id=payload.resolved_by_session_id,
            resolution_payload_hash=payload.resolution_payload_hash,
            operator_comment=payload.operator_comment,
        )

        approval.status = resolved.status
        approval.resolved_at = resolved.resolved_at
        approval.resolved_by_user_id = resolved.resolved_by_user_id
        approval.resolved_by_session_id = resolved.resolved_by_session_id
        approval.resolution_payload_hash = resolved.resolution_payload_hash
        approval.decision = resolved.decision
        approval.operator_comment = resolved.operator_comment
        approval.updated_at = resolved.updated_at
        self._session.flush()
        return resolved


class ModelRoutingPolicyRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def upsert_policy(self, policy: ModelRoutingPolicy) -> ModelRoutingPolicy:
        existing = self._session.get(ModelRoutingPolicyTable, policy.policy_id)
        if existing is None:
            persisted = _policy_record_to_table(policy)
            self._session.add(persisted)
            self._session.flush()
            return _policy_table_to_record(persisted)

        existing.version = policy.version
        existing.active = policy.active
        existing.provider_mappings = [mapping.model_dump(mode="json") for mapping in policy.provider_mappings]
        existing.operation_mappings = [mapping.model_dump(mode="json") for mapping in policy.operation_mappings]
        existing.timeout_profiles = [profile.model_dump(mode="json") for profile in policy.timeout_profiles]
        existing.fallback_profiles = [profile.model_dump(mode="json") for profile in policy.fallback_profiles]
        existing.budget_profiles = [profile.model_dump(mode="json") for profile in policy.budget_profiles]
        existing.updated_at = policy.updated_at
        self._session.flush()
        return _policy_table_to_record(existing)

    def get_active_policy(self) -> ModelRoutingPolicy | None:
        policy = self._session.execute(
            select(ModelRoutingPolicyTable).where(ModelRoutingPolicyTable.active.is_(True))
        ).scalar_one_or_none()
        if policy is None:
            return None
        return _policy_table_to_record(policy)


class ProviderHealthRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def upsert_provider_health(self, provider_health: ProviderHealthRecord) -> ProviderHealthRecord:
        existing = self._session.get(ProviderHealthTable, provider_health.provider_id)
        if existing is None:
            existing = ProviderHealthTable(
                provider_id=provider_health.provider_id,
                health_status=provider_health.health_status,
                last_success_at=provider_health.last_success_at,
                last_timeout_at=provider_health.last_timeout_at,
                last_rate_limit_at=provider_health.last_rate_limit_at,
                consecutive_failures=provider_health.consecutive_failures,
                degraded_until=provider_health.degraded_until,
                notes=provider_health.notes,
                updated_at=provider_health.updated_at,
            )
            self._session.add(existing)
            self._session.flush()
            return _provider_health_table_to_record(existing)

        existing.health_status = provider_health.health_status
        existing.last_success_at = provider_health.last_success_at
        existing.last_timeout_at = provider_health.last_timeout_at
        existing.last_rate_limit_at = provider_health.last_rate_limit_at
        existing.consecutive_failures = provider_health.consecutive_failures
        existing.degraded_until = provider_health.degraded_until
        existing.notes = provider_health.notes
        existing.updated_at = provider_health.updated_at
        self._session.flush()
        return _provider_health_table_to_record(existing)

    def get_provider_health(self, provider_id: str) -> ProviderHealthRecord | None:
        provider_health = self._session.get(ProviderHealthTable, provider_id)
        if provider_health is None:
            return None
        return _provider_health_table_to_record(provider_health)

    def list_provider_health(self) -> list[ProviderHealthRecord]:
        provider_health = self._session.execute(select(ProviderHealthTable).order_by(ProviderHealthTable.provider_id)).scalars().all()
        return [_provider_health_table_to_record(item) for item in provider_health]


class GeneratedToolRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    _ACTIVATED_STATES = frozenset(
        {
            GeneratedToolLifecycleState.QUARANTINED,
            GeneratedToolLifecycleState.LIMITED,
            GeneratedToolLifecycleState.GLOBAL,
        }
    )

    def create_generated_tool(self, generated_tool: GeneratedToolRecord) -> GeneratedToolRecord:
        persisted = _generated_tool_record_to_table(generated_tool)
        self._session.add(persisted)
        self._session.flush()
        self._log_lifecycle_activity(_generated_tool_table_to_record(persisted), generated_tool.created_at, summary="Generated tool proposed")
        return _generated_tool_table_to_record(persisted)

    def get_generated_tool(self, tool_id: str) -> GeneratedToolRecord | None:
        generated_tool = self._session.get(GeneratedToolTable, tool_id)
        if generated_tool is None:
            return None
        return _generated_tool_table_to_record(generated_tool)

    def list_generated_tools(
        self,
        *,
        lifecycle_states: list[GeneratedToolLifecycleState | str] | None = None,
        limit: int = 50,
    ) -> list[GeneratedToolRecord]:
        statement = select(GeneratedToolTable).order_by(GeneratedToolTable.updated_at.desc())
        if lifecycle_states:
            statement = statement.where(GeneratedToolTable.lifecycle_state.in_(lifecycle_states))
        tools = self._session.execute(statement.limit(limit)).scalars().all()
        return [_generated_tool_table_to_record(tool) for tool in tools]

    def transition_generated_tool(
        self,
        *,
        tool_id: str,
        new_state: GeneratedToolLifecycleState,
        transitioned_at: datetime,
        activation_scope: ToolActivationScope | None = None,
        requested_approval_id: str | None = None,
        quarantine_until: datetime | None = None,
        activated_at: datetime | None = None,
        disabled_reason: str | None = None,
        superseded_by_tool_id: str | None = None,
        rollback_of_tool_id: str | None = None,
    ) -> GeneratedToolRecord:
        generated_tool = self._session.execute(
            select(GeneratedToolTable).where(GeneratedToolTable.tool_id == tool_id).with_for_update()
        ).scalar_one()
        generated_tool_record = _generated_tool_table_to_record(generated_tool)
        self._require_approved_activation_request(
            generated_tool_record=generated_tool_record,
            new_state=new_state,
            requested_approval_id=requested_approval_id,
        )
        transitioned = transition_generated_tool_state(
            generated_tool_record,
            new_state,
            transition_time=transitioned_at,
            activation_scope=activation_scope,
            requested_approval_id=requested_approval_id,
            quarantine_until=quarantine_until,
            activated_at=activated_at,
            disabled_reason=disabled_reason,
            superseded_by_tool_id=superseded_by_tool_id,
            rollback_of_tool_id=rollback_of_tool_id,
        )

        generated_tool.requested_approval_id = transitioned.requested_approval_id
        generated_tool.lifecycle_state = transitioned.lifecycle_state
        generated_tool.activation_scope = transitioned.activation_scope
        generated_tool.quarantine_until = transitioned.quarantine_until
        generated_tool.activated_at = transitioned.activated_at
        generated_tool.disabled_at = transitioned.disabled_at
        generated_tool.disabled_reason = transitioned.disabled_reason
        generated_tool.superseded_by_tool_id = transitioned.superseded_by_tool_id
        generated_tool.rollback_of_tool_id = transitioned.rollback_of_tool_id
        generated_tool.updated_at = transitioned.updated_at
        self._session.flush()
        self._log_lifecycle_activity(transitioned, transitioned_at, summary=f"Generated tool transitioned to {new_state}")
        return transitioned

    def _require_approved_activation_request(
        self,
        *,
        generated_tool_record: GeneratedToolRecord,
        new_state: GeneratedToolLifecycleState,
        requested_approval_id: str | None,
    ) -> None:
        if new_state not in self._ACTIVATED_STATES:
            return

        approval_id = requested_approval_id or generated_tool_record.requested_approval_id
        if approval_id is None:
            raise GeneratedToolLifecycleError("activated generated tools require an approved approval")

        approval = self._session.get(ApprovalTable, approval_id)
        if approval is None or approval.status != ApprovalStatus.APPROVED:
            raise GeneratedToolLifecycleError("activated generated tools require an approved approval")

    def _log_lifecycle_activity(self, generated_tool: GeneratedToolRecord, now: datetime, *, summary: str) -> None:
        self._session.add(
            _activity_record_to_table(
                ActivityRecord(
                    activity_id=f"activity-{uuid4().hex}",
                    activity_kind=ActivityKind.GENERATED_TOOL_LIFECYCLE,
                    task_id=generated_tool.source_task_id,
                    approval_id=generated_tool.requested_approval_id,
                    generated_tool_id=generated_tool.tool_id,
                    summary=summary,
                    detail=(
                        f"state={generated_tool.lifecycle_state} scope={generated_tool.activation_scope} version={generated_tool.version}"
                    ),
                    metadata_json={
                        "activation_scope": generated_tool.activation_scope,
                        "lifecycle_state": generated_tool.lifecycle_state,
                        "rollback_of_tool_id": generated_tool.rollback_of_tool_id,
                        "superseded_by_tool_id": generated_tool.superseded_by_tool_id,
                    },
                    created_at=now,
                    updated_at=now,
                )
            )
        )


class ActivityRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def record_activity(self, activity: ActivityRecord) -> ActivityRecord:
        persisted = _activity_record_to_table(activity)
        self._session.add(persisted)
        self._session.flush()
        return _activity_table_to_record(persisted)

    def list_activity(
        self,
        *,
        activity_kinds: list[ActivityKind | str] | None = None,
        task_id: str | None = None,
        generated_tool_id: str | None = None,
        limit: int = 50,
    ) -> list[ActivityRecord]:
        statement = select(ActivityTable).order_by(ActivityTable.created_at.desc(), ActivityTable.activity_id.desc())
        if activity_kinds:
            statement = statement.where(ActivityTable.activity_kind.in_(activity_kinds))
        if task_id is not None:
            statement = statement.where(ActivityTable.task_id == task_id)
        if generated_tool_id is not None:
            statement = statement.where(ActivityTable.generated_tool_id == generated_tool_id)
        activities = self._session.execute(statement.limit(limit)).scalars().all()
        return [_activity_table_to_record(activity) for activity in activities]


class MemoryRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def upsert_memory(self, memory: MemoryRecord) -> MemoryRecord:
        existing = self._session.get(MemoryTable, memory.memory_id)
        if existing is None:
            persisted = _memory_record_to_table(memory)
            self._session.add(persisted)
            self._session.flush()
            return _memory_table_to_record(persisted)

        existing.memory_type = memory.memory_type
        existing.content = memory.content
        existing.summary = memory.summary
        existing.embedding_ref = memory.embedding_ref
        existing.source_kind = memory.source_kind
        existing.source_ref = memory.source_ref
        existing.confidence = memory.confidence
        existing.recency_weight = memory.recency_weight
        existing.tags = memory.tags
        existing.metadata_json = memory.metadata_json
        existing.updated_at = memory.updated_at
        self._session.flush()
        return _memory_table_to_record(existing)

    def search_memories(self, request: MemorySearchRequest) -> list[MemoryRecord]:
        candidates = self._session.execute(select(MemoryTable)).scalars().all()
        query_tokens = _tokenize_for_memory_search(request.query_text)
        ranked: list[tuple[float, MemoryRecord]] = []

        for candidate in candidates:
            record = _memory_table_to_record(candidate)
            if request.memory_types is not None and record.memory_type not in request.memory_types:
                continue
            if request.source_kind is not None and record.source_kind != request.source_kind:
                continue
            if request.source_ref is not None and record.source_ref != request.source_ref:
                continue

            searchable_text = " ".join(
                part for part in [record.summary, record.content, " ".join(record.tags), record.source_ref] if part
            )
            overlap = len(query_tokens & _tokenize_for_memory_search(searchable_text))
            if query_tokens and overlap == 0:
                continue
            score = float(overlap)
            if record.confidence is not None:
                score += record.confidence
            if record.recency_weight is not None:
                score += record.recency_weight
            if score <= 0:
                continue
            ranked.append((score, record))

        ranked.sort(key=lambda item: (-item[0], item[1].updated_at), reverse=False)
        return [record for _, record in ranked[: request.limit]]


class ArtifactRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create_artifact(self, artifact: ArtifactRecord) -> ArtifactRecord:
        persisted = _artifact_record_to_table(artifact)
        self._session.add(persisted)
        self._session.flush()
        return _artifact_table_to_record(persisted)

    def list_task_artifacts(self, task_id: str) -> list[ArtifactRecord]:
        artifacts = self._session.execute(select(ArtifactTable).where(ArtifactTable.task_id == task_id)).scalars().all()
        return [_artifact_table_to_record(artifact) for artifact in artifacts]


class MaintenanceRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_due_scheduled_tasks(self, *, as_of: datetime) -> list[TaskRecord]:
        tasks = self._session.execute(
            select(TaskTable)
            .where(TaskTable.status == TaskStatus.SCHEDULED)
            .where(TaskTable.next_followup_at.is_not(None))
            .where(TaskTable.next_followup_at <= as_of)
        ).scalars().all()
        return [_task_table_to_record(task) for task in tasks]

    def list_stale_tasks(self, *, as_of: datetime, statuses: list[TaskStatus]) -> list[TaskRecord]:
        tasks = self._session.execute(
            select(TaskTable)
            .where(TaskTable.status.in_(statuses))
            .where(TaskTable.stale_after_at.is_not(None))
            .where(TaskTable.stale_after_at <= as_of)
        ).scalars().all()
        return [_task_table_to_record(task) for task in tasks]

    def list_tasks_by_status(self, *, statuses: list[TaskStatus]) -> list[TaskRecord]:
        tasks = self._session.execute(select(TaskTable).where(TaskTable.status.in_(statuses))).scalars().all()
        return [_task_table_to_record(task) for task in tasks]

    def list_expired_active_claims(self, *, as_of: datetime) -> list[TaskClaimRecord]:
        claims = self._session.execute(
            select(TaskClaimTable)
            .where(TaskClaimTable.claim_state == ClaimState.ACTIVE)
            .where(TaskClaimTable.lease_expires_at <= as_of)
        ).scalars().all()
        return [_claim_table_to_record(claim) for claim in claims]

    def transition_stale_task(self, request: StaleTaskTransitionRequest) -> TaskRecord:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()
        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            request.target_status,
            transition_time=request.transitioned_at,
            pending_approval_id=task_record.pending_approval_id,
        ).model_copy(
            update={
                "blocked_reason": request.blocked_reason if request.blocked_reason is not None else task_record.blocked_reason,
                "continuation_hint": request.continuation_hint if request.continuation_hint is not None else task_record.continuation_hint,
                "next_followup_at": request.next_followup_at,
                "stale_after_at": request.stale_after_at,
            }
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.pending_approval_id = transitioned_task.pending_approval_id
        task.blocked_reason = transitioned_task.blocked_reason
        task.continuation_hint = transitioned_task.continuation_hint
        task.next_followup_at = transitioned_task.next_followup_at
        task.stale_after_at = transitioned_task.stale_after_at
        task.failed_at = transitioned_task.failed_at
        task.abandoned_at = transitioned_task.abandoned_at
        task.updated_at = transitioned_task.updated_at
        self._session.flush()
        return transitioned_task


class SubagentRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def begin_delegation(
        self,
        *,
        parent_task_id: str,
        claim_id: str | None,
        child_task: TaskRecord,
        subagent: SubagentRecord,
        now: datetime,
        blocked_reason: str,
        stale_after_at: datetime | None,
    ) -> tuple[TaskRecord, TaskRecord, SubagentRecord]:
        parent = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == parent_task_id).with_for_update()
        ).scalar_one()
        claim = None
        if claim_id is not None:
            claim = self._session.execute(
                select(TaskClaimTable).where(TaskClaimTable.claim_id == claim_id).with_for_update()
            ).scalar_one()
            if claim.task_id != parent_task_id:
                raise ClaimLifecycleError(f"claim {claim_id} does not belong to task {parent_task_id}")
        parent_record = _task_table_to_record(parent)
        transitioned_parent = transition_task_status(
            parent_record,
            TaskStatus.BLOCKED,
            transition_time=now,
            pending_approval_id=parent_record.pending_approval_id,
        ).model_copy(
            update={
                "blocked_reason": blocked_reason,
                "stale_after_at": stale_after_at,
                "child_task_ids": [*parent_record.child_task_ids, child_task.task_id],
            }
        )

        parent.status = transitioned_parent.status
        parent.active_run_id = transitioned_parent.active_run_id
        parent.blocked_reason = transitioned_parent.blocked_reason
        parent.stale_after_at = transitioned_parent.stale_after_at
        parent.child_task_ids = transitioned_parent.child_task_ids
        parent.updated_at = transitioned_parent.updated_at

        if claim is not None:
            claim_record = _claim_table_to_record(claim)
            transitioned_claim = transition_claim_state(
                claim_record,
                ClaimState.EXPIRED,
                transition_time=now,
            )
            claim.claim_state = transitioned_claim.claim_state
            claim.updated_at = transitioned_claim.updated_at
            claim.lease_expires_at = now

        self._session.add(_task_record_to_table(child_task))
        persisted_subagent = _subagent_record_to_table(subagent)
        self._session.add(persisted_subagent)
        self._session.flush()
        return transitioned_parent, child_task, _subagent_table_to_record(persisted_subagent)

    def mark_running(self, subagent_id: str, *, now: datetime) -> SubagentRecord:
        subagent = self._session.execute(
            select(SubagentTable).where(SubagentTable.subagent_id == subagent_id).with_for_update()
        ).scalar_one()
        subagent_record = _subagent_table_to_record(subagent)
        transitioned = transition_subagent_status(
            subagent_record,
            SubagentStatus.RUNNING,
            transition_time=now,
            heartbeat_at=now,
        )

        subagent.status = transitioned.status
        subagent.started_at = transitioned.started_at
        subagent.heartbeat_at = transitioned.heartbeat_at
        subagent.updated_at = transitioned.updated_at
        self._session.flush()
        return transitioned

    def apply_child_outcome(
        self,
        *,
        subagent_id: str,
        new_status: SubagentStatus,
        now: datetime,
        parent_status: TaskStatus,
        parent_blocked_reason: str | None = None,
        parent_continuation_hint: str | None = None,
        parent_next_followup_at: datetime | None = None,
        parent_stale_after_at: datetime | None = None,
        result_artifact_refs: list[str] | None = None,
        error_summary: str | None = None,
    ) -> tuple[SubagentRecord, TaskRecord]:
        subagent = self._session.execute(
            select(SubagentTable).where(SubagentTable.subagent_id == subagent_id).with_for_update()
        ).scalar_one()
        parent = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == subagent.parent_task_id).with_for_update()
        ).scalar_one()

        subagent_record = _subagent_table_to_record(subagent)
        transitioned_subagent = transition_subagent_status(
            subagent_record,
            new_status,
            transition_time=now,
            heartbeat_at=now,
            result_artifact_refs=result_artifact_refs,
            error_summary=error_summary,
        )

        parent_record = _task_table_to_record(parent)
        transitioned_parent = transition_task_status(
            parent_record,
            parent_status,
            transition_time=now,
            pending_approval_id=parent_record.pending_approval_id,
        ).model_copy(
            update={
                "blocked_reason": parent_blocked_reason,
                "continuation_hint": parent_continuation_hint,
                "next_followup_at": parent_next_followup_at,
                "stale_after_at": parent_stale_after_at,
            }
        )

        subagent.status = transitioned_subagent.status
        subagent.started_at = transitioned_subagent.started_at
        subagent.heartbeat_at = transitioned_subagent.heartbeat_at
        subagent.completed_at = transitioned_subagent.completed_at
        subagent.failed_at = transitioned_subagent.failed_at
        subagent.timeout_at = transitioned_subagent.timeout_at
        subagent.result_artifact_refs = transitioned_subagent.result_artifact_refs
        subagent.error_summary = transitioned_subagent.error_summary
        subagent.updated_at = transitioned_subagent.updated_at

        parent.status = transitioned_parent.status
        parent.active_run_id = transitioned_parent.active_run_id
        parent.blocked_reason = transitioned_parent.blocked_reason
        parent.continuation_hint = transitioned_parent.continuation_hint
        parent.next_followup_at = transitioned_parent.next_followup_at
        parent.stale_after_at = transitioned_parent.stale_after_at
        parent.failed_at = transitioned_parent.failed_at
        parent.updated_at = transitioned_parent.updated_at

        self._session.flush()
        return transitioned_subagent, transitioned_parent