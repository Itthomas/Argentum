# DeepSeek Adapter MVP

## Purpose

This spec defines the initial DeepSeek-specific adapter behavior for MVP.

## Responsibilities

- Translate `LLMInferenceRequest` into the selected DeepSeek chat interface
- Project provider-neutral tool schemas into the DeepSeek-native tool definition format when native tool calling is enabled
- Normalize DeepSeek responses into `LLMInferenceResult`
- Capture request and response traces for debugging

## Required Behavior

- Prefer native tool calling when the selected DeepSeek endpoint supports it reliably.
- Fall back to structured JSON or parsed-text normalization within the adapter when native tool calling is unavailable or malformed.
- Emit `normalization_status` that reflects the strategy actually used.
- Preserve DeepSeek tool-call ordering when constructing `ActionDecision.tool_calls`.
- Keep provider-native repair and malformed-output recovery internal to the adapter until a normalized result or adapter failure is produced.

## Non-Responsibilities

- Deciding whether a tool is authorized to run
- Repairing canonical contracts outside the adapter boundary
- Managing session locks or turn state

## MVP Constraints

- One configured DeepSeek model target
- One request path per inference step
- No provider-specific streaming requirement is imposed on the core loop
- Provider bootstrap values are sourced from `RuntimeConfigDTO.provider`

## Acceptance Criteria

- A single inference request can result in a normalized decision regardless of whether the adapter used native tool calling or fallback parsing.

## Open Questions

- Exact DeepSeek endpoint and model identifiers are deferred to implementation planning.