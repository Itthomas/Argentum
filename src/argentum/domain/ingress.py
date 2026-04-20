from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .enums import EventAuthStatus, EventProcessingStatus, EventType, QueueClass, TriggerMode
from .models import EventRecord

INLINE_EVENT_TYPES = frozenset({EventType.USER_MESSAGE, EventType.APPROVAL_RESPONSE})
QUEUE_PRIORITIES: dict[QueueClass, int] = {
    QueueClass.INTERACTIVE: 100,
    QueueClass.APPROVAL: 90,
    QueueClass.RECOVERY: 80,
    QueueClass.SCHEDULED: 70,
    QueueClass.MAINTENANCE: 50,
}


@dataclass(slots=True, frozen=True)
class EventIntakePolicy:
    max_delivery_attempts: int = 5
    base_retry_delay_seconds: int = 30
    interactive_inline_enabled: bool = True


@dataclass(slots=True, frozen=True)
class EventIntakeDecision:
    processing_status: EventProcessingStatus
    queue_class: QueueClass | None
    queue_priority: int | None
    queued_at: datetime | None
    next_attempt_at: datetime | None
    dead_letter_reason: str | None
    inline_execution: bool


def _now_or(value: datetime | None) -> datetime:
    return value or datetime.now(tz=UTC)


def _default_queue_class(event: EventRecord) -> QueueClass:
    if event.event_type == EventType.APPROVAL_RESPONSE:
        return QueueClass.APPROVAL
    if event.trigger_mode == TriggerMode.SCHEDULED:
        return QueueClass.SCHEDULED
    if event.trigger_mode == TriggerMode.RECOVERY:
        return QueueClass.RECOVERY
    return QueueClass.INTERACTIVE


def evaluate_event_intake(
    event: EventRecord,
    *,
    policy: EventIntakePolicy | None = None,
    now: datetime | None = None,
) -> EventIntakeDecision:
    resolved_policy = policy or EventIntakePolicy()
    current_time = _now_or(now)

    if event.auth_status == EventAuthStatus.REJECTED_UNAUTHENTICATED:
        return EventIntakeDecision(
            processing_status=EventProcessingStatus.REJECTED_UNAUTHENTICATED,
            queue_class=None,
            queue_priority=None,
            queued_at=None,
            next_attempt_at=None,
            dead_letter_reason=None,
            inline_execution=False,
        )
    if event.auth_status == EventAuthStatus.REJECTED_UNAUTHORIZED:
        return EventIntakeDecision(
            processing_status=EventProcessingStatus.REJECTED_UNAUTHORIZED,
            queue_class=None,
            queue_priority=None,
            queued_at=None,
            next_attempt_at=None,
            dead_letter_reason=None,
            inline_execution=False,
        )

    queue_class = event.queue_class or _default_queue_class(event)
    queue_priority = event.queue_priority or QUEUE_PRIORITIES[queue_class]

    if event.processing_status == EventProcessingStatus.FAILED:
        if event.delivery_attempt_count >= resolved_policy.max_delivery_attempts:
            return EventIntakeDecision(
                processing_status=EventProcessingStatus.DEAD_LETTERED,
                queue_class=queue_class,
                queue_priority=queue_priority,
                queued_at=event.queued_at,
                next_attempt_at=None,
                dead_letter_reason=event.dead_letter_reason or "max_delivery_attempts_exceeded",
                inline_execution=False,
            )

        retry_delay = timedelta(seconds=resolved_policy.base_retry_delay_seconds * max(event.delivery_attempt_count, 1))
        return EventIntakeDecision(
            processing_status=EventProcessingStatus.QUEUED,
            queue_class=queue_class,
            queue_priority=queue_priority,
            queued_at=event.queued_at or current_time,
            next_attempt_at=current_time + retry_delay,
            dead_letter_reason=None,
            inline_execution=False,
        )

    if (
        resolved_policy.interactive_inline_enabled
        and event.event_type in INLINE_EVENT_TYPES
        and queue_class in {QueueClass.INTERACTIVE, QueueClass.APPROVAL}
        and event.processing_status == EventProcessingStatus.RECEIVED
    ):
        return EventIntakeDecision(
            processing_status=EventProcessingStatus.CONSUMED,
            queue_class=queue_class,
            queue_priority=queue_priority,
            queued_at=None,
            next_attempt_at=None,
            dead_letter_reason=None,
            inline_execution=True,
        )

    return EventIntakeDecision(
        processing_status=EventProcessingStatus.QUEUED,
        queue_class=queue_class,
        queue_priority=queue_priority,
        queued_at=event.queued_at or current_time,
        next_attempt_at=event.next_attempt_at,
        dead_letter_reason=None,
        inline_execution=False,
    )


def apply_intake_decision(
    event: EventRecord,
    decision: EventIntakeDecision,
    *,
    queue_owner: str | None = None,
    now: datetime | None = None,
) -> EventRecord:
    current_time = _now_or(now)
    updated_delivery_attempt_count = event.delivery_attempt_count
    if event.processing_status == EventProcessingStatus.FAILED and decision.processing_status == EventProcessingStatus.QUEUED:
        updated_delivery_attempt_count += 1

    return event.model_copy(
        update={
            "processing_status": decision.processing_status,
            "queue_class": decision.queue_class,
            "queue_priority": decision.queue_priority,
            "queue_owner": queue_owner,
            "queued_at": decision.queued_at,
            "next_attempt_at": decision.next_attempt_at,
            "dead_letter_reason": decision.dead_letter_reason,
            "delivery_attempt_count": updated_delivery_attempt_count,
            "updated_at": current_time,
        }
    )