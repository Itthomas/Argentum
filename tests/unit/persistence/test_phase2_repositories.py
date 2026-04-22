from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from argentum.domain import (
    ApprovalDecision,
    ApprovalDecisionPayload,
    ApprovalLifecycleError,
    ApprovalRecord,
    ApprovalStatus,
    ApprovalType,
    EventAuthStatus,
    EventRecord,
    EventType,
    RiskLevel,
    TaskRecord,
    TaskStatus,
    TaskType,
    TriggerMode,
)
from argentum.persistence.base import Base
from argentum.persistence.repositories import ApprovalRepository, EventRepository
from argentum.persistence.session import create_session_factory, create_sqlalchemy_engine
from argentum.persistence.tables import TaskTable


def timestamp() -> datetime:
    return datetime(2026, 4, 20, 16, 0, tzinfo=UTC)


@pytest.fixture()
def session() -> Session:
    engine = create_sqlalchemy_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory() as current_session:
        EventRepository(current_session).record_event(
            EventRecord(
                event_id="event-1",
                event_type=EventType.USER_MESSAGE,
                trigger_mode=TriggerMode.INTERACTIVE,
                source_surface="slack",
                auth_status=EventAuthStatus.AUTHENTICATED,
                created_at=timestamp(),
                updated_at=timestamp(),
            )
        )
        current_session.add(
            TaskTable(
                task_id="task-1",
                title="Approval task",
                objective="Request approval before acting",
                normalized_objective="request approval before acting",
                task_type=TaskType.EXECUTION_TASK,
                status=TaskStatus.PROPOSED,
                priority=1,
                created_by_event_id="event-1",
                origin_session_ids=[],
                origin_thread_refs=[],
                child_task_ids=[],
                success_criteria=[],
                artifact_refs=[],
                related_memory_refs=[],
                metadata_json={},
                created_at=timestamp(),
                updated_at=timestamp(),
            )
        )
        current_session.commit()
        yield current_session


def test_approval_repository_records_reminders_and_idempotent_resolution(session: Session) -> None:
    repository = ApprovalRepository(session)

    created = repository.create_approval(
        ApprovalRecord(
            approval_id="approval-1",
            task_id="task-1",
            run_id="run-1",
            approval_type=ApprovalType.DESTRUCTIVE_ACTION,
            risk_level=RiskLevel.HIGH,
            requested_action="Delete a deployment file",
            rationale="The task requires a destructive filesystem operation.",
            constrained_options=["approve", "deny", "cancel"],
            request_payload={"path": "/srv/argentum/config/bootstrap/SOUL.md"},
            eligible_resolver_refs=["operator:isaac"],
            status=ApprovalStatus.PENDING,
            created_at=timestamp(),
            updated_at=timestamp(),
        )
    )

    reminded = repository.record_reminder(
        "approval-1",
        next_reminder_at=timestamp(),
        now=timestamp(),
    )
    assert created.status == ApprovalStatus.PENDING
    assert reminded.status == ApprovalStatus.REMINDED
    assert reminded.reminder_count == 1

    payload = ApprovalDecisionPayload(
        approval_id="approval-1",
        decision=ApprovalDecision.APPROVE,
        resolved_by_user_id="operator:isaac",
        resolved_by_session_id=None,
        resolution_payload_hash="hash-1",
        operator_comment="Approved for the test path.",
        occurred_at=timestamp(),
    )
    first_resolution = repository.resolve_approval(payload)
    second_resolution = repository.resolve_approval(payload)

    assert first_resolution.status == ApprovalStatus.APPROVED
    assert second_resolution.approval_id == first_resolution.approval_id
    assert second_resolution.status == first_resolution.status
    assert second_resolution.decision == first_resolution.decision
    assert second_resolution.resolution_payload_hash == first_resolution.resolution_payload_hash

    with pytest.raises(ApprovalLifecycleError, match="already resolved"):
        repository.resolve_approval(payload.model_copy(update={"resolution_payload_hash": "hash-2"}))

    with pytest.raises(ApprovalLifecycleError, match="already resolved"):
        repository.resolve_approval(payload.model_copy(update={"resolved_by_user_id": "operator:other"}))