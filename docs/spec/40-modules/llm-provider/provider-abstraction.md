# Provider Abstraction

## Purpose

This spec defines the responsibilities of the LLM provider module.

## Responsibilities

- Accept `LLMInferenceRequest` values from the core loop
- Translate `ContextItem` values and tool schemas into provider-native request shapes
- Use provider-native structured output facilities when beneficial
- Normalize provider responses into `LLMInferenceResult`
- Persist raw request and response traces by reference for debugging

## Non-Responsibilities

- Deciding turn state transitions
- Executing tools directly
- Owning episodic memory
- Defining canonical tool schemas

## Inputs

- `LLMInferenceRequest`
- Provider configuration resolved by the environment layer

## Outputs

- `LLMInferenceResult`
- `llm.*` stream events

## Rules

- The provider layer may use native tool calling, JSON mode, or parsed text internally.
- The provider layer must return one normalized `ActionDecision` per inference request.
- Provider-native tool schemas must be generated from the tool registry source of truth.
- Raw provider payloads remain adapter-private except by artifact reference.

## MVP Constraints

- One DeepSeek adapter implementation
- No provider failover
- No adapter-managed parallel action execution

## Acceptance Criteria

- A caller can request one inference step without knowing provider-native API structure.
- The adapter emits a valid `LLMInferenceResult` or a controlled adapter failure.