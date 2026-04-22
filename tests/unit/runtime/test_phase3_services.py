from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from argentum.domain import (
    EventAuthStatus,
    EventRecord,
    EventType,
    FollowupRequest,
    MemoryRecord,
    MemorySourceKind,
    MemoryType,
    SubagentDelegationDraft,
    SubagentRole,
    TaskRecord,
    TaskStatus,
    TaskType,
    TriggerMode,
)
from argentum.persistence.base import Base
from argentum.persistence.repositories import (
    ApprovalRepository,
    ClaimAcquisitionRequest,
    ClaimRepository,
    EventRepository,
    MaintenanceRepository,
    MemoryRepository,
    SubagentRepository,
)
from argentum.persistence.session import create_session_factory, create_sqlalchemy_engine
from argentum.persistence.tables import TaskClaimTable, TaskTable, SubagentTable
from argentum.runtime import (
    BootstrapIdentitySource,
    ContextAssembler,
    HeartbeatMaintenanceService,
    LLMOrchestrator,
    RuntimeExecutionRequest,
    RuntimeTurnResult,
    StaleWorkPolicy,
    TaskRuntime,
    build_default_routing_policy,
)


def timestamp() -> datetime:
    return datetime(2026, 4, 21, 12, 0, tzinfo=UTC)


def build_event(event_id: str = "event-1", event_type: EventType = EventType.USER_MESSAGE) -> EventRecord:
    return EventRecord(
        event_id=event_id,
        event_type=event_type,
        trigger_mode=TriggerMode.INTERACTIVE,
        source_surface="slack",
        auth_status=EventAuthStatus.AUTHENTICATED,
        created_at=timestamp(),
        updated_at=timestamp(),
    )


def build_task(task_id: str = "task-1", status: TaskStatus = TaskStatus.PROPOSED) -> TaskRecord:
    return TaskRecord(
        task_id=task_id,
        title="Phase 3 task",
        objective="Coordinate runtime continuation safely.",
        normalized_objective="coordinate runtime continuation safely",
        task_type=TaskType.EXECUTION_TASK,
        status=status,
        priority=1,
        created_by_event_id="event-1",
        success_criteria=["Persist follow-up or delegation durably."],
        metadata_json={},
        created_at=timestamp(),
        updated_at=timestamp(),
    )


class FakeGateway:
    def __init__(self, responses: list[RuntimeTurnResult]) -> None:
        self._responses = responses
        self.calls = 0

    async def invoke(self, selection, prompt: str, *, structured_output_schema=None):
        self.calls += 1
        return self._responses.pop(0)


@pytest.fixture()
def session(tmp_path_factory: pytest.TempPathFactory) -> Session:
    database_path = tmp_path_factory.mktemp("phase3-runtime-db") / "runtime.sqlite3"
    engine = create_sqlalchemy_engine(
        f"sqlite+pysqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory() as current_session:
        EventRepository(current_session).record_event(build_event())
        task = build_task()
        current_session.add(
            TaskTable(
                task_id=task.task_id,
                title=task.title,
                objective=task.objective,
                normalized_objective=task.normalized_objective,
                task_type=task.task_type,
                status=task.status,
                priority=task.priority,
                created_by_event_id=task.created_by_event_id,
                origin_session_ids=[],
                origin_thread_refs=[],
                child_task_ids=[],
                success_criteria=task.success_criteria,
                artifact_refs=[],
                related_memory_refs=[],
                metadata_json={},
                created_at=task.created_at,
                updated_at=task.updated_at,
            )
        )
        current_session.commit()
        yield current_session


def build_runtime(tmp_path: Path, session: Session, gateway: FakeGateway) -> TaskRuntime:
    soul_path = tmp_path / "SOUL.md"
    soul_path.write_text("identity " * 120, encoding="utf-8")
    policy = build_default_routing_policy(timestamp())
    return TaskRuntime(
        context_assembler=ContextAssembler(BootstrapIdentitySource(soul_path=soul_path)),
        orchestrator=LLMOrchestrator(gateway=gateway, policy=policy),
        claim_repository=ClaimRepository(session),
        approval_repository=ApprovalRepository(session),
        routing_policy=policy,
        subagent_repository=SubagentRepository(session),
    )


def acquire_claim(session: Session, *, claim_id: str, run_id: str) -> None:
    ClaimRepository(session).acquire_claim(
        ClaimAcquisitionRequest(
            task_id="task-1",
            claim_id=claim_id,
            run_id=run_id,
            claimed_by="runtime-a",
            claim_duration=timedelta(minutes=5),
            claimed_at=timestamp(),
        )
    )
    session.commit()


def test_heartbeat_service_inspects_due_work_and_related_memories(session: Session) -> None:
    memory_repository = MemoryRepository(session)
    memory_repository.upsert_memory(
        MemoryRecord(
            memory_id="memory-1",
            memory_type=MemoryType.FOLLOWUP_COMMITMENT,
            content="Follow up on deployment bootstrap health.",
            summary="Deployment follow-up",
            source_kind=MemorySourceKind.TASK,
            source_ref="task-1",
            confidence=0.8,
            recency_weight=0.9,
            tags=["deployment", "followup"],
            created_at=timestamp(),
            updated_at=timestamp(),
        )
    )

    session.execute(
        TaskTable.__table__.update().where(TaskTable.task_id == "task-1").values(
            status=TaskStatus.SCHEDULED,
            next_followup_at=timestamp() - timedelta(minutes=1),
            stale_after_at=timestamp() + timedelta(hours=1),
            updated_at=timestamp(),
        )
    )
    session.commit()

    service = HeartbeatMaintenanceService(
        maintenance_repository=MaintenanceRepository(session),
        claim_repository=ClaimRepository(session),
        memory_repository=memory_repository,
    )
    inspection = service.inspect(now=timestamp(), memory_query="deployment followup")

    assert [task.task_id for task in inspection.due_followups] == ["task-1"]
    assert [memory.memory_id for memory in inspection.related_memories] == ["memory-1"]


def test_heartbeat_service_applies_stale_recovery_policy(session: Session) -> None:
    acquire_claim(session, claim_id="claim-1", run_id="run-1")
    session.execute(
        TaskTable.__table__.update().where(TaskTable.task_id == "task-1").values(
            stale_after_at=timestamp() - timedelta(minutes=1),
            updated_at=timestamp(),
        )
    )
    session.execute(
        TaskClaimTable.__table__.update().where(TaskClaimTable.claim_id == "claim-1").values(
            lease_expires_at=timestamp() - timedelta(minutes=1),
            updated_at=timestamp(),
        )
    )
    session.commit()

    service = HeartbeatMaintenanceService(
        maintenance_repository=MaintenanceRepository(session),
        claim_repository=ClaimRepository(session),
        memory_repository=MemoryRepository(session),
    )
    result = service.apply_recovery(now=timestamp(), policy=StaleWorkPolicy())
    session.commit()

    task = session.get(TaskTable, "task-1")
    claim = session.get(TaskClaimTable, "claim-1")
    assert len(result.expired_claims) == 1
    assert task is not None
    assert task.status == TaskStatus.STALLED
    assert claim is not None
    assert claim.claim_state.value == "expired"


@pytest.mark.anyio
async def test_task_runtime_loops_continue_now_until_terminal(session: Session, tmp_path: Path) -> None:
    acquire_claim(session, claim_id="claim-continue", run_id="run-continue")
    gateway = FakeGateway(
        [
            RuntimeTurnResult(continuation_decision="continue_now", observations=["Keep going."]),
            RuntimeTurnResult(continuation_decision="complete", observations=["Finished."]),
        ]
    )
    runtime = build_runtime(tmp_path, session, gateway)

    result = await runtime.run(
        RuntimeExecutionRequest(
            run_id="run-continue",
            claim_id="claim-continue",
            event=build_event(),
            task=build_task(status=TaskStatus.ACTIVE),
            now=timestamp(),
        )
    )
    session.commit()

    task = session.get(TaskTable, "task-1")
    assert gateway.calls == 2
    assert result.working_state.current_status == "completed"
    assert task is not None
    assert task.status == TaskStatus.COMPLETED


@pytest.mark.anyio
async def test_task_runtime_schedules_followup_durably(session: Session, tmp_path: Path) -> None:
    acquire_claim(session, claim_id="claim-followup", run_id="run-followup")
    runtime = build_runtime(
        tmp_path,
        session,
        FakeGateway(
            [
                RuntimeTurnResult(
                    continuation_decision="schedule_followup",
                    followup_request=FollowupRequest(
                        next_followup_at=timestamp() + timedelta(hours=1),
                        continuation_hint="Revisit after the external window opens.",
                        stale_after_at=timestamp() + timedelta(hours=2),
                    ),
                )
            ]
        ),
    )

    result = await runtime.run(
        RuntimeExecutionRequest(
            run_id="run-followup",
            claim_id="claim-followup",
            event=build_event(),
            task=build_task(status=TaskStatus.ACTIVE),
            now=timestamp(),
        )
    )
    session.commit()

    task = session.get(TaskTable, "task-1")
    claim = session.get(TaskClaimTable, "claim-followup")
    assert result.working_state.current_status == "completed"
    assert task is not None
    assert task.status == TaskStatus.SCHEDULED
    assert task.next_followup_at is not None
    assert claim is not None
    assert claim.claim_state.value == "expired"


@pytest.mark.anyio
async def test_task_runtime_creates_durable_delegation(session: Session, tmp_path: Path) -> None:
    acquire_claim(session, claim_id="claim-delegate", run_id="run-delegate")
    runtime = build_runtime(
        tmp_path,
        session,
        FakeGateway(
            [
                RuntimeTurnResult(
                    continuation_decision="delegate",
                    subagent_delegation=SubagentDelegationDraft(
                        child_task_id="child-task-1",
                        child_title="Investigate deployment issue",
                        delegated_objective="Inspect the deployment boundary for stale files.",
                        expected_output_contract="Return findings and recommended next step.",
                        role=SubagentRole.RESEARCH,
                        child_success_criteria=["Produce a concise report."],
                        blocked_reason="waiting for delegated child task",
                        stale_after_at=timestamp() + timedelta(hours=1),
                    ),
                )
            ]
        ),
    )

    result = await runtime.run(
        RuntimeExecutionRequest(
            run_id="run-delegate",
            claim_id="claim-delegate",
            event=build_event(),
            task=build_task(status=TaskStatus.ACTIVE),
            now=timestamp(),
        )
    )
    session.commit()

    parent_task = session.get(TaskTable, "task-1")
    child_task = session.get(TaskTable, "child-task-1")
    subagent = session.get(SubagentTable, "subagent-run-delegate")
    claim = session.get(TaskClaimTable, "claim-delegate")
    assert result.working_state.current_status == "delegating"
    assert result.subagent_record is not None
    assert parent_task is not None
    assert parent_task.status == TaskStatus.BLOCKED
    assert child_task is not None
    assert child_task.parent_task_id == "task-1"
    assert subagent is not None
    assert subagent.status.value == "proposed"
    assert claim is not None
    assert claim.claim_state.value == "expired"