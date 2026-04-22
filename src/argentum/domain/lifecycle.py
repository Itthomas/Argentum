from __future__ import annotations

from datetime import UTC, datetime

from .enums import (
    ApprovalDecision,
    ApprovalStatus,
    ClaimReleaseReason,
    ClaimState,
    GeneratedToolLifecycleState,
    SubagentStatus,
    TaskStatus,
    ToolActivationScope,
)
from .models import ApprovalRecord, GeneratedToolRecord, SubagentRecord, TaskClaimRecord, TaskRecord

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
        {
            TaskStatus.ACTIVE,
            TaskStatus.SCHEDULED,
            TaskStatus.BLOCKED_TIMEOUT,
            TaskStatus.ABANDONED,
            TaskStatus.FAILED,
            TaskStatus.NEEDS_OPERATOR_ATTENTION,
        }
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

APPROVAL_TRANSITIONS: dict[ApprovalStatus, frozenset[ApprovalStatus]] = {
    ApprovalStatus.PENDING: frozenset(
        {
            ApprovalStatus.REMINDED,
            ApprovalStatus.APPROVED,
            ApprovalStatus.DENIED,
            ApprovalStatus.EXPIRED,
            ApprovalStatus.CANCELLED,
        }
    ),
    ApprovalStatus.REMINDED: frozenset(
        {
            ApprovalStatus.REMINDED,
            ApprovalStatus.APPROVED,
            ApprovalStatus.DENIED,
            ApprovalStatus.EXPIRED,
            ApprovalStatus.CANCELLED,
        }
    ),
    ApprovalStatus.APPROVED: frozenset(),
    ApprovalStatus.DENIED: frozenset(),
    ApprovalStatus.EXPIRED: frozenset(),
    ApprovalStatus.CANCELLED: frozenset(),
}

SUBAGENT_TRANSITIONS: dict[SubagentStatus, frozenset[SubagentStatus]] = {
    SubagentStatus.PROPOSED: frozenset({SubagentStatus.RUNNING, SubagentStatus.CANCELLED}),
    SubagentStatus.RUNNING: frozenset(
        {SubagentStatus.COMPLETED, SubagentStatus.FAILED, SubagentStatus.TIMED_OUT, SubagentStatus.LOST, SubagentStatus.CANCELLED}
    ),
    SubagentStatus.COMPLETED: frozenset(),
    SubagentStatus.FAILED: frozenset(),
    SubagentStatus.TIMED_OUT: frozenset(),
    SubagentStatus.LOST: frozenset(),
    SubagentStatus.CANCELLED: frozenset(),
}

GENERATED_TOOL_TRANSITIONS: dict[GeneratedToolLifecycleState, frozenset[GeneratedToolLifecycleState]] = {
    GeneratedToolLifecycleState.PROPOSED: frozenset({GeneratedToolLifecycleState.VALIDATING, GeneratedToolLifecycleState.ARCHIVED}),
    GeneratedToolLifecycleState.VALIDATING: frozenset(
        {GeneratedToolLifecycleState.VERIFIED, GeneratedToolLifecycleState.DISABLED, GeneratedToolLifecycleState.ARCHIVED}
    ),
    GeneratedToolLifecycleState.VERIFIED: frozenset(
        {
            GeneratedToolLifecycleState.APPROVAL_PENDING,
            GeneratedToolLifecycleState.DISABLED,
            GeneratedToolLifecycleState.ARCHIVED,
        }
    ),
    GeneratedToolLifecycleState.APPROVAL_PENDING: frozenset(
        {GeneratedToolLifecycleState.APPROVED, GeneratedToolLifecycleState.DISABLED, GeneratedToolLifecycleState.ARCHIVED}
    ),
    GeneratedToolLifecycleState.APPROVED: frozenset(
        {
            GeneratedToolLifecycleState.QUARANTINED,
            GeneratedToolLifecycleState.LIMITED,
            GeneratedToolLifecycleState.GLOBAL,
            GeneratedToolLifecycleState.DISABLED,
            GeneratedToolLifecycleState.SUPERSEDED,
            GeneratedToolLifecycleState.ARCHIVED,
        }
    ),
    GeneratedToolLifecycleState.QUARANTINED: frozenset(
        {
            GeneratedToolLifecycleState.LIMITED,
            GeneratedToolLifecycleState.GLOBAL,
            GeneratedToolLifecycleState.DISABLED,
            GeneratedToolLifecycleState.SUPERSEDED,
            GeneratedToolLifecycleState.ARCHIVED,
        }
    ),
    GeneratedToolLifecycleState.LIMITED: frozenset(
        {
            GeneratedToolLifecycleState.GLOBAL,
            GeneratedToolLifecycleState.DISABLED,
            GeneratedToolLifecycleState.SUPERSEDED,
            GeneratedToolLifecycleState.ARCHIVED,
        }
    ),
    GeneratedToolLifecycleState.GLOBAL: frozenset(
        {
            GeneratedToolLifecycleState.DISABLED,
            GeneratedToolLifecycleState.SUPERSEDED,
            GeneratedToolLifecycleState.ARCHIVED,
        }
    ),
    GeneratedToolLifecycleState.DISABLED: frozenset(
        {GeneratedToolLifecycleState.APPROVED, GeneratedToolLifecycleState.ARCHIVED, GeneratedToolLifecycleState.SUPERSEDED}
    ),
    GeneratedToolLifecycleState.SUPERSEDED: frozenset({GeneratedToolLifecycleState.ARCHIVED}),
    GeneratedToolLifecycleState.ARCHIVED: frozenset(),
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


class ApprovalLifecycleError(ValueError):
    """Raised when an approval transition violates the canonical state machine."""


class SubagentLifecycleError(ValueError):
    """Raised when a subagent transition violates the canonical state machine."""


class GeneratedToolLifecycleError(ValueError):
    """Raised when a generated-tool transition violates the canonical state machine."""


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


def transition_approval_status(
    approval: ApprovalRecord,
    new_status: ApprovalStatus,
    *,
    transition_time: datetime | None = None,
    next_reminder_at: datetime | None = None,
    decision: ApprovalDecision | None = None,
    resolved_by_user_id: str | None = None,
    resolved_by_session_id: str | None = None,
    resolution_payload_hash: str | None = None,
    operator_comment: str | None = None,
) -> ApprovalRecord:
    if new_status not in APPROVAL_TRANSITIONS[approval.status]:
        raise ApprovalLifecycleError(f"illegal approval transition: {approval.status} -> {new_status}")

    when = _now_or(transition_time)
    updates: dict[str, object | None] = {
        "status": new_status,
        "updated_at": when,
    }

    if new_status == ApprovalStatus.REMINDED:
        updates["reminder_count"] = approval.reminder_count + 1
        updates["next_reminder_at"] = next_reminder_at

    if new_status in {ApprovalStatus.APPROVED, ApprovalStatus.DENIED, ApprovalStatus.CANCELLED}:
        if decision is None:
            raise ApprovalLifecycleError("resolved approvals require an explicit decision")
        if resolved_by_user_id is None:
            raise ApprovalLifecycleError("resolved approvals require an operator identity")
        if resolution_payload_hash is None:
            raise ApprovalLifecycleError("resolved approvals require a durable payload hash")
        updates["decision"] = decision
        updates["resolved_at"] = when
        updates["resolved_by_user_id"] = resolved_by_user_id
        updates["resolved_by_session_id"] = resolved_by_session_id
        updates["resolution_payload_hash"] = resolution_payload_hash
        updates["operator_comment"] = operator_comment

    if new_status == ApprovalStatus.EXPIRED:
        updates["resolved_at"] = when

    return approval.model_copy(update=updates)


def transition_subagent_status(
    subagent: SubagentRecord,
    new_status: SubagentStatus,
    *,
    transition_time: datetime | None = None,
    heartbeat_at: datetime | None = None,
    result_artifact_refs: list[str] | None = None,
    error_summary: str | None = None,
) -> SubagentRecord:
    if new_status not in SUBAGENT_TRANSITIONS[subagent.status]:
        raise SubagentLifecycleError(f"illegal subagent transition: {subagent.status} -> {new_status}")

    when = _now_or(transition_time)
    updates: dict[str, object | None] = {
        "status": new_status,
        "updated_at": when,
    }

    if heartbeat_at is not None:
        updates["heartbeat_at"] = heartbeat_at

    if new_status == SubagentStatus.RUNNING:
        updates["started_at"] = subagent.started_at or when
    elif new_status == SubagentStatus.COMPLETED:
        updates["completed_at"] = when
        updates["result_artifact_refs"] = list(result_artifact_refs or subagent.result_artifact_refs)
        updates["error_summary"] = None
    elif new_status == SubagentStatus.FAILED:
        updates["failed_at"] = when
        updates["error_summary"] = error_summary
    elif new_status in {SubagentStatus.TIMED_OUT, SubagentStatus.LOST}:
        updates["timeout_at"] = when
        updates["error_summary"] = error_summary
    elif new_status == SubagentStatus.CANCELLED:
        updates["error_summary"] = error_summary

    return subagent.model_copy(update=updates)


def transition_generated_tool_state(
    generated_tool: GeneratedToolRecord,
    new_state: GeneratedToolLifecycleState,
    *,
    transition_time: datetime | None = None,
    activation_scope: ToolActivationScope | None = None,
    requested_approval_id: str | None = None,
    quarantine_until: datetime | None = None,
    activated_at: datetime | None = None,
    disabled_reason: str | None = None,
    superseded_by_tool_id: str | None = None,
    rollback_of_tool_id: str | None = None,
) -> GeneratedToolRecord:
    if new_state not in GENERATED_TOOL_TRANSITIONS[generated_tool.lifecycle_state]:
        raise GeneratedToolLifecycleError(
            f"illegal generated-tool transition: {generated_tool.lifecycle_state} -> {new_state}"
        )

    when = _now_or(transition_time)
    resolved_scope = activation_scope or _default_activation_scope(new_state, generated_tool.activation_scope)
    updates: dict[str, object | None] = {
        "lifecycle_state": new_state,
        "activation_scope": resolved_scope,
        "requested_approval_id": requested_approval_id or generated_tool.requested_approval_id,
        "quarantine_until": quarantine_until if quarantine_until is not None else generated_tool.quarantine_until,
        "rollback_of_tool_id": rollback_of_tool_id if rollback_of_tool_id is not None else generated_tool.rollback_of_tool_id,
        "updated_at": when,
    }

    if new_state in {
        GeneratedToolLifecycleState.QUARANTINED,
        GeneratedToolLifecycleState.LIMITED,
        GeneratedToolLifecycleState.GLOBAL,
    }:
        updates["activated_at"] = activated_at or generated_tool.activated_at or when

    if new_state == GeneratedToolLifecycleState.DISABLED:
        if disabled_reason is None and generated_tool.disabled_reason is None:
            raise GeneratedToolLifecycleError("disabled generated tools require a disabled_reason")
        updates["disabled_at"] = when
        updates["disabled_reason"] = disabled_reason or generated_tool.disabled_reason

    if new_state == GeneratedToolLifecycleState.SUPERSEDED:
        if superseded_by_tool_id is None:
            raise GeneratedToolLifecycleError("superseded generated tools require a replacement tool id")
        updates["superseded_by_tool_id"] = superseded_by_tool_id

    return generated_tool.model_copy(update=updates)


def _default_activation_scope(
    lifecycle_state: GeneratedToolLifecycleState,
    current_scope: ToolActivationScope,
) -> ToolActivationScope:
    scope_by_state = {
        GeneratedToolLifecycleState.PROPOSED: ToolActivationScope.NONE,
        GeneratedToolLifecycleState.VALIDATING: ToolActivationScope.NONE,
        GeneratedToolLifecycleState.VERIFIED: ToolActivationScope.NONE,
        GeneratedToolLifecycleState.APPROVAL_PENDING: ToolActivationScope.NONE,
        GeneratedToolLifecycleState.APPROVED: current_scope if current_scope == ToolActivationScope.SHADOW else ToolActivationScope.NONE,
        GeneratedToolLifecycleState.QUARANTINED: ToolActivationScope.QUARANTINE,
        GeneratedToolLifecycleState.LIMITED: ToolActivationScope.LIMITED,
        GeneratedToolLifecycleState.GLOBAL: ToolActivationScope.GLOBAL,
        GeneratedToolLifecycleState.DISABLED: current_scope,
        GeneratedToolLifecycleState.SUPERSEDED: current_scope,
        GeneratedToolLifecycleState.ARCHIVED: current_scope,
    }
    return scope_by_state[lifecycle_state]


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