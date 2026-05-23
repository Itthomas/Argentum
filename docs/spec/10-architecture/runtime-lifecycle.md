# Runtime Lifecycle

## Purpose

This document defines the high-level lifetime of a session and turn in Argentum.

## Session Lifecycle

1. A channel message arrives.
2. The gateway resolves or creates a session.
3. The gateway acquires the session lock or queues ingress.
4. The accepted ingress becomes one `TurnEnvelope`.
5. The turn executes until response, clarification, or abort.
6. The gateway releases the lock and drains the next queued ingress if present.

## Turn Lifecycle

1. Accept ingress
2. Build context
3. Infer one action decision
4. Validate and normalize that decision
5. Execute any required tools
6. Compact and commit memory updates
7. Return to another inference step after tool execution, or respond for terminal decisions
8. Finalize and archive asynchronously

## Lifecycle Guarantees

- One session has at most one active turn at a time.
- One turn consumes exactly one accepted ingress.
- Tool execution occurs only inside an active turn.
- Archival work must not delay lock release in MVP.

## Open Questions

- Queue coalescing behavior beyond FIFO is deferred.