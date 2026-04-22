from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from argentum.domain import (
    EventAuthStatus,
    EventRecord,
    EventType,
    MemoryRecord,
    MemorySourceKind,
    MemoryType,
    SubagentRecord,
    SubagentRole,
    SubagentStatus,
    TaskRecord,
    TaskStatus,
    TaskType,
    TriggerMode,
)
from argentum.persistence.base import Base
from argentum.persistence.repositories import EventRepository, MemoryRepository, MemorySearchRequest, SubagentRepository
from argentum.persistence.session import create_session_factory, create_sqlalchemy_engine
from argentum.persistence.tables import TaskTable


def timestamp() -> datetime:
    return datetime(2026, 4, 21, 11, 0, tzinfo=UTC)


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
                task_id="parent-task",
                title="Parent task",
                objective="Coordinate delegated work",
                normalized_objective="coordinate delegated work",
                task_type=TaskType.EXECUTION_TASK,
                status=TaskStatus.ACTIVE,
                priority=1,
                created_by_event_id="event-1",
                origin_session_ids=[],
                origin_thread_refs=[],
                child_task_ids=[],
                success_criteria=["Handle child results durably."],
                artifact_refs=[],
                related_memory_refs=[],
                active_run_id="parent-run",
                metadata_json={},
                created_at=timestamp(),
                updated_at=timestamp(),
            )
        )
        current_session.commit()
        yield current_session


def build_child_task(child_task_id: str = "child-task") -> TaskRecord:
    return TaskRecord(
        task_id=child_task_id,
        title="Child task",
        objective="Research the deployment issue",
        normalized_objective="research the deployment issue",
        task_type=TaskType.CHILD_TASK,
        status=TaskStatus.PROPOSED,
        priority=1,
        created_by_event_id="event-1",
        parent_task_id="parent-task",
        success_criteria=["Return a bounded answer."],
        metadata_json={},
        created_at=timestamp(),
        updated_at=timestamp(),
    )


def build_subagent(status: SubagentStatus = SubagentStatus.PROPOSED) -> SubagentRecord:
    return SubagentRecord(
        subagent_id="subagent-1",
        parent_task_id="parent-task",
        child_task_id="child-task",
        role=SubagentRole.RESEARCH,
        status=status,
        delegated_objective="Research the deployment issue",
        expected_output_contract="Return a concise report",
        created_at=timestamp(),
        updated_at=timestamp(),
    )


def test_memory_repository_filters_and_ranks_memories(session: Session) -> None:
    repository = MemoryRepository(session)
    repository.upsert_memory(
        MemoryRecord(
            memory_id="memory-1",
            memory_type=MemoryType.PROJECT_KNOWLEDGE,
            content="Deployment bootstrap policy for agent runtime safety.",
            summary="Bootstrap deployment policy",
            source_kind=MemorySourceKind.SYSTEM,
            source_ref="spec:deployment",
            confidence=0.8,
            recency_weight=0.7,
            tags=["deployment", "bootstrap"],
            created_at=timestamp(),
            updated_at=timestamp(),
        )
    )
    repository.upsert_memory(
        MemoryRecord(
            memory_id="memory-2",
            memory_type=MemoryType.PROJECT_KNOWLEDGE,
            content="General planning guidance.",
            summary="Planning guidance",
            source_kind=MemorySourceKind.SYSTEM,
            source_ref="spec:planning",
            confidence=0.5,
            recency_weight=0.2,
            tags=["planning"],
            created_at=timestamp(),
            updated_at=timestamp() + timedelta(minutes=1),
        )
    )
    repository.upsert_memory(
        MemoryRecord(
            memory_id="memory-3",
            memory_type=MemoryType.USER_PROFILE,
            content="Operator preference for concise status notes.",
            summary="Operator preference",
            source_kind=MemorySourceKind.OPERATOR,
            source_ref="operator:isaac",
            confidence=0.9,
            recency_weight=0.9,
            tags=["preference"],
            created_at=timestamp(),
            updated_at=timestamp(),
        )
    )

    results = repository.search_memories(
        request=MemorySearchRequest(
            query_text="deployment bootstrap policy",
            memory_types=[MemoryType.PROJECT_KNOWLEDGE],
            source_kind=MemorySourceKind.SYSTEM,
            limit=5,
        )
    )

    assert [record.memory_id for record in results] == ["memory-1"]


@pytest.mark.parametrize(
    ("subagent_status", "parent_status"),
    [
        (SubagentStatus.COMPLETED, TaskStatus.SCHEDULED),
        (SubagentStatus.FAILED, TaskStatus.NEEDS_OPERATOR_ATTENTION),
        (SubagentStatus.TIMED_OUT, TaskStatus.BLOCKED_TIMEOUT),
        (SubagentStatus.LOST, TaskStatus.NEEDS_OPERATOR_ATTENTION),
    ],
)
def test_subagent_repository_applies_parent_child_outcomes(
    session: Session,
    subagent_status: SubagentStatus,
    parent_status: TaskStatus,
) -> None:
    repository = SubagentRepository(session)
    repository.begin_delegation(
        parent_task_id="parent-task",
        claim_id=None,
        child_task=build_child_task(),
        subagent=build_subagent(),
        now=timestamp(),
        blocked_reason="waiting on delegated child task",
        stale_after_at=timestamp() + timedelta(hours=2),
    )
    repository.mark_running("subagent-1", now=timestamp() + timedelta(minutes=1))
    session.commit()

    updated_subagent, updated_parent = repository.apply_child_outcome(
        subagent_id="subagent-1",
        new_status=subagent_status,
        now=timestamp() + timedelta(minutes=5),
        parent_status=parent_status,
        parent_blocked_reason=None if parent_status == TaskStatus.SCHEDULED else "child execution requires operator review",
        parent_continuation_hint="resume after child result" if parent_status == TaskStatus.SCHEDULED else None,
        parent_next_followup_at=timestamp() + timedelta(minutes=10) if parent_status == TaskStatus.SCHEDULED else None,
        parent_stale_after_at=timestamp() + timedelta(hours=1),
        result_artifact_refs=["artifact-1"] if subagent_status == SubagentStatus.COMPLETED else None,
        error_summary="child execution failed" if subagent_status != SubagentStatus.COMPLETED else None,
    )
    session.commit()

    assert updated_subagent.status == subagent_status
    assert updated_parent.status == parent_status
    if subagent_status == SubagentStatus.COMPLETED:
        assert updated_subagent.result_artifact_refs == ["artifact-1"]
        assert updated_parent.next_followup_at is not None
    else:
        assert updated_subagent.error_summary == "child execution failed"