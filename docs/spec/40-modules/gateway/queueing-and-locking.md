# Queueing And Locking

## Purpose

This spec defines session admission control in the gateway.

## Rules

- Each session may have at most one active turn.
- The gateway must create an `IngressDTO` before queue, accept, or reject decisions are made.
- New ingress for a locked session must be queued rather than dropped.
- MVP queue policy is FIFO.
- The per-session queued-ingress limit is `8`.
- When the queue is full, the newest ingress is rejected and must not displace earlier queued ingress.
- The session lock is released during `finalizing` before archival work begins.
- Queue state changes must emit `queue.*` events.
- Queue overflow must emit `queue.rejected` with enough data to identify the rejected ingress and session.
- Queue limit and overflow policy are configured through `RuntimeConfigDTO.gateway` and must conform to the frozen MVP behavior.

## Non-Goals

- Queue summarization or coalescing in MVP
- Cross-session scheduling policies

## Acceptance Criteria

- A second message arriving during an active turn is preserved and processed after lock release.
- A ninth queued ingress for the same locked session is rejected deterministically.

## Open Questions

- None.