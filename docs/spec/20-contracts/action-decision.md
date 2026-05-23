# Action Decision

## Purpose

`ActionDecision` is the normalized result of one model inference step.

## Decision Kinds

- `respond`: emit a final assistant response for this turn
- `tool_calls`: execute one or more tool calls, sequentially in MVP
- `clarify`: ask the user for missing information and finalize the turn
- `abort`: stop the turn in a controlled manner

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `decision_id` | string | yes | Unique identifier for the normalized decision |
| `kind` | string | yes | One of the defined decision kinds |
| `message` | string | conditional | Required for `respond`, `clarify`, and most `abort` outcomes |
| `tool_calls` | array | conditional | Required when `kind` is `tool_calls` |
| `decision_summary` | string | no | Short operational rationale suitable for logs |
| `provider_trace_ref` | object | no | `ContentRef` for raw provider output |

## Tool Call Entry Shape

Each entry in `tool_calls` must include:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `tool_name` | string | yes | Registry-qualified tool name |
| `arguments` | object | yes | Provider-normalized arguments |
| `provider_call_ref` | string | no | Optional provider-native correlation value |

## Rules

- The core loop consumes only normalized `ActionDecision` values.
- Provider adapters may use native tool calling internally, but must not return provider-native payloads here.
- `tool_calls` execute sequentially in listed order during MVP.
- Mixed user-visible text and tool execution is normalized into one decision kind.
- `decision_summary` must not contain hidden chain-of-thought.

## Open Questions

- Whether post-MVP decisions may allow parallel-execution hints is deferred.