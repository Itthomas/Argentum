# ADR 0001: Hybrid Provider Normalization

## Status

Accepted

## Context

Argentum needs a provider-neutral core loop but also wants to take advantage of provider-native tool-calling features where they improve reliability or cost.

## Decision

Provider adapters may use native tool calling, JSON mode, or parsed-text repair internally, but they must always normalize the result into the canonical `ActionDecision` and `LLMInferenceResult` contracts before returning control to the core loop.

## Consequences

- The core loop remains provider-neutral.
- Provider adapters can optimize for provider-specific strengths.
- Adapter implementations are more complex than a pure text-completion wrapper.