from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .enums import (
    ActivityKind,
    ApprovalDecision,
    ApprovalStatus,
    ApprovalType,
    ArtifactType,
    ArtifactVisibility,
    ChannelType,
    ClaimReleaseReason,
    ClaimState,
    ContinuationDecision,
    CostClass,
    EventAuthStatus,
    EventProcessingStatus,
    EventType,
    FallbackAction,
    GeneratedToolLifecycleState,
    MemorySourceKind,
    MemoryType,
    ModelTier,
    OperationType,
    ProviderHealthStatus,
    QueueClass,
    RetentionClass,
    RiskLevel,
    RunClass,
    RunStatus,
    SubagentRole,
    SubagentStatus,
    TaskStatus,
    TaskType,
    ToolActivationScope,
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
        if self.processing_status == EventProcessingStatus.CONSUMED and self.consumed_by_run_id is None:
            raise ValueError("consumed events must record the run that consumed them")
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


class ApprovalRecord(ArgentumModel):
    approval_id: str
    task_id: str
    run_id: str
    approval_type: ApprovalType
    risk_level: RiskLevel
    requested_action: str
    rationale: str
    constrained_options: list[str] = Field(default_factory=list)
    request_payload: dict[str, Any] = Field(default_factory=dict)
    eligible_resolver_refs: list[str] = Field(default_factory=list)
    status: ApprovalStatus
    requested_via_session_id: str | None = None
    requested_via_message_ref: str | None = None
    reminder_count: int = 0
    next_reminder_at: datetime | None = None
    expires_at: datetime | None = None
    resolved_at: datetime | None = None
    resolved_by_user_id: str | None = None
    resolved_by_session_id: str | None = None
    resolution_payload_hash: str | None = None
    decision: ApprovalDecision | None = None
    operator_comment: str | None = None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_approval_invariants(self) -> ApprovalRecord:
        if self.reminder_count < 0:
            raise ValueError("approval reminder_count must be non-negative")
        if self.status == ApprovalStatus.REMINDED and self.reminder_count < 1:
            raise ValueError("reminded approvals must have a durable reminder count")

        terminal_statuses = {
            ApprovalStatus.APPROVED,
            ApprovalStatus.DENIED,
            ApprovalStatus.EXPIRED,
            ApprovalStatus.CANCELLED,
        }
        if self.status in terminal_statuses and self.resolved_at is None:
            raise ValueError("terminal approvals must record resolved_at")

        if self.status in {ApprovalStatus.APPROVED, ApprovalStatus.DENIED, ApprovalStatus.CANCELLED}:
            if self.decision is None:
                raise ValueError("resolved approvals require a decision")
            if self.resolved_by_user_id is None:
                raise ValueError("resolved approvals must bind an operator identity")
            if self.resolution_payload_hash is None:
                raise ValueError("resolved approvals require a durable payload hash")

        if self.status == ApprovalStatus.EXPIRED and self.decision is not None:
            raise ValueError("expired approvals must not carry an operator decision")

        if self.decision is not None and self.status not in {
            ApprovalStatus.APPROVED,
            ApprovalStatus.DENIED,
            ApprovalStatus.CANCELLED,
        }:
            raise ValueError("approval decisions are only valid for operator-resolved terminal states")
        return self


class ProviderMapping(ArgentumModel):
    provider_id: str
    provider_name: str
    tiers_supported: list[ModelTier] = Field(default_factory=list)
    default_models_by_tier: dict[ModelTier, str] = Field(default_factory=dict)
    max_context_by_model: dict[str, int] = Field(default_factory=dict)
    supports_streaming: bool
    supports_structured_output: bool
    supports_reasoning_mode: bool


class OperationRoutingRule(ArgentumModel):
    operation_type: OperationType
    default_tier: ModelTier
    escalation_tier: ModelTier | None = None
    allow_downgrade: bool
    require_structured_output: bool
    latency_sensitive: bool
    high_consequence: bool
    notes: str | None = None


class TimeoutProfile(ArgentumModel):
    name: str
    operation_types: list[OperationType] = Field(default_factory=list)
    request_timeout_seconds: int
    stream_idle_timeout_seconds: int | None = None
    max_retries: int


class FallbackProfile(ArgentumModel):
    name: str
    operation_types: list[OperationType] = Field(default_factory=list)
    on_timeout: FallbackAction
    on_rate_limit: FallbackAction
    on_malformed_output: FallbackAction
    on_overflow: FallbackAction
    on_provider_unavailable: FallbackAction


class BudgetProfile(ArgentumModel):
    name: str
    operation_types: list[OperationType] = Field(default_factory=list)
    max_cost_class: CostClass
    max_input_tokens: int
    prefer_low_latency: bool


class ModelRoutingPolicy(ArgentumModel):
    policy_id: str
    version: str
    active: bool
    provider_mappings: list[ProviderMapping] = Field(default_factory=list)
    operation_mappings: list[OperationRoutingRule] = Field(default_factory=list)
    timeout_profiles: list[TimeoutProfile] = Field(default_factory=list)
    fallback_profiles: list[FallbackProfile] = Field(default_factory=list)
    budget_profiles: list[BudgetProfile] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ProviderHealthRecord(ArgentumModel):
    provider_id: str
    health_status: ProviderHealthStatus
    last_success_at: datetime | None = None
    last_timeout_at: datetime | None = None
    last_rate_limit_at: datetime | None = None
    consecutive_failures: int = 0
    degraded_until: datetime | None = None
    notes: str | None = None
    updated_at: datetime


class GeneratedToolRecord(ArgentumModel):
    tool_id: str
    tool_name: str
    version: str
    source_task_id: str
    source_artifact_ref: str
    requested_approval_id: str | None = None
    lifecycle_state: GeneratedToolLifecycleState
    activation_scope: ToolActivationScope = ToolActivationScope.NONE
    capability_summary: str
    schema_ref: str | None = None
    supersedes_tool_id: str | None = None
    superseded_by_tool_id: str | None = None
    rollback_of_tool_id: str | None = None
    quarantine_until: datetime | None = None
    activated_at: datetime | None = None
    disabled_at: datetime | None = None
    disabled_reason: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_generated_tool_invariants(self) -> GeneratedToolRecord:
        preactivation_states = {
            GeneratedToolLifecycleState.PROPOSED,
            GeneratedToolLifecycleState.VALIDATING,
            GeneratedToolLifecycleState.VERIFIED,
            GeneratedToolLifecycleState.APPROVAL_PENDING,
        }
        if self.lifecycle_state in preactivation_states and self.activation_scope != ToolActivationScope.NONE:
            raise ValueError("pre-activation generated tools must not expose an activation scope")

        if self.lifecycle_state == GeneratedToolLifecycleState.APPROVED and self.activation_scope not in {
            ToolActivationScope.NONE,
            ToolActivationScope.SHADOW,
        }:
            raise ValueError("approved tools may only remain unactivated or in shadow scope")

        state_scope_requirements = {
            GeneratedToolLifecycleState.QUARANTINED: ToolActivationScope.QUARANTINE,
            GeneratedToolLifecycleState.LIMITED: ToolActivationScope.LIMITED,
            GeneratedToolLifecycleState.GLOBAL: ToolActivationScope.GLOBAL,
        }
        required_scope = state_scope_requirements.get(self.lifecycle_state)
        if required_scope is not None and self.activation_scope != required_scope:
            raise ValueError(f"{self.lifecycle_state} tools must use activation scope {required_scope}")

        if self.activation_scope != ToolActivationScope.NONE and self.requested_approval_id is None:
            raise ValueError("activated or shadowed generated tools must retain approval linkage")

        if self.lifecycle_state in {
            GeneratedToolLifecycleState.QUARANTINED,
            GeneratedToolLifecycleState.LIMITED,
            GeneratedToolLifecycleState.GLOBAL,
        } and self.activated_at is None:
            raise ValueError("activated generated tools must record activated_at")

        if self.lifecycle_state == GeneratedToolLifecycleState.DISABLED:
            if self.disabled_at is None:
                raise ValueError("disabled generated tools must record disabled_at")
            if self.disabled_reason is None:
                raise ValueError("disabled generated tools must record a disabled_reason")

        if self.lifecycle_state == GeneratedToolLifecycleState.SUPERSEDED and self.superseded_by_tool_id is None:
            raise ValueError("superseded generated tools must record their replacement")
        return self


class ActivityRecord(ArgentumModel):
    activity_id: str
    activity_kind: ActivityKind
    task_id: str | None = None
    run_id: str | None = None
    approval_id: str | None = None
    generated_tool_id: str | None = None
    provider_id: str | None = None
    model_name: str | None = None
    summary: str
    detail: str | None = None
    fallback_from_provider_id: str | None = None
    fallback_reason: str | None = None
    token_count: int | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_activity_invariants(self) -> ActivityRecord:
        if self.activity_kind == ActivityKind.PROVIDER_ROUTING:
            if self.provider_id is None or self.model_name is None:
                raise ValueError("provider routing activity requires provider and model identity")
        if self.activity_kind == ActivityKind.GENERATED_TOOL_LIFECYCLE and self.generated_tool_id is None:
            raise ValueError("generated-tool lifecycle activity requires a generated tool reference")
        return self


class MemoryRecord(ArgentumModel):
    memory_id: str
    memory_type: MemoryType
    content: str
    summary: str | None = None
    embedding_ref: str | None = None
    source_kind: MemorySourceKind
    source_ref: str | None = None
    confidence: float | None = None
    recency_weight: float | None = None
    tags: list[str] = Field(default_factory=list)
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ArtifactRecord(ArgentumModel):
    artifact_id: str
    artifact_type: ArtifactType
    task_id: str
    run_id: str | None = None
    storage_ref: str
    description: str | None = None
    content_hash: str | None = None
    visibility: ArtifactVisibility
    retention_class: RetentionClass
    expires_at: datetime | None = None
    archived_at: datetime | None = None
    purge_after_at: datetime | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class SubagentRecord(ArgentumModel):
    subagent_id: str
    parent_task_id: str
    child_task_id: str
    role: SubagentRole
    status: SubagentStatus
    model_policy_ref: str | None = None
    delegated_objective: str
    expected_output_contract: str
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    completed_at: datetime | None = None
    failed_at: datetime | None = None
    timeout_at: datetime | None = None
    result_artifact_refs: list[str] = Field(default_factory=list)
    error_summary: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_subagent_invariants(self) -> SubagentRecord:
        if self.status == SubagentStatus.RUNNING and self.started_at is None:
            raise ValueError("running subagents must record started_at")
        if self.status == SubagentStatus.COMPLETED and self.completed_at is None:
            raise ValueError("completed subagents must record completed_at")
        if self.status == SubagentStatus.FAILED and self.failed_at is None:
            raise ValueError("failed subagents must record failed_at")
        if self.status in {SubagentStatus.TIMED_OUT, SubagentStatus.LOST} and self.timeout_at is None:
            raise ValueError("timed out or lost subagents must record timeout_at")
        return self


class FollowupRequest(ArgentumModel):
    next_followup_at: datetime
    continuation_hint: str | None = None
    stale_after_at: datetime | None = None


class SubagentDelegationDraft(ArgentumModel):
    child_task_id: str
    child_title: str
    delegated_objective: str
    expected_output_contract: str
    role: SubagentRole
    model_policy_ref: str | None = None
    child_success_criteria: list[str] = Field(default_factory=list)
    child_priority: int = 1
    blocked_reason: str | None = None
    stale_after_at: datetime | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class RuntimeFacts(ArgentumModel):
    runtime_lane: str | None = None
    current_time: datetime
    claim_lease_expires_at: datetime | None = None
    provider_health_summary: list[str] = Field(default_factory=list)


class BootstrapContext(ArgentumModel):
    soul_ref: str
    soul_content: str
    integrity_ok: bool
    content_hash: str
    integrity_notes: list[str] = Field(default_factory=list)


class TaskSnapshot(ArgentumModel):
    task_id: str
    status: TaskStatus
    objective: str
    success_criteria: list[str] = Field(default_factory=list)
    continuation_hint: str | None = None
    pending_approval_id: str | None = None
    artifact_refs: list[str] = Field(default_factory=list)


class TaskDigest(ArgentumModel):
    task_id: str
    title: str
    status: TaskStatus
    summary: str | None = None


class MemoryDigest(ArgentumModel):
    memory_id: str
    summary: str
    source_ref: str | None = None


class SessionDigest(ArgentumModel):
    session_id: str
    channel_type: ChannelType
    summary: str
    recent_task_ids: list[str] = Field(default_factory=list)


class ArtifactDigest(ArgentumModel):
    artifact_id: str
    artifact_type: str
    description: str | None = None


class ContextBudget(ArgentumModel):
    run_class: RunClass
    target_input_tokens: int
    reserved_output_tokens: int
    reserved_tool_schema_tokens: int
    max_bootstrap_tokens: int
    max_task_snapshot_tokens: int
    max_memory_digest_tokens: int
    max_open_task_digest_tokens: int
    max_recent_session_tokens: int
    max_artifact_digest_tokens: int


class ContextPacket(ArgentumModel):
    context_packet_id: str
    event_id: str
    task_id: str | None = None
    generated_at: datetime
    runtime_facts: RuntimeFacts
    bootstrap_context: BootstrapContext
    task_snapshot: TaskSnapshot | None = None
    relevant_open_tasks_digest: list[TaskDigest] = Field(default_factory=list)
    relevant_memory_digest: list[MemoryDigest] = Field(default_factory=list)
    recent_session_digest: SessionDigest | None = None
    recent_artifact_digest: list[ArtifactDigest] = Field(default_factory=list)
    approval_constraints: list[str] = Field(default_factory=list)
    token_budget: ContextBudget
    assembly_notes: list[str] = Field(default_factory=list)


class ToolResultSummary(ArgentumModel):
    tool_name: str
    outcome: str
    summary: str


class ApprovalRequestDraft(ArgentumModel):
    approval_type: ApprovalType
    risk_level: RiskLevel
    requested_action: str
    rationale: str
    constrained_options: list[str] = Field(default_factory=list)
    request_payload: dict[str, Any] = Field(default_factory=dict)
    eligible_resolver_refs: list[str] = Field(default_factory=list)
    requested_via_session_id: str | None = None
    requested_via_message_ref: str | None = None
    expires_at: datetime | None = None


class ApprovalDecisionPayload(ArgentumModel):
    approval_id: str
    decision: ApprovalDecision
    resolved_by_user_id: str
    resolved_by_session_id: str | None = None
    resolution_payload_hash: str
    operator_comment: str | None = None
    occurred_at: datetime


class ReflectionResult(ArgentumModel):
    summary: str
    needs_escalation: bool = False


class RunPlan(ArgentumModel):
    steps: list[str] = Field(default_factory=list)


class RunWorkingState(ArgentumModel):
    run_id: str
    event_id: str
    task_id: str
    claim_id: str
    current_status: RunStatus
    objective: str
    success_criteria: list[str] = Field(default_factory=list)
    context_packet: ContextPacket
    active_plan: RunPlan | None = None
    current_step: str | None = None
    recent_observations: list[str] = Field(default_factory=list)
    recent_tool_results: list[ToolResultSummary] = Field(default_factory=list)
    pending_questions: list[str] = Field(default_factory=list)
    followup_request: FollowupRequest | None = None
    approval_request: ApprovalRequestDraft | None = None
    approval_result: ApprovalDecisionPayload | None = None
    subagent_delegation: SubagentDelegationDraft | None = None
    reflection_result: ReflectionResult | None = None
    continuation_decision: ContinuationDecision | None = None
    last_error: str | None = None
    artifacts_created: list[str] = Field(default_factory=list)