# ADR 0002: Inline Compaction For MVP

## Status

Accepted

## Context

Argentum needs active context management, but asynchronous background compaction introduces coordination risk early in the project.

## Decision

MVP uses inline compaction. Tool outputs are summarized and committed synchronously before the next inference step consumes them.

## Consequences

- Turn behavior stays deterministic.
- Runtime latency may be slightly higher than a future asynchronous design.
- The Shadow Loop concept remains available as a post-MVP extension.