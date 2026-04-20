from __future__ import annotations

from enum import StrEnum


class EventType(StrEnum):
    USER_MESSAGE = "user_message"
    APPROVAL_RESPONSE = "approval_response"
    HEARTBEAT_TICK = "heartbeat_tick"
    CRON_TRIGGER = "cron_trigger"
    WEBHOOK_TRIGGER = "webhook_trigger"
    SYSTEM_FOLLOWUP = "system_followup"
    TASK_RESUME_REQUEST = "task_resume_request"
    CHILD_COMPLETION = "child_completion"
    CHILD_FAILURE = "child_failure"


class TriggerMode(StrEnum):
    INTERACTIVE = "interactive"
    SCHEDULED = "scheduled"
    AUTONOMOUS = "autonomous"
    APPROVAL_RESUME = "approval_resume"
    RECOVERY = "recovery"


class EventProcessingStatus(StrEnum):
    RECEIVED = "received"
    REJECTED_UNAUTHENTICATED = "rejected_unauthenticated"
    REJECTED_UNAUTHORIZED = "rejected_unauthorized"
    DEDUPLICATED = "deduplicated"
    QUEUED = "queued"
    CONSUMED = "consumed"
    IGNORED = "ignored"
    FAILED = "failed"
    DEAD_LETTERED = "dead_lettered"


class EventAuthStatus(StrEnum):
    NOT_APPLICABLE = "not_applicable"
    PENDING = "pending"
    AUTHENTICATED = "authenticated"
    REJECTED_UNAUTHENTICATED = "rejected_unauthenticated"
    REJECTED_UNAUTHORIZED = "rejected_unauthorized"


class QueueClass(StrEnum):
    INTERACTIVE = "interactive"
    APPROVAL = "approval"
    SCHEDULED = "scheduled"
    RECOVERY = "recovery"
    MAINTENANCE = "maintenance"


class ChannelType(StrEnum):
    SLACK_DM = "slack_dm"
    SLACK_CHANNEL = "slack_channel"
    WEBHOOK = "webhook"
    INTERNAL = "internal"
    SCHEDULED = "scheduled"


class TaskType(StrEnum):
    CONVERSATION_TASK = "conversation_task"
    RESEARCH_TASK = "research_task"
    EXECUTION_TASK = "execution_task"
    MAINTENANCE_TASK = "maintenance_task"
    FOLLOWUP_TASK = "followup_task"
    CHILD_TASK = "child_task"
    TOOL_AUTHORING_TASK = "tool_authoring_task"
    APPROVAL_TASK = "approval_task"


class TaskStatus(StrEnum):
    PROPOSED = "proposed"
    ACTIVE = "active"
    WAITING_HUMAN = "waiting_human"
    BLOCKED = "blocked"
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    FAILED = "failed"
    ABANDONED = "abandoned"
    STALLED = "stalled"
    BLOCKED_TIMEOUT = "blocked_timeout"
    FAILED_TIMEOUT = "failed_timeout"
    EXPIRED = "expired"
    NEEDS_OPERATOR_ATTENTION = "needs_operator_attention"


class ClaimState(StrEnum):
    ACTIVE = "active"
    RELEASED = "released"
    EXPIRED = "expired"
    SUPERSEDED = "superseded"
    INVALIDATED = "invalidated"


class ClaimReleaseReason(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    ABANDONED = "abandoned"
    LEASE_EXPIRED = "lease_expired"
    RUNTIME_SHUTDOWN = "runtime_shutdown"
    RECOVERY_RECLAIMED = "recovery_reclaimed"
    OPERATOR_CANCELLED = "operator_cancelled"


class ApprovalType(StrEnum):
    TOOL_ACTIVATION = "tool_activation"
    DESTRUCTIVE_ACTION = "destructive_action"
    PRIVILEGED_EXECUTION = "privileged_execution"
    EXTERNAL_SIDE_EFFECT = "external_side_effect"
    POLICY_EXCEPTION = "policy_exception"


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    REMINDED = "reminded"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ApprovalDecision(StrEnum):
    APPROVE = "approve"
    DENY = "deny"
    CANCEL = "cancel"


class RunStatus(StrEnum):
    INITIALIZING = "initializing"
    EXECUTING = "executing"
    WAITING_APPROVAL = "waiting_approval"
    DELEGATING = "delegating"
    COMMITTING = "committing"
    COMPLETED = "completed"
    FAILED = "failed"


class ContinuationDecision(StrEnum):
    CONTINUE_NOW = "continue_now"
    PAUSE_WAITING_HUMAN = "pause_waiting_human"
    SCHEDULE_FOLLOWUP = "schedule_followup"
    COMPLETE = "complete"
    FAIL = "fail"
    DELEGATE = "delegate"


class RunClass(StrEnum):
    INGRESS_TRIAGE = "ingress_triage"
    STANDARD_RUNTIME = "standard_runtime"
    DEEP_PLANNING = "deep_planning"
    APPROVAL_REASONING = "approval_reasoning"
    TOOL_AUTHORING = "tool_authoring"
    HEARTBEAT_MAINTENANCE = "heartbeat_maintenance"
    SUBAGENT_EXECUTION = "subagent_execution"


class ModelTier(StrEnum):
    UTILITY = "utility"
    STANDARD = "standard"
    DEEP_REASONING = "deep_reasoning"
    CRITICAL = "critical"


class OperationType(StrEnum):
    INGRESS_NORMALIZATION = "ingress_normalization"
    TASK_RESOLUTION_SUPPORT = "task_resolution_support"
    CONTEXT_COMPRESSION = "context_compression"
    STANDARD_RUNTIME_TURN = "standard_runtime_turn"
    DEEP_PLANNING = "deep_planning"
    APPROVAL_REASONING = "approval_reasoning"
    TOOL_AUTHORING = "tool_authoring"
    TOOL_VERIFICATION = "tool_verification"
    HEARTBEAT_MAINTENANCE = "heartbeat_maintenance"
    SUBAGENT_ANALYSIS = "subagent_analysis"
    SUBAGENT_EXECUTION = "subagent_execution"
    CONFLICT_RESOLUTION = "conflict_resolution"


class FallbackAction(StrEnum):
    RETRY_SAME_PROVIDER = "retry_same_provider"
    RETRY_OTHER_PROVIDER_SAME_TIER = "retry_other_provider_same_tier"
    DOWNGRADE_TIER = "downgrade_tier"
    ESCALATE_TIER = "escalate_tier"
    REASSEMBLE_CONTEXT_AND_RETRY = "reassemble_context_and_retry"
    FAIL_OPERATOR_VISIBLE = "fail_operator_visible"
    QUEUE_FOR_RETRY = "queue_for_retry"


class CostClass(StrEnum):
    MINIMAL = "minimal"
    NORMAL = "normal"
    ELEVATED = "elevated"
    CRITICAL = "critical"


class ProviderHealthStatus(StrEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"