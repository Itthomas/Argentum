# Prompt Compiler

## Purpose

This spec defines how the agentic layer assembles inference requests.

## Responsibilities

- Select current `ContextItem` values
- Order them for the provider adapter
- Attach provider-neutral tool schemas for the current step
- Produce `LLMInferenceRequest`

## Rules

- The compiler operates on `ContextItem` references, not raw provider message objects.
- Bedrock content is included as stable context, not mutable working memory.
- Compacted tool summaries are preferred over raw tool outputs.
- The compiler must respect turn budget constraints.

## Acceptance Criteria

- The same selected context can be rendered through different provider adapters without compiler changes.