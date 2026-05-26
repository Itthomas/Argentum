# Post-MVP Hardening Ideas

> Informal architectural notes on hardening slices that would improve production readiness
> but are not required for MVP.  These are brainstorming seeds, not committed backlog items.

## Session Resumption via `SessionContextStore`

**Date**: 2026-05-26
**Status**: idea — no slice planned yet

### Problem

Today the core loop's persistence is split across three surfaces:

| Surface | What it stores | Durable? |
|---|---|---|
| `EpisodicMemory` | Ordered `ContextItem[]` | ❌ in-process only |
| `TurnContentStore` | Backing text for `ContentRef` | ✅ filesystem |
| `ArtifactExternalizer` | Externalized tool artifacts | ✅ filesystem |

If the runtime crashes mid-turn, the gateway recovers its lock/queue state from SQLite,
but the agentic layer has total amnesia — the ordered context list cannot be reconstructed
from the content files alone.

### Proposed solution

Define a single `SessionContextStore` contract in `@argentum/contracts` that the
core loop calls instead of the three scattered surfaces:

```typescript
interface SessionContextStore {
  /** Append a ContextItem with optional backing text, durably. */
  append(item: ContextItem, backingText?: string): Promise<void>;

  /** Restore all context items for a session, in insertion order. */
  restore(sessionId: string): Promise<ContextItem[]>;

  /** Resolve backing text for a ContentRef stored via append(). */
  resolveBackingText(ref: ContentRef): Promise<string>;

  /** Discard all context for a session (post-session cleanup). */
  discard(sessionId: string): Promise<void>;
}
```

Key design decisions:
- **Storage-agnostic contract**: the MVP implementation can use the existing
  filesystem layout; a future slice can swap in SQLite or a local KV store
  without changing the core loop.
- **Does NOT absorb gateway persistence**: gateway lock/queue state remains
  in `@argentum/gateway` with its own SQLite store.  `SessionContextStore`
  is for agentic-layer memory only.
- **Does NOT absorb telemetry**: `TelemetryWriter` remains in
  `@argentum/telemetry` with append-only JSONL.

### Benefits

1. **Session resumption** — crash recovery for the agentic layer.
2. **Simpler core-loop wiring** — one injected dependency instead of three.
3. **Testable without filesystem mocks** — inject an in-memory implementation.
4. **Per-session storage quotas** — one place to enforce byte limits.
5. **Post-MVP archival memory** — `archiveSession()` can flush to long-term
   storage without touching the active-turn path.

### Implementation sketch

1. Define `SessionContextStore` interface in `packages/contracts/src/session-context-store.ts`.
2. Create a filesystem-backed implementation in `packages/environment`.
3. Wire it into `CoreLoopOrchestratorDependencies`, replacing `memory`,
   `contentStore`, and `compactionPolicy`'s `ArtifactExternalizer`.
4. Add `restore()` call during session bootstrap so the orchestrator can
   resume an interrupted turn.
5. Add focused contract tests for the interface shape.

### Relationship to existing slices

- **Slice 0050 (DI compliance audit)**: resolved the persistence-seam ambiguity
  by defining `SessionContextStore` as the future canonical persistence seam;
  the MVP audit treats `TurnContentStore` + `EpisodicMemory` as the current
  concrete split.
- **Audit 0021 M-2 (incomplete event-kind coverage)**: a session-resumption
  E2E test would exercise additional `MvpStreamEventKind` variants
  (restore path).
