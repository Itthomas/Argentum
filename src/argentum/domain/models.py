from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .enums import (
    ChannelType,
    ClaimReleaseReason,
    ClaimState,
    EventAuthStatus,
    EventProcessingStatus,
    EventType,
    QueueClass,
    TaskStatus,
    TaskType,
    TriggerMode,
)

APPROVAL_HOLD_STATUSES = frozenset(
    {
        TaskStatus.WAITING_HUMAN,
        TaskStatus.BLOCKED,
        TaskStatus.BLOCKED_TIMEOUT,
        TaskStatus.NEEDS_OPERATOR_ATTENTION,
    }
)
TERMINAL_TASK_STATUSES = frozenset(
    {
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.FAILED_TIMEOUT,
        TaskStatus.EXPIRED,
        TaskStatus.ABANDONED,
    }
)


class ArgentumModel(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)


class TaskCandidate(ArgentumModel):
    task_id: str
    confidence_score: float
    rationale: str | None = None


class EventRecord(ArgentumModel):
    event_id: str
    event_type: EventType
    trigger_mode: TriggerMode
    source_surface: str
    source_channel_id: str | None = None
    source_thread_ref: str | None = None
    source_user_id: str | None = None
    source_message_ref: str | None = None
    authenticated_principal_ref: str | None = None
    auth_status: EventAuthStatus = EventAuthStatus.PENDING
    idempotency_key: str | None = None
    replay_window_key: str | None = None
    replay_window_expires_at: datetime | None = None
    payload_text: str | None = None
    payload_structured: dict[str, Any] | None = None
    attachment_refs: list[str] = Field(default_factory=list)
    explicit_task_refs: list[str] = Field(default_factory=list)
    inferred_task_candidates: list[TaskCandidate] = Field(default_factory=list)
    approval_response_data: dict[str, Any] | None = None
    heartbeat_data: dict[str, Any] | None = None
    cron_data: dict[str, Any] | None = None
    webhook_data: dict[str, Any] | None = None
    queue_class: QueueClass | None = None
    queue_priority: int | None = None
    queue_owner: str | None = None
    queued_at: datetime | None = None
    next_attempt_at: datetime | None = None
    delivery_attempt_count: int = 0
    processing_status: EventProcessingStatus = EventProcessingStatus.RECEIVED
    processing_error: str | None = None
    dead_letter_reason: str | None = None
    consumed_by_run_id: str | None = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_event_contract(self) -> EventRecord:
        rejected_statuses = {
            EventProcessingStatus.REJECTED_UNAUTHENTICATED,
            EventProcessingStatus.REJECTED_UNAUTHORIZED,
        }
        if self.processing_status in rejected_statuses and self.queue_class is not None:
            raise ValueError("rejected events must not remain queued for normal execution")
        if self.processing_status == EventProcessingStatus.DEAD_LETTERED and self.dead_letter_reason is None:
            raise ValueError("dead-lettered events require a dead-letter reason")
        return self


class SessionRecord(ArgentumModel):
    session_id: str
    session_key: str
    channel_type: ChannelType
    channel_id: str
    peer_id: str | None = None
    user_id: str | None = None
    active_thread_ref: str | None = None
    transcript_ref: str | None = None
    current_task_id: str | None = None
    recent_task_ids: list[str] = Field(default_factory=list)
    approval_capabilities: dict[str, bool] = Field(default_factory=dict)
    delivery_capabilities: dict[str, bool] = Field(default_factory=dict)
    runtime_flags: dict[str, Any] = Field(default_factory=dict)
    latest_activity_at: datetime
    created_at: datetime
    updated_at: datetime


class TaskRecord(ArgentumModel):
    task_id: str
    title: str
    objective: str
    normalized_objective: str
    task_type: TaskType
    status: TaskStatus
    priority: int
    confidence_score: float | None = None
    created_by_event_id: str
    origin_session_ids: list[str] = Field(default_factory=list)
    origin_thread_refs: list[str] = Field(default_factory=list)
    assigned_runtime_lane: str | None = None
    active_run_id: str | None = None
    parent_task_id: str | None = None
    child_task_ids: list[str] = Field(default_factory=list)
    latest_summary: str | None = None
    latest_summary_at: datetime | None = None
    success_criteria: list[str] = Field(default_factory=list)
    continuation_hint: str | None = None
    blocked_reason: str | None = None
    pending_approval_id: str | None = None
    artifact_refs: list[str] = Field(default_factory=list)
    related_memory_refs: list[str] = Field(default_factory=list)
    last_operator_confirmation_at: datetime | None = None
    next_followup_at: datetime | None = None
    stale_after_at: datetime | None = None
    abandoned_at: datetime | None = None
    completed_at: datetime | None = None
    failed_at: datetime | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_task_invariants(self) -> TaskRecord:
        if self.pending_approval_id is not None and self.status not in APPROVAL_HOLD_STATUSES:
            raise ValueError("pending approvals are only valid for approval-hold task states")
        if self.status in TERMINAL_TASK_STATUSES and self.active_run_id is not None:
            raise ValueError("terminal tasks must not retain an active run")
        if self.status == TaskStatus.COMPLETED and self.completed_at is None:
            raise ValueError("completed tasks must record completed_at")
        if self.status in {TaskStatus.FAILED, TaskStatus.FAILED_TIMEOUT} and self.failed_at is None:
            raise ValueError("failed tasks must record failed_at")
        if self.status == TaskStatus.ABANDONED and self.abandoned_at is None:
            raise ValueError("abandoned tasks must record abandoned_at")
        return self


class TaskClaimRecord(ArgentumModel):
    claim_id: str
    task_id: str
    run_id: str
    claimed_by: str
    claim_state: ClaimState
    claimed_at: datetime
    last_lease_renewal_at: datetime | None = None
    lease_expires_at: datetime
    released_at: datetime | None = None
    release_reason: ClaimReleaseReason | None = None
    superseded_by_claim_id: str | None = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_claim_invariants(self) -> TaskClaimRecord:
        if self.claim_state == ClaimState.ACTIVE:
            if self.release_reason is not None or self.released_at is not None:
                raise ValueError("active claims must not be marked released")
        if self.claim_state == ClaimState.RELEASED:
            if self.release_reason is None or self.released_at is None:
                raise ValueError("released claims require release metadata")
        if self.claim_state == ClaimState.SUPERSEDED and self.superseded_by_claim_id is None:
            raise ValueError("superseded claims require a successor claim reference")
        return self