## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (per user directive)
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core

## Scope

- Slice name: Agentic Core — Episodic Memory
- Target package or boundary: `@argentum/agentic-core`
- Authoritative spec files:
  - `docs/spec/40-modules/agentic-layer/episodic-memory.md` — sole authority for memory surface
  - `docs/spec/20-contracts/context-item.md` — `ContextItem` shape consumed for memory entries
  - `docs/spec/20-contracts/content-ref.md` — `ContentRef` shape for artifact references
  - `docs/spec/50-implementation/package-boundaries.md`
  - `docs/spec/50-implementation/test-strategy.md`
- Acceptance criteria:
  1. Episodic memory is session-scoped (tied to `session_id`)
  2. Stores accepted user inputs, committed assistant outputs, compacted tool summaries, artifact references, and repair feedback as `ContextItem` entries
  3. Raw tool artifacts are referenced via `ContentRef` rather than stored inline when compaction rules require externalization
  4. Bedrock content is NOT copied into episodic memory merely because it was read (enforced by caller convention; the store does not auto-import bedrock reads)
  5. Memory commits happen at defined turn boundaries: accepted ingress, compaction, final response
  6. No background summarization worker
  7. No automatic long-term memory writeback during active turn
  8. The next inference step can rely on compacted summaries without re-reading every raw tool artifact (achieved by `getRecent` and `getByLayer` retrieval methods)
  9. Entries are ordered by insertion (FIFO with newest last)
  10. Memory is in-process only — no persistence in this slice
- Inputs crossing the boundary:
  - `ContextItem` objects (from `@argentum/contracts`) via `add(entry)`
  - `session_id` string at construction time
- Outputs crossing the boundary:
  - `ContextItem[]` via `getRecent(limit?)` and `getByLayer(layer)`
  - `number` via `size` (total entry count)
  - `string` via `sessionId` (read-only accessor)

## Plan

- First contracts or interfaces to create:
  1. `EpisodicMemory` interface (or abstract class) in `packages/agentic_core/src/episodic-memory.ts`
     - `constructor(sessionId: string)`
     - `add(entry: ContextItem): void`
     - `getRecent(limit?: number): ContextItem[]`
     - `getByLayer(layer: ContextLayer): ContextItem[]`
     - `readonly sessionId: string`
     - `readonly size: number`
  2. Re-export from `packages/agentic_core/src/index.ts`
- Minimal implementation steps:
  1. Create `packages/agentic_core/src/episodic-memory.ts` with the `EpisodicMemory` class backed by a private `ContextItem[]` array
  2. Validate each `ContextItem` on `add()` using `parseContextItem` from `@argentum/contracts`; throw on invalid entries
  3. Implement `getRecent(limit?)`: return a shallow copy of the last N entries (default to all if limit is omitted or exceeds length)
  4. Implement `getByLayer(layer)`: filter entries by `ContextLayer` literal, preserving insertion order
  5. Export `EpisodicMemory` from `packages/agentic_core/src/index.ts`
  6. Add `@argentum/contracts` as a dependency in `packages/agentic_core/package.json` (import for `ContextItem`, `ContextLayer`, `parseContextItem`)
  7. Wire the package build so `tsc -b` resolves the contracts dependency
- Required tests:
  1. `add()` commits a valid `ContextItem` and increments `size`
  2. `add()` throws on invalid input (missing required fields, wrong types)
  3. `getRecent()` returns entries in insertion order (oldest first, newest last)
  4. `getRecent(limit)` limit edge cases (M1 — split into three sub-tests):
     a. `limit < size`: returns exactly the most recent N entries
     b. `limit > size`: returns all entries (no error, no padding)
     c. `limit === 0`: returns an empty array `[]`
  5. `getRecent()` on empty memory returns `[]`
  6. `getByLayer("episodic")` returns only episodic-layer entries
  7. `getByLayer("tool_summary")` returns only tool-summary-layer entries
  8. `getByLayer()` on empty memory returns `[]`
  9. `sessionId` accessor returns the constructor-provided session ID
  10. `size` accessor reflects the current entry count
  11. Multiple `add()` calls preserve insertion order across layers
  12. Returned arrays are independent copies (mutating a returned array does not affect internal state)
  13. **ContentRef round-trip integrity** (H1):
     a. Construct a `ContextItem` with a fully-populated `ContentRef` (all fields: `ref_id`, `kind`, `storage_area`, `locator`, `media_type`, `retention`). Call `add()` then `getRecent()` and assert deep equality on the returned `ContextItem.content_ref` — all fields must match exactly.
     b. Add an item with `content_ref.storage_area = "artifacts"` and `content_ref.locator = "some-call-id.json"`. Call `getByLayer()` with the item's layer and assert the `storage_area` field is preserved as `"artifacts"` (not defaulted or mutated).
  14. **parseContextItem delegation** (M3):
     a. Construct an object that is structurally valid at the top level (has `context_id`, `layer`, `content_ref`, etc.) but has a structurally invalid `content_ref` (missing required sub-fields like `ref_id` or `storage_area`). Assert `add()` throws `ContextItemValidationError` (proving `parseContextItem` is actually called and validates the nested `content_ref`).
- Narrow validation step:
  ```bash
  pnpm --filter @argentum/agentic-core test
  ```
  All 14+ tests pass with no `--passWithNoTests` fallback.

- **Design note — duplicate context_id** (M2): The `EpisodicMemory` store does NOT enforce `context_id` uniqueness. Callers are responsible for supplying unique IDs. If two entries share the same `context_id`, both are stored and can be retrieved independently. This is a deliberate simplification for MVP — enforcement, deduplication, or upsert semantics may be added in a future slice if needed.

## Execution Strategy

- Autopilot suitability: **Safe**. The slice is bounded, has a single owning package, depends only on already-validated contracts (`ContextItem`, `ContentRef`), has no persistence, no external I/O, and the acceptance criteria are deterministic. The implementation is a straightforward in-memory collection with validation at the boundary.
- Parallel subagent opportunities:
  - **Read-only subagent: test extraction** — Harvest the 12 test scenarios from this card and the `episodic-memory.md` spec into a standalone test-plan review. No code mutations needed.
  - **Read-only subagent: contract dependency audit** — Verify that `@argentum/contracts` exports all types needed by `EpisodicMemory` (`ContextItem`, `ContextLayer`, `parseContextItem`, `ContextItemValidationError`) and that no additional contracts are needed for this slice.
- Out of scope:
  - Persistence (SQLite or file-backed storage) — deferred to a later slice
  - Background summarization worker — explicitly excluded by MVP constraints
  - Automatic long-term memory writeback — explicitly excluded by MVP constraints
  - Compaction logic — the memory store accepts compacted entries but does not perform compaction itself
  - Bedrock-copy prevention enforcement — the store trusts callers; it does not introspect `layer` to reject bedrock entries
  - Turn-boundary commit enforcement — the store does not gate `add()` on turn state; callers are responsible for calling `add()` only at correct boundaries
  - Memory eviction or capacity limits — MVP has none; memory grows unbounded within a session
  - Session lifecycle management — the store is constructed with a `session_id` but does not manage session creation or teardown
- Deferred decisions that must remain deferred:
  - None introduced by this slice. All deferred decisions referenced in `docs/spec/70-roadmap/deferred-decisions.md` (background summarization, long-term memory writeback, persistence backend selection) are explicitly out of scope and remain deferred.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1**: Missing ContentRef round-trip integrity test.
  - **M1**: getRecent limit edge cases not split.
  - **M2**: Duplicate context_id behavior unspecified.
  - **M3**: parseContextItem delegation not provably tested.
- Refinements applied:
  - **H1**: Added two ContentRef round-trip integrity tests: (A) construct ContextItem with fully-populated ContentRef, add+getRecent, assert deep equality on all content_ref fields. (B) add item with content_ref.storage_area="artifacts", getByLayer, assert field preserved.
  - **M1**: Split test #4 (`getRecent(limit)`) into three sub-tests: (a) limit < size → most recent N, (b) limit > size → all entries, (c) limit === 0 → empty array.
  - **M2**: Added design note documenting that the store does NOT enforce context_id uniqueness — callers are responsible for unique IDs. Both duplicate entries are stored independently.
  - **M3**: Added parseContextItem delegation sub-test: construct object valid at top level but with structurally invalid content_ref (missing required sub-fields). Assert add() throws ContextItemValidationError, proving parseContextItem validates nested content_ref.

- Implementation review (2026-05-24, argentum-implementer):
  - **CRITICAL**: None.
  - **HIGH**: None.
  - **MEDIUM**: None.
  - **LOW**:
    - `#entries` uses ES2022 private field syntax — compatible with ES2023 target, no interop concerns.
    - `getByLayer()` uses `.filter()` which inherently returns a new array (no extra spread needed unlike `getRecent()` which slices the internal array).
  - Validation results:
    - `pnpm --filter @argentum/agentic-core test`: **101 tests passed** (24 episodic-memory, 6 package-entrypoint, 71 turn-state-machine), 0 failures.
    - `pnpm typecheck` (`tsc -b`): **clean** — no type errors across the workspace.
  - All 14+ required test scenarios from the plan are implemented and passing.
  - No new deferred decisions introduced.
