from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from argentum.domain.models import MemoryRecord, TaskClaimRecord, TaskRecord
from argentum.domain.enums import TaskStatus
from argentum.persistence.repositories import (
    ClaimRepository,
    MaintenanceRepository,
    MemoryRepository,
    MemorySearchRequest,
    StaleClaimTransitionRequest,
    StaleTaskTransitionRequest,
)


@dataclass(slots=True, frozen=True)
class StaleWorkPolicy:
    stale_claim_task_status: TaskStatus = TaskStatus.STALLED
    waiting_human_timeout_status: TaskStatus = TaskStatus.NEEDS_OPERATOR_ATTENTION
    blocked_timeout_status: TaskStatus = TaskStatus.BLOCKED_TIMEOUT
    scheduled_timeout_status: TaskStatus = TaskStatus.EXPIRED


@dataclass(slots=True, frozen=True)
class HeartbeatInspectionResult:
    due_followups: list[TaskRecord]
    waiting_tasks: list[TaskRecord]
    blocked_tasks: list[TaskRecord]
    stale_claims: list[TaskClaimRecord]
    related_memories: list[MemoryRecord]


@dataclass(slots=True, frozen=True)
class RecoverySweepResult:
    expired_claims: list[TaskClaimRecord]
    updated_tasks: list[TaskRecord]


class HeartbeatMaintenanceService:
    def __init__(
        self,
        *,
        maintenance_repository: MaintenanceRepository,
        claim_repository: ClaimRepository,
        memory_repository: MemoryRepository,
    ) -> None:
        self._maintenance_repository = maintenance_repository
        self._claim_repository = claim_repository
        self._memory_repository = memory_repository

    def inspect(self, *, now: datetime, memory_query: str | None = None) -> HeartbeatInspectionResult:
        related_memories: list[MemoryRecord] = []
        if memory_query:
            related_memories = self._memory_repository.search_memories(
                MemorySearchRequest(query_text=memory_query, limit=5)
            )

        return HeartbeatInspectionResult(
            due_followups=self._maintenance_repository.list_due_scheduled_tasks(as_of=now),
            waiting_tasks=self._maintenance_repository.list_tasks_by_status(statuses=[TaskStatus.WAITING_HUMAN]),
            blocked_tasks=self._maintenance_repository.list_tasks_by_status(statuses=[TaskStatus.BLOCKED]),
            stale_claims=self._maintenance_repository.list_expired_active_claims(as_of=now),
            related_memories=related_memories,
        )

    def apply_recovery(self, *, now: datetime, policy: StaleWorkPolicy | None = None) -> RecoverySweepResult:
        resolved_policy = policy or StaleWorkPolicy()
        updated_tasks: list[TaskRecord] = []
        expired_claims = self._maintenance_repository.list_expired_active_claims(as_of=now)

        for claim in expired_claims:
            result = self._claim_repository.expire_stale_claim(
                StaleClaimTransitionRequest(
                    claim_id=claim.claim_id,
                    transitioned_at=now,
                    task_status=resolved_policy.stale_claim_task_status,
                    blocked_reason="execution lease expired before runtime completed",
                )
            )
            updated_tasks.append(result.task)

        for task in self._maintenance_repository.list_stale_tasks(
            as_of=now,
            statuses=[TaskStatus.WAITING_HUMAN],
        ):
            updated_tasks.append(
                self._maintenance_repository.transition_stale_task(
                    StaleTaskTransitionRequest(
                        task_id=task.task_id,
                        target_status=resolved_policy.waiting_human_timeout_status,
                        transitioned_at=now,
                        blocked_reason="approval expired without operator response",
                        continuation_hint=task.continuation_hint,
                    )
                )
            )

        for task in self._maintenance_repository.list_stale_tasks(
            as_of=now,
            statuses=[TaskStatus.BLOCKED],
        ):
            updated_tasks.append(
                self._maintenance_repository.transition_stale_task(
                    StaleTaskTransitionRequest(
                        task_id=task.task_id,
                        target_status=resolved_policy.blocked_timeout_status,
                        transitioned_at=now,
                        blocked_reason=task.blocked_reason or "blocked work exceeded stale threshold",
                    )
                )
            )

        for task in self._maintenance_repository.list_stale_tasks(
            as_of=now,
            statuses=[TaskStatus.SCHEDULED],
        ):
            updated_tasks.append(
                self._maintenance_repository.transition_stale_task(
                    StaleTaskTransitionRequest(
                        task_id=task.task_id,
                        target_status=resolved_policy.scheduled_timeout_status,
                        transitioned_at=now,
                        continuation_hint=task.continuation_hint,
                    )
                )
            )

        return RecoverySweepResult(expired_claims=expired_claims, updated_tasks=updated_tasks)