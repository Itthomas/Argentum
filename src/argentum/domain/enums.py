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