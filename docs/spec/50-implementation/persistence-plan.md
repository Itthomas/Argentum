# Persistence Plan

## Purpose

This document defines the minimum persistence surfaces needed for MVP.

## Persistent Data Classes

- Session metadata and lock state
- Queued ingress items
- Turn metadata
- Telemetry logs
- Raw provider traces and tool artifacts

## MVP Direction

- Use one local persistence mechanism for session and queue state.
- Store logs and artifacts in local filesystem areas defined by the workspace model.
- Keep archival memory writeback out of the active-turn path.
- Persist content addressed by `ContentRef` according to its declared `retention` class.

## Open Questions

- Whether session state should live in SQLite, file-backed storage, or a small local KV layer is deferred.