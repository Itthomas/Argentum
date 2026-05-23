# Provider Normalization

## Purpose

This spec defines how provider-native output is normalized into Argentum contracts.

## Normalization Policy

- The provider adapter may choose the most reliable provider-native mechanism available.
- The normalization target is always `ActionDecision` plus `LLMInferenceResult` metadata.
- Provider-native multi-tool outputs are preserved as ordered `tool_calls` entries.
- Provider-native parallel intent, if present, is flattened into sequential order for MVP.

## Allowed Internal Strategies

- Native function or tool calling
- JSON mode or structured output mode
- Parsed text with adapter-local repair

## Required Output Guarantees

- One canonical decision object per inference request
- Stable tool names matching the registry
- Argument objects coerced into canonical JSON-compatible form
- User-visible text normalized into `respond`, `clarify`, or `abort`
- Provider-native repair stays internal to the adapter and must not be exported as a separate core-loop repair state in MVP.

## Drift Risks

- Letting a provider's richer semantics redefine core-loop behavior
- Maintaining provider-facing tool schemas separately from the registry
- Returning raw SDK data in place of canonical contracts

## MVP Constraints

- Ordered tool calls execute sequentially after normalization.
- The adapter must not expose provider-native parallel execution semantics to the core loop.

## Acceptance Criteria

- The same core loop can consume DeepSeek output without knowing whether native tool calling or JSON mode produced it.