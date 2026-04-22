from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

from argentum.domain.models import (
    ActivityKind,
    ActivityRecord,
    BudgetProfile,
    FallbackProfile,
    ModelRoutingPolicy,
    ModelTier,
    OperationRoutingRule,
    OperationType,
    ProviderHealthRecord,
    ProviderHealthStatus,
    ProviderMapping,
    TimeoutProfile,
)


class RoutingPolicyError(ValueError):
    """Raised when routing policy resolution cannot find a valid model path."""


@dataclass(slots=True, frozen=True)
class ModelSelection:
    provider_id: str
    model_name: str
    tier: ModelTier
    operation_type: OperationType
    timeout_profile: TimeoutProfile
    fallback_profile: FallbackProfile
    budget_profile: BudgetProfile
    preferred_provider_id: str | None = None
    fallback_from_provider_id: str | None = None
    fallback_reason: str | None = None
    selected_from_degraded_pool: bool = False


@dataclass(slots=True, frozen=True)
class RoutingActivityContext:
    task_id: str | None = None
    run_id: str | None = None
    generated_tool_id: str | None = None


class ModelGateway(Protocol):
    async def invoke(
        self,
        selection: ModelSelection,
        prompt: str,
        *,
        structured_output_schema: type[Any] | None = None,
    ) -> Any:
        ...


class ActivitySink(Protocol):
    def record_activity(self, activity: ActivityRecord) -> ActivityRecord:
        ...


def build_default_routing_policy(now: datetime) -> ModelRoutingPolicy:
    operation_defaults = {
        OperationType.INGRESS_NORMALIZATION: ModelTier.UTILITY,
        OperationType.TASK_RESOLUTION_SUPPORT: ModelTier.UTILITY,
        OperationType.CONTEXT_COMPRESSION: ModelTier.UTILITY,
        OperationType.STANDARD_RUNTIME_TURN: ModelTier.STANDARD,
        OperationType.DEEP_PLANNING: ModelTier.DEEP_REASONING,
        OperationType.APPROVAL_REASONING: ModelTier.DEEP_REASONING,
        OperationType.TOOL_AUTHORING: ModelTier.CRITICAL,
        OperationType.TOOL_VERIFICATION: ModelTier.CRITICAL,
        OperationType.HEARTBEAT_MAINTENANCE: ModelTier.UTILITY,
        OperationType.SUBAGENT_ANALYSIS: ModelTier.STANDARD,
        OperationType.SUBAGENT_EXECUTION: ModelTier.STANDARD,
        OperationType.CONFLICT_RESOLUTION: ModelTier.CRITICAL,
    }
    provider_mappings = [
        ProviderMapping(
            provider_id="gemini",
            provider_name="Gemini",
            tiers_supported=[ModelTier.UTILITY, ModelTier.STANDARD, ModelTier.DEEP_REASONING, ModelTier.CRITICAL],
            default_models_by_tier={
                ModelTier.UTILITY: "gemini-2.5-flash",
                ModelTier.STANDARD: "gemini-2.5-flash",
                ModelTier.DEEP_REASONING: "gemini-2.5-pro",
                ModelTier.CRITICAL: "gemini-2.5-pro",
            },
            max_context_by_model={"gemini-2.5-flash": 1_000_000, "gemini-2.5-pro": 1_000_000},
            supports_streaming=True,
            supports_structured_output=True,
            supports_reasoning_mode=True,
        ),
        ProviderMapping(
            provider_id="deepseek",
            provider_name="DeepSeek",
            tiers_supported=[ModelTier.STANDARD, ModelTier.DEEP_REASONING, ModelTier.CRITICAL],
            default_models_by_tier={
                ModelTier.STANDARD: "deepseek-chat",
                ModelTier.DEEP_REASONING: "deepseek-reasoner",
                ModelTier.CRITICAL: "deepseek-reasoner",
            },
            max_context_by_model={"deepseek-chat": 128_000, "deepseek-reasoner": 128_000},
            supports_streaming=True,
            supports_structured_output=True,
            supports_reasoning_mode=True,
        ),
    ]

    operation_mappings = [
        OperationRoutingRule(
            operation_type=operation_type,
            default_tier=default_tier,
            escalation_tier=_default_escalation_tier(default_tier),
            allow_downgrade=operation_type not in {OperationType.TOOL_AUTHORING, OperationType.TOOL_VERIFICATION},
            require_structured_output=operation_type
            in {
                OperationType.TASK_RESOLUTION_SUPPORT,
                OperationType.APPROVAL_REASONING,
                OperationType.TOOL_AUTHORING,
                OperationType.TOOL_VERIFICATION,
                OperationType.CONFLICT_RESOLUTION,
            },
            latency_sensitive=operation_type in {OperationType.INGRESS_NORMALIZATION, OperationType.CONTEXT_COMPRESSION},
            high_consequence=operation_type
            in {
                OperationType.APPROVAL_REASONING,
                OperationType.TOOL_AUTHORING,
                OperationType.TOOL_VERIFICATION,
                OperationType.CONFLICT_RESOLUTION,
            },
            notes=None,
        )
        for operation_type, default_tier in operation_defaults.items()
    ]

    timeout_profiles = [
        TimeoutProfile(
            name="default",
            operation_types=list(operation_defaults.keys()),
            request_timeout_seconds=60,
            stream_idle_timeout_seconds=15,
            max_retries=1,
        ),
        TimeoutProfile(
            name="critical",
            operation_types=[OperationType.APPROVAL_REASONING, OperationType.TOOL_AUTHORING, OperationType.TOOL_VERIFICATION],
            request_timeout_seconds=120,
            stream_idle_timeout_seconds=20,
            max_retries=2,
        ),
    ]

    fallback_profiles = [
        FallbackProfile(
            name="default",
            operation_types=list(operation_defaults.keys()),
            on_timeout="retry_other_provider_same_tier",
            on_rate_limit="queue_for_retry",
            on_malformed_output="reassemble_context_and_retry",
            on_overflow="reassemble_context_and_retry",
            on_provider_unavailable="retry_other_provider_same_tier",
        ),
        FallbackProfile(
            name="critical",
            operation_types=[OperationType.APPROVAL_REASONING, OperationType.TOOL_AUTHORING, OperationType.TOOL_VERIFICATION],
            on_timeout="escalate_tier",
            on_rate_limit="fail_operator_visible",
            on_malformed_output="fail_operator_visible",
            on_overflow="reassemble_context_and_retry",
            on_provider_unavailable="fail_operator_visible",
        ),
    ]

    budget_profiles = [
        BudgetProfile(
            name="default",
            operation_types=list(operation_defaults.keys()),
            max_cost_class="normal",
            max_input_tokens=2400,
            prefer_low_latency=False,
        ),
        BudgetProfile(
            name="critical",
            operation_types=[OperationType.APPROVAL_REASONING, OperationType.TOOL_AUTHORING, OperationType.TOOL_VERIFICATION],
            max_cost_class="critical",
            max_input_tokens=4000,
            prefer_low_latency=False,
        ),
    ]

    return ModelRoutingPolicy(
        policy_id="default-phase2-routing-policy",
        version="phase2-v1",
        active=True,
        provider_mappings=provider_mappings,
        operation_mappings=operation_mappings,
        timeout_profiles=timeout_profiles,
        fallback_profiles=fallback_profiles,
        budget_profiles=budget_profiles,
        created_at=now,
        updated_at=now,
    )


def _default_escalation_tier(default_tier: ModelTier) -> ModelTier | None:
    escalation_by_tier = {
        ModelTier.UTILITY: ModelTier.STANDARD,
        ModelTier.STANDARD: ModelTier.DEEP_REASONING,
        ModelTier.DEEP_REASONING: ModelTier.CRITICAL,
        ModelTier.CRITICAL: None,
    }
    return escalation_by_tier[default_tier]


def _tier_order() -> list[ModelTier]:
    return [ModelTier.UTILITY, ModelTier.STANDARD, ModelTier.DEEP_REASONING, ModelTier.CRITICAL]


def select_route(
    policy: ModelRoutingPolicy,
    provider_health: list[ProviderHealthRecord],
    operation_type: OperationType,
    *,
    now: datetime | None = None,
    prefer_escalation: bool = False,
    require_structured_output: bool | None = None,
) -> ModelSelection:
    at = now or datetime.now(tz=UTC)
    rule = next((mapping for mapping in policy.operation_mappings if mapping.operation_type == operation_type), None)
    if rule is None:
        raise RoutingPolicyError(f"no routing rule exists for operation {operation_type}")

    target_tier = rule.escalation_tier if prefer_escalation and rule.escalation_tier is not None else rule.default_tier
    required_structured_output = rule.require_structured_output if require_structured_output is None else require_structured_output

    selection = _resolve_selection(policy, provider_health, operation_type, target_tier, required_structured_output, at)
    if selection is not None:
        return selection

    if rule.allow_downgrade:
        order = _tier_order()
        target_index = order.index(target_tier)
        for fallback_tier in reversed(order[:target_index]):
            selection = _resolve_selection(policy, provider_health, operation_type, fallback_tier, required_structured_output, at)
            if selection is not None:
                return selection

    raise RoutingPolicyError(f"no available provider supports operation {operation_type} at tier {target_tier}")


def _resolve_selection(
    policy: ModelRoutingPolicy,
    provider_health: list[ProviderHealthRecord],
    operation_type: OperationType,
    tier: ModelTier,
    required_structured_output: bool,
    now: datetime,
) -> ModelSelection | None:
    health_by_provider = {health.provider_id: health for health in provider_health}

    candidates: list[ProviderMapping] = []
    for provider in policy.provider_mappings:
        if tier not in provider.tiers_supported:
            continue
        if tier not in provider.default_models_by_tier:
            continue
        if required_structured_output and not provider.supports_structured_output:
            continue
        candidates.append(provider)

    if not candidates:
        return None

    preferred_candidate = candidates[0]

    healthy_candidates = []
    degraded_candidates = []
    for candidate in candidates:
        health = health_by_provider.get(candidate.provider_id)
        if health is None or health.health_status == ProviderHealthStatus.HEALTHY:
            healthy_candidates.append(candidate)
            continue
        if health.health_status == ProviderHealthStatus.DEGRADED and (health.degraded_until is None or health.degraded_until <= now):
            healthy_candidates.append(candidate)
            continue
        degraded_candidates.append(candidate)

    chosen_provider = healthy_candidates[0] if healthy_candidates else (degraded_candidates[0] if degraded_candidates else None)
    if chosen_provider is None:
        return None

    selected_from_degraded_pool = not healthy_candidates and bool(degraded_candidates)
    fallback_from_provider_id = None
    fallback_reason = None
    if chosen_provider.provider_id != preferred_candidate.provider_id:
        fallback_from_provider_id = preferred_candidate.provider_id
        fallback_reason = _fallback_reason_for_provider(health_by_provider.get(preferred_candidate.provider_id), now)
    elif selected_from_degraded_pool:
        fallback_reason = "no_healthy_provider_available"

    timeout_profile = _find_timeout_profile(policy, operation_type)
    fallback_profile = _find_fallback_profile(policy, operation_type)
    budget_profile = _find_budget_profile(policy, operation_type)
    return ModelSelection(
        provider_id=chosen_provider.provider_id,
        model_name=chosen_provider.default_models_by_tier[tier],
        tier=tier,
        operation_type=operation_type,
        timeout_profile=timeout_profile,
        fallback_profile=fallback_profile,
        budget_profile=budget_profile,
        preferred_provider_id=preferred_candidate.provider_id,
        fallback_from_provider_id=fallback_from_provider_id,
        fallback_reason=fallback_reason,
        selected_from_degraded_pool=selected_from_degraded_pool,
    )


def _fallback_reason_for_provider(provider_health: ProviderHealthRecord | None, now: datetime) -> str:
    if provider_health is None:
        return "policy_preference_shift"
    if provider_health.health_status == ProviderHealthStatus.UNAVAILABLE:
        return "provider_unavailable"
    if provider_health.health_status == ProviderHealthStatus.DEGRADED and (
        provider_health.degraded_until is None or provider_health.degraded_until > now
    ):
        return "provider_degraded"
    return "provider_unhealthy"


def _find_timeout_profile(policy: ModelRoutingPolicy, operation_type: OperationType) -> TimeoutProfile:
    profile = next((item for item in policy.timeout_profiles if operation_type in item.operation_types), None)
    if profile is None:
        raise RoutingPolicyError(f"no timeout profile exists for operation {operation_type}")
    return profile


def _find_fallback_profile(policy: ModelRoutingPolicy, operation_type: OperationType) -> FallbackProfile:
    profile = next((item for item in policy.fallback_profiles if operation_type in item.operation_types), None)
    if profile is None:
        raise RoutingPolicyError(f"no fallback profile exists for operation {operation_type}")
    return profile


def _find_budget_profile(policy: ModelRoutingPolicy, operation_type: OperationType) -> BudgetProfile:
    profile = next((item for item in policy.budget_profiles if operation_type in item.operation_types), None)
    if profile is None:
        raise RoutingPolicyError(f"no budget profile exists for operation {operation_type}")
    return profile


class LLMOrchestrator:
    def __init__(
        self,
        gateway: ModelGateway,
        policy: ModelRoutingPolicy,
        *,
        activity_sink: ActivitySink | None = None,
    ) -> None:
        self._gateway = gateway
        self._policy = policy
        self._activity_sink = activity_sink

    async def invoke_operation(
        self,
        operation_type: OperationType,
        prompt: str,
        *,
        provider_health: list[ProviderHealthRecord],
        now: datetime | None = None,
        prefer_escalation: bool = False,
        structured_output_schema: type[Any] | None = None,
        activity_context: RoutingActivityContext | None = None,
    ) -> tuple[ModelSelection, Any]:
        selection = select_route(
            self._policy,
            provider_health,
            operation_type,
            now=now,
            prefer_escalation=prefer_escalation,
            require_structured_output=structured_output_schema is not None,
        )
        occurred_at = now or datetime.now(tz=UTC)
        try:
            result = await self._gateway.invoke(selection, prompt, structured_output_schema=structured_output_schema)
        except Exception as exc:
            self._record_routing_activity(selection, activity_context, occurred_at, gateway_outcome="error", error_message=str(exc))
            raise
        self._record_routing_activity(selection, activity_context, occurred_at, gateway_outcome="success")
        return selection, result

    def _record_routing_activity(
        self,
        selection: ModelSelection,
        activity_context: RoutingActivityContext | None,
        occurred_at: datetime,
        *,
        gateway_outcome: str,
        error_message: str | None = None,
    ) -> None:
        if self._activity_sink is None:
            return

        fallback_suffix = ""
        if selection.fallback_from_provider_id is not None:
            fallback_suffix = f" after fallback from {selection.fallback_from_provider_id}"
        self._activity_sink.record_activity(
            ActivityRecord(
                activity_id=f"activity-{uuid4().hex}",
                activity_kind=ActivityKind.PROVIDER_ROUTING,
                task_id=activity_context.task_id if activity_context is not None else None,
                run_id=activity_context.run_id if activity_context is not None else None,
                generated_tool_id=activity_context.generated_tool_id if activity_context is not None else None,
                provider_id=selection.provider_id,
                model_name=selection.model_name,
                summary=(
                    f"Routed {selection.operation_type} to {selection.provider_id}/{selection.model_name}{fallback_suffix}"
                ),
                detail=error_message,
                fallback_from_provider_id=selection.fallback_from_provider_id,
                fallback_reason=selection.fallback_reason,
                metadata_json={
                    "budget_profile": selection.budget_profile.name,
                    "fallback_profile": selection.fallback_profile.name,
                    "gateway_outcome": gateway_outcome,
                    "preferred_provider_id": selection.preferred_provider_id,
                    "selected_from_degraded_pool": selection.selected_from_degraded_pool,
                    "tier": selection.tier,
                    "timeout_profile": selection.timeout_profile.name,
                },
                created_at=occurred_at,
                updated_at=occurred_at,
            )
        )