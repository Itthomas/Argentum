# Dependency Injection Plan

## Purpose

This document defines how module dependencies should be assembled at runtime.

## Composition Rules

- The application composition root wires concrete implementations together.
- The core loop receives interfaces for provider access, tool execution, persistence, and event emission.
- Channel modules depend on gateway-facing interfaces, not on concrete gateway internals.
- Tool implementations depend on execution drivers or host services through explicit interfaces.

## MVP Assembly

- One CLI channel implementation
- One gateway implementation
- One agentic core implementation
- One DeepSeek adapter
- One local tool registry
- One native execution driver
- One local persistence implementation
- One validated `RuntimeConfigDTO` loaded before assembly completes

## Acceptance Criteria

- Swapping the provider adapter or execution driver does not require editing core-loop business logic.