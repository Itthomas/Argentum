# Workspace Model

## Purpose

This spec defines the logical filesystem areas that make up the Argentum runtime environment.

## Logical Areas

- `bedrock/`: operator-authored immutable bootstrap files
- `working/`: agent-writable notes, plans, and transient outputs
- `artifacts/`: stored raw tool outputs and traces referenced by contracts
- `logs/`: append-only runtime telemetry and diagnostics

## Rules

- Bedrock and working areas must be separated.
- Raw tool artifacts must be storable without entering episodic memory directly.
- Paths exposed through `ExecutionGrantDTO` must resolve to one of the allowed workspace areas.
- The exact physical path layout may vary by deployment as long as these logical areas remain distinct.

## MVP Constraints

- One local host directory workspace
- No distributed artifact store
- No runtime bedrock writes

## Acceptance Criteria

- A coding agent can identify where immutable config, mutable files, and raw artifacts belong without inferring policy from code.