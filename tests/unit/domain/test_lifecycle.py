from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from argentum.domain.enums import ClaimReleaseReason, ClaimState, TaskStatus, TaskType
from argentum.domain.lifecycle import (
    ClaimLifecycleError,
    TaskLifecycleError,
    ensure_exclusive_active_claims,
    transition_claim_state,
    transition_task_status,
)
from argentum.domain.models import TaskClaimRecord, TaskRecord


def timestamp() -> datetime:
    return datetime(2026, 4, 20, 12, 0, tzinfo=UTC)


def build_task(status: TaskStatus, *, active_run_id: str | None = None) -> TaskRecord:
    return TaskRecord(
        task_id="task-1",
        title="Example task",
        objective="Example objective",
        normalized_objective="example objective",
        task_type=TaskType.EXECUTION_TASK,
        status=status,
        priority=1,
        created_by_event_id="event-1",
        active_run_id=active_run_id,
        created_at=timestamp(),
        updated_at=timestamp(),
    )


def build_claim(
    claim_id: str,
    *,
    state: ClaimState = ClaimState.ACTIVE,
    lease_expires_at: datetime | None = None,
) -> TaskClaimRecord:
    when = timestamp()
    return TaskClaimRecord(
        claim_id=claim_id,
        task_id="task-1",
        run_id=f"run-{claim_id}",
        claimed_by="runtime-a",
        claim_state=state,
        claimed_at=when,
        lease_expires_at=lease_expires_at or (when + timedelta(minutes=5)),
        created_at=when,
        updated_at=when,
    )


def test_transition_task_status_allows_proposed_to_active_with_run() -> None:
    transitioned = transition_task_status(
        build_task(TaskStatus.PROPOSED),
        TaskStatus.ACTIVE,
        active_run_id="run-1",
        transition_time=timestamp(),
    )

    assert transitioned.status == TaskStatus.ACTIVE
    assert transitioned.active_run_id == "run-1"


def test_transition_task_status_rejects_illegal_transition() -> None:
    with pytest.raises(TaskLifecycleError, match="illegal task transition"):
        transition_task_status(build_task(TaskStatus.ACTIVE, active_run_id="run-1"), TaskStatus.PROPOSED)


def test_transition_task_status_requires_pending_approval_for_waiting_human() -> None:
    with pytest.raises(TaskLifecycleError, match="pending approval"):
        transition_task_status(
            build_task(TaskStatus.ACTIVE, active_run_id="run-1"),
            TaskStatus.WAITING_HUMAN,
            transition_time=timestamp(),
        )


def test_transition_claim_state_requires_release_reason() -> None:
    with pytest.raises(ClaimLifecycleError, match="release reason"):
        transition_claim_state(build_claim("claim-1"), ClaimState.RELEASED)


def test_transition_claim_state_records_release_metadata() -> None:
    transitioned = transition_claim_state(
        build_claim("claim-1"),
        ClaimState.RELEASED,
        transition_time=timestamp(),
        release_reason=ClaimReleaseReason.COMPLETED,
    )

    assert transitioned.claim_state == ClaimState.RELEASED
    assert transitioned.release_reason == ClaimReleaseReason.COMPLETED
    assert transitioned.released_at == timestamp()


def test_ensure_exclusive_active_claims_rejects_multiple_active_unexpired_claims() -> None:
    with pytest.raises(ClaimLifecycleError, match="multiple active unexpired claims"):
        ensure_exclusive_active_claims("task-1", [build_claim("claim-1"), build_claim("claim-2")], as_of=timestamp())


def test_ensure_exclusive_active_claims_allows_expired_claim_alongside_active_claim() -> None:
    ensure_exclusive_active_claims(
        "task-1",
        [
            build_claim("claim-1"),
            build_claim("claim-2", lease_expires_at=timestamp() - timedelta(minutes=1)),
        ],
        as_of=timestamp(),
    )