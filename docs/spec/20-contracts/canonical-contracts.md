# Canonical Contracts

## Purpose

This document defines the authoritative contract set used across Argentum module boundaries.

## Contract Rules

- Shared contracts are defined only in this directory.
- Provider adapters must normalize provider-native behavior into these contracts before the core loop consumes it.
- Module specs may constrain how a contract is used, but may not redefine its shape.
- Raw provider payloads, SDK objects, and tool-runtime internals are not canonical contracts.

## Contract Set

| Contract | Purpose | Defining Spec | Primary Producers | Primary Consumers |
| --- | --- | --- | --- | --- |
| `IngressDTO` | Normalized inbound user input before admission outcome | `ingress-contract.md` | channel modules, gateway | gateway, agentic layer |
| `MessagePart` | Canonical inbound message content unit | `message-part.md` | channel modules, gateway | gateway, agentic layer |
| `TurnEnvelope` | Canonical unit of turn execution | `turn-envelope.md` | gateway | agentic layer, telemetry |
| `ContextItem` | Provider-neutral context unit | `context-item.md` | prompt compiler | LLM adapter |
| `ContentRef` | Canonical reference to persisted content or artifacts | `content-ref.md` | gateway, agentic layer, tools, provider layer | all modules |
| `ActionDecision` | Normalized result of one inference step | `action-decision.md` | LLM adapter | core loop |
| `StreamEvent` | Append-only runtime event | `stream-event.md` | gateway, agentic layer, tools | channel modules, telemetry |
| `ToolCallDTO` | Authorized executable tool request | `tool-call-and-result.md` | core loop | tool layer |
| `ToolResultDTO` | Structured tool execution outcome | `tool-call-and-result.md` | tool layer | core loop, telemetry |
| `ExecutionGrantDTO` | Scoped execution permissions | `execution-grant.md` | environment grant resolver | core loop, tool layer, execution driver |
| `RuntimePolicyDTO` | Canonical runtime policy input for grant derivation | `runtime-policy.md` | environment configuration layer | environment grant resolver, gateway, tool layer |
| `RuntimeConfigDTO` | Operator-facing serialized runtime configuration | `runtime-config.md` | environment configuration layer | application composition root, environment layer |
| `LLMInferenceRequest` / `LLMInferenceResult` | Normalized provider adapter boundary | `llm-adapter-contract.md` | prompt compiler, core loop, LLM adapter | LLM adapter, core loop |

## Canonical Normalization Boundary

The boundary between provider-native behavior and Argentum-native behavior is the LLM adapter contract. Native tool calling, response blocks, JSON mode, and provider-specific tracing must be converted into `ActionDecision` and `LLMInferenceResult` before they leave the provider module.

## Cross-References

- MVP boundary: `../00-overview/mvp-scope.md`
- Core loop semantics: `../30-core-loop/core-loop-state-machine.md`
- Provider normalization rules: `../40-modules/llm-provider/provider-normalization.md`

## Open Questions

- None at the contract set level. Open questions belong in the leaf contract files or roadmap docs.