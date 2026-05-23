# System Context

## Purpose

This document defines the top-level runtime boundary between Argentum modules.

## External Actors

- User interacting through a channel module
- LLM provider endpoint accessed through the provider adapter
- Local host execution environment used by tools
- Local persistence used for session and telemetry state

## Module Boundaries

### Channel Modules

Own platform I/O only. They normalize inbound messages and render outgoing `StreamEvent` values.

### Gateway

Owns session routing, queueing, locking, and turn creation. It does not decide actions.

### Agentic Layer

Owns prompt compilation, deterministic step progression, episodic memory updates, and branching on `ActionDecision`.

### LLM Provider Layer

Owns provider-specific request formatting, provider-native tool calling, repair loops internal to the adapter, and normalization into `LLMInferenceResult`.

### Tool Layer

Owns tool schema registration, tool discovery, invocation routing, and `ToolResultDTO` production.

### Environment Layer

Owns workspace topology, immutable bedrock boundaries, mutable working directories, secret resolution, and execution-driver configuration.

## Top-Level Data Flow

1. Channel emits ingress to gateway.
2. Gateway creates `IngressDTO` and `TurnEnvelope`.
3. Agentic layer selects `ContextItem` values and builds `LLMInferenceRequest`.
4. LLM adapter returns `LLMInferenceResult`.
5. Core loop converts planned tool calls into `ToolCallDTO` values.
6. Tool layer executes calls under the embedded `ExecutionGrantDTO` carried by each `ToolCallDTO`.
7. Agentic layer compacts and commits results.
8. Gateway and channel modules emit final output and telemetry.

## Non-Goals

- Defining internal package structure
- Defining specific provider payload formats

## Cross-References

- Contract source of truth: `../20-contracts/canonical-contracts.md`
- Core loop semantics: `../30-core-loop/core-loop-state-machine.md`