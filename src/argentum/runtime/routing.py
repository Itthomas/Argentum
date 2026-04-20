from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from argentum.domain.models import (
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


class ModelGateway(Protocol):
    def invoke(self, selection: ModelSelection, prompt: str, *, structured_output_schema: type[Any] | None = None) -> Any:
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
    )


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
    def __init__(self, gateway: ModelGateway, policy: ModelRoutingPolicy) -> None:
        self._gateway = gateway
        self._policy = policy

    def invoke_operation(
        self,
        operation_type: OperationType,
        prompt: str,
        *,
        provider_health: list[ProviderHealthRecord],
        now: datetime | None = None,
        prefer_escalation: bool = False,
        structured_output_schema: type[Any] | None = None,
    ) -> tuple[ModelSelection, Any]:
        selection = select_route(
            self._policy,
            provider_health,
            operation_type,
            now=now,
            prefer_escalation=prefer_escalation,
            require_structured_output=structured_output_schema is not None,
        )
        result = self._gateway.invoke(selection, prompt, structured_output_schema=structured_output_schema)
        return selection, result