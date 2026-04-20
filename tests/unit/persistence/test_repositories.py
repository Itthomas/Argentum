from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from argentum.domain.enums import ClaimState, EventAuthStatus, EventProcessingStatus, EventType, TaskStatus, TaskType, TriggerMode
from argentum.persistence.base import Base
from argentum.persistence.repositories import ClaimAcquisitionRequest, ClaimRepository, EventRepository
from argentum.persistence.session import create_session_factory, create_sqlalchemy_engine
from argentum.persistence.tables import EventTable, TaskClaimTable, TaskTable


def timestamp() -> datetime:
    return datetime(2026, 4, 20, 14, 0, tzinfo=UTC)


@pytest.fixture()
def session() -> Session:
    engine = create_sqlalchemy_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory() as current_session:
        current_session.add(
            EventTable(
                event_id="event-1",
                event_type=EventType.USER_MESSAGE,
                trigger_mode=TriggerMode.INTERACTIVE,
                source_surface="slack",
                auth_status=EventAuthStatus.AUTHENTICATED,
                attachment_refs=[],
                explicit_task_refs=[],
                inferred_task_candidates=[],
                delivery_attempt_count=0,
                processing_status=EventProcessingStatus.RECEIVED,
                created_at=timestamp(),
                updated_at=timestamp(),
            )
        )
        current_session.add(
            TaskTable(
                task_id="task-1",
                title="Task",
                objective="Do work",
                normalized_objective="do work",
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


def test_claim_repository_acquires_claim_and_activates_task(session: Session) -> None:
    repository = ClaimRepository(session)

    claim = repository.acquire_claim(
        ClaimAcquisitionRequest(
            task_id="task-1",
            claim_id="claim-1",
            run_id="run-1",
            claimed_by="runtime-a",
            claim_duration=timedelta(minutes=5),
            claimed_at=timestamp(),
        )
    )
    session.commit()

    persisted_task = session.get(TaskTable, "task-1")
    assert claim.claim_state == ClaimState.ACTIVE
    assert persisted_task is not None
    assert persisted_task.status == TaskStatus.ACTIVE
    assert persisted_task.active_run_id == "run-1"


def test_claim_repository_rejects_second_active_claim(session: Session) -> None:
    repository = ClaimRepository(session)
    repository.acquire_claim(
        ClaimAcquisitionRequest(
            task_id="task-1",
            claim_id="claim-1",
            run_id="run-1",
            claimed_by="runtime-a",
            claim_duration=timedelta(minutes=5),
            claimed_at=timestamp(),
        )
    )
    session.commit()

    with pytest.raises(ValueError, match="already has an active claim"):
        repository.acquire_claim(
            ClaimAcquisitionRequest(
                task_id="task-1",
                claim_id="claim-2",
                run_id="run-2",
                claimed_by="runtime-b",
                claim_duration=timedelta(minutes=5),
                claimed_at=timestamp(),
            )
        )


def test_event_repository_marks_event_consumed(session: Session) -> None:
    repository = EventRepository(session)

    repository.mark_event_consumed("event-1", consumed_by_run_id="run-1", now=timestamp())
    session.commit()

    persisted_event = session.get(EventTable, "event-1")
    assert persisted_event is not None
    assert persisted_event.processing_status == EventProcessingStatus.CONSUMED
    assert persisted_event.consumed_by_run_id == "run-1"