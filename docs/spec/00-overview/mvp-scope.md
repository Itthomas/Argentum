# MVP Scope

## Purpose

This document is the sole source of truth for what Argentum MVP includes and excludes.

## Included In MVP

- One terminal CLI channel module
- One gateway implementation with local session persistence
- One deterministic single-agent turn loop
- One hybrid LLM adapter implementation for DeepSeek
- One provider-neutral tool registry
- One native host execution driver with minimal security controls
- Inline context compaction for large tool outputs
- Immutable bedrock files and a separate mutable working area
- Sequential execution of all tool calls produced by one action decision
- Flat structured telemetry suitable for replay and debugging

## Excluded From MVP

- Multi-agent orchestration
- Distributed workers or remote execution pools
- Parallel tool execution
- Bedrock write access during normal runtime
- Rich approval workflows for dangerous actions
- Multiple channel implementations
- Multiple provider implementations
- Full remote secret brokers or enterprise secret stores
- Autonomous schema evolution by the runtime

## Frozen MVP Decisions

- The LLM adapter may use provider-native tool calling internally.
- The agentic layer receives only normalized internal decisions.
- When multiple tool calls are present in one action decision, they execute sequentially.
- Compaction occurs inline before large tool results enter episodic memory.
- The governor uses fixed MVP defaults for inference-step count, repair-attempt count, and wall-clock runtime.
- Session queue overflow rejects the newest ingress once 8 items are queued for the same locked session.
- Automatic tool retries are limited to one transient retry for read-only tools within the tool layer.
- Ambiguous choices favor smaller scope and cleaner boundaries.

## MVP Success Criteria

Argentum MVP is successful when the in-repo reference implementation can be built from the spine docs and the relevant module leaf specs without inventing unresolved runtime behavior, and a coding agent can implement one end-to-end runtime path from terminal input to normalized model decision to tool execution to compacted memory commit to terminal output using those docs alone.

## Open Questions

- The exact initial local persistence shape is deferred to implementation planning.
- The final initial tool set is deferred to the tool-layer specs.
- Maintenance-mode behavior for bedrock mutation is deferred to post-MVP design.