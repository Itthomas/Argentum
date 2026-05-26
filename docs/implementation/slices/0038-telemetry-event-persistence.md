# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: orchestrator
- Approval date: 2026-05-24
- Phase: 7 (Hardening)
- Owner: telemetry
- Execution readiness: implemented-and-validated. This slice is the first real `@argentum/telemetry` implementation slice, with a non-vacuous package test gate and downstream runtime consumption through the 0037 happy-path composition seam. The upstream `StreamEvent` and telemetry config contracts remain the only required inputs.

## Scope

- Slice name: Telemetry Event Persistence
- Target package or boundary: `telemetry` (`@argentum/telemetry`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "Flat structured telemetry suitable for replay and debugging" (MVP scope)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md) — **sole authority** for event roles: "Telemetry: events written to logs for debugging, replay, and inspection"; event families; scoping rules; "Event emission must not become an alternative control plane"
  - [docs/spec/10-architecture/state-ownership.md](../../spec/10-architecture/state-ownership.md) — telemetry event stream is "append-only shared emission"; no module owns all events; producers own payload correctness
  - [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md) — `StreamEvent` contract (validated slice 0004): `event_id`, `session_id`, `scope`, `turn_id`, `sequence`, `kind`, `timestamp`, `visibility`, `payload`; rules: "Telemetry pipelines must preserve original event order"
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md) — minimum required payload fields for MVP event families
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md) — `telemetry` config section: `format` (`"jsonl"`), `persist_events` (boolean)
  - [docs/spec/40-modules/gateway/telemetry.md](../../spec/40-modules/gateway/telemetry.md) — gateway telemetry spec: "Subscribe to emitted `StreamEvent` values", "Persist append-only telemetry records", "Preserve event ordering per turn", "Attach correlation identifiers for turn, session, and tool call flows", "Telemetry storage is append-only in MVP", "Large payloads must be stored by reference rather than duplicated in logs", acceptance criteria: "An implementer can replay one turn's high-level state transitions from telemetry records alone"
  - [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md) — `logs/`: append-only runtime telemetry and diagnostics
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md) — `telemetry`: event persistence and log formatting
  - [docs/spec/50-implementation/persistence-plan.md](../../spec/50-implementation/persistence-plan.md) — "Store logs and artifacts in local filesystem areas defined by the workspace model"
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "Telemetry tests for event ordering and minimum payload presence"
  - [docs/spec/00-overview/mvp-scope.md](../../spec/00-overview/mvp-scope.md) — "Flat structured telemetry suitable for replay and debugging"
- Acceptance criteria:
  - **`TelemetryWriter` class exported** from `@argentum/telemetry`. Accepts configuration via constructor and persists `StreamEvent` values to disk as structured logs.
  - **Constructor signature**: `new TelemetryWriter(config: TelemetryWriterConfig)` where `TelemetryWriterConfig` has:
    - `logDir: string` — absolute path to the log output directory (from workspace model's `logs/` area)
    - `format: "jsonl"` — output format (only `"jsonl"` in MVP)
    - `persistEvents: boolean` — if `false`, `writeEvent()` is a no-op (events are not written to disk)
  - **`TelemetryWriterConfig` type exported**.
  - **`writeEvent(event: StreamEvent): Promise<void>` method**: Appends one `StreamEvent` as a single JSON line to the current log file. The JSON line is the result of `JSON.stringify(event)` — the full `StreamEvent` object is serialized, including `event_id`, `session_id`, `scope`, `turn_id`, `sequence`, `kind`, `timestamp`, `visibility`, and `payload`. Each call writes exactly one line ending with `\n`.
  - **Append-only**: Events are appended to the log file. Existing log content is never overwritten or truncated. The file is opened in append mode (`fs.appendFile` or equivalent).
  - **Event ordering preserved**: Events are written in the order `writeEvent()` is called, even under concurrent calls. An internal `#writeChain` promise chain serializes appends so JSONL line order is deterministic regardless of caller concurrency. Each `writeEvent()` call returns a promise that resolves when its specific append is complete.
  - **One log file per session**: The log file is named `<session_id>.jsonl` and created in `config.logDir`. The file is created on first `writeEvent()` for a session. If the file already exists (e.g., from a previous runtime invocation), events are appended to it.
  - **`flush(): Promise<void>` method**: Ensures all pending writes are durably persisted. Returns a promise that resolves when all buffered writes are complete. For MVP, since each `writeEvent()` writes immediately, `flush()` is a no-op that returns `Promise.resolve()`.
  - **`persistEvents: false` mode**: When `persistEvents` is `false`, `writeEvent()` returns `Promise.resolve()` immediately without touching the filesystem. `flush()` also no-ops. No log files are created.
  - **Directory creation**: The `logDir` directory is created recursively on first `writeEvent()` if it does not exist (using `fs.mkdirSync` or `fs.promises.mkdir` with `recursive: true`). If directory creation fails, `writeEvent()` throws.
  - **Write errors**: If appending to the log file fails (disk full, permission denied, etc.), `writeEvent()` throws the underlying filesystem error. The telemetry writer does not swallow or retry write failures.
  - **No event emission**: The `TelemetryWriter` does not emit events, create `StreamEvent` values, or modify event payloads. It only persists what it receives.
  - **No log rotation**: MVP does not implement log rotation, size limits, or retention policies. The log file grows indefinitely.
  - **No structured query interface**: MVP provides file-based JSONL output only. No in-process query API, no indexing, no search.
  - **Correlation identifiers preserved**: The full `StreamEvent` is serialized, so `session_id`, `turn_id`, and `sequence` are always present in the log output, enabling per-turn replay.
  - **Large payloads by reference**: The telemetry writer serializes the event as-is. It does not inspect or extract large payloads — the contract layer is responsible for using `ContentRef` for large artifacts. This slice serializes whatever `payload` is provided.
  - **Package exports**: `TelemetryWriter` and `TelemetryWriterConfig` are exported from `packages/telemetry/src/index.ts`.
  - The module does NOT own event emission, event creation, session management, gateway logic, or any module-internal behavior.
- Inputs crossing the boundary:
  - `StreamEvent` from `@argentum/contracts` (slice 0004) — the append-only runtime event contract
  - `TelemetryWriterConfig` — `{ logDir: string; format: "jsonl"; persistEvents: boolean }`
- Outputs crossing the boundary:
  - JSONL log file at `<logDir>/<session_id>.jsonl` — one JSON object per line, each a serialized `StreamEvent`
  - `TelemetryWriter` class exported from `@argentum/telemetry`
  - `TelemetryWriterConfig` type exported from `@argentum/telemetry`

## Plan

- First contracts or interfaces to create:
  - `TelemetryWriterConfig` type — `{ logDir: string; format: "jsonl"; persistEvents: boolean }`
  - `TelemetryWriter` class — constructor accepts `TelemetryWriterConfig`, exposes `writeEvent(event: StreamEvent): Promise<void>` and `flush(): Promise<void>`
- Minimal implementation steps:
  1. **Scaffold `telemetry` package dependencies**:
     - Add `"@argentum/contracts": "workspace:*"` to `dependencies` in `packages/telemetry/package.json`
     - Add `"references": [{ "path": "../contracts" }]` to `packages/telemetry/tsconfig.json`
     - Change test script from `"vitest run --passWithNoTests"` to `"vitest run"`
  2. **Create `packages/telemetry/src/telemetry-writer.ts`**:
     - Import `StreamEvent` from `@argentum/contracts`
     - Import `fs/promises` (or `fs` with `fs.promises.appendFile`) and `path` from Node.js
     - Define and export `TelemetryWriterConfig`:
       ```ts
       export interface TelemetryWriterConfig {
         logDir: string;
         format: "jsonl";
         persistEvents: boolean;
       }
       ```
     - Define and export `TelemetryWriter` class:
       ```ts
       export class TelemetryWriter {
         readonly #config: TelemetryWriterConfig;
         #dirEnsured = false;
         #writeChain: Promise<void> = Promise.resolve();

         constructor(config: TelemetryWriterConfig) {
           this.#config = { ...config }; // shallow defensive copy
         }

         async writeEvent(event: StreamEvent): Promise<void> {
           if (!this.#config.persistEvents) return;
           // Chain onto the previous write so concurrent callers are
           // serialized and JSONL line order is deterministic.
           const writePromise = this.#writeChain.then(() => this.#doWrite(event));
           // Prevent a single failure from breaking the entire chain.
           this.#writeChain = writePromise.catch(() => {});
           return writePromise;
         }

         async flush(): Promise<void> {
           // MVP: writes are immediate, nothing to flush
         }

         async #doWrite(event: StreamEvent): Promise<void> {
           await this.#ensureLogDir();
           const filePath = path.join(this.#config.logDir, `${event.session_id}.jsonl`);
           const line = JSON.stringify(event) + "\n";
           await appendFile(filePath, line, "utf-8");
         }

         async #ensureLogDir(): Promise<void> {
           if (this.#dirEnsured) return;
           await mkdir(this.#config.logDir, { recursive: true });
           this.#dirEnsured = true;
         }
       }
       ```
     - The class uses a `#writeChain` promise chain to serialize concurrent writes — this guarantees JSONL line ordering even under `Promise.all()` call patterns.
     - **Do NOT** import any logging frameworks (winston, pino, bunyan, etc.)
     - **Do NOT** buffer or batch events — each `writeEvent()` call writes immediately (serialized via the chain)
     - **Do NOT** implement log rotation, compression, or retention
     - **Do NOT** emit events or modify event payloads
  3. **Update `packages/telemetry/src/index.ts`**: Replace `export {};` with:
     ```ts
     export { TelemetryWriter } from "./telemetry-writer.js";
     export type { TelemetryWriterConfig } from "./telemetry-writer.js";
     export type { StreamEvent } from "@argentum/contracts";
     ```
  4. **Create `packages/telemetry/tests/telemetry-writer.test.ts`** with vitest tests. Use a temporary directory (via Node.js `fs.mkdtemp` or `os.tmpdir`) for log output. Clean up after tests. Import `parseStreamEvent` from `@argentum/contracts` for the round-trip validation tests (H-0038-2).
  5. Run `pnpm --filter @argentum/telemetry test` to validate.
  6. Run `pnpm test` at repo root to ensure no regressions.
- Required tests:
  - **Write single event**: Create `TelemetryWriter` with `persistEvents: true` and a temp log dir. Write one `StreamEvent`. Read the log file and verify it contains exactly one JSON line matching the event.
  - **JSONL format**: Each line in the log file is a valid JSON object parseable by `JSON.parse`. No extra whitespace, no trailing commas.
  - **One line per event**: Writing N events produces exactly N lines in the log file.
  - **Event ordering preserved**: Write 3 events with `sequence` 1, 2, 3. Read the log file and verify lines appear in the same order.
  - **Full event serialization**: The written JSON includes all `StreamEvent` fields: `event_id`, `session_id`, `scope`, `turn_id`, `sequence`, `kind`, `timestamp`, `visibility`, `payload`.
  - **One log file per session**: Events with different `session_id` values are written to different files (`<session_id_1>.jsonl`, `<session_id_2>.jsonl`).
  - **Append to existing file**: Write one event, then write a second event for the same session. Verify the file has 2 lines (second write appended, not overwritten).
  - **persistEvents: false**: Create `TelemetryWriter` with `persistEvents: false`. Write events. Verify no log file is created and no error is thrown.
  - **Directory auto-creation**: Create `TelemetryWriter` with a non-existent `logDir`. Write an event. Verify the directory is created and the log file exists inside it.
  - **Directory creation failure**: Create `TelemetryWriter` with a `logDir` path where a file (not directory) already exists at that path. Verify `writeEvent()` throws.
  - **flush() no-op**: Call `flush()` and verify it resolves without error whether or not events were written.
  - **Concurrent writes with ordering guarantee**: Write multiple events concurrently (`Promise.all([writeEvent(e1), writeEvent(e2), ..., writeEvent(e7)])`). Verify all events are written and line order matches call order — the `#writeChain` serializes concurrent appends. (H-0038-1)
  - **Immutability of input**: The `StreamEvent` passed to `writeEvent` is not modified by the writer (verify by comparing before/after).
  - **Special characters in payload**: Events with payloads containing Unicode, newlines, quotes, and backslashes are serialized correctly via `JSON.stringify` and parseable on read-back.
  - **Minimum payload presence**: Events from each required MVP event family (`turn.*`, `validation.*`, `llm.*`, `tool.*`, `memory.*`, `response.*`, `queue.*`) are written and the payload is present in the JSON output.
  - **Telemetry replay**: Write a sequence of events representing a full turn lifecycle (`turn.started` → `llm.started` → `llm.completed` → `tool.started` → `tool.finished` → `response.started` → `response.completed` → `turn.completed`). Read the log file and verify all events are present in order and can be parsed as an array of `StreamEvent` objects.
  - **JSONL round-trip through `parseStreamEvent()` (turn-scoped)**: Write event → read JSONL line → `JSON.parse` → `parseStreamEvent()` → assert deep equality with original. (H-0038-2)
  - **JSONL round-trip through `parseStreamEvent()` (session-scoped)**: Same round-trip for a `queue.*` event with `scope: "session"`. (H-0038-2)
  - **Write error propagation**: Force a write to fail (e.g., read-only file) and verify `writeEvent()` throws the underlying filesystem error.
  - **Write chain resilience**: A failed write does not break the `#writeChain`; subsequent writes succeed after the failure condition is removed. (H-0038-1)
- Narrow validation step:
  - `pnpm --filter @argentum/telemetry test` passes with non-zero test count
  - `pnpm test` at repo root passes (no regressions across existing tests)
  - Manual check: a JSONL log file from a test run is human-readable and contains all expected fields

## Execution Strategy

- Autopilot suitability: **SAFE**. This slice is:
  - Bounded to one package (`telemetry`) with a single class (~50 lines)
  - Input contract (`StreamEvent`) is fully defined and validated upstream (slice 0004)
  - Simple filesystem I/O (append JSONL lines to a file) — no complex logic
  - No cross-package mutation, no state management beyond a directory-ensured flag
  - No unresolved bootstrap decisions — all blockers are resolved
  - No deferred decisions affect this slice (persistence technology for telemetry is explicitly filesystem `logs/` per workspace model)
  - Deterministic, testable with vitest and temp directories
  - ~16 focused test cases covering write, append, ordering, format, directory creation, persist toggle, and replay
  - Identical scaffolding pattern to slice 0031 (add contracts dep, tsconfig reference, vitest config, create one module)
- Parallel subagent opportunities: **None**. This is a single-class module with focused tests — one subagent can implement end-to-end.
- Out of scope:
  - Event emission or event bus — the telemetry module receives events, it does not create or emit them
  - Log rotation, compression, size limits, or retention policies
  - Structured query interface, indexing, or search
  - Centralized metrics backend or aggregation
  - Real-time streaming or WebSocket-based telemetry
  - Any module-internal logic (gateway, agentic core, tooling) — telemetry only persists what it receives
  - Event creation — `StreamEvent` construction is owned by the emitting module
  - Runtime config loading — the `TelemetryWriterConfig` is passed in by the composition root
  - Multiple output formats beyond JSONL
  - Session lifecycle or session management
- Deferred decisions that must remain deferred:
  - "Exact local persistence technology for session and queue state" — does not apply to telemetry. The workspace model explicitly specifies `logs/` as a filesystem area. JSONL files on disk are the MVP persistence mechanism for telemetry. No deferred decision blocks this slice.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H-0038-1 (HIGH): `writeEvent()` does not guarantee sequential ordering.** `fs.appendFile` is asynchronous and concurrent calls can interleave, breaking JSONL line ordering with concurrent turn/validation/tool events. **Mitigation**: Added a per-instance `#writeChain: Promise<void>` inside `TelemetryWriter`. Each `writeEvent()` chains onto the previous write via `this.#writeChain = this.#writeChain.then(() => this.#doWrite(event)).catch(() => {})`. The `.catch(() => {})` prevents a single failed write from breaking the chain for subsequent writes. A dedicated test issues concurrent `writeEvent` calls via `Promise.all()` and verifies line ordering in the output.
  - **H-0038-2 (HIGH): No test for JSONL round-trip through `parseStreamEvent()`.** Consumers reading JSONL files back need confidence that deserialized lines survive re-validation. **Mitigation**: Added round-trip tests (turn-scoped and session-scoped) that: write event → read JSONL line → `JSON.parse` → `parseStreamEvent()` → assert deep equality with original. Added JSDoc on `TelemetryWriter` noting that consumers should use `parseStreamEvent()` to re-validate deserialized events.

- Refinements applied:
  - **2026-05-24 runtime-consumption validation**: `apps/runtime` now constructs `TelemetryWriter` from the validated runtime config, persists real happy-path `StreamEvent` values during runtime execution, and calls `flush()` during shutdown. This slice is therefore validated as a consumed runtime boundary in addition to its package-local test coverage.
  - **2026-05-24**: Implemented `#writeChain` promise-chain serialization in `TelemetryWriter.writeEvent()` to guarantee sequential JSONL line ordering under concurrent writes (H-0038-1).
  - **2026-05-24**: Added concurrent-write ordering test (`Promise.all` of 7 events, verified line-for-line) to `telemetry-writer.test.ts` (H-0038-1).
  - **2026-05-24**: Added write-chain resilience test: failed write does not break the chain; subsequent writes succeed after file permissions are restored (H-0038-1).
  - **2026-05-24**: Added JSONL round-trip test (`write` → `JSON.parse` → `parseStreamEvent` → assert deep equality) for turn-scoped events (H-0038-2).
  - **2026-05-24**: Added JSONL round-trip test for session-scoped (`queue.*`) events (H-0038-2).
  - **2026-05-24**: Added JSDoc to `TelemetryWriter` class: "Re-validation of deserialized events" section recommending `parseStreamEvent()` for consumers reading JSONL logs (H-0038-2).
  - **2026-05-24**: Scaffold: added `@argentum/contracts` dependency and tsconfig reference to `packages/telemetry`.
  - **2026-05-24**: Created `telemetry-writer.ts` (~95 lines) and `telemetry-writer.test.ts` (~22 test cases).
  - **State updated**: planned → implemented (pending validation) → validated after runtime integration coverage plus package/runtime/typecheck validation.
