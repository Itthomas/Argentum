# Tool Call And Result Contracts

## Purpose

These contracts define the normalized request and result boundary between the core loop and the tool layer.

## `ToolCallDTO`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `call_id` | string | yes | Unique execution request identifier |
| `turn_id` | string | yes | Owning turn |
| `tool_name` | string | yes | Registry-qualified tool name |
| `arguments` | object | yes | Canonically normalized invocation arguments pending tool-layer schema validation |
| `grant` | object | yes | Embedded `ExecutionGrantDTO` resolved for this tool call |
| `timeout_ms` | integer | yes | Maximum execution time |
| `idempotency_key` | string | yes | Stable key for replay-safe retries |

## `ToolResultDTO`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `call_id` | string | yes | Originating call identifier |
| `status` | string | yes | One of `success`, `error`, or `blocked` |
| `human_summary` | string | yes | Short model-consumable outcome summary |
| `artifact_refs` | array | no | `ContentRef` values for raw outputs or generated files |
| `structured_payload_ref` | object | no | `ContentRef` for structured result payload |
| `duration_ms` | integer | yes | Observed execution duration |
| `truncated` | boolean | yes | Whether raw output was truncated or externalized |
| `retryable` | boolean | yes | Whether the failure may be retried safely |
| `error_code` | string | no | Stable failure code |

## Rules

- `ToolCallDTO` is created only after action validation and grant resolution.
- Tool-layer schema validation is performed after `ToolCallDTO` creation and before tool execution begins.
- `idempotency_key` is derived by the core loop from `turn_id`, the tool call's zero-based position inside `ActionDecision.tool_calls`, `tool_name`, and canonical serialized arguments.
- `timeout_ms` must equal `grant.max_runtime_ms` in MVP.
- `ToolResultDTO` must preserve enough structure for compaction without forcing raw output into memory.
- Tool-layer implementations may emit richer internal data, but only these fields are canonical.
- `human_summary` is the default model-facing summary used by inline compaction when no additional summarization call is required.
- MVP core-loop behavior does not perform automatic retries beyond the tool-layer retry policy.

## Cross-References

- Tool retry policy: `../40-modules/tool-layer/retry-policy.md`

## Open Questions

- The initial artifact storage layout is deferred to implementation planning.