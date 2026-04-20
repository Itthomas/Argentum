from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from argentum.domain.enums import ClaimReleaseReason, ClaimState, EventProcessingStatus, TaskStatus
from argentum.domain.ingress import EventIntakePolicy, apply_intake_decision, evaluate_event_intake
from argentum.domain.lifecycle import ClaimLifecycleError, transition_claim_state, transition_task_status
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


@dataclass(slots=True, frozen=True)
class TerminalTaskTransitionRequest:
    task_id: str
    claim_id: str
    terminal_status: TaskStatus
    release_reason: ClaimReleaseReason
    transitioned_at: datetime


@dataclass(slots=True, frozen=True)
class TerminalTaskTransitionResult:
    task: TaskRecord
    claim: TaskClaimRecord


@dataclass(slots=True, frozen=True)
class EventPersistenceResult:
    event: EventRecord
    created: bool
    deduplicated: bool


def _task_table_to_record(task: TaskTable) -> TaskRecord:
    return TaskRecord.model_validate(
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


def _claim_table_to_record(claim: TaskClaimTable) -> TaskClaimRecord:
    return TaskClaimRecord.model_validate(
        {
            "claim_id": claim.claim_id,
            "task_id": claim.task_id,
            "run_id": claim.run_id,
            "claimed_by": claim.claimed_by,
            "claim_state": claim.claim_state,
            "claimed_at": claim.claimed_at,
            "last_lease_renewal_at": claim.last_lease_renewal_at,
            "lease_expires_at": claim.lease_expires_at,
            "released_at": claim.released_at,
            "release_reason": claim.release_reason,
            "superseded_by_claim_id": claim.superseded_by_claim_id,
            "created_at": claim.created_at,
            "updated_at": claim.updated_at,
        }
    )


def _event_table_to_record(event: EventTable) -> EventRecord:
    return EventRecord.model_validate(
        {
            "event_id": event.event_id,
            "event_type": event.event_type,
            "trigger_mode": event.trigger_mode,
            "source_surface": event.source_surface,
            "source_channel_id": event.source_channel_id,
            "source_thread_ref": event.source_thread_ref,
            "source_user_id": event.source_user_id,
            "source_message_ref": event.source_message_ref,
            "authenticated_principal_ref": event.authenticated_principal_ref,
            "auth_status": event.auth_status,
            "idempotency_key": event.idempotency_key,
            "replay_window_key": event.replay_window_key,
            "replay_window_expires_at": event.replay_window_expires_at,
            "payload_text": event.payload_text,
            "payload_structured": event.payload_structured,
            "attachment_refs": event.attachment_refs,
            "explicit_task_refs": event.explicit_task_refs,
            "inferred_task_candidates": event.inferred_task_candidates,
            "approval_response_data": event.approval_response_data,
            "heartbeat_data": event.heartbeat_data,
            "cron_data": event.cron_data,
            "webhook_data": event.webhook_data,
            "queue_class": event.queue_class,
            "queue_priority": event.queue_priority,
            "queue_owner": event.queue_owner,
            "queued_at": event.queued_at,
            "next_attempt_at": event.next_attempt_at,
            "delivery_attempt_count": event.delivery_attempt_count,
            "processing_status": event.processing_status,
            "processing_error": event.processing_error,
            "dead_letter_reason": event.dead_letter_reason,
            "consumed_by_run_id": event.consumed_by_run_id,
            "created_at": event.created_at,
            "updated_at": event.updated_at,
        }
    )


def _event_record_to_table(event: EventRecord) -> EventTable:
    return EventTable(
        event_id=event.event_id,
        event_type=event.event_type,
        trigger_mode=event.trigger_mode,
        source_surface=event.source_surface,
        source_channel_id=event.source_channel_id,
        source_thread_ref=event.source_thread_ref,
        source_user_id=event.source_user_id,
        source_message_ref=event.source_message_ref,
        authenticated_principal_ref=event.authenticated_principal_ref,
        auth_status=event.auth_status,
        idempotency_key=event.idempotency_key,
        replay_window_key=event.replay_window_key,
        replay_window_expires_at=event.replay_window_expires_at,
        payload_text=event.payload_text,
        payload_structured=event.payload_structured,
        attachment_refs=event.attachment_refs,
        explicit_task_refs=event.explicit_task_refs,
        inferred_task_candidates=[candidate.model_dump(mode="json") for candidate in event.inferred_task_candidates],
        approval_response_data=event.approval_response_data,
        heartbeat_data=event.heartbeat_data,
        cron_data=event.cron_data,
        webhook_data=event.webhook_data,
        queue_class=event.queue_class,
        queue_priority=event.queue_priority,
        queue_owner=event.queue_owner,
        queued_at=event.queued_at,
        next_attempt_at=event.next_attempt_at,
        delivery_attempt_count=event.delivery_attempt_count,
        processing_status=event.processing_status,
        processing_error=event.processing_error,
        dead_letter_reason=event.dead_letter_reason,
        consumed_by_run_id=event.consumed_by_run_id,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


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

        task_record = _task_table_to_record(task)
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

    def transition_task_to_terminal(self, request: TerminalTaskTransitionRequest) -> TerminalTaskTransitionResult:
        task = self._session.execute(
            select(TaskTable).where(TaskTable.task_id == request.task_id).with_for_update()
        ).scalar_one()
        claim = self._session.execute(
            select(TaskClaimTable).where(TaskClaimTable.claim_id == request.claim_id).with_for_update()
        ).scalar_one()

        if claim.task_id != request.task_id:
            raise ClaimLifecycleError(
                f"claim {request.claim_id} does not belong to task {request.task_id}"
            )

        task_record = _task_table_to_record(task)
        transitioned_task = transition_task_status(
            task_record,
            request.terminal_status,
            transition_time=request.transitioned_at,
            pending_approval_id=None,
        )
        claim_record = _claim_table_to_record(claim)
        transitioned_claim = transition_claim_state(
            claim_record,
            ClaimState.RELEASED,
            transition_time=request.transitioned_at,
            release_reason=request.release_reason,
        )

        task.status = transitioned_task.status
        task.active_run_id = transitioned_task.active_run_id
        task.completed_at = transitioned_task.completed_at
        task.failed_at = transitioned_task.failed_at
        task.abandoned_at = transitioned_task.abandoned_at
        task.updated_at = transitioned_task.updated_at

        claim.claim_state = transitioned_claim.claim_state
        claim.released_at = transitioned_claim.released_at
        claim.release_reason = transitioned_claim.release_reason
        claim.updated_at = transitioned_claim.updated_at

        self._session.flush()
        return TerminalTaskTransitionResult(task=transitioned_task, claim=transitioned_claim)


class EventRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def record_event(self, event: EventRecord) -> EventPersistenceResult:
        existing_event = None
        if event.idempotency_key is not None:
            existing_event = self._session.execute(
                select(EventTable).where(EventTable.idempotency_key == event.idempotency_key)
            ).scalar_one_or_none()
        if existing_event is None:
            existing_event = self._session.get(EventTable, event.event_id)

        if existing_event is not None:
            return EventPersistenceResult(
                event=_event_table_to_record(existing_event),
                created=False,
                deduplicated=True,
            )

        persisted_event = _event_record_to_table(event)
        self._session.add(persisted_event)
        self._session.flush()
        return EventPersistenceResult(event=_event_table_to_record(persisted_event), created=True, deduplicated=False)

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
        if event.processing_status == EventProcessingStatus.CONSUMED:
            if event.consumed_by_run_id != consumed_by_run_id:
                raise ValueError(
                    f"event {event_id} already consumed by run {event.consumed_by_run_id}"
                )
            event.updated_at = when
            return
        event.processing_status = EventProcessingStatus.CONSUMED
        event.consumed_by_run_id = consumed_by_run_id
        event.queue_owner = None
        event.updated_at = when