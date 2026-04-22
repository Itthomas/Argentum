from __future__ import annotations

from argentum.domain.models import ActivityRecord, GeneratedToolRecord, ProviderHealthRecord
from argentum.persistence.repositories import ActivityRepository, GeneratedToolRepository, ProviderHealthRepository
from pydantic import Field

from argentum.domain.models import ArgentumModel


class ProviderRoutingReport(ArgentumModel):
    provider_health: list[ProviderHealthRecord] = Field(default_factory=list)
    recent_routing_activity: list[ActivityRecord] = Field(default_factory=list)


class GeneratedToolLifecycleReport(ArgentumModel):
    generated_tools: list[GeneratedToolRecord] = Field(default_factory=list)
    recent_lifecycle_activity: list[ActivityRecord] = Field(default_factory=list)


class TaskActivityReport(ArgentumModel):
    task_id: str
    recent_activity: list[ActivityRecord] = Field(default_factory=list)


class ObservabilityService:
    def __init__(
        self,
        *,
        activity_repository: ActivityRepository,
        generated_tool_repository: GeneratedToolRepository,
        provider_health_repository: ProviderHealthRepository,
    ) -> None:
        self._activity_repository = activity_repository
        self._generated_tool_repository = generated_tool_repository
        self._provider_health_repository = provider_health_repository

    def build_provider_routing_report(self, *, limit: int = 20) -> ProviderRoutingReport:
        return ProviderRoutingReport(
            provider_health=self._provider_health_repository.list_provider_health(),
            recent_routing_activity=self._activity_repository.list_activity(activity_kinds=["provider_routing"], limit=limit),
        )

    def build_generated_tool_lifecycle_report(self, *, limit: int = 20) -> GeneratedToolLifecycleReport:
        return GeneratedToolLifecycleReport(
            generated_tools=self._generated_tool_repository.list_generated_tools(limit=limit),
            recent_lifecycle_activity=self._activity_repository.list_activity(
                activity_kinds=["generated_tool_lifecycle"],
                limit=limit,
            ),
        )

    def build_task_activity_report(self, task_id: str, *, limit: int = 20) -> TaskActivityReport:
        return TaskActivityReport(
            task_id=task_id,
            recent_activity=self._activity_repository.list_activity(task_id=task_id, limit=limit),
        )