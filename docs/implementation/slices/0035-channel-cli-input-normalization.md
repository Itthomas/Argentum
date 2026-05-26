# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: human decision (CRITICAL C1 resolution)
- Approval date: 2026-05-24
- Phase: 6 (CLI Channel and End-to-End Wiring)
- Owner: channel_cli
- Execution readiness: ready-when-approved. This is the **first implementation slice** for the `@argentum/channel-cli` package (currently a shell with `export {}`). The upstream contract dependencies (`IngressDTO`, `MessagePart`, `ChannelIngressPayload`) are available from `@argentum/contracts`. No upstream `channel_cli` slices exist — this slice creates the package's first real module.
- **CRITICAL C1 resolved 2026-05-24 by human decision (Option A)**: Gateway owns `IngressDTO` construction. The channel normalizes raw input into a partial payload (`ChannelIngressPayload` / `Omit<IngressDTO, "ingress_id" | "session_id">`). The gateway adds `ingress_id` and `session_id` and constructs the final `IngressDTO`. This aligns with the validated slice 0006 gateway contract (`GatewayIngressInput`) and the ingress-contract.md rule: "The gateway assigns `ingress_id` immediately after normalization and before queue-admission decisions."

## Scope

- Slice name: CLI Input Normalization
- Target package or boundary: `channel_cli` (`@argentum/channel-cli`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "One terminal CLI channel module", "Each accepted terminal input is normalized into one IngressDTO containing exactly one MessagePart with kind = text"
  - [docs/spec/40-modules/channel-cli/cli-adapter-mvp.md](../../spec/40-modules/channel-cli/cli-adapter-mvp.md) — **sole authority** for CLI responsibilities: read terminal input, normalize into IngressDTO containing one MessagePart with kind=text
  - [docs/spec/40-modules/channel-cli/terminal-rendering.md](../../spec/40-modules/channel-cli/terminal-rendering.md) — rendering spec (contextual only; NOT owned by this slice)
  - [docs/spec/20-contracts/ingress-contract.md](../../spec/20-contracts/ingress-contract.md) — IngressDTO contract shape (implemented slice 0005, available from `@argentum/contracts`)
  - [docs/spec/20-contracts/message-part.md](../../spec/20-contracts/message-part.md) — MessagePart contract (text kind)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — contract set definition; `IngressDTO` and `MessagePart` are canonical contracts
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md) — `channel_cli` is "terminal input and rendering"; the channel package must not depend on provider implementation code
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "end-to-end happy-path CLI tests for one full turn" (future slices); this slice requires boundary contract tests for normalization correctness
- Acceptance criteria:
  - **`normalizeCliInput(rawInput: string): ChannelIngressPayload`** function exported from `@argentum/channel-cli`
  - Returns a frozen `ChannelIngressPayload` with:
    - `channel` set to `"terminal_cli"`
    - `user_id` set to `"local"` (single-user MVP CLI; no multi-user terminal multiplexing)
    - Exactly one `MessagePart` in `message_parts` with `kind: "text"` and `text` set to the trimmed input
    - `received_at` set to the current UTC timestamp in ISO-8601 format (via `new Date().toISOString()`)
    - No `attachments` or `metadata` fields (undefined, not present)
    - **NO `ingress_id`** — the gateway assigns `ingress_id` during `IngressDTO` construction (per ingress-contract.md rule and validated slice 0006)
    - **NO `session_id`** — the gateway's session router assigns `session_id` during `IngressDTO` construction
  - **Structural validation**: Before returning, the function validates that `message_parts` is a non-empty array and that `message_parts[0].text` is a non-empty string after trimming. If validation fails, throws `CliInputError`.
  - **No `parseIngressDTO` call**: The function does NOT call `parseIngressDTO` — the gateway validates the full `IngressDTO` after adding `ingress_id` and `session_id`.
  - **Whitespace handling**: Strips leading and trailing whitespace from `rawInput`; preserves internal whitespace exactly as received
  - **Empty input rejection**: Throws a `CliInputError` (extending `Error`) when `rawInput` is empty or whitespace-only after trimming. Error `message` describes the rejection reason. The error class name is `"CliInputError"`.
  - **`CliInputError` class exported**: Extends `Error`, sets `name` to `"CliInputError"`. Simple named error — no multi-issue validation, no error codes.
  - **Immutability**: The returned `ChannelIngressPayload` is frozen (`Object.freeze`).
  - **Deterministic timestamp generation**: `received_at` is generated via `new Date().toISOString()` at call time. Testable via fake timers.
  - **Structural compatibility with `GatewayIngressInput`**: The returned `ChannelIngressPayload` is structurally assignable to `Omit<IngressDTO, "ingress_id" | "session_id">` (i.e., `GatewayIngressInput` from `@argentum/gateway`).
  - **Package exports**: The `channel-cli` package exports `normalizeCliInput`, `CliInputError`, and all consumed contract types from its entrypoint.
  - The `ChannelIngressPayload` type is defined in `@argentum/contracts` and re-exported by `@argentum/channel-cli`.
  - The slice does NOT render output, manage sessions, call the gateway, handle multi-line input, implement rich TUI, or implement any channel other than CLI.
- Inputs crossing the boundary:
  - `rawInput: string` — raw user input from stdin (or equivalent string source)
  - `ChannelIngressPayload` type from `@argentum/contracts` (to be added as part of this slice)
  - `MessagePart` type from `@argentum/contracts` (slice 0004)
- Outputs crossing the boundary:
  - `ChannelIngressPayload` — frozen, validated partial ingress payload ready for gateway consumption (gateway adds `ingress_id` and `session_id`)
  - `normalizeCliInput` function exported from `@argentum/channel-cli`
  - `CliInputError` class exported from `@argentum/channel-cli`

## Plan

- First contracts or interfaces to create:
  - **`ChannelIngressPayload` type in `@argentum/contracts`**:
    ```ts
    export type ChannelIngressPayload = Readonly<{
      channel: string;
      user_id: string;
      message_parts: readonly MessagePart[];
      received_at: string;
    }>;
    ```
    This type is structurally equivalent to `Omit<IngressDTO, "ingress_id" | "session_id">` and compatible with `GatewayIngressInput` from `@argentum/gateway`.
  - `normalizeCliInput(rawInput: string): ChannelIngressPayload` — the single normalization function
  - `CliInputError` — simple `Error` subclass for empty-input rejection
- Minimal implementation steps:
  1. **Add `ChannelIngressPayload` to `@argentum/contracts`**:
     - Create `packages/contracts/src/channel-ingress-payload.ts` with the `ChannelIngressPayload` type definition.
     - Re-export `ChannelIngressPayload` from `packages/contracts/src/index.ts`.
  2. **Scaffold `channel_cli` package dependencies**: Add `"@argentum/contracts": "workspace:*"` to `dependencies` in `packages/channel_cli/package.json`. Add `"references": [{ "path": "../contracts" }]` to `packages/channel_cli/tsconfig.json`. Change test script from `"vitest run --passWithNoTests"` to `"vitest run"`.
  3. **Create `packages/channel_cli/src/cli-input-normalizer.ts`**:
     - Import `ChannelIngressPayload`, `MessagePart` from `@argentum/contracts`
     - Define and export `CliInputError` class extending `Error` with `name = "CliInputError"`
     - Define and export `normalizeCliInput(rawInput: string): ChannelIngressPayload`:
       a. Trim `rawInput` (`.trim()`)
       b. If trimmed string is empty (`""`), throw `CliInputError` with descriptive message
       c. Build `message_parts` array with exactly one `MessagePart`: `[{ kind: "text" as const, text: trimmed }]`
       d. Perform simple structural validation: verify `message_parts` is non-empty and `message_parts[0].text` is non-empty; throw `CliInputError` if not
       e. Generate `received_at` via `new Date().toISOString()`
       f. Construct the payload object:
          ```ts
          const payload: ChannelIngressPayload = {
            channel: "terminal_cli",
            user_id: "local",
            message_parts: [{ kind: "text" as const, text: trimmed }],
            received_at: new Date().toISOString(),
          };
          ```
       g. Return `Object.freeze(payload)`
     - **Do NOT** import or call `parseIngressDTO` — the gateway validates the full `IngressDTO` after adding `ingress_id` and `session_id`
     - **Do NOT** generate `ingress_id` — owned by gateway
     - **Do NOT** accept or handle `session_id` — owned by gateway's session router
  4. **Update `packages/channel_cli/src/index.ts`**: Replace `export {};` with re-exports of `normalizeCliInput`, `CliInputError`, and `ChannelIngressPayload` (re-exported from contracts).
  5. **Create `packages/channel_cli/tests/cli-input-normalizer.test.ts`** with vitest tests.
  6. Run `pnpm --filter @argentum/channel-cli test` to validate.
  7. Run `pnpm test` at repo root to ensure no regressions.
- Required tests:
  - **Happy path — basic normalization**: Given `"hello"`, returns `ChannelIngressPayload` with `message_parts[0].text === "hello"`, `channel === "terminal_cli"`, `user_id === "local"`
  - **No `ingress_id` or `session_id` in output**: Verify the returned object does NOT have `ingress_id` or `session_id` properties (use `"ingress_id" in result === false`, `"session_id" in result === false`)
  - **Whitespace trimming**: Given `"  hello world  "` (with leading/trailing spaces), `message_parts[0].text === "hello world"` (internal space preserved, leading/trailing stripped)
  - **Internal whitespace preservation**: Given `"hello   world"` (multiple internal spaces), internal whitespace is preserved exactly
  - **Empty string rejection**: Given `""`, throws `CliInputError` with descriptive message
  - **Whitespace-only rejection**: Given `"   "`, throws `CliInputError`
  - **Newline-only rejection**: Given `"\n\t"`, throws `CliInputError` (trim handles all whitespace)
  - **Structural validation — non-empty message_parts**: Internal validation rejects payloads with empty `message_parts` array
  - **Structural validation — non-empty text**: Internal validation rejects payloads where `message_parts[0].text` is empty
  - **No `parseIngressDTO` dependency**: The implementation does NOT import `parseIngressDTO` (verify via static analysis of imports)
  - **Timestamp validity**: `received_at` is a valid ISO-8601 UTC string ending in `Z`, parseable by `new Date()`
  - **Exactly one MessagePart**: `message_parts.length === 1`, `message_parts[0].kind === "text"`
  - **No attachments or metadata**: `attachments` is `undefined` (not present), `metadata` is `undefined` (not present)
  - **Immutability**: Attempting to mutate the returned payload throws in strict mode (verify `Object.isFrozen`)
  - **Fake timer determinism**: With `vi.useFakeTimers()` and a fixed date, `received_at` matches the expected ISO-8601 string
  - **Structural compatibility with `GatewayIngressInput`**: Verify that `ChannelIngressPayload` is structurally assignable to `Omit<IngressDTO, "ingress_id" | "session_id">`. A value of type `ChannelIngressPayload` should satisfy `GatewayIngressInput` without type assertion.
  - **Special characters**: Unicode input (e.g., emoji, CJK characters) is preserved correctly in `text`
  - **Long input**: Reasonably long input strings are handled without truncation
- Narrow validation step:
  - `pnpm --filter @argentum/channel-cli test` passes with non-zero test count
  - `pnpm test` at repo root passes (no regressions across existing 1,121+ tests)

## Execution Strategy

- Autopilot suitability: **SAFE**. This slice is:
  - Bounded to one package (`channel_cli`) with a single function
  - Input/output contracts are fully defined and validated upstream (`IngressDTO`, `MessagePart` in `@argentum/contracts`)
  - No cross-package mutation or state management
  - No unresolved bootstrap decisions — all blockers are resolved
  - No deferred decisions affect this slice
  - Deterministic, testable with vitest
  - Identical scaffolding pattern to slice 0031 (add contracts dep, tsconfig reference, vitest config)
- Parallel subagent opportunities: **None**. This is a single-function module with focused tests — one subagent can implement end-to-end.
- Out of scope:
  - Terminal rendering (slice 0036) — this slice does NOT render `StreamEvent` values or produce any terminal output
  - Session management or session routing — `session_id` is assigned by the gateway's session router
  - Gateway integration or queue admission — `ingress_id` is assigned by the gateway during `IngressDTO` construction
  - Multi-line input handling or readline/TUI integration
  - Stdin stream reading — the function accepts a string, not a stream
  - Any channel other than the local terminal CLI (`channel: "terminal_cli"`)
  - `user_id` resolution beyond the `"local"` default
  - `IngressDTO` construction — the channel returns a partial `ChannelIngressPayload`; the gateway constructs the final `IngressDTO`
- Deferred decisions that must remain deferred:
  - None. All decisions needed for this slice are resolved:
    - `channel` value `"terminal_cli"` is specified in the ingress contract and MVP scope
    - `user_id` default of `"local"` is a reasonable MVP default for single-user terminal CLI (no multi-user multiplexing in MVP)
    - `ingress_id` generation is the gateway's responsibility (not the channel's) — resolved by C1 decision
    - `session_id` assignment is the gateway's session router responsibility (not the channel's) — resolved by C1 decision
    - Error type (`CliInputError`) follows the pattern established by other `@argentum/*` packages (e.g., `IngressValidationError`, `MessagePartValidationError`)

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **CRITICAL C1 — Architectural conflict: who constructs `IngressDTO`?** (RESOLVED 2026-05-24 by human decision, Option A): The `cli-adapter-mvp.md` leaf spec said the channel normalizes into an `IngressDTO`, but `system-context.md` and `ingress-contract.md` say the gateway owns `IngressDTO` construction. The validated slice 0006 (`gateway`) already implements `GatewayIngressInput = Omit<IngressDTO, "ingress_id" | "session_id">`. **Resolution**: Gateway owns `IngressDTO` construction. The channel normalizes raw input into a `ChannelIngressPayload` (partial payload without `ingress_id` and `session_id`). The gateway adds those fields and constructs the final `IngressDTO`.
  - **HIGH H2 — `parseIngressDTO` return value discarded** (MOOT — resolved by C1): The original design called `parseIngressDTO(dto)` as a defensive guard but did not use the returned frozen value. Since `parseIngressDTO` is removed entirely (the gateway validates the full `IngressDTO` later), this finding is moot.
  - **HIGH H3 — Non-deterministic `ingress_id` generation in channel** (MOOT — resolved by C1): The original design generated `ingress_id` via `crypto.randomUUID()` in the channel. Since `ingress_id` generation is removed from the channel (it's the gateway's responsibility), this finding is moot.
  - **MEDIUM M1 — `ChannelIngressPayload` type not in canonical contracts** (RESOLVED 2026-05-24): The new `ChannelIngressPayload` type is added to `@argentum/contracts`, making it a canonical contract type available to all consumers. Added to implementation step 1.
  - **MEDIUM M2 — Structural validation gap without `parseIngressDTO`** (RESOLVED 2026-05-24): Since `parseIngressDTO` is removed, simple structural validation is added: verify `message_parts` is non-empty array and `message_parts[0].text` is non-empty string. This catches malformed payloads at the channel boundary before they reach the gateway.
  - **MEDIUM M3 — `GatewayIngressInput` compatibility not verified** (RESOLVED 2026-05-24): Added acceptance criterion and test requirement that `ChannelIngressPayload` is structurally assignable to `Omit<IngressDTO, "ingress_id" | "session_id">` (i.e., `GatewayIngressInput`). This ensures the channel output can be consumed by the gateway without adapter code.
- Refinements applied:
  - Function signature changed: `normalizeCliInput(rawInput: string, sessionId: string): IngressDTO` → `normalizeCliInput(rawInput: string): ChannelIngressPayload`
  - Removed `sessionId` parameter — `session_id` is assigned by the gateway's session router
  - Removed `ingress_id` generation — `ingress_id` is assigned by the gateway
  - Removed `parseIngressDTO` call — the gateway validates the full `IngressDTO` after construction
  - Added simple structural validation (non-empty `message_parts`, non-empty `text`)
  - Added `ChannelIngressPayload` type to `@argentum/contracts` (new contracts boundary type)
  - Removed tests for `ingress_id`, `session_id`, and `parseIngressDTO` validation
  - Added tests verifying absence of `ingress_id` and `session_id` in output
  - Added structural compatibility test with `GatewayIngressInput`
  - Updated all acceptance criteria, implementation steps, and out-of-scope items
