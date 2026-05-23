# Context Item

## Purpose

`ContextItem` is the provider-neutral unit of context selected for one inference step.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `context_id` | string | yes | Unique identifier for the context item |
| `layer` | string | yes | One of `bedrock`, `environment`, `episodic`, `tool_summary`, `system` |
| `role` | string | yes | Semantic role consumed by the LLM adapter |
| `content_ref` | object | yes | `ContentRef` pointing to the underlying text or artifact |
| `origin` | string | yes | Producing module or subsystem |
| `version` | string | no | Version or digest for drift detection |
| `token_estimate` | integer | no | Estimated token cost used for selection |
| `retention` | string | yes | Retention policy such as `sticky`, `rolling`, or `ephemeral` |

## Rules

- `ContextItem` defines semantic membership, not provider message formatting.
- `content_ref` must resolve to inspectable source content or an artifact.
- Bedrock items must remain stable for the duration of a turn.
- Large raw tool outputs must not appear as direct episodic content if compaction rules require artifact externalization.

## Open Questions

- Exact role taxonomy can expand post-MVP if additional provider adapters require it.