# ADR 0004: Sequential Multi-Tool Actions In MVP

## Status

Accepted

## Context

Provider-native outputs may include multiple tool calls, but parallel execution adds scheduling and policy complexity that MVP does not need.

## Decision

When an `ActionDecision` contains multiple tool calls, the core loop executes them sequentially in listed order during MVP.

## Consequences

- The normalization contract can preserve multiple tool calls without requiring parallel execution support.
- Later parallelism can be added behind the same decision shape if needed.