from __future__ import annotations

from datetime import UTC, datetime

from argentum.domain.enums import EventAuthStatus, EventProcessingStatus, EventType, QueueClass, TriggerMode
from argentum.domain.ingress import EventIntakePolicy, apply_intake_decision, evaluate_event_intake
from argentum.domain.models import EventRecord


def timestamp() -> datetime:
    return datetime(2026, 4, 20, 13, 0, tzinfo=UTC)


def build_event(**overrides: object) -> EventRecord:
    base = {
        "event_id": "event-1",
        "event_type": EventType.USER_MESSAGE,
        "trigger_mode": TriggerMode.INTERACTIVE,
        "source_surface": "slack",
        "auth_status": EventAuthStatus.AUTHENTICATED,
        "processing_status": EventProcessingStatus.RECEIVED,
        "created_at": timestamp(),
        "updated_at": timestamp(),
    }
    base.update(overrides)
    return EventRecord(**base)


def test_evaluate_event_intake_rejects_unauthenticated_event() -> None:
    decision = evaluate_event_intake(build_event(auth_status=EventAuthStatus.REJECTED_UNAUTHENTICATED))

    assert decision.processing_status == EventProcessingStatus.REJECTED_UNAUTHENTICATED
    assert decision.queue_class is None


def test_evaluate_event_intake_queues_failed_event_with_retry_time() -> None:
    decision = evaluate_event_intake(
        build_event(
            processing_status=EventProcessingStatus.FAILED,
            delivery_attempt_count=2,
            queue_class=QueueClass.RECOVERY,
        ),
        policy=EventIntakePolicy(base_retry_delay_seconds=10),
        now=timestamp(),
    )

    assert decision.processing_status == EventProcessingStatus.QUEUED
    assert decision.queue_class == QueueClass.RECOVERY
    assert decision.next_attempt_at == datetime(2026, 4, 20, 13, 0, 20, tzinfo=UTC)


def test_evaluate_event_intake_dead_letters_after_max_attempts() -> None:
    decision = evaluate_event_intake(
        build_event(processing_status=EventProcessingStatus.FAILED, delivery_attempt_count=5),
        policy=EventIntakePolicy(max_delivery_attempts=5),
        now=timestamp(),
    )

    assert decision.processing_status == EventProcessingStatus.DEAD_LETTERED
    assert decision.dead_letter_reason == "max_delivery_attempts_exceeded"


def test_apply_intake_decision_increments_attempts_for_retry_queue() -> None:
    event = build_event(processing_status=EventProcessingStatus.FAILED, delivery_attempt_count=1)
    decision = evaluate_event_intake(event, now=timestamp())
    updated = apply_intake_decision(event, decision, queue_owner="worker-a", now=timestamp())

    assert updated.processing_status == EventProcessingStatus.QUEUED
    assert updated.delivery_attempt_count == 2
    assert updated.queue_owner == "worker-a"


def test_evaluate_event_intake_prioritizes_approval_events() -> None:
    decision = evaluate_event_intake(
        build_event(event_type=EventType.APPROVAL_RESPONSE, queue_class=QueueClass.APPROVAL),
        policy=EventIntakePolicy(interactive_inline_enabled=False),
        now=timestamp(),
    )

    assert decision.queue_class == QueueClass.APPROVAL
    assert decision.queue_priority == 90


def test_evaluate_event_intake_keeps_inline_events_unconsumed_until_run_exists() -> None:
    event = build_event()

    decision = evaluate_event_intake(
        event,
        policy=EventIntakePolicy(interactive_inline_enabled=True),
        now=timestamp(),
    )
    updated = apply_intake_decision(event, decision, now=timestamp())

    assert decision.inline_execution is True
    assert decision.processing_status == EventProcessingStatus.RECEIVED
    assert updated.processing_status == EventProcessingStatus.RECEIVED
    assert updated.consumed_by_run_id is None