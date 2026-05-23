# Message Part Contract

## Purpose

`MessagePart` is the canonical content unit used inside `IngressDTO.message_parts`.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string | yes | MVP supports only `text` |
| `text` | string | conditional | Required when `kind = text` |

## Rules

- MVP CLI ingress must normalize user input into exactly one `MessagePart` with `kind = text`.
- Message-part ordering must be preserved exactly as received.
- Additional message-part kinds are post-MVP unless explicitly added to this contract.

## Open Questions

- None.