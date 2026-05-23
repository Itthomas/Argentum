# Tool Schema Model

## Purpose

This spec defines the canonical provider-neutral schema shape owned by the tool layer.

## Required Schema Fields

- `name`: stable namespace-qualified tool name
- `description`: concise operational description
- `input_schema`: JSON-compatible argument schema
- `side_effect_level`: descriptive impact label for execution policy
- `path_scope`: declared filesystem scope used for grant derivation
- `required_secret_handles`: secret handles the tool may receive when granted
- `network_access`: declared network posture used for grant derivation
- `default_timeout_ms`: default execution ceiling used for grant derivation
- `defaults`: optional default argument values

## Canonical Vocabularies

### `side_effect_level`

- `read_only`: no intended mutation of files or external systems
- `workspace_mutation`: may mutate files inside the runtime workspace
- `host_mutation`: may trigger host-side process or filesystem effects inside the operator-selected runtime root
- `external_effect`: may cause effects outside the local runtime workspace, such as remote API calls or external service mutation

### `path_scope`

- `none`: no filesystem access is required
- `working`: access is limited to mutable working and artifact areas
- `workspace`: access may span the full runtime workspace, including bedrock for reads

### `network_access`

- `deny`: the tool does not require network access
- `inherit`: the tool may use inherited host networking in MVP

## Rules

- Tool schema definitions originate in the registry and are projected outward.
- The schema must be rich enough to support provider-native tool definition generation.
- Tool schema changes are operator or developer actions, not autonomous runtime actions in MVP.
- Execution policy fields are canonical inputs to grant resolution, not adapter-local metadata.

## Cross-References

- Provider normalization: `../llm-provider/provider-normalization.md`
- LLM adapter contract: `../../20-contracts/llm-adapter-contract.md`
- Grant resolution policy: `../environment/grant-resolution.md`

## Acceptance Criteria

- One tool schema definition can be rendered into provider-facing formats without adding provider-specific semantics to the core loop.