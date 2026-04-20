from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from argentum.domain.enums import ClaimState, EventProcessingStatus, TaskStatus
from argentum.domain.ingress import EventIntakePolicy, apply_intake_decision, evaluate_event_intake
from argentum.domain.lifecycle import ClaimLifecycleError, TaskLifecycleError, transition_task_status
from argentum.domain.models import EventRecord, TaskClaimRecord, TaskRecord

from .tables import EventTable, TaskClaimTable, TaskTable


@dataclass(slots=True, frozen=True)
class ClaimAcquisitionRequest:
    task_id: str
    claim_id: str
    run_id: str
    claimed_by: str
    claim_duration: timedelta
    claimed_at: datetime


def active_claims_for_task_statement(task_id: str, *, as_of: datetime) -> Select[tuple[TaskClaimTable]]:
    return (
        select(TaskClaimTable)
        .where(TaskClaimTable.task_id == task_id)
        .where(TaskClaimTable.claim_state == ClaimState.ACTIVE)
        .where(TaskClaimTable.lease_expires_at > as_of)
    )


class ClaimRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def acquire_claim(self, request: ClaimAcquisitionRequest) -> TaskClaimTable:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()

        existing_active_claim = self._session.execute(
            active_claims_for_task_statement(request.task_id, as_of=request.claimed_at).with_for_update()
        ).scalar_one_or_none()
        if existing_active_claim is not None:
            raise ClaimLifecycleError(f"task {request.task_id} already has an active claim")

        task_record = TaskRecord.model_validate(
            {
                "task_id": task.task_id,
                "title": task.title,
                "objective": task.objective,
                "normalized_objective": task.normalized_objective,
                "task_type": task.task_type,
                "status": task.status,
                "priority": task.priority,
                "confidence_score": float(task.confidence_score) if task.confidence_score is not None else None,
                "created_by_event_id": task.created_by_event_id,
                "origin_session_ids": task.origin_session_ids,
                "origin_thread_refs": task.origin_thread_refs,
                "assigned_runtime_lane": task.assigned_runtime_lane,
                "active_run_id": task.active_run_id,
                "parent_task_id": task.parent_task_id,
                "child_task_ids": task.child_task_ids,
                "latest_summary": task.latest_summary,
                "latest_summary_at": task.latest_summary_at,
                "success_criteria": task.success_criteria,
                "continuation_hint": task.continuation_hint,
                "blocked_reason": task.blocked_reason,
                "pending_approval_id": task.pending_approval_id,
                "artifact_refs": task.artifact_refs,
                "related_memory_refs": task.related_memory_refs,
                "last_operator_confirmation_at": task.last_operator_confirmation_at,
                "next_followup_at": task.next_followup_at,
                "stale_after_at": task.stale_after_at,
                "abandoned_at": task.abandoned_at,
                "completed_at": task.completed_at,
                "failed_at": task.failed_at,
                "metadata_json": task.metadata_json,
                "created_at": task.created_at,
                "updated_at": task.updated_at,
            }
        )
        transitioned_task = transition_task_status(
            task_record,
            TaskStatus.ACTIVE,
            active_run_id=request.run_id,
            transition_time=request.claimed_at,
            pending_approval_id=task.pending_approval_id,
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.updated_at = transitioned_task.updated_at

        claim = TaskClaimTable(
            claim_id=request.claim_id,
            task_id=request.task_id,
            run_id=request.run_id,
            claimed_by=request.claimed_by,
            claim_state=ClaimState.ACTIVE,
            claimed_at=request.claimed_at,
            last_lease_renewal_at=request.claimed_at,
            lease_expires_at=request.claimed_at + request.claim_duration,
            created_at=request.claimed_at,
            updated_at=request.claimed_at,
        )
        self._session.add(claim)
        self._session.flush()
        return claim


class EventRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def apply_intake_policy(
        self,
        event: EventRecord,
        *,
        policy: EventIntakePolicy | None = None,
        queue_owner: str | None = None,
        now: datetime | None = None,
    ) -> EventRecord:
        decision = evaluate_event_intake(event, policy=policy, now=now)
        return apply_intake_decision(event, decision, queue_owner=queue_owner, now=now)

    def mark_event_consumed(self, event_id: str, *, consumed_by_run_id: str, now: datetime | None = None) -> None:
        when = now or datetime.now(tz=UTC)
        event = self._session.get(EventTable, event_id)
        if event is None:
            raise LookupError(f"event {event_id} not found")
        event.processing_status = EventProcessingStatus.CONSUMED
        event.consumed_by_run_id = consumed_by_run_id
        event.queue_owner = None
        event.updated_at = when