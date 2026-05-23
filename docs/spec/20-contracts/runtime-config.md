# Runtime Config Contract

## Purpose

`RuntimeConfigDTO` is the canonical operator-facing configuration shape for Argentum MVP. It is the serialized source used to instantiate runtime defaults and derived policy contracts, not an alternative source of truth for runtime behavior.

## Serialization Format

- MVP configuration is stored as one JSON document.
- The JSON document must validate against the `RuntimeConfigDTO` shape before runtime startup continues.

## Sections

| Section | Required | Purpose |
| --- | --- | --- |
| `workspace` | yes | Binds logical storage roots |
| `provider` | yes | Selects and configures the MVP LLM provider |
| `governor` | yes | Supplies default turn-governor limits |
| `gateway` | yes | Supplies queue and session-admission defaults |
| `tool_policy` | yes | Supplies runtime tool and secret policy inputs |
| `telemetry` | yes | Supplies log and event persistence settings |
| `features` | no | Supplies explicit MVP feature toggles where allowed |

## Fields

### `workspace`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `bedrock_root` | string | yes | Absolute or deployment-resolved bedrock root |
| `working_root` | string | yes | Absolute or deployment-resolved working root |
| `artifacts_root` | string | yes | Absolute or deployment-resolved artifacts root |
| `logs_root` | string | yes | Absolute or deployment-resolved logs root |

### `provider`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | MVP supports only `deepseek` |
| `model_id` | string | yes | Concrete model identifier |
| `endpoint` | string | yes | Provider endpoint or local gateway URL |
| `temperature` | number | no | Default inference temperature |
| `max_output_tokens` | integer | no | Default output budget |

### `governor`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `max_inference_steps` | integer | yes | Default turn limit |
| `max_repair_attempts` | integer | yes | Default canonical repair limit |
| `max_wall_clock_ms` | integer | yes | Default turn wall-clock limit |

### `gateway`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `max_queued_ingress_per_session` | integer | yes | MVP queue cap |
| `queue_overflow_policy` | string | yes | MVP supports only `reject_newest` |

### `tool_policy`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled_tools` | array | yes | Namespace-qualified enabled tools |
| `enabled_secret_handles` | array | yes | Secret handles available for grant resolution |
| `max_tool_runtime_ms` | integer | yes | Global maximum tool runtime cap |
| `trusted_local_mode` | boolean | yes | Enables MVP automatic approval behavior |

### `telemetry`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `format` | string | yes | MVP supports `jsonl` |
| `persist_events` | boolean | yes | Whether events are written durably |

### `features`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `enable_native_tool_calling` | boolean | no | Adapter preference toggle |

## Rules

- `RuntimeConfigDTO` must not contain raw secret values.
- Secret values are supplied out-of-band and referenced only through handles named in the config.
- `RuntimeConfigDTO.workspace` must compile into `RuntimePolicyDTO.workspace_roots`.
- `RuntimeConfigDTO.tool_policy` must compile into `RuntimePolicyDTO`.
- `RuntimeConfigDTO.governor` supplies the default values stamped into `TurnEnvelope.budget`.
- `RuntimeConfigDTO` may instantiate existing canonical contracts, but it must not override normative behavior defined elsewhere in the spec tree.

## Precedence

1. Normative spec contracts and behavior
2. Validated `RuntimeConfigDTO`
3. Implementation defaults only where the config omits an optional field

## Open Questions

- The concrete filesystem path of the JSON file is an implementation choice unless frozen later.