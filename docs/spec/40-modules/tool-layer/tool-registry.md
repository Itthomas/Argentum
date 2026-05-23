# Tool Registry

## Purpose

This spec defines the provider-neutral registry of callable capabilities.

## Responsibilities

- Register tool definitions and schemas
- Route `ToolCallDTO` requests to implementations
- Validate invocation arguments against the registered schema
- Return `ToolResultDTO`

## Rules

- The registry is the source of truth for tool schema definitions.
- Tool names must be stable and namespace-qualified.
- Tool-layer schema validation is the canonical authority for validating `ToolCallDTO.arguments` against the registered schema.
- Validation failures must produce structured tool-layer outcomes rather than bypassing the registry.
- Provider-facing tool definitions must be generated from registry data.

## MVP Constraints

- One local in-process registry
- One implementation per registered tool

## Acceptance Criteria

- A provider adapter can project tool definitions from the registry without adapter-owned schema duplication.