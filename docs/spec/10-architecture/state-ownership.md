# State Ownership

## Purpose

This document defines which module owns which mutable runtime state.

## Ownership Table

| State | Owning Module | Notes |
| --- | --- | --- |
| session lock state | gateway | Includes queue admission and lock release |
| ingress queue | gateway | Session-scoped buffered inputs |
| turn envelope | gateway then agentic layer | Gateway creates, agentic layer advances state |
| episodic memory | agentic layer | Includes committed summaries and transcript references |
| provider-native request/response traces | LLM provider layer | Exposed only by reference |
| tool registry schema catalog | tool layer | Canonical schema source of truth |
| tool execution artifacts | tool layer and environment layer | Artifact storage policy defined by environment |
| bedrock files | environment layer | Immutable during MVP runtime |
| secret resolution | environment layer | Secret handles only cross boundaries |
| telemetry event stream | append-only shared emission | No module owns all events; producers own payload correctness |

## Rules

- State mutation must happen in the owning module.
- Other modules interact with owned state through contracts or service interfaces.
- Global mutable singleton state is out of scope.
- Bedrock mutation is forbidden in MVP runtime mode.

## Drift Risks

- Provider-specific fields leaking into core turn state
- Tool runtime internals being written directly into episodic memory
- Channel rendering concerns leaking into stream event definitions

## Cross-References

- MVP scope: `../00-overview/mvp-scope.md`
- Contracts: `../20-contracts/canonical-contracts.md`