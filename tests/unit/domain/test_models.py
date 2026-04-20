from __future__ import annotations

from datetime import UTC, datetime

import pytest

from argentum.domain.enums import (
    ChannelType,
    ClaimState,
    EventAuthStatus,
    EventProcessingStatus,
    EventType,
    QueueClass,
    TaskStatus,
    TaskType,
    TriggerMode,
)
from argentum.domain.models import EventRecord, SessionRecord, TaskClaimRecord, TaskRecord


def timestamp() -> datetime:
    return datetime(2026, 4, 20, 12, 0, tzinfo=UTC)


def test_task_record_rejects_pending_approval_for_non_hold_state() -> None:
    with pytest.raises(ValueError, match="pending approvals"):
        TaskRecord(
            task_id="task-1",
            title="Example",
            objective="Build a durable task",
            normalized_objective="build a durable task",
            task_type=TaskType.EXECUTION_TASK,
            status=TaskStatus.SCHEDULED,
            priority=1,
            created_by_event_id="event-1",
            pending_approval_id="approval-1",
            created_at=timestamp(),
            updated_at=timestamp(),
        )


def test_task_record_rejects_terminal_task_with_active_run() -> None:
    with pytest.raises(ValueError, match="terminal tasks"):
        TaskRecord(
            task_id="task-1",
            title="Example",
            objective="Finish a task",
            normalized_objective="finish a task",
            task_type=TaskType.EXECUTION_TASK,
            status=TaskStatus.COMPLETED,
            priority=1,
            created_by_event_id="event-1",
            active_run_id="run-1",
            completed_at=timestamp(),
            created_at=timestamp(),
            updated_at=timestamp(),
        )


def test_event_record_rejects_rejected_event_with_queue_class() -> None:
    with pytest.raises(ValueError, match="rejected events"):
        EventRecord(
            event_id="event-1",
            event_type=EventType.USER_MESSAGE,
            trigger_mode=TriggerMode.INTERACTIVE,
            source_surface="slack",
            auth_status=EventAuthStatus.REJECTED_UNAUTHENTICATED,
            queue_class=QueueClass.INTERACTIVE,
            processing_status=EventProcessingStatus.REJECTED_UNAUTHENTICATED,
            created_at=timestamp(),
            updated_at=timestamp(),
        )


def test_session_record_allows_minimal_phase1_shape() -> None:
    session = SessionRecord(
        session_id="session-1",
        session_key="slack:thread:1",
        channel_type=ChannelType.SLACK_DM,
        channel_id="channel-1",
        latest_activity_at=timestamp(),
        created_at=timestamp(),
        updated_at=timestamp(),
    )

    assert session.channel_type == ChannelType.SLACK_DM


def test_claim_record_requires_release_metadata_for_released_state() -> None:
    with pytest.raises(ValueError, match="released claims"):
        TaskClaimRecord(
            claim_id="claim-1",
            task_id="task-1",
            run_id="run-1",
            claimed_by="runtime-a",
            claim_state=ClaimState.RELEASED,
            claimed_at=timestamp(),
            lease_expires_at=timestamp(),
            created_at=timestamp(),
            updated_at=timestamp(),
        )