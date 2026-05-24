# Turn Envelope

## Purpose

`TurnEnvelope` is the canonical unit of work for one accepted ingress.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `turn_id` | string | yes | Unique turn identifier |
| `session_id` | string | yes | Owning session |
| `ingress_id` | string | yes | Source ingress identifier |
| `state` | string | yes | Current lifecycle state as defined by the core loop spec |
| `step_count` | integer | yes | Number of completed inference decision cycles |
| `budget` | object | yes | Turn-level governor fields and counters |
| `context_refs` | array | yes | References to selected context items or committed artifacts |
| `compaction_revision` | integer | yes | Monotonic revision incremented by inline compaction commits |
| `final_outcome` | string | no | Final completion class once the turn is finalized |
| `created_at` | string | yes | UTC timestamp |
| `updated_at` | string | yes | UTC timestamp |

## Budget Fields

`budget` must contain these MVP fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `max_inference_steps` | integer | yes | Maximum number of inference steps allowed in the turn |
| `max_repair_attempts` | integer | yes | Maximum canonical repair attempts allowed in the turn |
| `max_wall_clock_ms` | integer | yes | Maximum wall-clock runtime for the turn |
| `repair_attempts_used` | integer | yes | Number of canonical repair attempts consumed so far |
| `max_tokens_per_step` | integer | no | Maximum number of tokens allowed per inference step |

## Rules

- `TurnEnvelope` identity fields are immutable.
- `state` transitions must follow `../30-core-loop/core-loop-state-machine.md`.
- `context_refs` track committed context membership, not raw provider prompt assembly order.
- `budget` defaults are stamped into the turn when it is created and then updated only through governed turn execution.
- `step_count` must not increment per individual tool call inside one `tool_calls` decision.
- `final_outcome` may be set only during finalization.

## Open Questions

- None.