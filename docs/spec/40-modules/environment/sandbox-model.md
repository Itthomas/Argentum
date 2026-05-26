# Sandbox Model

## Purpose

This spec defines the MVP execution model for running tools.

## MVP Execution Mode

Argentum MVP uses a native host execution driver. The runtime executes tools directly on the host within an operator-selected workspace subtree.

## Rules

- Every tool execution must receive an `ExecutionGrantDTO`.
- The native execution driver must honor working-directory and `path_permissions` settings from the grant.
- The environment layer may factor workspace-path authorization into an internal helper or internal admission seam used by the native execution driver, but that authorization logic remains an environment-internal implementation concern in MVP rather than a required exported public boundary.
- When enforcing `path_permissions`, the environment uses the host-independent lexical containment model defined by `workspace-model.md` before host-native path rendering or execution.
- Minimal-security MVP may inherit host networking, but the grant must still record the network posture.
- The sandbox model must not assume generic access to all environment variables.

## Non-Goals

- Container isolation in MVP
- Full untrusted-code hardening in MVP

## Acceptance Criteria

- Tools execute through one driver abstraction rather than directly from the core loop.
- The later addition of a container driver would not require contract changes.