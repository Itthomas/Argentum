# Secrets And Config

## Purpose

This spec defines how runtime configuration and secrets are classified and exposed.

## Configuration Classes

- Public config: non-sensitive runtime settings such as workspace root and model selection
- Operator secrets: long-lived credentials managed outside the agent-writable workspace
- Session secrets: user-scoped short-lived credentials, if introduced later

## Rules

- Secrets are runtime capabilities, not semantic memory.
- The agent must not have a generic environment-variable read capability.
- Tool invocations receive secret handles through `ExecutionGrantDTO`, not raw secret values in turn memory.
- Secret resolution occurs only within the environment and execution layers.
- Logs and artifacts must record secret handle names only when necessary, never secret values.
- Runtime grant resolution inputs must be materialized through `RuntimePolicyDTO` rather than implicit host-process state.
- The operator-facing configuration surface is `RuntimeConfigDTO`, serialized as JSON.

## MVP Constraints

- Operator secrets are loaded from host-managed configuration outside mutable workspace areas.
- Session secrets are out of MVP scope.

## Acceptance Criteria

- The system can execute a secret-using tool without placing the secret value in episodic memory, stream events, or contract payloads.

## Cross-References

- Runtime policy contract: `../../20-contracts/runtime-policy.md`
- Runtime config contract: `../../20-contracts/runtime-config.md`