# Runtime Policy Contract

## Purpose

`RuntimePolicyDTO` defines the canonical policy surface consumed by environment-layer grant resolution in MVP.

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `enabled_tools` | array | yes | Namespace-qualified tool names allowed in the current runtime |
| `enabled_secret_handles` | array | yes | Secret handles available for grant resolution |
| `max_tool_runtime_ms` | integer | yes | Global maximum tool runtime cap |
| `workspace_roots` | object | yes | Bound concrete roots for `bedrock`, `working`, `artifacts`, and `logs` |
| `trusted_local_mode` | boolean | yes | Whether trusted-local automatic approval rules are enabled |

## Rules

- Grant derivation must depend only on canonical tool metadata plus `RuntimePolicyDTO` inputs.
- Tool names not present in `enabled_tools` must resolve to denied grants.
- `workspace_roots` must provide concrete filesystem roots for every logical storage area used by MVP contracts.
- `RuntimePolicyDTO` is derived from `RuntimeConfigDTO`, not authored as an unrelated parallel configuration object.

## Cross-References

- Runtime config contract: `runtime-config.md`

## Open Questions

- None.