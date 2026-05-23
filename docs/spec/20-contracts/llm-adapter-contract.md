# LLM Adapter Contract

## Purpose

This contract defines the provider-neutral boundary between the core loop and the LLM provider module.

## `LLMInferenceRequest`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `request_id` | string | yes | Unique inference request identifier |
| `turn_id` | string | yes | Owning turn |
| `context_items` | array | yes | Ordered `ContextItem` values selected for the step |
| `available_tools` | array | yes | Provider-neutral tool schemas exposed for this step |
| `inference_policy` | object | yes | Policy knobs such as temperature, max output budget, and normalization mode |

## `LLMInferenceResult`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `request_id` | string | yes | Originating request identifier |
| `decision` | object | yes | Normalized `ActionDecision` |
| `usage` | object | no | Provider usage metrics if available |
| `normalization_status` | string | yes | One of `native_tool`, `json_mode`, or `parsed_text` |
| `raw_trace_ref` | object | no | `ContentRef` for raw provider input and output artifacts |

## Rules

- The LLM adapter may use provider-native tool calling internally.
- The LLM adapter must always return a canonical `ActionDecision`.
- Provider-native tool schemas must be derived from the tool registry schema source of truth.
- Repair attempts caused by malformed provider output remain within the provider boundary until a normalized result is returned or the adapter fails.
- `normalization_status` must describe only the strategy that produced the exported normalized result.
- Adapter failure is surfaced outside `LLMInferenceResult` through provider-module failure handling and `llm.failed` events.
- The core loop must not inspect provider-native trace structure.

## Open Questions

- The exact `inference_policy` subfields are deferred to the DeepSeek adapter MVP and implementation planning.