# Ingress Contract

## Purpose

`IngressDTO` is the canonical representation of one normalized inbound user input before queueing, acceptance, or rejection outcomes are applied.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ingress_id` | string | yes | Unique identifier for the normalized ingress event |
| `session_id` | string | yes | Resolved session identifier |
| `channel` | string | yes | Source channel name such as `terminal_cli` |
| `user_id` | string | yes | Channel-scoped user identifier |
| `message_parts` | array | yes | Ordered `MessagePart` values |
| `attachments` | array | no | Attachment metadata and artifact references |
| `received_at` | string | yes | UTC timestamp in ISO-8601 form |
| `metadata` | object | no | Non-semantic transport metadata |

## Rules

- The gateway assigns `ingress_id` immediately after normalization and before queue-admission decisions.
- `IngressDTO` is immutable after creation.
- One accepted ingress may create at most one `TurnEnvelope`.
- Rejected ingress does not create a `TurnEnvelope`.
- `message_parts` must preserve user-visible ordering.
- Transport metadata must not be merged into semantic content automatically.

## Non-Goals

- Defining attachment storage internals
- Defining provider-facing prompt content

## Cross-References

- Message-part shape: `message-part.md`

## Open Questions

- The exact shape of attachment metadata is deferred until attachments are in MVP scope.