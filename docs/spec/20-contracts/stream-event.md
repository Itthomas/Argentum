# Stream Event

## Purpose

`StreamEvent` is the append-only event contract emitted during runtime execution.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `event_id` | string | yes | Unique event identifier |
| `session_id` | string | yes | Owning session |
| `scope` | string | yes | One of `session` or `turn` |
| `turn_id` | string | conditional | Required when `scope = turn` |
| `sequence` | integer | yes | Monotonic event sequence within the declared scope |
| `kind` | string | yes | Typed event name |
| `timestamp` | string | yes | UTC timestamp |
| `visibility` | string | yes | One of `user`, `system`, or `telemetry` |
| `payload` | object | yes | Kind-specific event body |

## Required Event Families

- Turn lifecycle events
- Queue-admission events
- Validation events
- Tool execution events
- Compaction events
- Final response events
- Error and abort events

## Rules

- Events are append-only.
- `scope = session` is used for queue-admission events that can occur before a turn exists.
- `scope = turn` is used for events owned by one active turn.
- User-facing renderers may ignore events whose visibility is not `user`.
- Telemetry pipelines must preserve original event order.
- Event payloads may reference raw artifacts instead of embedding large bodies.

## Cross-References

- Event family semantics: `../10-architecture/eventing-model.md`
- Minimal payload contracts: `stream-event-payloads.md`

## Open Questions

- None. Event-kind expansion belongs in the eventing model and module specs.