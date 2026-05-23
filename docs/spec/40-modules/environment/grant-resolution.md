# Grant Resolution

## Purpose

This spec defines how Argentum derives one `ExecutionGrantDTO` for a validated tool call.

## Owner

The environment-layer grant resolver is the sole owner of grant derivation. The core loop requests a grant before creating `ToolCallDTO`, but it does not derive grant contents itself.

## Inputs

- Canonical tool schema execution-policy fields
- `RuntimePolicyDTO`
- Current session and turn context needed for workspace rooting

## Output

- One `ExecutionGrantDTO` with either `approval_mode = auto_allow` or `approval_mode = deny`

## Deterministic Mapping Rules

### Working Directory

- `cwd` is `RuntimePolicyDTO.workspace_roots.working` for MVP unless a future tool-specific override is explicitly added to the spec.

### Allowed Paths

- `path_scope = none` -> `path_permissions = []`
- `path_scope = working` -> `path_permissions` includes:
	- `working` with `read` and `write`
	- `artifacts` with `read` and `write`
- `path_scope = workspace` -> `path_permissions` includes:
	- `bedrock` with `read`
	- `working` with `read` and `write`
	- `artifacts` with `read` and `write`
	- `logs` with `append`

### Secrets

- `env_secret_handles` is the intersection of `required_secret_handles` and `RuntimePolicyDTO.enabled_secret_handles`.
- If a required secret handle is unavailable, the grant resolves to `deny`.

### Network

- `network_access = deny` -> `network_policy = deny`
- `network_access = inherit` -> `network_policy = inherit`

### Runtime Ceiling

- `max_runtime_ms` is `default_timeout_ms` capped by `RuntimePolicyDTO.max_tool_runtime_ms`.

### Approval Outcome

- Registered tools that fit within path, secret, and network policy constraints resolve to `auto_allow` in MVP when `RuntimePolicyDTO.trusted_local_mode = true`.
- A tool call resolves to `deny` when the tool is absent from `RuntimePolicyDTO.enabled_tools`, requests unavailable secrets, or requests policy outside `RuntimePolicyDTO` limits.

## Blocked Outcome Rules

- A denied grant must prevent tool execution entirely.
- Denied execution must emit a `tool.blocked` event.
- Denied execution must produce `ToolResultDTO.status = blocked` with a stable policy-oriented error code.

## MVP Constraints

- Rich interactive approval workflows are out of scope.
- MVP trusted-local mode uses automatic approval for policy-compliant registered tools as defined by `RuntimePolicyDTO.trusted_local_mode`.
- Bedrock immutability is enforced through `path_permissions` by granting only `read` capability for the `bedrock` root.

## Cross-References

- Runtime policy contract: `../../20-contracts/runtime-policy.md`

## Acceptance Criteria

- Two implementations using the same tool schema and runtime profile derive the same grant outcome for the same tool call.