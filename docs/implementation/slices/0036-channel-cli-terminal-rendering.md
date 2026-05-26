# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: orchestrator
- Approval date: 2026-05-24
- Phase: 6 (CLI Channel and End-to-End Wiring)
- Owner: channel_cli
- Execution readiness: implemented-and-validated. Slice 0035 provided the package scaffolding, and this slice is now implemented with focused rendering tests in `@argentum/channel-cli` plus downstream runtime consumption through the 0037 happy-path seam.

## Scope

- Slice name: CLI Terminal Rendering
- Target package or boundary: `channel_cli` (`@argentum/channel-cli`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "One terminal CLI channel module"
  - [docs/spec/40-modules/channel-cli/terminal-rendering.md](../../spec/40-modules/channel-cli/terminal-rendering.md) — **sole authority** for terminal rendering: renders from `StreamEvent` values, plain text only, user can distinguish thinking/acting/blocked/finished states, telemetry-only events hidden from normal output
  - [docs/spec/40-modules/channel-cli/cli-adapter-mvp.md](../../spec/40-modules/channel-cli/cli-adapter-mvp.md) — CLI responsibilities: "Render user-visible `StreamEvent` values back to the terminal" (contextual only; this slice owns rendering)
  - [docs/spec/20-contracts/stream-event.md](../../spec/20-contracts/stream-event.md) — `StreamEvent` contract (validated slice 0004, available from `@argentum/contracts`)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md) — minimum required payload fields for MVP event families
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md) — event families (`turn.*`, `validation.*`, `llm.*`, `tool.*`, `memory.*`, `response.*`, `queue.*`), visibility roles (`user`, `system`, `telemetry`)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `StreamEvent` is a canonical contract; rendering logic keys off event kinds and visibility
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md) — `channel_cli` is "terminal input and rendering"; the channel package must not depend on provider implementation code
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "end-to-end happy-path CLI tests for one full turn" (future slices); this slice requires rendering boundary tests for event-kind routing and visibility filtering
- Acceptance criteria:
  - **`renderStreamEvent(event: StreamEvent): string` function exported** from `@argentum/channel-cli`. Accepts a `StreamEvent`, returns a human-readable plain-text string suitable for `console.log` or `process.stdout.write`. The function is pure — no I/O, no side effects, no internal state. Callers decide where to write the returned string.
  - **Visibility filtering**:
    - Events with `visibility: "user"` are always rendered.
    - Events with `visibility: "system"` are rendered with a `[system]` prefix or equivalent visual distinction.
    - Events with `visibility: "telemetry"` return an empty string `""` (hidden from normal terminal output).
  - **State-distinguishing output**: The rendered output for each event family makes the runtime state clearly distinguishable to a user reading terminal output alone:
    - **Thinking** (inference in progress): `llm.started` → `"Thinking..."`; `llm.completed` → `"[system] Inference complete."` when `visibility === "system"`, otherwise `""` (the completion boundary distinguishes thinking from finished states). `llm.failed` → `"Inference failed: <reason>"`.
    - **Acting** (tool execution): `tool.started` → `"Using <tool_name>..."`; `tool.finished` → `"<tool_name> completed"`; `tool.planned` → no output (implementation detail).
    - **Blocked** (cannot proceed): `tool.blocked` → `"<tool_name> blocked: <reason>"`; `turn.aborted` → `"Turn aborted: <reason>"`; `validation.failed` (unrepairable) → `event.visibility === "system" ? "[system] Validation failed: <reason>" : "Validation failed: <reason>"`.
    - **Finished** (terminal outcome): `turn.completed` → `"Done."`; `response.*` events carry the actual assistant response text — the renderer extracts `payload.final_outcome` (the **only** spec-guaranteed field for `response.completed` per `stream-event-payloads.md`) and returns it directly. There is no `message` fallback — `final_outcome` is the sole authoritative field.
  - **Event-kind routing**: The function uses a `switch` or lookup table on `event.kind` (string prefix match on the event family). Unknown event kinds return an empty string `""` (forward-compatible; no throw).
  - **Discriminated union awareness**: The `StreamEvent` type from `@argentum/contracts` is a discriminated union on `scope` (`"session"` | `"turn"`), not on `kind`. The renderer accepts the full `StreamEvent` union type and narrows by `event.kind` at runtime. No TypeScript-level narrowing on `kind` is required — the renderer keys off the string value of `event.kind`.
  - **Minimum rendered event kinds** (MVP coverage):
    - `turn.started` → `"Turn started${payload.state ? ` (${payload.state})` : ""}."` (payload `state` is a spec-required field; fallback to `""` if missing)
    - `turn.state_changed` → the `[system]` prefix is conditional on `event.visibility === "system"`: if system, `"[system] State: <from_state> → <to_state>"`; otherwise `"State: <from_state> → <to_state>"`
    - `turn.completed` → `"Done."`
    - `turn.aborted` → `"Turn aborted: <payload.reason>"`
    - `llm.started` → `"Thinking..."`
    - `llm.completed` → `event.visibility === "system" ? "[system] Inference complete." : ""`
    - `llm.failed` → `"Inference failed: <payload.reason>"`
    - `tool.started` → `"Using <payload.tool_name>..."`
    - `tool.finished` → `"<payload.tool_name> completed"`
    - `tool.blocked` → `"<payload.tool_name> blocked: <payload.reason>"`
    - `validation.failed` → `event.visibility === "system" ? "[system] Validation failed: <payload.reason>" : "Validation failed: <payload.reason>"` (only when `payload.repairable === false`; repairable failures are silent — the next repair attempt will produce a subsequent event)
    - `response.started` → `""` (transient; response text follows)
    - `response.completed` → extracts and returns `payload.final_outcome` directly (no prefix, no `message` fallback — `final_outcome` is spec-guaranteed)
    - `memory.compaction_committed` → `""` (implementation detail, hidden)
    - `queue.queued` → `""` (session-scoped, hidden from terminal in MVP)
    - `queue.dequeued` → `""` (session-scoped, hidden from terminal in MVP)
    - `queue.rejected` → `event.visibility === "system" ? "[system] Queue full — input rejected" : "Queue full — input rejected"`
  - **Plain text only**: All rendered strings are plain UTF-8 text with no ANSI escape codes, no terminal control sequences, no color codes. Lines end with `\n` where appropriate (the function may return multi-line strings for complex events).
  - **No external dependencies**: The function uses only `@argentum/contracts` types. No terminal UI framework (chalk, blessed, ink, etc.). No filesystem access. No network.
  - **Payload safety**: If an expected payload field is missing, the renderer substitutes `"unknown"` rather than emitting `undefined` or throwing. Example: `tool.started` with missing `tool_name` → `"Using unknown..."`
  - **Package exports**: `renderStreamEvent` is exported from `packages/channel_cli/src/index.ts` alongside the exports from slice 0035 (`normalizeCliInput`, `CliInputError`).
  - The module does NOT own input normalization, session management, gateway communication, event emission, or telemetry persistence.
- Inputs crossing the boundary:
  - `StreamEvent` from `@argentum/contracts` (slice 0004) — the append-only runtime event contract with `event_id`, `session_id`, `scope`, `turn_id`, `sequence`, `kind`, `timestamp`, `visibility`, `payload`
- Outputs crossing the boundary:
  - `string` — plain-text human-readable rendering of the event, or `""` for hidden events
  - `renderStreamEvent` function exported from `@argentum/channel-cli`

## Plan

- First contracts or interfaces to create:
  - **`renderStreamEvent(event: StreamEvent): string`** — the single rendering function. Pure, synchronous, no dependencies beyond `StreamEvent` type.
- Minimal implementation steps:
  1. **Ensure channel_cli has contracts dependency** (if not already done by slice 0035): `@argentum/contracts` in `dependencies`, tsconfig reference to `../contracts`. If slice 0035 has already scaffolded these, skip this step.
  2. **Create `packages/channel_cli/src/terminal-renderer.ts`**:
     - Import `StreamEvent` from `@argentum/contracts`
     - Define and export `renderStreamEvent(event: StreamEvent): string`:
       a. Check `event.visibility`: if `"telemetry"`, return `""`.
       b. Route on `event.kind` (string prefix match or lookup table):
          - `turn.started` → `"Turn started${payload.state ? ` (${payload.state})` : ""}."` (payload `state` is spec-required; fallback to empty)
          - `turn.state_changed` → if `event.visibility === "system"`, `"[system] State: <from> → <to>"`; otherwise `"State: <from> → <to>"`
          - `turn.completed` → `"Done."`
          - `turn.aborted` → `"Turn aborted: <reason>"`
          - `llm.started` → `"Thinking..."`
          - `llm.completed` → `event.visibility === "system" ? "[system] Inference complete." : ""`
          - `llm.failed` → `"Inference failed: <reason>"`
          - `tool.started` → `"Using <tool_name>..."`
          - `tool.finished` → `"<tool_name> completed"`
          - `tool.blocked` → `"<tool_name> blocked: <reason>"`
          - `validation.failed` → if `payload.repairable === false`, `event.visibility === "system" ? "[system] Validation failed: <reason>" : "Validation failed: <reason>"`; otherwise `""`
          - `response.completed` → extract `payload.final_outcome` only; return as-is (no `message` fallback — `final_outcome` is spec-guaranteed)
          - `response.started` → `""`
          - `memory.*` → `""`
          - `queue.rejected` → `event.visibility === "system" ? "[system] Queue full — input rejected" : "Queue full — input rejected"`
          - `queue.*` (other) → `""`
          - `validation.repair_requested` → `""`
          - default → `""` (forward-compatible)
       c. For `system` visibility events that produce output, prefix with `"[system] "` if not already prefixed.
       d. Use optional chaining and nullish coalescing for payload fields: `event.payload?.tool_name ?? "unknown"`, `event.payload?.reason ?? "unknown"`.
     - **Do NOT** import or use any terminal UI libraries (chalk, blessed, ink, etc.)
     - **Do NOT** call `console.log` — the function returns a string; the caller decides output destination
     - **Do NOT** access filesystem, network, or environment variables
  3. **Update `packages/channel_cli/src/index.ts`**: Add `export { renderStreamEvent } from "./terminal-renderer.js";` alongside slice 0035 exports.
  4. **Create `packages/channel_cli/tests/terminal-renderer.test.ts`** with vitest tests.
  5. Run `pnpm --filter @argentum/channel-cli test` to validate.
  6. Run `pnpm test` at repo root to ensure no regressions.
- Required tests:
  - **Thinking state — `llm.started`**: Returns `"Thinking..."`
  - **Thinking state — `llm.completed` (system visibility)**: Returns `"[system] Inference complete."`
  - **Thinking state — `llm.completed` (user visibility)**: Returns `""`
  - **Thinking state — `llm.completed` boundary test**: Full event sequence `llm.started → llm.completed → response.completed` produces visually distinguishable output (`"Thinking..."` → `"[system] Inference complete."` → `<final_outcome text>`) showing clear boundaries between thinking and finished states
  - **Thinking state — `llm.failed`**: Returns `"Inference failed: <reason>"` with payload reason
  - **Acting state — `tool.started`**: Returns `"Using <tool_name>..."` with payload tool_name
  - **Acting state — `tool.started` missing tool_name**: Returns `"Using unknown..."` (graceful degradation)
  - **Acting state — `tool.finished`**: Returns `"<tool_name> completed"` with payload tool_name
  - **Blocked state — `tool.blocked`**: Returns `"<tool_name> blocked: <reason>"` with payload values
  - **Blocked state — `turn.aborted`**: Returns `"Turn aborted: <reason>"` with payload reason
  - **Finished state — `turn.completed`**: Returns `"Done."`
  - **Finished state — `response.completed`**: Returns payload `final_outcome` directly (no prefix, no `message` fallback)
  - **Finished state — `response.completed` missing `final_outcome`**: Returns `""` (graceful)
  - **State transition — `turn.state_changed` (system visibility)**: Returns `"[system] State: <from> → <to>"`
  - **State transition — `turn.state_changed` (user visibility)**: Returns `"State: <from> → <to>"` (no `[system]` prefix)
  - **Turn start — `turn.started` with state**: Returns `"Turn started (inferring)."` (payload state included)
  - **Turn start — `turn.started` without state**: Returns `"Turn started."` (graceful fallback when `payload.state` is missing)
  - **Visibility filtering — `telemetry` events**: Any event with `visibility: "telemetry"` returns `""`
  - **Visibility filtering — `system` events**: Non-empty output for `system` events is prefixed or visually distinct
  - **Visibility filtering — `user` events**: Always rendered when the event kind has output
  - **Repairable validation failure**: `validation.failed` with `payload.repairable === true` returns `""` (silent; repair will follow)
  - **Unrepairable validation failure (system visibility)**: `validation.failed` with `payload.repairable === false` and `visibility: "system"` returns `"[system] Validation failed: <reason>"`
  - **Unrepairable validation failure (user visibility)**: `validation.failed` with `payload.repairable === false` and `visibility: "user"` returns `"Validation failed: <reason>"` (no `[system]` prefix)
  - **Queue rejection (system visibility)**: `queue.rejected` with `visibility: "system"` returns `"[system] Queue full — input rejected"`
  - **Queue rejection (user visibility)**: `queue.rejected` with `visibility: "user"` returns `"Queue full — input rejected"` (no `[system]` prefix)
  - **Hidden events**: `memory.compaction_started`, `memory.compaction_committed`, `queue.queued`, `queue.dequeued`, `response.started`, `validation.repair_requested`, `tool.planned`, `queue.rejected` with `visibility: "telemetry"` all return `""`
  - **Unknown event kind**: Returns `""` (forward-compatible, no throw)
  - **Payload safety — missing fields**: Each rendered event kind with expected payload fields is tested with an empty `payload: {}` — no throws, no `undefined` in output
  - **Plain text output**: Rendered strings contain no ANSI escape sequences (`\x1b[`), no carriage returns (`\r`) without `\n`
  - **Pure function**: Calling `renderStreamEvent` twice with the same event returns the same string (no internal mutable state)
- Narrow validation step:
  - `pnpm --filter @argentum/channel-cli test` passes with non-zero test count (this slice adds tests)
  - `pnpm test` at repo root passes (no regressions across existing tests)
  - Manual check: rendered output for a sequence of events representing a full turn is readable and clearly communicates progress

## Execution Strategy

- Autopilot suitability: **SAFE**. This slice is:
  - Bounded to one package (`channel_cli`) with a single pure function (~80 lines)
  - Input contract (`StreamEvent`) is fully defined and validated upstream (slice 0004)
  - No cross-package mutation, no I/O, no async, no state management
  - No unresolved bootstrap decisions — all blockers are resolved
  - No deferred decisions affect this slice
  - Deterministic, testable with vitest
  - Identical scaffolding pattern to slice 0035 (same package, same dependency setup)
  - ~20 focused test cases covering all event families, visibility filtering, payload safety, and graceful degradation
- Parallel subagent opportunities: **None**. This is a single-function module with focused tests — one subagent can implement end-to-end.
- Out of scope:
  - Input normalization (slice 0035) — this slice does NOT read stdin or produce `ChannelIngressPayload`
  - Session management or gateway communication
  - Event emission or event bus implementation
  - Telemetry persistence (slice 0038)
  - Rich TUI, ANSI colors, progress spinners, or terminal UI frameworks
  - Multi-line input handling or readline integration
  - Any channel other than CLI terminal
  - Writing to stdout — the function returns a string; the caller decides output destination
  - Formatting or wrapping output to terminal width
- Deferred decisions that must remain deferred:
  - None. All decisions needed for this slice are resolved:
    - Plain text output (no rich TUI) is an MVP constraint in the terminal rendering spec
    - Visibility filtering rules are defined in the eventing model and stream event contract
    - Event families are canonical in the eventing model

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H-0036-1**: `llm.completed` rendered as empty string breaks state-distinguishability — **RESOLVED 2026-05-24**. Added rendering: `event.visibility === "system" ? "[system] Inference complete." : ""`. Added boundary test for full sequence `llm.started → llm.completed → response.completed`.
  - **H-0036-2**: `turn.started` ignores payload `state` field — **RESOLVED 2026-05-24**. Changed to `"Turn started${payload.state ? ` (${payload.state})` : ""}."` with fallback.
  - **M-0036-1**: Remove `message` fallback from `response.completed` rendering — **RESOLVED 2026-05-24**. `response.completed` now extracts `payload.final_outcome` only; `message` fallback removed. `final_outcome` is the sole spec-guaranteed field per `stream-event-payloads.md`.
  - **M-0036-2**: Add note acknowledging `StreamEvent` discriminated union — **RESOLVED 2026-05-24**. Added "Discriminated union awareness" bullet to acceptance criteria documenting that the type discriminates on `scope` not `kind`, and the renderer narrows by `event.kind` at runtime.
  - **M-0036-3**: Make `[system]` prefix conditional on `event.visibility === "system"` for `turn.state_changed` — **RESOLVED 2026-05-24**. `turn.state_changed` rendering now applies `[system]` prefix only when `visibility === "system"`; otherwise emits `"State: <from> → <to>"`.
  - **M-0036-4**: `[system]` prefix conditioning was applied to `turn.state_changed` and `llm.completed` but NOT to `validation.failed` and `queue.rejected` — **RESOLVED 2026-05-24**. Both now use conditional `[system]` prefix: `event.visibility === "system" ? "[system] ..." : "..."`. Updated acceptance criteria, minimum rendered event kinds, implementation plan, and tests (added user-visibility variants for both event kinds).
- Refinements applied:
  - **2026-05-24**: Applied all H-0036-1, H-0036-2, M-0036-1, M-0036-2, M-0036-3, M-0036-4 refinements. Updated acceptance criteria (state-distinguishability, `llm.completed` rendering, `turn.started` payload state, `response.completed` single-field extraction, discriminated union acknowledgment, conditional `[system]` prefix for `turn.state_changed`, `validation.failed`, and `queue.rejected`), minimum rendered event kinds, implementation steps, test descriptions, and review log.
