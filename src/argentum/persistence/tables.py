from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from argentum.domain.enums import (
    ApprovalDecision,
    ApprovalStatus,
    ApprovalType,
    ArtifactType,
    ArtifactVisibility,
    ChannelType,
    ClaimReleaseReason,
    ClaimState,
    CostClass,
    EventAuthStatus,
    EventProcessingStatus,
    EventType,
    FallbackAction,
    MemorySourceKind,
    MemoryType,
    ModelTier,
    OperationType,
    ProviderHealthStatus,
    QueueClass,
    RetentionClass,
    RiskLevel,
    SubagentRole,
    SubagentStatus,
    TaskStatus,
    TaskType,
    TriggerMode,
)

from .base import Base


class EventTable(Base):
    __tablename__ = "events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[EventType] = mapped_column(Enum(EventType, native_enum=False), nullable=False)
    trigger_mode: Mapped[TriggerMode] = mapped_column(Enum(TriggerMode, native_enum=False), nullable=False)
    source_surface: Mapped[str] = mapped_column(String(64), nullable=False)
    source_channel_id: Mapped[str | None] = mapped_column(String(255))
    source_thread_ref: Mapped[str | None] = mapped_column(String(255))
    source_user_id: Mapped[str | None] = mapped_column(String(255))
    source_message_ref: Mapped[str | None] = mapped_column(String(255))
    authenticated_principal_ref: Mapped[str | None] = mapped_column(String(255))
    auth_status: Mapped[EventAuthStatus] = mapped_column(Enum(EventAuthStatus, native_enum=False), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), unique=True)
    replay_window_key: Mapped[str | None] = mapped_column(String(255))
    replay_window_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payload_text: Mapped[str | None] = mapped_column(Text())
    payload_structured: Mapped[dict[str, Any] | None] = mapped_column(JSON())
    attachment_refs: Mapped[list[str]] = mapped_column(JSON(), default=list)
    explicit_task_refs: Mapped[list[str]] = mapped_column(JSON(), default=list)
    inferred_task_candidates: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default=list)
    approval_response_data: Mapped[dict[str, Any] | None] = mapped_column(JSON())
    heartbeat_data: Mapped[dict[str, Any] | None] = mapped_column(JSON())
    cron_data: Mapped[dict[str, Any] | None] = mapped_column(JSON())
    webhook_data: Mapped[dict[str, Any] | None] = mapped_column(JSON())
    queue_class: Mapped[QueueClass | None] = mapped_column(Enum(QueueClass, native_enum=False))
    queue_priority: Mapped[int | None] = mapped_column(Integer())
    queue_owner: Mapped[str | None] = mapped_column(String(255))
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_attempt_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    processing_status: Mapped[EventProcessingStatus] = mapped_column(
        Enum(EventProcessingStatus, native_enum=False), nullable=False
    )
    processing_error: Mapped[str | None] = mapped_column(Text())
    dead_letter_reason: Mapped[str | None] = mapped_column(Text())
    consumed_by_run_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SessionTable(Base):
    __tablename__ = "sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    channel_type: Mapped[ChannelType] = mapped_column(Enum(ChannelType, native_enum=False), nullable=False)
    channel_id: Mapped[str] = mapped_column(String(255), nullable=False)
    peer_id: Mapped[str | None] = mapped_column(String(255))
    user_id: Mapped[str | None] = mapped_column(String(255))
    active_thread_ref: Mapped[str | None] = mapped_column(String(255))
    transcript_ref: Mapped[str | None] = mapped_column(String(255))
    current_task_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("tasks.task_id"))
    recent_task_ids: Mapped[list[str]] = mapped_column(JSON(), default=list)
    approval_capabilities: Mapped[dict[str, bool]] = mapped_column(JSON(), default=dict)
    delivery_capabilities: Mapped[dict[str, bool]] = mapped_column(JSON(), default=dict)
    runtime_flags: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    latest_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TaskTable(Base):
    __tablename__ = "tasks"

    task_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    objective: Mapped[str] = mapped_column(Text(), nullable=False)
    normalized_objective: Mapped[str] = mapped_column(Text(), nullable=False)
    task_type: Mapped[TaskType] = mapped_column(Enum(TaskType, native_enum=False), nullable=False)
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus, native_enum=False), nullable=False)
    priority: Mapped[int] = mapped_column(Integer(), nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    created_by_event_id: Mapped[str] = mapped_column(String(64), ForeignKey("events.event_id"), nullable=False)
    origin_session_ids: Mapped[list[str]] = mapped_column(JSON(), default=list)
    origin_thread_refs: Mapped[list[str]] = mapped_column(JSON(), default=list)
    assigned_runtime_lane: Mapped[str | None] = mapped_column(String(64))
    active_run_id: Mapped[str | None] = mapped_column(String(64))
    parent_task_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("tasks.task_id"))
    child_task_ids: Mapped[list[str]] = mapped_column(JSON(), default=list)
    latest_summary: Mapped[str | None] = mapped_column(Text())
    latest_summary_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    success_criteria: Mapped[list[str]] = mapped_column(JSON(), default=list)
    continuation_hint: Mapped[str | None] = mapped_column(Text())
    blocked_reason: Mapped[str | None] = mapped_column(Text())
    pending_approval_id: Mapped[str | None] = mapped_column(String(64))
    artifact_refs: Mapped[list[str]] = mapped_column(JSON(), default=list)
    related_memory_refs: Mapped[list[str]] = mapped_column(JSON(), default=list)
    last_operator_confirmation_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_followup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stale_after_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    abandoned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TaskClaimTable(Base):
    __tablename__ = "task_claims"

    claim_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(64), ForeignKey("tasks.task_id"), nullable=False)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False)
    claimed_by: Mapped[str] = mapped_column(String(255), nullable=False)
    claim_state: Mapped[ClaimState] = mapped_column(Enum(ClaimState, native_enum=False), nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_lease_renewal_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    release_reason: Mapped[ClaimReleaseReason | None] = mapped_column(Enum(ClaimReleaseReason, native_enum=False))
    superseded_by_claim_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("task_claims.claim_id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ApprovalTable(Base):
    __tablename__ = "approvals"

    approval_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(64), ForeignKey("tasks.task_id"), nullable=False)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False)
    approval_type: Mapped[ApprovalType] = mapped_column(Enum(ApprovalType, native_enum=False), nullable=False)
    risk_level: Mapped[RiskLevel] = mapped_column(Enum(RiskLevel, native_enum=False), nullable=False)
    requested_action: Mapped[str] = mapped_column(Text(), nullable=False)
    rationale: Mapped[str] = mapped_column(Text(), nullable=False)
    constrained_options: Mapped[list[str]] = mapped_column(JSON(), default=list)
    request_payload: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    eligible_resolver_refs: Mapped[list[str]] = mapped_column(JSON(), default=list)
    status: Mapped[ApprovalStatus] = mapped_column(Enum(ApprovalStatus, native_enum=False), nullable=False)
    requested_via_session_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("sessions.session_id"))
    requested_via_message_ref: Mapped[str | None] = mapped_column(String(255))
    reminder_count: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    next_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_user_id: Mapped[str | None] = mapped_column(String(255))
    resolved_by_session_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("sessions.session_id"))
    resolution_payload_hash: Mapped[str | None] = mapped_column(String(255))
    decision: Mapped[ApprovalDecision | None] = mapped_column(Enum(ApprovalDecision, native_enum=False))
    operator_comment: Mapped[str | None] = mapped_column(Text())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ModelRoutingPolicyTable(Base):
    __tablename__ = "model_routing_policies"

    policy_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(nullable=False, default=False)
    provider_mappings: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default=list)
    operation_mappings: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default=list)
    timeout_profiles: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default=list)
    fallback_profiles: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default=list)
    budget_profiles: Mapped[list[dict[str, Any]]] = mapped_column(JSON(), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ProviderHealthTable(Base):
    __tablename__ = "provider_health"

    provider_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    health_status: Mapped[ProviderHealthStatus] = mapped_column(
        Enum(ProviderHealthStatus, native_enum=False), nullable=False
    )
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_timeout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_rate_limit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consecutive_failures: Mapped[int] = mapped_column(Integer(), default=0, nullable=False)
    degraded_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MemoryTable(Base):
    __tablename__ = "memories"

    memory_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    memory_type: Mapped[MemoryType] = mapped_column(Enum(MemoryType, native_enum=False), nullable=False)
    content: Mapped[str] = mapped_column(Text(), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text())
    embedding_ref: Mapped[str | None] = mapped_column(String(255))
    source_kind: Mapped[MemorySourceKind] = mapped_column(Enum(MemorySourceKind, native_enum=False), nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String(255))
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4))
    recency_weight: Mapped[float | None] = mapped_column(Numeric(5, 4))
    tags: Mapped[list[str]] = mapped_column(JSON(), default=list)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ArtifactTable(Base):
    __tablename__ = "artifacts"

    artifact_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    artifact_type: Mapped[ArtifactType] = mapped_column(Enum(ArtifactType, native_enum=False), nullable=False)
    task_id: Mapped[str] = mapped_column(String(64), ForeignKey("tasks.task_id"), nullable=False)
    run_id: Mapped[str | None] = mapped_column(String(64))
    storage_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text())
    content_hash: Mapped[str | None] = mapped_column(String(255))
    visibility: Mapped[ArtifactVisibility] = mapped_column(Enum(ArtifactVisibility, native_enum=False), nullable=False)
    retention_class: Mapped[RetentionClass] = mapped_column(Enum(RetentionClass, native_enum=False), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purge_after_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SubagentTable(Base):
    __tablename__ = "subagents"

    subagent_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    parent_task_id: Mapped[str] = mapped_column(String(64), ForeignKey("tasks.task_id"), nullable=False)
    child_task_id: Mapped[str] = mapped_column(String(64), ForeignKey("tasks.task_id"), nullable=False)
    role: Mapped[SubagentRole] = mapped_column(Enum(SubagentRole, native_enum=False), nullable=False)
    status: Mapped[SubagentStatus] = mapped_column(Enum(SubagentStatus, native_enum=False), nullable=False)
    model_policy_ref: Mapped[str | None] = mapped_column(String(64))
    delegated_objective: Mapped[str] = mapped_column(Text(), nullable=False)
    expected_output_contract: Mapped[str] = mapped_column(Text(), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timeout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result_artifact_refs: Mapped[list[str]] = mapped_column(JSON(), default=list)
    error_summary: Mapped[str | None] = mapped_column(Text())
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)