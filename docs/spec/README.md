# Argentum Spec Index

This directory is the authoritative implementation spec for Argentum.

## Reading Order

Coding agents and human implementers should load documents in this order:

1. `00-overview/framework-overview.md`
2. `00-overview/mvp-scope.md`
3. `20-contracts/canonical-contracts.md`
4. `30-core-loop/core-loop-state-machine.md`
5. The leaf spec for the module being implemented
6. Relevant ADRs only when decision rationale is needed

## Source-of-Truth Rules

- MVP boundaries are defined only in `00-overview/mvp-scope.md`.
- Shared DTOs and event shapes are defined only in `20-contracts/`.
- Core loop behavior is defined only in `30-core-loop/`.
- Module responsibilities are defined only in `40-modules/`.
- Decision rationale lives in `60-adr/` and must not override normative specs.
- Future work and unresolved choices live in `70-roadmap/`.

## Directory Map

- `00-overview/`: framework intent, principles, glossary, and scope
- `10-architecture/`: cross-cutting system structure and runtime behavior
- `20-contracts/`: canonical contracts and their leaf definitions
- `30-core-loop/`: deterministic turn execution semantics
- `40-modules/`: module-specific responsibilities and rules
- `50-implementation/`: packaging, persistence, logging, and test plans
- `60-adr/`: architecture decision records
- `70-roadmap/`: deferred decisions and post-MVP expansion

## Writing Rules

- Keep one concept authoritative in one file.
- Reference upstream specs instead of repeating definitions.
- Prefer normative language for current behavior.
- Record open questions without resolving them ad hoc.
- Keep the MVP narrow when a choice is ambiguous.

## Current Frozen Decisions

- MVP uses a hybrid LLM adapter strategy with strict normalization into canonical internal contracts.
- Bedrock files are immutable in MVP.
- Context compaction is inline in MVP.
- Multi-tool action decisions execute sequentially in MVP.
- The governor uses loose but finite defaults for step count, repair count, and wall-clock runtime.
- Session queues are FIFO with a per-session limit of 8 queued ingress items and reject-newest overflow behavior.
- Automatic tool retries are limited to one transient retry for read-only tools inside the tool layer.
- One centralized JSON runtime config document instantiates operator-facing runtime variables for MVP.

## Immediate Implementation Spine

The current architectural spine is:

- overview and scope
- canonical contracts
- core loop state machine
- cross-cutting invariants

Leaf specs must conform to that spine.