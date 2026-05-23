# Sandbox Model

## Purpose

This spec defines the MVP execution model for running tools.

## MVP Execution Mode

Argentum MVP uses a native host execution driver. The runtime executes tools directly on the host within an operator-selected workspace subtree.

## Rules

- Every tool execution must receive an `ExecutionGrantDTO`.
- The native execution driver must honor working-directory and `path_permissions` settings from the grant.
- Minimal-security MVP may inherit host networking, but the grant must still record the network posture.
- The sandbox model must not assume generic access to all environment variables.

## Non-Goals

- Container isolation in MVP
- Full untrusted-code hardening in MVP

## Acceptance Criteria

- Tools execute through one driver abstraction rather than directly from the core loop.
- The later addition of a container driver would not require contract changes.