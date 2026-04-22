from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy.orm import Session

from argentum.domain import (
    ApprovalDecision,
    ApprovalDecisionPayload,
    ApprovalRecord,
    ApprovalType,
    ArtifactRecord,
    ArtifactType,
    ArtifactVisibility,
    EventAuthStatus,
    EventRecord,
    EventType,
    GeneratedToolLifecycleState,
    GeneratedToolLifecycleError,
    GeneratedToolRecord,
    ProviderHealthRecord,
    ProviderHealthStatus,
    RetentionClass,
    RiskLevel,
    TaskRecord,
    TaskStatus,
    TaskType,
    ToolActivationScope,
    TriggerMode,
)
from argentum.persistence.repositories import (
    ActivityRepository,
    ApprovalRepository,
    ArtifactRepository,
    ClaimAcquisitionRequest,
    ClaimRepository,
    EventRepository,
    GeneratedToolRepository,
    ProviderHealthRepository,
)
from argentum.persistence.session import create_session_factory, create_sqlalchemy_engine
from argentum.persistence.tables import TaskTable
from argentum.runtime import (
    BootstrapIdentitySource,
    ContextAssembler,
    LLMOrchestrator,
    ObservabilityService,
    RuntimeExecutionRequest,
    RuntimeTurnResult,
    TaskRuntime,
    build_default_routing_policy,
)


def timestamp() -> datetime:
    return datetime(2026, 4, 21, 18, 0, tzinfo=UTC)


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


def build_task(task_id: str = "task-1", status: TaskStatus = TaskStatus.PROPOSED) -> TaskRecord:
    return TaskRecord(
        task_id=task_id,
        title="Phase 4 task",
        objective="Validate governed activation and runtime observability.",
        normalized_objective="validate governed activation and runtime observability",
        task_type=TaskType.TOOL_AUTHORING_TASK,
        status=status,
        priority=1,
        created_by_event_id="event-1",
        success_criteria=["Keep tool activation approval-gated and visible."],
        metadata_json={},
        created_at=timestamp(),
        updated_at=timestamp(),
    )


class FakeGateway:
    def __init__(self, responses: list[RuntimeTurnResult]) -> None:
        self._responses = responses

    async def invoke(self, selection, prompt: str, *, structured_output_schema=None):
        return self._responses.pop(0)


@pytest.fixture()
def session(tmp_path: Path) -> Iterator[Session]:
    database_path = tmp_path / "phase4-integration.sqlite3"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", f"sqlite+pysqlite:///{database_path.as_posix()}")
    command.upgrade(config, "20260421_0004")

    engine = create_sqlalchemy_engine(
        f"sqlite+pysqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    factory = create_session_factory(engine)
    with factory() as current_session:
        yield current_session
    engine.dispose()


def seed_task_graph(session: Session) -> None:
    event_repository = EventRepository(session)
    event_repository.record_event(build_event())
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


@pytest.mark.anyio
async def test_generated_tool_activation_stays_approval_gated_and_visible(session: Session) -> None:
    seed_task_graph(session)
    artifact_repository = ArtifactRepository(session)
    approval_repository = ApprovalRepository(session)
    generated_tool_repository = GeneratedToolRepository(session)
    observability_service = ObservabilityService(
        activity_repository=ActivityRepository(session),
        generated_tool_repository=generated_tool_repository,
        provider_health_repository=ProviderHealthRepository(session),
    )

    artifact = artifact_repository.create_artifact(
        ArtifactRecord(
            artifact_id="artifact-tool-bundle",
            artifact_type=ArtifactType.GENERATED_TOOL_BUNDLE,
            task_id="task-1",
            storage_ref="var/artifacts/tool-bundle.zip",
            visibility=ArtifactVisibility.OPERATOR_VISIBLE,
            retention_class=RetentionClass.GENERATED_TOOL,
            created_at=timestamp(),
            updated_at=timestamp(),
        )
    )
    approval = approval_repository.create_approval(
        ApprovalRecord(
            approval_id="approval-tool-1",
            task_id="task-1",
            run_id="run-tool-1",
            approval_type=ApprovalType.TOOL_ACTIVATION,
            risk_level=RiskLevel.HIGH,
            requested_action="Activate generated tool in quarantine scope.",
            rationale="New tools must remain approval-gated and staged.",
            constrained_options=["approve", "deny", "cancel"],
            request_payload={"scope": "quarantine"},
            eligible_resolver_refs=["operator:isaac"],
            status="pending",
            created_at=timestamp(),
            updated_at=timestamp(),
        )
    )
    generated_tool_repository.create_generated_tool(
        GeneratedToolRecord(
            tool_id="tool-1",
            tool_name="safe_shell_report",
            version="v1",
            source_task_id="task-1",
            source_artifact_ref=artifact.artifact_id,
            lifecycle_state=GeneratedToolLifecycleState.PROPOSED,
            activation_scope=ToolActivationScope.NONE,
            capability_summary="Collects a bounded shell diagnostic report.",
            created_at=timestamp(),
            updated_at=timestamp(),
        )
    )
    generated_tool_repository.transition_generated_tool(
        tool_id="tool-1",
        new_state=GeneratedToolLifecycleState.VALIDATING,
        transitioned_at=timestamp() + timedelta(minutes=1),
    )
    generated_tool_repository.transition_generated_tool(
        tool_id="tool-1",
        new_state=GeneratedToolLifecycleState.VERIFIED,
        transitioned_at=timestamp() + timedelta(minutes=2),
    )
    generated_tool_repository.transition_generated_tool(
        tool_id="tool-1",
        new_state=GeneratedToolLifecycleState.APPROVAL_PENDING,
        transitioned_at=timestamp() + timedelta(minutes=3),
        requested_approval_id=approval.approval_id,
    )
    generated_tool_repository.transition_generated_tool(
        tool_id="tool-1",
        new_state=GeneratedToolLifecycleState.APPROVED,
        transitioned_at=timestamp() + timedelta(minutes=4),
        requested_approval_id=approval.approval_id,
    )
    with pytest.raises(GeneratedToolLifecycleError, match="approved approval"):
        generated_tool_repository.transition_generated_tool(
            tool_id="tool-1",
            new_state=GeneratedToolLifecycleState.QUARANTINED,
            transitioned_at=timestamp() + timedelta(minutes=5),
            requested_approval_id=approval.approval_id,
            quarantine_until=timestamp() + timedelta(days=1),
        )

    approval_repository.resolve_approval(
        ApprovalDecisionPayload(
            approval_id=approval.approval_id,
            decision=ApprovalDecision.APPROVE,
            resolved_by_user_id="operator:isaac",
            resolved_by_session_id=None,
            resolution_payload_hash="approval-tool-1-hash",
            operator_comment="Approved after verification.",
            occurred_at=timestamp() + timedelta(minutes=5),
        )
    )
    quarantined = generated_tool_repository.transition_generated_tool(
        tool_id="tool-1",
        new_state=GeneratedToolLifecycleState.QUARANTINED,
        transitioned_at=timestamp() + timedelta(minutes=6),
        requested_approval_id=approval.approval_id,
        quarantine_until=timestamp() + timedelta(days=1),
    )
    session.commit()

    lifecycle_report = observability_service.build_generated_tool_lifecycle_report(limit=10)

    assert quarantined.lifecycle_state == GeneratedToolLifecycleState.QUARANTINED
    assert quarantined.activation_scope == ToolActivationScope.QUARANTINE
    assert quarantined.requested_approval_id == approval.approval_id
    assert [tool.tool_id for tool in lifecycle_report.generated_tools] == ["tool-1"]
    assert len(lifecycle_report.recent_lifecycle_activity) >= 5
    assert lifecycle_report.recent_lifecycle_activity[0].generated_tool_id == "tool-1"


@pytest.mark.anyio
async def test_async_runtime_persists_provider_fallback_and_task_activity_reports(session: Session, tmp_path: Path) -> None:
    seed_task_graph(session)
    activity_repository = ActivityRepository(session)
    provider_health_repository = ProviderHealthRepository(session)
    generated_tool_repository = GeneratedToolRepository(session)
    claim_repository = ClaimRepository(session)

    provider_health_repository.upsert_provider_health(
        ProviderHealthRecord(
            provider_id="gemini",
            health_status=ProviderHealthStatus.UNAVAILABLE,
            updated_at=timestamp(),
        )
    )
    provider_health_repository.upsert_provider_health(
        ProviderHealthRecord(
            provider_id="deepseek",
            health_status=ProviderHealthStatus.HEALTHY,
            updated_at=timestamp(),
        )
    )
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

    soul_path = tmp_path / "SOUL.md"
    soul_path.write_text("identity " * 120, encoding="utf-8")
    policy = build_default_routing_policy(timestamp())
    orchestrator = LLMOrchestrator(
        gateway=FakeGateway([RuntimeTurnResult(continuation_decision="complete")]),
        policy=policy,
        activity_sink=activity_repository,
    )
    runtime = TaskRuntime(
        context_assembler=ContextAssembler(BootstrapIdentitySource(soul_path=soul_path)),
        orchestrator=orchestrator,
        claim_repository=claim_repository,
        approval_repository=ApprovalRepository(session),
        routing_policy=policy,
        activity_repository=activity_repository,
    )

    result = await runtime.run(
        RuntimeExecutionRequest(
            run_id="run-1",
            claim_id="claim-1",
            event=build_event(),
            task=build_task(status=TaskStatus.ACTIVE),
            now=timestamp(),
            provider_health=provider_health_repository.list_provider_health(),
        )
    )
    session.commit()

    observability_service = ObservabilityService(
        activity_repository=activity_repository,
        generated_tool_repository=generated_tool_repository,
        provider_health_repository=provider_health_repository,
    )
    provider_report = observability_service.build_provider_routing_report(limit=10)
    task_report = observability_service.build_task_activity_report("task-1", limit=10)

    assert result.route.provider_id == "deepseek"
    assert provider_report.recent_routing_activity[0].fallback_from_provider_id == "gemini"
    assert provider_report.recent_routing_activity[0].fallback_reason == "provider_unavailable"
    assert any(activity.activity_kind == "autonomous_action" for activity in task_report.recent_activity)