from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from argentum.domain import (
    ApprovalDecision,
    ApprovalDecisionPayload,
    ApprovalRequestDraft,
    ApprovalType,
    ArtifactDigest,
    ClaimState,
    ContextBudget,
    ContinuationDecision,
    EventAuthStatus,
    EventRecord,
    EventType,
    MemoryDigest,
    ProviderHealthRecord,
    ProviderHealthStatus,
    RiskLevel,
    RunClass,
    SessionDigest,
    TaskDigest,
    TaskRecord,
    TaskStatus,
    TaskType,
    ToolResultSummary,
    TriggerMode,
)
from argentum.domain.lifecycle import ClaimLifecycleError
from argentum.persistence.base import Base
from argentum.persistence.repositories import ApprovalRepository, ClaimAcquisitionRequest, ClaimRepository, EventRepository, SubagentRepository
from argentum.persistence.session import create_session_factory, create_sqlalchemy_engine
from argentum.persistence.tables import TaskClaimTable, TaskTable
from argentum.runtime import BootstrapIdentitySource, ContextAssembler, LLMOrchestrator, RuntimeExecutionRequest, RuntimeTurnResult, TaskRuntime, build_default_routing_policy, select_route


def timestamp() -> datetime:
    return datetime(2026, 4, 20, 17, 0, tzinfo=UTC)


def build_event(event_id: str = "event-1") -> EventRecord:
    return EventRecord(
        event_id=event_id,
        event_type=EventType.USER_MESSAGE,
        trigger_mode=TriggerMode.INTERACTIVE,
        source_surface="slack",
        auth_status=EventAuthStatus.AUTHENTICATED,
        created_at=timestamp(),
        updated_at=timestamp(),
    )


def build_task(status: TaskStatus = TaskStatus.PROPOSED) -> TaskRecord:
    return TaskRecord(
        task_id="task-1",
        title="Runtime task",
        objective="Safely execute a governed action.",
        normalized_objective="safely execute a governed action",
        task_type=TaskType.EXECUTION_TASK,
        status=status,
        priority=1,
        created_by_event_id="event-1",
        success_criteria=["Request approval before destructive work.", "Complete safely."],
        artifact_refs=[],
        related_memory_refs=[],
        metadata_json={},
        created_at=timestamp(),
        updated_at=timestamp(),
    )


def persist_task_seed(session: Session) -> None:
    EventRepository(session).record_event(build_event())
    task = build_task()
    session.add(
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
    session.commit()


class FakeGateway:
    def __init__(self, responses: list[RuntimeTurnResult]) -> None:
        self._responses = responses
        self.selections = []

    async def invoke(self, selection, prompt: str, *, structured_output_schema=None):
        self.selections.append(selection)
        return self._responses.pop(0)


@pytest.fixture()
def session(tmp_path_factory: pytest.TempPathFactory) -> Session:
    database_path = tmp_path_factory.mktemp("phase2-runtime-db") / "runtime.sqlite3"
    engine = create_sqlalchemy_engine(
        f"sqlite+pysqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with factory() as current_session:
        persist_task_seed(current_session)
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


def test_context_assembler_trims_in_documented_order(tmp_path: Path) -> None:
    soul_path = tmp_path / "SOUL.md"
    soul_path.write_text("bootstrap identity " * 100, encoding="utf-8")
    assembler = ContextAssembler(BootstrapIdentitySource(soul_path=soul_path))

    packet = assembler.assemble(
        build_event(),
        build_task(),
        runtime_facts={
            "runtime_lane": "lane-a",
            "current_time": timestamp(),
            "claim_lease_expires_at": timestamp(),
            "provider_health_summary": [],
        },
        run_class=RunClass.STANDARD_RUNTIME,
        generated_at=timestamp(),
        relevant_open_tasks_digest=[TaskDigest(task_id=f"open-{index}", title="Open task", status=TaskStatus.ACTIVE, summary="summary " * 20) for index in range(3)],
        relevant_memory_digest=[MemoryDigest(memory_id=f"memory-{index}", summary="memory summary " * 20) for index in range(3)],
        recent_session_digest=SessionDigest(
            session_id="session-1",
            channel_type="slack_dm",
            summary="session summary " * 50,
            recent_task_ids=["task-a", "task-b", "task-c"],
        ),
        recent_artifact_digest=[ArtifactDigest(artifact_id=f"artifact-{index}", artifact_type="report", description="artifact description " * 20) for index in range(3)],
        approval_constraints=["approval-required"],
        token_budget=ContextBudget(
            run_class=RunClass.STANDARD_RUNTIME,
            target_input_tokens=1200,
            reserved_output_tokens=20,
            reserved_tool_schema_tokens=20,
            max_bootstrap_tokens=12,
            max_task_snapshot_tokens=12,
            max_memory_digest_tokens=10,
            max_open_task_digest_tokens=10,
            max_recent_session_tokens=10,
            max_artifact_digest_tokens=10,
        ),
    )

    notes = packet.assembly_notes
    artifact_index = next(index for index, note in enumerate(notes) if "artifact" in note)
    open_task_index = next(index for index, note in enumerate(notes) if "open-task" in note)
    memory_index = next(index for index, note in enumerate(notes) if "memory" in note)
    session_index = next(index for index, note in enumerate(notes) if "recent-session" in note)
    task_index = next(index for index, note in enumerate(notes) if "task snapshot" in note)
    bootstrap_index = next(index for index, note in enumerate(notes) if "bootstrap" in note)

    assert artifact_index < open_task_index < memory_index < session_index < task_index < bootstrap_index
    assert len(packet.model_dump_json()) <= (
        (
            packet.token_budget.target_input_tokens
            - packet.token_budget.reserved_output_tokens
            - packet.token_budget.reserved_tool_schema_tokens
        )
        * 3
    )


def test_select_route_uses_default_and_escalation_paths() -> None:
    policy = build_default_routing_policy(timestamp())

    standard_selection = select_route(policy, [], "standard_runtime_turn", now=timestamp())
    escalated_selection = select_route(policy, [], "standard_runtime_turn", now=timestamp(), prefer_escalation=True)

    assert standard_selection.tier == "standard"
    assert escalated_selection.tier == "deep_reasoning"


def test_select_route_avoids_unavailable_provider() -> None:
    policy = build_default_routing_policy(timestamp())
    selection = select_route(
        policy,
        [
            ProviderHealthRecord(
                provider_id="gemini",
                health_status=ProviderHealthStatus.UNAVAILABLE,
                updated_at=timestamp(),
            )
        ],
        "deep_planning",
        now=timestamp(),
    )
    assert selection.provider_id == "deepseek"


@pytest.mark.anyio
async def test_task_runtime_refuses_execution_without_authoritative_claim(session: Session, tmp_path: Path) -> None:
    runtime = build_runtime(
        tmp_path,
        session,
        FakeGateway([
            RuntimeTurnResult(continuation_decision=ContinuationDecision.COMPLETE),
        ]),
    )

    with pytest.raises(ClaimLifecycleError):
        await runtime.run(
            RuntimeExecutionRequest(
                run_id="run-without-claim",
                claim_id="missing-claim",
                event=build_event(),
                task=build_task(),
                now=timestamp(),
            )
        )


@pytest.mark.anyio
async def test_task_runtime_pauses_for_approval_and_resumes_safely(session: Session, tmp_path: Path) -> None:
    claim_repository = ClaimRepository(session)
    approval_repository = ApprovalRepository(session)
    claim_repository.acquire_claim(
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

    first_runtime = build_runtime(
        tmp_path,
        session,
        FakeGateway(
            [
                RuntimeTurnResult(
                    continuation_decision=ContinuationDecision.PAUSE_WAITING_HUMAN,
                    approval_request=ApprovalRequestDraft(
                        approval_type=ApprovalType.DESTRUCTIVE_ACTION,
                        risk_level=RiskLevel.HIGH,
                        requested_action="Delete a bootstrap-adjacent file",
                        rationale="The action is destructive and requires approval.",
                        constrained_options=["approve", "deny", "cancel"],
                        request_payload={"path": "/srv/argentum/var/tmp/test.txt"},
                        eligible_resolver_refs=["operator:isaac"],
                    ),
                )
            ]
        ),
    )

    paused = await first_runtime.run(
        RuntimeExecutionRequest(
            run_id="run-1",
            claim_id="claim-1",
            event=build_event(),
            task=build_task(TaskStatus.ACTIVE),
            now=timestamp(),
        )
    )
    session.commit()

    paused_task = session.get(TaskTable, "task-1")
    paused_claim = session.get(TaskClaimTable, "claim-1")
    assert paused.approval_record is not None
    assert paused.working_state.current_status == "waiting_approval"
    assert paused_task is not None
    assert paused_task.status == TaskStatus.WAITING_HUMAN
    assert paused_task.pending_approval_id == paused.approval_record.approval_id
    assert paused_claim is not None
    assert paused_claim.claim_state == ClaimState.EXPIRED

    approval_payload = ApprovalDecisionPayload(
        approval_id=paused.approval_record.approval_id,
        decision=ApprovalDecision.APPROVE,
        resolved_by_user_id="operator:isaac",
        resolution_payload_hash="approval-hash-1",
        occurred_at=timestamp(),
    )
    resolved = approval_repository.resolve_approval(approval_payload)
    assert resolved.status == "approved"

    claim_repository.acquire_claim(
        ClaimAcquisitionRequest(
            task_id="task-1",
            claim_id="claim-2",
            run_id="run-2",
            claimed_by="runtime-a",
            claim_duration=timedelta(minutes=5),
            claimed_at=timestamp() + timedelta(minutes=1),
        )
    )
    session.commit()

    second_runtime = build_runtime(
        tmp_path,
        session,
        FakeGateway(
            [
                RuntimeTurnResult(
                    continuation_decision=ContinuationDecision.COMPLETE,
                    observations=["Approval satisfied."],
                    tool_results=[ToolResultSummary(tool_name="noop", outcome="success", summary="No destructive work executed in test.")],
                )
            ]
        ),
    )
    completed = await second_runtime.run(
        RuntimeExecutionRequest(
            run_id="run-2",
            claim_id="claim-2",
            event=build_event("event-2"),
            task=build_task(TaskStatus.ACTIVE),
            now=timestamp() + timedelta(minutes=1),
            approval_result=approval_payload,
        )
    )
    session.commit()

    completed_task = session.get(TaskTable, "task-1")
    completed_claim = session.get(TaskClaimTable, "claim-2")
    assert completed.working_state.current_status == "completed"
    assert completed_task is not None
    assert completed_task.status == TaskStatus.COMPLETED
    assert completed_task.active_run_id is None
    assert completed_task.pending_approval_id is None
    assert completed_claim is not None
    assert completed_claim.claim_state == ClaimState.RELEASED


@pytest.mark.parametrize(
    ("continuation_decision", "message"),
    [
        (ContinuationDecision.SCHEDULE_FOLLOWUP, "requires a follow-up request payload"),
        (ContinuationDecision.DELEGATE, "requires a subagent delegation payload"),
        (ContinuationDecision.PAUSE_WAITING_HUMAN, "requires a durable approval request"),
    ],
)
def test_task_runtime_rejects_missing_non_terminal_continuation_payloads(
    session: Session,
    tmp_path: Path,
    continuation_decision: ContinuationDecision,
    message: str,
) -> None:
    claim_repository = ClaimRepository(session)
    claim_repository.acquire_claim(
        ClaimAcquisitionRequest(
            task_id="task-1",
            claim_id="claim-guardrail",
            run_id="run-guardrail",
            claimed_by="runtime-a",
            claim_duration=timedelta(minutes=5),
            claimed_at=timestamp(),
        )
    )
    session.commit()

    runtime = build_runtime(
        tmp_path,
        session,
        FakeGateway([RuntimeTurnResult(continuation_decision=continuation_decision)]),
    )

    with pytest.raises(Exception, match=message):
        pass


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("continuation_decision", "message"),
    [
        (ContinuationDecision.SCHEDULE_FOLLOWUP, "requires a follow-up request payload"),
        (ContinuationDecision.DELEGATE, "requires a subagent delegation payload"),
        (ContinuationDecision.PAUSE_WAITING_HUMAN, "requires a durable approval request"),
    ],
)
async def test_task_runtime_rejects_missing_non_terminal_continuation_payloads(
    session: Session,
    tmp_path: Path,
    continuation_decision: ContinuationDecision,
    message: str,
) -> None:
    claim_repository = ClaimRepository(session)
    claim_repository.acquire_claim(
        ClaimAcquisitionRequest(
            task_id="task-1",
            claim_id="claim-guardrail",
            run_id="run-guardrail",
            claimed_by="runtime-a",
            claim_duration=timedelta(minutes=5),
            claimed_at=timestamp(),
        )
    )
    session.commit()

    runtime = build_runtime(
        tmp_path,
        session,
        FakeGateway([RuntimeTurnResult(continuation_decision=continuation_decision)]),
    )

    with pytest.raises(Exception, match=message):
        await runtime.run(
            RuntimeExecutionRequest(
                run_id="run-guardrail",
                claim_id="claim-guardrail",
                event=build_event(),
                task=build_task(TaskStatus.ACTIVE),
                now=timestamp(),
            )
        )