from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from argentum.domain.enums import ApprovalStatus, ClaimReleaseReason, ContinuationDecision, OperationType, RunClass, RunStatus, SubagentStatus, TaskStatus, TaskType
from argentum.domain.models import (
    ApprovalDecisionPayload,
    ApprovalRecord,
    ApprovalRequestDraft,
    EventRecord,
    FollowupRequest,
    ModelRoutingPolicy,
    ProviderHealthRecord,
    ReflectionResult,
    RunWorkingState,
    RuntimeFacts,
    SessionDigest,
    SubagentDelegationDraft,
    SubagentRecord,
    TaskDigest,
    TaskRecord,
    ToolResultSummary,
)
from argentum.persistence.repositories import (
    ApprovalRepository,
    ApprovalTaskTransitionRequest,
    ClaimRepository,
    FollowupTaskTransitionRequest,
    SubagentRepository,
)

from .context import ContextAssembler
from .routing import LLMOrchestrator, ModelSelection


class TaskRuntimeError(RuntimeError):
    """Raised when a runtime turn cannot be executed safely."""


class RuntimeTurnResult(BaseModel):
    continuation_decision: ContinuationDecision
    observations: list[str] = Field(default_factory=list)
    pending_questions: list[str] = Field(default_factory=list)
    followup_request: FollowupRequest | None = None
    approval_request: ApprovalRequestDraft | None = None
    subagent_delegation: SubagentDelegationDraft | None = None
    reflection_result: ReflectionResult | None = None
    tool_results: list[ToolResultSummary] = Field(default_factory=list)
    artifacts_created: list[str] = Field(default_factory=list)


@dataclass(slots=True, frozen=True)
class RuntimeExecutionRequest:
    run_id: str
    claim_id: str
    event: EventRecord
    task: TaskRecord
    now: datetime
    runtime_lane: str | None = None
    recent_session_digest: SessionDigest | None = None
    open_tasks_digest: list[TaskDigest] | None = None
    memory_digest: list[Any] | None = None
    artifact_digest: list[Any] | None = None
    approval_constraints: list[str] | None = None
    approval_result: ApprovalDecisionPayload | None = None
    provider_health: list[ProviderHealthRecord] | None = None


@dataclass(slots=True, frozen=True)
class RuntimeExecutionResult:
    working_state: RunWorkingState
    route: ModelSelection
    approval_record: ApprovalRecord | None = None
    subagent_record: SubagentRecord | None = None


class _RuntimeGraphState(TypedDict, total=False):
    request: RuntimeExecutionRequest
    working_state: RunWorkingState
    turn_result: RuntimeTurnResult
    route: ModelSelection
    approval_record: ApprovalRecord | None
    subagent_record: SubagentRecord | None


class TaskRuntime:
    def __init__(
        self,
        *,
        context_assembler: ContextAssembler,
        orchestrator: LLMOrchestrator,
        claim_repository: ClaimRepository,
        approval_repository: ApprovalRepository,
        routing_policy: ModelRoutingPolicy,
        subagent_repository: SubagentRepository | None = None,
        max_turns: int = 3,
    ) -> None:
        self._context_assembler = context_assembler
        self._orchestrator = orchestrator
        self._claim_repository = claim_repository
        self._approval_repository = approval_repository
        self._routing_policy = routing_policy
        self._subagent_repository = subagent_repository
        self._max_turns = max_turns

    def run(self, request: RuntimeExecutionRequest) -> RuntimeExecutionResult:
        graph = self._build_graph()
        graph_state: _RuntimeGraphState = {"request": request}
        turns = 0

        while True:
            final_state = graph.invoke(graph_state)
            turns += 1
            decision = final_state["working_state"].continuation_decision
            if decision != ContinuationDecision.CONTINUE_NOW:
                break
            if turns >= self._max_turns:
                raise TaskRuntimeError("runtime exceeded max_turns while handling continue_now")
            graph_state = {"request": request, "working_state": final_state["working_state"]}

        return RuntimeExecutionResult(
            working_state=final_state["working_state"],
            route=final_state["route"],
            approval_record=final_state.get("approval_record"),
            subagent_record=final_state.get("subagent_record"),
        )

    def _build_graph(self):
        graph = StateGraph(_RuntimeGraphState)
        graph.add_node("initialize", self._initialize)
        graph.add_node("execute_turn", self._execute_turn)
        graph.add_node("finalize", self._finalize)
        graph.add_edge(START, "initialize")
        graph.add_edge("initialize", "execute_turn")
        graph.add_edge("execute_turn", "finalize")
        graph.add_edge("finalize", END)
        return graph.compile()

    def _initialize(self, state: _RuntimeGraphState) -> _RuntimeGraphState:
        if "working_state" in state:
            return {}

        request = state["request"]
        claim_record = self._claim_repository.verify_authoritative_claim(
            request.task.task_id,
            request.claim_id,
            as_of=request.now,
        )
        runtime_facts = RuntimeFacts(
            runtime_lane=request.runtime_lane,
            current_time=request.now,
            claim_lease_expires_at=claim_record.lease_expires_at,
            provider_health_summary=[f"{item.provider_id}:{item.health_status}" for item in request.provider_health or []],
        )
        context_packet = self._context_assembler.assemble(
            request.event,
            request.task,
            runtime_facts=runtime_facts,
            run_class=RunClass.STANDARD_RUNTIME,
            generated_at=request.now,
            relevant_open_tasks_digest=request.open_tasks_digest,
            relevant_memory_digest=request.memory_digest,
            recent_session_digest=request.recent_session_digest,
            recent_artifact_digest=request.artifact_digest,
            approval_constraints=request.approval_constraints,
        )
        if not context_packet.bootstrap_context.integrity_ok:
            raise TaskRuntimeError("bootstrap identity integrity failed during context assembly")

        working_state = RunWorkingState(
            run_id=request.run_id,
            event_id=request.event.event_id,
            task_id=request.task.task_id,
            claim_id=request.claim_id,
            current_status=RunStatus.EXECUTING,
            objective=request.task.objective,
            success_criteria=request.task.success_criteria,
            context_packet=context_packet,
            approval_result=request.approval_result,
        )
        return {"working_state": working_state}

    def _execute_turn(self, state: _RuntimeGraphState) -> _RuntimeGraphState:
        request = state["request"]
        working_state = state["working_state"]
        selection, raw_result = self._orchestrator.invoke_operation(
            OperationType.STANDARD_RUNTIME_TURN,
            working_state.context_packet.model_dump_json(indent=2),
            provider_health=request.provider_health or [],
            now=request.now,
            structured_output_schema=RuntimeTurnResult,
        )
        turn_result = raw_result if isinstance(raw_result, RuntimeTurnResult) else RuntimeTurnResult.model_validate(raw_result)
        updated_state = working_state.model_copy(
            update={
                "recent_observations": turn_result.observations,
                "pending_questions": turn_result.pending_questions,
                "followup_request": turn_result.followup_request,
                "approval_request": turn_result.approval_request,
                "subagent_delegation": turn_result.subagent_delegation,
                "reflection_result": turn_result.reflection_result,
                "recent_tool_results": turn_result.tool_results,
                "artifacts_created": turn_result.artifacts_created,
                "continuation_decision": turn_result.continuation_decision,
            }
        )
        return {"working_state": updated_state, "turn_result": turn_result, "route": selection}

    def _finalize(self, state: _RuntimeGraphState) -> _RuntimeGraphState:
        request = state["request"]
        working_state = state["working_state"]
        turn_result = state["turn_result"]

        if turn_result.followup_request is not None and turn_result.continuation_decision != ContinuationDecision.SCHEDULE_FOLLOWUP:
            raise TaskRuntimeError("follow-up requests must use the schedule_followup continuation decision")
        if turn_result.subagent_delegation is not None and turn_result.continuation_decision != ContinuationDecision.DELEGATE:
            raise TaskRuntimeError("subagent delegation must use the delegate continuation decision")

        if turn_result.approval_request is not None and turn_result.continuation_decision != ContinuationDecision.PAUSE_WAITING_HUMAN:
            raise TaskRuntimeError("approval requests must pause the task for human review")

        if turn_result.approval_request is not None:
            approval = ApprovalRecord(
                approval_id=f"approval-{request.run_id}",
                task_id=request.task.task_id,
                run_id=request.run_id,
                approval_type=turn_result.approval_request.approval_type,
                risk_level=turn_result.approval_request.risk_level,
                requested_action=turn_result.approval_request.requested_action,
                rationale=turn_result.approval_request.rationale,
                constrained_options=turn_result.approval_request.constrained_options,
                request_payload=turn_result.approval_request.request_payload,
                eligible_resolver_refs=turn_result.approval_request.eligible_resolver_refs,
                status=ApprovalStatus.PENDING,
                requested_via_session_id=turn_result.approval_request.requested_via_session_id,
                requested_via_message_ref=turn_result.approval_request.requested_via_message_ref,
                expires_at=turn_result.approval_request.expires_at,
                created_at=request.now,
                updated_at=request.now,
            )
            approval_record = self._approval_repository.create_approval(approval)
            self._claim_repository.transition_task_to_waiting_human(
                ApprovalTaskTransitionRequest(
                    task_id=request.task.task_id,
                    claim_id=request.claim_id,
                    approval_id=approval_record.approval_id,
                    transitioned_at=request.now,
                )
            )
            paused_state = working_state.model_copy(update={"current_status": RunStatus.WAITING_APPROVAL})
            return {"working_state": paused_state, "approval_record": approval_record}

        if turn_result.continuation_decision == ContinuationDecision.PAUSE_WAITING_HUMAN:
            raise TaskRuntimeError("pause_waiting_human requires a durable approval request")

        if turn_result.continuation_decision == ContinuationDecision.SCHEDULE_FOLLOWUP:
            if turn_result.followup_request is None:
                raise TaskRuntimeError("schedule_followup requires a follow-up request payload")
            self._claim_repository.transition_task_to_scheduled(
                FollowupTaskTransitionRequest(
                    task_id=request.task.task_id,
                    claim_id=request.claim_id,
                    next_followup_at=turn_result.followup_request.next_followup_at,
                    transitioned_at=request.now,
                    continuation_hint=turn_result.followup_request.continuation_hint,
                    stale_after_at=turn_result.followup_request.stale_after_at,
                )
            )
            scheduled_state = working_state.model_copy(update={"current_status": RunStatus.COMPLETED})
            return {"working_state": scheduled_state, "approval_record": None, "subagent_record": None}

        if turn_result.continuation_decision == ContinuationDecision.DELEGATE:
            if self._subagent_repository is None:
                raise TaskRuntimeError("delegate continuation requires a subagent repository")
            if turn_result.subagent_delegation is None:
                raise TaskRuntimeError("delegate continuation requires a subagent delegation payload")

            draft = turn_result.subagent_delegation
            child_task = TaskRecord(
                task_id=draft.child_task_id,
                title=draft.child_title,
                objective=draft.delegated_objective,
                normalized_objective=draft.delegated_objective.lower(),
                task_type=TaskType.CHILD_TASK,
                status=TaskStatus.PROPOSED,
                priority=draft.child_priority,
                created_by_event_id=request.event.event_id,
                parent_task_id=request.task.task_id,
                success_criteria=draft.child_success_criteria,
                metadata_json=draft.metadata_json,
                created_at=request.now,
                updated_at=request.now,
            )
            subagent_record = SubagentRecord(
                subagent_id=f"subagent-{request.run_id}",
                parent_task_id=request.task.task_id,
                child_task_id=draft.child_task_id,
                role=draft.role,
                status=SubagentStatus.PROPOSED,
                model_policy_ref=draft.model_policy_ref,
                delegated_objective=draft.delegated_objective,
                expected_output_contract=draft.expected_output_contract,
                metadata_json=draft.metadata_json,
                created_at=request.now,
                updated_at=request.now,
            )
            _, _, created_subagent = self._subagent_repository.begin_delegation(
                parent_task_id=request.task.task_id,
                claim_id=request.claim_id,
                child_task=child_task,
                subagent=subagent_record,
                now=request.now,
                blocked_reason=draft.blocked_reason or f"waiting for delegated child task {draft.child_task_id}",
                stale_after_at=draft.stale_after_at,
            )
            delegating_state = working_state.model_copy(update={"current_status": RunStatus.DELEGATING})
            return {"working_state": delegating_state, "approval_record": None, "subagent_record": created_subagent}

        final_status = RunStatus.EXECUTING
        if turn_result.continuation_decision == ContinuationDecision.COMPLETE:
            self._claim_repository.transition_task_to_terminal(
                request=self._terminal_transition_request(request, TaskStatus.COMPLETED, ClaimReleaseReason.COMPLETED)
            )
            final_status = RunStatus.COMPLETED
        elif turn_result.continuation_decision == ContinuationDecision.FAIL:
            self._claim_repository.transition_task_to_terminal(
                request=self._terminal_transition_request(request, TaskStatus.FAILED, ClaimReleaseReason.FAILED)
            )
            final_status = RunStatus.FAILED
        elif turn_result.continuation_decision == ContinuationDecision.CONTINUE_NOW:
            final_status = RunStatus.EXECUTING
        else:
            raise TaskRuntimeError(
                f"continuation decision {turn_result.continuation_decision} requires durable handling before runtime completion"
            )

        finalized_state = working_state.model_copy(update={"current_status": final_status})
        return {"working_state": finalized_state, "approval_record": None}

    def _terminal_transition_request(
        self,
        request: RuntimeExecutionRequest,
        terminal_status: TaskStatus,
        release_reason: ClaimReleaseReason,
    ):
        from argentum.persistence.repositories import TerminalTaskTransitionRequest

        return TerminalTaskTransitionRequest(
            task_id=request.task.task_id,
            claim_id=request.claim_id,
            terminal_status=terminal_status,
            release_reason=release_reason,
            transitioned_at=request.now,
        )