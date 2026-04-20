from __future__ import annotations

from datetime import UTC, datetime

from .enums import ClaimReleaseReason, ClaimState, TaskStatus
from .models import TaskClaimRecord, TaskRecord

TASK_TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    TaskStatus.PROPOSED: frozenset({TaskStatus.ACTIVE, TaskStatus.SCHEDULED, TaskStatus.ABANDONED}),
    TaskStatus.ACTIVE: frozenset(
        {
            TaskStatus.WAITING_HUMAN,
            TaskStatus.BLOCKED,
            TaskStatus.SCHEDULED,
            TaskStatus.COMPLETED,
            TaskStatus.FAILED,
            TaskStatus.STALLED,
            TaskStatus.ABANDONED,
            TaskStatus.NEEDS_OPERATOR_ATTENTION,
        }
    ),
    TaskStatus.WAITING_HUMAN: frozenset(
        {TaskStatus.ACTIVE, TaskStatus.BLOCKED_TIMEOUT, TaskStatus.ABANDONED, TaskStatus.NEEDS_OPERATOR_ATTENTION}
    ),
    TaskStatus.BLOCKED: frozenset(
        {TaskStatus.ACTIVE, TaskStatus.BLOCKED_TIMEOUT, TaskStatus.ABANDONED, TaskStatus.FAILED, TaskStatus.NEEDS_OPERATOR_ATTENTION}
    ),
    TaskStatus.SCHEDULED: frozenset({TaskStatus.ACTIVE, TaskStatus.EXPIRED, TaskStatus.ABANDONED}),
    TaskStatus.STALLED: frozenset({TaskStatus.ACTIVE, TaskStatus.ABANDONED, TaskStatus.NEEDS_OPERATOR_ATTENTION}),
    TaskStatus.BLOCKED_TIMEOUT: frozenset({TaskStatus.ACTIVE, TaskStatus.ABANDONED, TaskStatus.FAILED_TIMEOUT}),
    TaskStatus.NEEDS_OPERATOR_ATTENTION: frozenset({TaskStatus.ACTIVE, TaskStatus.ABANDONED}),
    TaskStatus.COMPLETED: frozenset(),
    TaskStatus.FAILED: frozenset(),
    TaskStatus.FAILED_TIMEOUT: frozenset(),
    TaskStatus.EXPIRED: frozenset(),
    TaskStatus.ABANDONED: frozenset(),
}

CLAIM_TRANSITIONS: dict[ClaimState, frozenset[ClaimState]] = {
    ClaimState.ACTIVE: frozenset({ClaimState.RELEASED, ClaimState.EXPIRED, ClaimState.INVALIDATED, ClaimState.SUPERSEDED}),
    ClaimState.EXPIRED: frozenset({ClaimState.SUPERSEDED, ClaimState.INVALIDATED}),
    ClaimState.RELEASED: frozenset(),
    ClaimState.SUPERSEDED: frozenset(),
    ClaimState.INVALIDATED: frozenset(),
}

TERMINAL_TASK_STATUSES = frozenset(
    {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.FAILED_TIMEOUT, TaskStatus.EXPIRED, TaskStatus.ABANDONED}
)
SUSPENDED_TASK_STATUSES = frozenset(
    {TaskStatus.WAITING_HUMAN, TaskStatus.BLOCKED, TaskStatus.STALLED, TaskStatus.BLOCKED_TIMEOUT, TaskStatus.NEEDS_OPERATOR_ATTENTION}
)


class TaskLifecycleError(ValueError):
    """Raised when a task transition violates the canonical state machine."""


class ClaimLifecycleError(ValueError):
    """Raised when a claim transition violates the canonical state machine."""


def _now_or(value: datetime | None) -> datetime:
    return value or datetime.now(tz=UTC)


def transition_task_status(
    task: TaskRecord,
    new_status: TaskStatus,
    *,
    transition_time: datetime | None = None,
    active_run_id: str | None = None,
    pending_approval_id: str | None = None,
) -> TaskRecord:
    if new_status not in TASK_TRANSITIONS[task.status]:
        raise TaskLifecycleError(f"illegal task transition: {task.status} -> {new_status}")

    when = _now_or(transition_time)
    updates: dict[str, object | None] = {
        "status": new_status,
        "updated_at": when,
        "pending_approval_id": pending_approval_id,
    }

    if new_status == TaskStatus.ACTIVE:
        resolved_run_id = active_run_id or task.active_run_id
        if resolved_run_id is None:
            raise TaskLifecycleError("entering active requires an active run identifier")
        updates["active_run_id"] = resolved_run_id
    elif new_status in TERMINAL_TASK_STATUSES | SUSPENDED_TASK_STATUSES:
        updates["active_run_id"] = None

    if new_status == TaskStatus.WAITING_HUMAN and pending_approval_id is None:
        raise TaskLifecycleError("entering waiting_human requires a pending approval identifier")
    if new_status == TaskStatus.COMPLETED:
        updates["completed_at"] = when
    if new_status in {TaskStatus.FAILED, TaskStatus.FAILED_TIMEOUT}:
        updates["failed_at"] = when
    if new_status == TaskStatus.ABANDONED:
        updates["abandoned_at"] = when

    return task.model_copy(update=updates)


def transition_claim_state(
    claim: TaskClaimRecord,
    new_state: ClaimState,
    *,
    transition_time: datetime | None = None,
    release_reason: ClaimReleaseReason | None = None,
    superseded_by_claim_id: str | None = None,
) -> TaskClaimRecord:
    if new_state not in CLAIM_TRANSITIONS[claim.claim_state]:
        raise ClaimLifecycleError(f"illegal claim transition: {claim.claim_state} -> {new_state}")

    when = _now_or(transition_time)
    updates: dict[str, object | None] = {
        "claim_state": new_state,
        "updated_at": when,
    }

    if new_state == ClaimState.RELEASED:
        if release_reason is None:
            raise ClaimLifecycleError("released claims require a release reason")
        updates["released_at"] = when
        updates["release_reason"] = release_reason

    if new_state == ClaimState.SUPERSEDED:
        if superseded_by_claim_id is None:
            raise ClaimLifecycleError("superseded claims require a successor claim id")
        updates["superseded_by_claim_id"] = superseded_by_claim_id

    return claim.model_copy(update=updates)


def ensure_exclusive_active_claims(
    task_id: str,
    claims: list[TaskClaimRecord],
    *,
    as_of: datetime | None = None,
) -> None:
    now = _now_or(as_of)
    active_unexpired_claims = [
        claim
        for claim in claims
        if claim.task_id == task_id and claim.claim_state == ClaimState.ACTIVE and claim.lease_expires_at > now
    ]
    if len(active_unexpired_claims) > 1:
        claim_ids = ", ".join(claim.claim_id for claim in active_unexpired_claims)
        raise ClaimLifecycleError(f"multiple active unexpired claims exist for task {task_id}: {claim_ids}")