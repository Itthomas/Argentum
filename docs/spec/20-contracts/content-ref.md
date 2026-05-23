# Content Reference Contract

## Purpose

`ContentRef` is the canonical reference shape for persisted text, structured payloads, traces, and file-backed artifacts.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ref_id` | string | yes | Unique reference identifier |
| `kind` | string | yes | One of `text`, `json`, `trace`, `file`, or `blob` |
| `storage_area` | string | yes | One of `bedrock`, `working`, `artifacts`, or `logs` |
| `locator` | string | yes | Stable locator relative to the storage area |
| `media_type` | string | no | Optional MIME-like content type |
| `retention` | string | yes | One of `persistent`, `session`, or `ephemeral` |

## Rules

- `ContentRef` must be inspectable by an implementation with access to the declared storage area.
- `locator` may be path-like, but the canonical meaning is an opaque relative locator scoped by `storage_area`.
- References with `retention = persistent` must survive process restarts.
- References with `retention = session` may be cleaned up after the session lifecycle ends.
- Modules may store richer internal metadata, but only this shape is canonical across boundaries.

## Open Questions

- None.