# Test Strategy

## Purpose

This document defines the minimum testing approach for MVP implementation.

## Required Test Layers

- Contract validation tests for canonical DTO shapes
- State-machine tests for allowed and forbidden transitions
- Adapter normalization tests for DeepSeek-native and fallback paths
- Tool registry tests for schema validation and routing
- End-to-end happy-path CLI tests for one full turn
- Failure-path tests for repair exhaustion and budget exhaustion
- Gateway tests for queue overflow and deterministic ingress rejection
- Tool-execution tests for blocked grants and narrow retry behavior
- Environment tests for secret redaction and bedrock immutability enforcement
- Telemetry tests for event ordering and minimum payload presence

## Rules

- Tests should target module boundaries and deterministic outputs.
- Provider adapter tests should use recorded fixtures where possible.
- State-machine tests must cover sequential multi-tool decisions.
- Failure-path tests must prove that blocked or exhausted conditions terminate deterministically.

## Acceptance Criteria

- The MVP can prove one end-to-end turn path and the critical normalization and compaction invariants.
- The MVP can prove its safety and failure invariants around queueing, grants, retries, secrets, bedrock, and telemetry.