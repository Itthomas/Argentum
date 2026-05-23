# ADR 0003: Immutable Bedrock In MVP

## Status

Accepted

## Context

Allowing an agent to rewrite its own bootstrap files can cause silent drift and reduce reproducibility.

## Decision

Operator-authored bedrock files are immutable during normal MVP runtime. Proposed changes must be expressed through mutable artifacts or deferred to a future maintenance mode.

## Consequences

- Persona and policy drift are reduced.
- Maintenance-mode behavior remains a separate future design problem.