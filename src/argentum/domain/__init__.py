from __future__ import annotations

"""Domain models and lifecycle helpers for Argentum."""

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
from .lifecycle import (
    ClaimLifecycleError,
    TaskLifecycleError,
    ensure_exclusive_active_claims,
    transition_claim_state,
    transition_task_status,
)
from .ingress import (
    EventIntakeDecision,
    EventIntakePolicy,
    apply_intake_decision,
    evaluate_event_intake,
)
from .models import EventRecord, SessionRecord, TaskCandidate, TaskClaimRecord, TaskRecord

__all__ = [
    "ChannelType",
    "ClaimLifecycleError",
    "ClaimReleaseReason",
    "ClaimState",
    "EventAuthStatus",
    "EventIntakeDecision",
    "EventIntakePolicy",
    "EventProcessingStatus",
    "EventRecord",
    "EventType",
    "QueueClass",
    "SessionRecord",
    "TaskCandidate",
    "TaskClaimRecord",
    "TaskLifecycleError",
    "TaskRecord",
    "TaskStatus",
    "TaskType",
    "TriggerMode",
    "apply_intake_decision",
    "ensure_exclusive_active_claims",
    "evaluate_event_intake",
    "transition_claim_state",
    "transition_task_status",
]