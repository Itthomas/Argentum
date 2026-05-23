# Package Boundaries

## Purpose

This document proposes the initial code package split that matches the spec hierarchy.

## Recommended Packages

- `channel_cli`: terminal input and rendering
- `gateway`: session routing, queueing, lock management, turn creation
- `agentic_core`: prompt compiler, context selection, episodic memory, turn loop
- `llm_provider`: provider interface plus DeepSeek adapter
- `tooling`: registry, schemas, tool routing, tool implementations
- `environment`: workspace layout, grants, secret resolution, execution driver
- `telemetry`: event persistence and log formatting

## Rules

- Shared contracts should live in a thin contract module imported by all runtime packages.
- Package dependencies should point inward toward contracts and core abstractions, not sideways through implementation details.
- The channel package must not depend on provider implementation code.

## Acceptance Criteria

- An implementer can place modules into packages without creating circular dependencies across the main runtime boundaries.