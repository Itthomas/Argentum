# Execution Grant Contract

## Purpose

`ExecutionGrantDTO` defines the scoped permissions applied to one tool execution.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `grant_id` | string | yes | Unique grant identifier |
| `cwd` | string | yes | Working directory for the execution |
| `path_permissions` | array | yes | Logical-root permissions with explicit capabilities |
| `env_secret_handles` | array | yes | Names of secrets that may be injected |
| `network_policy` | string | yes | Network posture such as `inherit`, `deny`, or future restricted modes |
| `approval_mode` | string | yes | Current approval posture |
| `max_runtime_ms` | integer | yes | Execution time ceiling |

## `path_permissions` Entry Shape

Each `path_permissions` entry must contain:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `root` | string | yes | One of `bedrock`, `working`, `artifacts`, or `logs` |
| `path` | string | yes | Concrete filesystem root path |
| `capabilities` | array | yes | Any of `read`, `write`, or `append` |

## Canonical Vocabularies

### `approval_mode`

- `auto_allow`: execution is permitted without interactive approval
- `deny`: execution is not permitted and must not run

### `network_policy`

- `deny`: network access is not granted for this tool call
- `inherit`: tool execution inherits host network access in MVP

## Rules

- The grant is the only canonical source of execution permissions.
- The environment-layer grant resolver is the only module allowed to create `ExecutionGrantDTO` values.
- Tool implementations must not infer permissions from global process state.
- Bedrock read access must be represented explicitly through `path_permissions` rather than external side rules.
- Secret values are resolved from handles at execution time and must not be serialized into turn memory.
- Minimal-security MVP may use permissive grant defaults, but it must still materialize a grant.

## Cross-References

- Grant resolution policy: `../40-modules/environment/grant-resolution.md`
- Tool execution policy vocabulary: `../40-modules/tool-layer/tool-schema-model.md`

## Open Questions

- Fine-grained network policy beyond MVP is deferred.