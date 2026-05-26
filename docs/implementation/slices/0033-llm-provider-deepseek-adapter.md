# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: orchestrator (H1/H2/M1-M6 resolved via refinement, 2026-05-24)
- Approval date: 2026-05-24
- Phase: 5 (LLM Provider Integration)
- Owner: llm_provider
- Execution readiness: ready-after-dependency. This is the **third implementation slice** for the `@argentum/llm-provider` package. Slice 0031 (`LLMProvider` interface + `LLMProviderError`) defines the provider abstraction seam. Slice 0032 (`projectToolSchemas` + `DeepSeekToolSchema`) provides the tool schema projection utility. Both must be implemented first. Slice 0016 (`LLMInferenceRequest` / `LLMInferenceResult`) and slice 0013 (`ActionDecision`) are validated and available. No additional upstream `llm_provider` slices exist beyond 0031 and 0032.

## Scope

- Slice name: DeepSeek Adapter Implementation
- Target package or boundary: `llm_provider` (`@argentum/llm-provider`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "MVP uses a hybrid LLM adapter strategy with strict normalization into canonical internal contracts"
  - [docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md](../../spec/40-modules/llm-provider/deepseek-adapter-mvp.md) — **sole authority** for DeepSeek adapter responsibilities: translate `LLMInferenceRequest` into DeepSeek chat interface, project tool schemas, normalize responses into `LLMInferenceResult`, capture traces
  - [docs/spec/40-modules/llm-provider/provider-normalization.md](../../spec/40-modules/llm-provider/provider-normalization.md) — normalization policy: native tool calling preferred, JSON mode/parsed-text fallback, must not expose provider-native semantics to core loop
  - [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md) — provider module responsibilities, input/output contracts, rules
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md) — `LLMInferenceRequest`, `LLMInferenceResult` shape (implemented slice 0016)
  - [docs/spec/20-contracts/action-decision.md](../../spec/20-contracts/action-decision.md) — `ActionDecision`, `DecisionKind` (implemented slice 0013)
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md) — `ToolCallDTO`, `ToolResultDTO` (implemented slice 0014) — contextual; the adapter constructs `ActionDecision.tool_calls` entries whose shape is defined here
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — canonical normalization boundary rule: "Native tool calling, response blocks, JSON mode, and provider-specific tracing must be converted into `ActionDecision` and `LLMInferenceResult` before they leave the provider module"
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "adapter fixture tests for native and fallback normalization" and "failure-path tests for adapter failure and malformed output repair exhaustion inside the adapter"
- Acceptance criteria:
  - **`DeepSeekAdapter` class implements `LLMProvider`**: The class `DeepSeekAdapter` is exported from `@argentum/llm-provider` and satisfies the `LLMProvider` interface from slice 0031 (single method `infer(request: LLMInferenceRequest): Promise<LLMInferenceResult>`). TypeScript compilation verifies assignability: `const adapter: LLMProvider = new DeepSeekAdapter(config)` compiles without errors.
  - **Constructor configuration**: `DeepSeekAdapter` constructor accepts a `DeepSeekAdapterConfig` object:
    - `endpoint: string` — DeepSeek API base URL (e.g., `"https://api.deepseek.com"`), sourced from `RuntimeConfigProviderDTO.endpoint`.
    - `apiKey: string` — DeepSeek API key. Resolved by the environment/composition layer (e.g., from `DEEPSEEK_API_KEY` environment variable) and injected at construction time. The adapter does NOT perform secret resolution itself.
    - `model: string` — model identifier (e.g., `"deepseek-chat"`), sourced from `RuntimeConfigProviderDTO.model_id`.
    - `temperature?: number` — optional temperature override (default `0`), sourced from `RuntimeConfigProviderDTO.temperature`.
    - `maxOutputTokens?: number` — optional max output token cap (default `4096`), sourced from `RuntimeConfigProviderDTO.max_output_tokens`.
    - `resolveContent?: ContentResolver` — optional content resolver function `(ref: ContentRef) => Promise<string>` for resolving `ContextItem.content_ref` to inline text. When omitted, the adapter throws `LLMProviderError` if any `ContextItem` requires resolution. In production, this is wired to the artifact store. In tests, it is a simple in-memory map.
  - **`ContentResolver` interface**: The package exports a `ContentResolver` type: `(ref: ContentRef) => Promise<string>`. It resolves a canonical `ContentRef` to its text content. This keeps the adapter decoupled from storage I/O.
  - **`DeepSeekAdapterConfig` type exported**: The config type is exported so callers (composition root, tests) can construct it with type safety.
  - **`infer()` method — request translation**:
    - Resolves each `ContextItem` in `request.context_items` into a DeepSeek chat message `{ role: string, content: string }`. The `ContextItem.role` maps to the message `role` for recognized values (`"user"`, `"assistant"`, `"system"`, `"tool"`). Unrecognized roles are mapped to `"user"` as a safe default. The `ContextItem.content_ref` is resolved via `ContentResolver` to produce the message `content` string.
    - If `ContentResolver` is not configured and any `ContextItem` has a `content_ref` requiring resolution, the adapter throws `LLMProviderError` with a descriptive message.
    - Projects `request.available_tools` via `projectToolSchemas()` from slice 0032. If `available_tools` is non-empty, the DeepSeek API request includes a `tools` array.
    - If `available_tools` is non-empty AND `request.inference_policy.normalization_mode` is not `"json_mode"` or `"parsed_text"`, the adapter sets `tool_choice: "auto"` to prefer native tool calling. If `normalization_mode` is explicitly `"json_mode"`, the adapter sets `response_format: { type: "json_object" }` and omits `tools`/`tool_choice` to force JSON-mode output. If `normalization_mode` is `"parsed_text"`, the adapter omits both `tools` and `response_format`.
    - Builds the DeepSeek API request body: `{ model, messages, temperature, max_tokens, ...(tools ? { tools, tool_choice } : {}), ...(response_format ? { response_format } : {}) }`.
    - Posts to `{endpoint}/v1/chat/completions` with headers `Authorization: Bearer {apiKey}` and `Content-Type: application/json`.
    - On HTTP non-2xx response, throws `LLMProviderError` with the HTTP status and response body summary.
    - On network failure (fetch throws), throws `LLMProviderError` wrapping the underlying error as `cause`.
  - **`infer()` method — response normalization**:
    - **Native tool calling path** (`normalization_status = "native_tool"`): When the API response contains `choices[0].message.tool_calls` (non-empty array), the adapter extracts each tool call into `ActionDecision.tool_calls` entries with `tool_name` mapped from `tool_call.function.name`, `arguments` JSON-parsed from `tool_call.function.arguments`, and `provider_call_ref` set to `tool_call.id`. The `ActionDecision.kind` is `"tool_calls"`. Tool-call ordering from the API is preserved.
    - **JSON mode path** (`normalization_status = "json_mode"`): When the API response contains `choices[0].message.content` that is valid JSON, the adapter parses it and extracts a canonical `ActionDecision` from the parsed object. The parsed JSON must contain at minimum a `kind` field matching a `DecisionKind` literal. If the JSON contains `tool_calls`, they are mapped to the canonical shape. If `kind` is `"respond"`, `"clarify"`, or `"abort"`, the `message` field is extracted.
    - **Parsed text path** (`normalization_status = "parsed_text"`): When the API response contains `choices[0].message.content` that is NOT valid JSON, the adapter attempts to extract an `ActionDecision` from the raw text via heuristics (look for JSON block in markdown fences, then fall back to treating the entire text as a `"respond"` decision with the text as `message`). This is the last-resort path.
    - **Malformed output repair exhaustion**: If all normalization paths fail (no tool_calls, content is not parseable JSON, text heuristics produce no valid decision), the adapter throws `LLMProviderError`. The adapter does NOT loop or retry — repair is a single-pass best-effort within the adapter per the spec: "Keep provider-native repair and malformed-output recovery internal to the adapter until a normalized result or adapter failure is produced."
    - The normalized `ActionDecision` receives a generated `decision_id` (via `randomUUID()`).
    - `LLMInferenceResult.request_id` is copied from `LLMInferenceRequest.request_id`.
    - `LLMInferenceResult.usage` is populated from the API response `usage` object if present (provider-specific; passed through as `Record<string, unknown>`).
  - **Raw trace capture**: The adapter captures the raw DeepSeek API request body and response body as a trace artifact. It constructs a `ContentRef` with:
    - `kind: "trace"`
    - `storage_area: "logs"`
    - `retention: "session"`
    - `ref_id` and `locator` derived from `request_id`
    - The raw request/response JSON is persisted via an injected `TraceWriter` interface (or, in tests, captured in memory). The `ContentRef` is assigned to `LLMInferenceResult.raw_trace_ref`.
    - If `TraceWriter` is not configured, `raw_trace_ref` is `undefined` (graceful degradation — trace capture is best-effort, not required for correctness).
  - **`TraceWriter` interface**: The package exports a `TraceWriter` type: `(ref: ContentRef, payload: unknown) => Promise<void>`. Persists a trace payload keyed by a `ContentRef`. Optional constructor dependency.
  - **Error handling contract**: All adapter-level failures (network errors, auth failures, malformed responses that cannot be repaired, missing content resolver) throw `LLMProviderError` (from slice 0031). The error carries:
    - `providerId`: set to `"deepseek"`.
    - `requestId`: the `request_id` from the originating `LLMInferenceRequest`.
    - `message`: descriptive error message.
    - `cause`: the underlying error if available (e.g., the fetch `Error`, the JSON parse `SyntaxError`).
  - **Package exports**: The `llm-provider` package exports `DeepSeekAdapter` (class), `DeepSeekAdapterConfig` (type), `ContentResolver` (type), and `TraceWriter` (type) from its barrel entrypoint, alongside exports from slices 0031 and 0032.
  - The slice does NOT implement provider failover, multi-provider routing, streaming responses, session locking, turn state management, or the core loop.
- Inputs crossing the boundary:
  - `LLMInferenceRequest` from `@argentum/contracts` (slice 0016) — canonical inference request
  - `DeepSeekAdapterConfig` from the composition root — provider bootstrap values (endpoint, apiKey, model)
  - `ContentResolver` (optional) — resolves `ContentRef` to text for building chat messages
  - `TraceWriter` (optional) — persists raw trace payloads
- Outputs crossing the boundary:
  - `LLMInferenceResult` containing a normalized `ActionDecision` (returned by `infer()`)
  - `LLMProviderError` (thrown on adapter failure)
  - `ContentRef` in `raw_trace_ref` (optional, when `TraceWriter` is configured)
  - `DeepSeekAdapter` class exported from `@argentum/llm-provider`

## Plan

- First contracts or interfaces to create:
  - `ContentResolver` type: `(ref: ContentRef) => Promise<string>` — resolves a `ContentRef` to its text content.
  - `TraceWriter` type: `(ref: ContentRef, payload: unknown) => Promise<void>` — persists a trace payload.
  - `DeepSeekAdapterConfig` interface:
    ```typescript
    interface DeepSeekAdapterConfig {
      endpoint: string;          // DeepSeek API base URL
      apiKey: string;            // API key (resolved externally)
      model: string;             // Model identifier
      temperature?: number;      // Default 0
      maxOutputTokens?: number;  // Default 4096
      resolveContent?: ContentResolver;
      writeTrace?: TraceWriter;
    }
    ```
  - `DeepSeekChatMessage` type (internal): `{ role: string; content: string }` — maps to DeepSeek chat message format.
  - `DeepSeekToolCall` type (internal): shape matching DeepSeek API `tool_calls` entry `{ id: string; type: "function"; function: { name: string; arguments: string } }`.
  - `DeepSeekApiResponse` type (internal): minimal shape of the DeepSeek chat completion response the adapter needs to inspect (`choices[0].message`, `usage`).
- Minimal implementation steps:
  1. Ensure slices 0031 and 0032 are implemented (package scaffolding, `@argentum/contracts` dependency, TypeScript project reference, `LLMProvider` interface, `LLMProviderError`, `projectToolSchemas`, `DeepSeekToolSchema`).
  2. Create `packages/llm_provider/src/content-resolver.ts`:
     - Import `ContentRef` from `@argentum/contracts`.
     - Define and export `ContentResolver` type: `(ref: ContentRef) => Promise<string>`.
     - Define and export `TraceWriter` type: `(ref: ContentRef, payload: unknown) => Promise<void>`.
  3. Create `packages/llm_provider/src/deepseek-adapter.ts`:
     - Import `LLMProvider`, `LLMProviderError` from `./llm-provider.js` (slice 0031).
     - Import `projectToolSchemas`, `DeepSeekToolSchema` from `./tool-schema-projection.js` (slice 0032).
     - Import `ContentResolver`, `TraceWriter` from `./content-resolver.js`.
     - Import canonical types from `@argentum/contracts`: `LLMInferenceRequest`, `LLMInferenceResult`, `ActionDecision`, `ContentRef`, `ContextItem`, `AvailableToolEntry`.
     - Define and export `DeepSeekAdapterConfig` interface.
     - Define internal types: `DeepSeekChatMessage`, `DeepSeekToolCall`, `DeepSeekApiResponse`.
     - Define and export `DeepSeekAdapter` class implementing `LLMProvider`:
       - **Constructor**: Store config, apply defaults (`temperature ?? 0`, `maxOutputTokens ?? 4096`). Normalize the endpoint URL by removing any trailing slash (e.g., `"https://api.deepseek.com/"` → `"https://api.deepseek.com"`) to prevent double-slash in the constructed URL `{endpoint}/v1/chat/completions`.
       - **`infer(request)`**:
         1. **Build messages**: For each `ContextItem` in `request.context_items`, resolve `content_ref` via `this.config.resolveContent` to get the `content` string. Map `item.role` to the message role — recognized roles (`"user"`, `"assistant"`, `"system"`, `"tool"`) pass through; unrecognized roles default to `"user"`. Build `{ role: mappedRole, content }`. If `resolveContent` is undefined, throw `LLMProviderError`.
         2. **Project tools**: Call `projectToolSchemas(request.available_tools)`. Since slice 0032 already accepts `AvailableToolEntry[]` directly, no cast or mapping is needed — `LLMInferenceRequest.available_tools` is already `AvailableToolEntry[]`.
         3. **Determine API mode**: Inspect `request.inference_policy.normalization_mode` (if present). Default when absent or unrecognized: `"native_tool"` (do not throw on unrecognized values — silently default to native tool calling).
            - `"native_tool"`: Include `tools` + `tool_choice: "auto"` if tools non-empty.
            - `"json_mode"`: Set `response_format: { type: "json_object" }`, omit `tools`.
            - `"parsed_text"`: Omit both `tools` and `response_format`.
         4. **Build request body**: `{ model: this.config.model, messages, temperature: this.config.temperature, max_tokens: this.config.maxOutputTokens, ...(tools?.length ? { tools, tool_choice: "auto" } : {}), ...(response_format ? { response_format } : {}) }`.
         5. **Call DeepSeek API**: `POST {this.config.endpoint}/v1/chat/completions` with JSON body and `Authorization: Bearer {this.config.apiKey}` header. Use the global `fetch` function.
            - On HTTP error (status >= 400): throw `LLMProviderError`.
            - On network error (fetch throws): throw `LLMProviderError` with `cause`.
         6. **Write raw trace**: If `this.config.writeTrace` is configured, construct a `ContentRef` for the trace and call `writeTrace(ref, { request: requestBody, response: responseJson })`. Set `raw_trace_ref` on the result.
         7. **Normalize response**:
            - **Path A — Native tool calling**: If `response.choices[0].message.tool_calls` is a non-empty array, extract each tool call:
              - `tool_name` = `tc.function.name`
              - `arguments` = `JSON.parse(tc.function.arguments)`. If `JSON.parse` throws `SyntaxError`, throw `LLMProviderError` — unparseable tool call arguments are a provider contract violation, not a fallback scenario.
              - `provider_call_ref` = `tc.id`
              - Construct the `ActionDecision` with `kind: "tool_calls"` and `tool_calls: [...]`. Set the local variable `normalization_status` to `"native_tool"` (this variable will be placed on `LLMInferenceResult`, NOT inside the `ActionDecision`).
            - **Path B — JSON mode**: If `response.choices[0].message.content` is a string that parses as valid JSON:
              - Parse the JSON object.
              - Extract `kind` (must be a valid `DecisionKind`).
              - Extract `message` if `kind` is `"respond"`, `"clarify"`, or `"abort"`.
              - Extract `tool_calls` if `kind` is `"tool_calls"` (map entries to canonical shape).
              - Construct the `ActionDecision` from the parsed JSON. Set the local variable `normalization_status` to `"json_mode"` (this variable will be placed on `LLMInferenceResult`, NOT inside the `ActionDecision`).
            - **Path C — Parsed text**: If neither Path A nor Path B succeeded:
              - Check if `content` contains a markdown-fenced JSON block (`` ```json ... ``` ``). If found, attempt Path B on the extracted JSON.
              - Otherwise, treat the entire `content` as a `"respond"` decision with `message: content`.
              - Construct the `ActionDecision` from the parsed or heuristically extracted content. Set the local variable `normalization_status` to `"parsed_text"` (this variable will be placed on `LLMInferenceResult`, NOT inside the `ActionDecision`).
            - **Path D — Exhaustion**: If all paths fail to produce a valid `ActionDecision`, throw `LLMProviderError`.
         8. **Assemble result**: Return `{ request_id: request.request_id, decision, normalization_status, usage: response.usage, raw_trace_ref }`.
  4. Update `packages/llm_provider/src/index.ts`:
     - Add barrel exports: `DeepSeekAdapter`, `DeepSeekAdapterConfig`, `ContentResolver`, `TraceWriter`.
  5. Create `packages/llm_provider/tests/deepseek-adapter.test.ts`:
     - Test infrastructure: mock `fetch` via `vi.fn()`, mock `ContentResolver` as in-memory map, mock `TraceWriter` as no-op or in-memory array.
- Required tests:
  - **Adapter implements LLMProvider test**: `const a: LLMProvider = new DeepSeekAdapter(config)` compiles. Verify `typeof a.infer === "function"`.
  - **Constructor defaults test**: Create adapter with minimal config (`endpoint`, `apiKey`, `model`). Assert `temperature` defaults to `0`, `maxOutputTokens` defaults to `4096`.
  - **Message building test**: Create `LLMInferenceRequest` with 2 `ContextItem` entries (role `"user"`, role `"assistant"`). Provide `ContentResolver` returning known strings. Spy on `fetch`. Verify the request body `messages` array has 2 entries with correct `role` and `content`.
  - **Missing ContentResolver test**: Create adapter without `resolveContent`. Call `infer()`. Assert it throws `LLMProviderError` with a message about missing content resolver.
  - **Tool projection test**: Create request with 2 `AvailableToolEntry` entries. Verify the `fetch` request body includes a `tools` array with 2 elements matching the projected schemas. Verify `tool_choice: "auto"` is present.
  - **Empty tools test**: Create request with empty `available_tools`. Verify the `fetch` request body does NOT include `tools` or `tool_choice`.
  - **Native tool calling normalization test** (fixture): Mock `fetch` to return a DeepSeek API response with `tool_calls` containing one tool call `{ id: "call_1", function: { name: "read_file", arguments: '{"path":"/foo"}' } }`. Call `infer()`. Assert:
    - `result.decision.kind === "tool_calls"`.
    - `result.decision.tool_calls[0].tool_name === "read_file"`.
    - `result.decision.tool_calls[0].arguments.path === "/foo"`.
    - `result.decision.tool_calls[0].provider_call_ref === "call_1"`.
    - `result.normalization_status === "native_tool"`.
    - `result.decision.decision_id` is present and non-empty (string, length > 0).
  - **Native tool calling — multiple tools ordering test** (fixture): Mock `fetch` to return 3 tool calls. Assert `result.decision.tool_calls` preserves API ordering (index 0, 1, 2). Assert `result.decision.decision_id` is present and non-empty.
  - **JSON mode normalization test** (fixture): Mock `fetch` to return `content: '{"kind":"respond","message":"Hello!"}'`. Configure request `inference_policy.normalization_mode = "json_mode"`. Assert:
    - `result.decision.kind === "respond"`.
    - `result.decision.message === "Hello!"`.
    - `result.normalization_status === "json_mode"`.
    - `result.decision.decision_id` is present and non-empty.
  - **JSON mode — tool_calls kind test** (fixture): Mock `fetch` to return JSON with `kind: "tool_calls"` and a `tool_calls` array. Assert the adapter extracts tool calls correctly with `normalization_status: "json_mode"`. Assert `result.decision.decision_id` is present and non-empty.
  - **JSON mode — malformed JSON falls through to parsed text** (fixture): Mock `fetch` to return content that is NOT valid JSON. With `normalization_mode = "json_mode"`, assert the adapter falls through to Path C and returns `normalization_status: "parsed_text"` (content treated as `"respond"`). Assert `result.decision.decision_id` is present and non-empty.
  - **Parsed text normalization test** (fixture): Mock `fetch` to return plain text `"The answer is 42."`. Assert:
    - `result.decision.kind === "respond"`.
    - `result.decision.message === "The answer is 42."`.
    - `result.normalization_status === "parsed_text"`.
    - `result.decision.decision_id` is present and non-empty.
  - **Parsed text — markdown JSON fence test** (fixture): Mock `fetch` to return text containing `` ```json\n{"kind":"abort","message":"Done."}\n``` ``. Assert the adapter extracts the JSON from the fence, producing `kind: "abort"` with `normalization_status: "json_mode"` (because it successfully parsed JSON, even though the outer path was parsed_text). Assert `result.decision.decision_id` is present and non-empty.
  - **Raw trace capture test**: Configure adapter with `writeTrace` mock. Call `infer()`. Assert `writeTrace` was called with a `ContentRef` (kind `"trace"`, storage_area `"logs"`) and a payload containing `request` and `response` keys. Assert `result.raw_trace_ref` matches the `ContentRef` passed to `writeTrace`.
  - **Raw trace — no TraceWriter test**: Configure adapter without `writeTrace`. Call `infer()`. Assert `result.raw_trace_ref` is `undefined`. Assert no throw.
  - **Usage passthrough test**: Mock `fetch` to include `usage: { prompt_tokens: 100, completion_tokens: 50 }`. Assert `result.usage` matches.
  - **HTTP error test**: Mock `fetch` to return HTTP 401. Assert `infer()` throws `LLMProviderError` with `providerId === "deepseek"`, `requestId` matching the request. Assert error message includes HTTP status.
  - **HTTP error — 500 test**: Mock `fetch` to return HTTP 500 with JSON error body. Assert `LLMProviderError` thrown with status info.
  - **Network error test**: Mock `fetch` to reject with `new Error("connect ECONNREFUSED")`. Assert `LLMProviderError` thrown with `cause` matching the original error.
  - **Malformed response — empty choices test**: Mock `fetch` to return `{ choices: [] }`. Assert normalization exhaustion → `LLMProviderError` thrown.
  - **Malformed response — null message test**: Mock `fetch` to return `{ choices: [{ message: null }] }`. Assert `LLMProviderError` thrown.
  - **Malformed response — tool_calls with unparseable arguments test**: Mock `fetch` to return tool_calls with `arguments: "not valid json"`. Assert the adapter throws `LLMProviderError` — unparseable tool call arguments are a provider contract violation.
  - **Malformed response — invalid JSON in content test**: Mock `fetch` to return `content: "{not json}"`. Assert adapter produces `normalization_status: "parsed_text"` with `kind: "respond"` and the raw text as `message`.
  - **API key in Authorization header test**: Spy on `fetch`. Assert the request headers include `Authorization: Bearer {apiKey}`.
  - **Endpoint URL construction test**: Spy on `fetch`. Assert the URL is `{endpoint}/v1/chat/completions` (no double slash when endpoint has trailing slash; normalize in constructor).
  - **Package entrypoint smoke test**: Import `DeepSeekAdapter`, `DeepSeekAdapterConfig`, `ContentResolver`, `TraceWriter` from `@argentum/llm-provider`. Verify `typeof DeepSeekAdapter === "function"`.
  - **TypeScript compilation test**: Create a `DeepSeekAdapter` instance and assign to `LLMProvider` variable. Create a `DeepSeekAdapterConfig` object literal. Use `ContentResolver` and `TraceWriter` as function types. All compile without errors.
  - **LLMInferenceResult parser round-trip test**: For each normalization path (native_tool, json_mode, parsed_text), construct the expected `LLMInferenceResult` from the fixture, run `parseLLMInferenceResult(result)` (imported from `@argentum/contracts`), and assert it does not throw. This validates that the adapter's output conforms to the canonical contract.
  - **ActionDecision parser round-trip test**: For each normalization path (native_tool, json_mode, parsed_text), construct the expected `ActionDecision` from the fixture, run `parseActionDecision(result.decision)` (imported from `@argentum/contracts`), and assert it does not throw. This validates that the normalized decision conforms to the canonical `ActionDecision` contract.
  - **ContextItem unrecognized role mapping test**: Create request with a `ContextItem` whose `role` is `"unknown_role"`. Verify the `fetch` request body `messages` entry has `role: "user"` (safe default). Also verify recognized roles (`"user"`, `"assistant"`, `"system"`, `"tool"`) pass through unchanged.
  - **Unrecognized normalization_mode defaults to native_tool test**: Configure request with `inference_policy.normalization_mode = "invalid_mode"`. Verify the adapter treats it as `"native_tool"` (includes `tools` + `tool_choice: "auto"` when tools are non-empty) without throwing.
- Narrow validation step:
  - `pnpm --filter @argentum/llm-provider test` passes with real (non-vacuous) tests covering all normalization paths, error paths, and trace capture.
  - `pnpm --filter @argentum/llm-provider build` succeeds (TypeScript compilation).
  - `pnpm --filter @argentum/llm-provider lint` passes.
  - `pnpm typecheck` passes (full-project type checking).

## Execution Strategy

- Autopilot suitability: **conditional**. This slice is:
  - **Well-bounded**: One class (`DeepSeekAdapter`) implementing one interface (`LLMProvider`), with clear input/output contracts and well-defined normalization paths.
  - **Contract-consumer only**: Consumes validated types from `@argentum/contracts` (`LLMInferenceRequest`, `LLMInferenceResult`, `ActionDecision`, `ContentRef`, `ContextItem`).
  - **Dependencies clear**: Depends on slice 0031 (`LLMProvider`, `LLMProviderError`) and slice 0032 (`projectToolSchemas`). Both must be implemented first.
  - **Testable with mocks**: The `fetch` API, `ContentResolver`, and `TraceWriter` are all injectable/test-double-friendly. All normalization paths can be tested with recorded fixtures.
  - **Risks requiring human judgment**:
    - `projectToolSchemas()` from slice 0032 already accepts `AvailableToolEntry[]` directly — the adapter passes `request.available_tools` without any cast or mapping.
    - The JSON mode / parsed text fallback heuristics: the markdown fence extraction and text-as-respond fallback are simple but must be implemented precisely to avoid silent normalization failures.
    - The normalization path fallthrough logic (Path A → B → C → D) must be correct and tested with malformed inputs at each stage.
    - The apiKey is injected, not resolved by the adapter — the autopilot must not accidentally implement secret resolution.
  - **Recommendation**: Safe for autopilot with clear guardrails captured in acceptance criteria, provided the autopilot implements the normalization paths in the specified order (native tool calling → JSON mode → parsed text → exhaustion) and covers all error paths with tests.
- Parallel subagent opportunities:
  - **Read-only contract shape verification** (safe for parallel subagent): Verify that `LLMInferenceRequest`, `LLMInferenceResult`, `ActionDecision`, `ContentRef`, `ContextItem`, and `AvailableToolEntry` are exported from `@argentum/contracts` with the expected field shapes. Cross-reference against the adapter's normalization logic to flag any field mismatches. This is independent of implementation.
  - **Read-only spec cross-reference** (safe for parallel subagent): Verify that the adapter's acceptance criteria cover all requirements from `docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md`, `provider-normalization.md`, and `provider-abstraction.md`. Flag any gaps. This is independent of implementation.
  - **Read-only API format research** (safe for parallel subagent): Verify the DeepSeek API chat completion request/response format (endpoint path `/v1/chat/completions`, `tools` array shape, `tool_calls` response shape, `response_format` shape) against current DeepSeek API documentation. This research is read-only and independent of implementation.
- Out of scope:
  - Tool schema projection (`projectToolSchemas`) — that's slice 0032. This slice only consumes it.
  - `LLMProvider` interface and `LLMProviderError` definition — that's slice 0031. This slice only implements/throws them.
  - Content resolution implementation (reading from artifact store) — the adapter accepts an injected `ContentResolver`. The artifact store wiring is owned by the composition root / environment layer.
  - Trace persistence implementation (writing to filesystem) — the adapter accepts an injected `TraceWriter`. The filesystem wiring is owned by the composition root.
  - Secret resolution (reading `DEEPSEEK_API_KEY` from environment) — the adapter receives `apiKey` in its config. Secret resolution is owned by the environment layer.
  - Provider failover or multi-provider routing.
  - Streaming response handling.
  - Session locking or turn state management.
  - Core loop implementation (orchestrator).
  - Prompt compilation or context selection (owned by `agentic_core`).
  - Tool execution or grant resolution (owned by `environment` and `tooling`).
  - `inference_policy` subfield definition — the policy object shape is deferred per `docs/spec/20-contracts/llm-adapter-contract.md`. The adapter reads known fields (`normalization_mode`, `temperature`, `max_output_tokens`) from the policy and ignores unknown fields.
- Deferred decisions that must remain deferred:
  - Exact DeepSeek endpoint and model identifiers (deferred per `docs/spec/70-roadmap/deferred-decisions.md`). The adapter accepts these as constructor config; they are resolved at composition time.
  - Exact `inference_policy` subfields (deferred per `docs/spec/20-contracts/llm-adapter-contract.md`). The adapter reads only the subset it needs (`normalization_mode`) and passes unknown fields through.
  - Whether tool exposure per step is full-registry or curated subset in MVP (deferred per roadmap). The adapter accepts whatever `available_tools` array it receives.
  - Exact local persistence technology for session and queue state (deferred per roadmap). Not relevant to this slice (trace persistence is injected).
  - Maintenance-mode semantics for bedrock mutation (deferred per roadmap). Not relevant to this slice.
- Bootstrap decisions resolved by this slice:
  - **API key injection pattern**: The adapter receives `apiKey` as a constructor parameter. The environment/composition layer resolves the key from the host environment (e.g., `DEEPSEEK_API_KEY` or `ARGENTUM_SECRET_HANDLES` convention) before constructing the adapter. This follows the pattern established in the "Startup Secret Handle Discovery Convention" bootstrap decision. The adapter itself does not read environment variables or perform secret resolution.
  - **Content resolution pattern**: The adapter receives an optional `ContentResolver` function. When present, it resolves `ContextItem.content_ref` to inline text for chat message construction. When absent, the adapter throws `LLMProviderError` if resolution is needed. The production composition root wires this to the artifact store. This keeps the adapter decoupled from storage I/O while remaining fully testable.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1 (HIGH — resolved 2026-05-24)**: Ambiguous `normalization_status` placement. Implementation steps Paths A, B, C described building `ActionDecision` with `normalization_status` inside it, but `normalization_status` is a field on `LLMInferenceResult`, not `ActionDecision`. This would cause `parseActionDecision` to reject unknown keys. **Resolution**: Rewrote each normalization path's concluding sentence in implementation steps to separate the two concerns — `ActionDecision` is constructed with only its canonical fields (`kind`, `tool_calls`, `message`), and `normalization_status` is described as a local variable placed on `LLMInferenceResult`.
  - **H2 (HIGH — resolved 2026-05-24)**: Missing parser-based contract validation. The test plan verified individual fields but never validated the full `LLMInferenceResult` or `ActionDecision` through canonical parsers (`parseLLMInferenceResult` and `parseActionDecision`). **Resolution**: Added two contract-level validation tests: `LLMInferenceResult` parser round-trip test and `ActionDecision` parser round-trip test, each running for all three normalization paths.
  - **M1 (MEDIUM — resolved 2026-05-24)**: Tool call arguments JSON parse failure should throw `LLMProviderError`, not silently fall through to parsed text. Unparseable tool call arguments are a provider contract violation. **Resolution**: Changed Path A `JSON.parse` failure behavior from "catch → fall through to Path C" to "throw `LLMProviderError`". Updated the corresponding test to assert `LLMProviderError` is thrown.
  - **M2 (MEDIUM — resolved 2026-05-24)**: Stale `projectToolSchemas` type instruction referenced `ToolDefinition[]` cast, but slice 0032 already accepts `AvailableToolEntry[]` directly. **Resolution**: Updated implementation step 7.2 and Execution Strategy risks to reflect that `projectToolSchemas(request.available_tools)` can be called directly with no cast needed.
  - **M3 (MEDIUM — resolved 2026-05-24)**: Endpoint URL trailing-slash normalization missing from implementation plan. **Resolution**: Added trailing-slash normalization to the constructor step (remove trailing slash to prevent double-slash in `{endpoint}/v1/chat/completions`).
  - **M4 (MEDIUM — resolved 2026-05-24)**: `normalization_mode` unrecognized value behavior not specified. **Resolution**: Documented that unrecognized `normalization_mode` values default to `"native_tool"` without throwing. Added corresponding test.
  - **M5 (MEDIUM — resolved 2026-05-24)**: `ContextItem.role` mapped directly to DeepSeek message role without validation. **Resolution**: Added role mapping — recognized roles (`"user"`, `"assistant"`, `"system"`, `"tool"`) pass through; unrecognized roles map to `"user"`. Added corresponding test.
  - **M6 (MEDIUM — resolved 2026-05-24)**: No test verifies `decision_id` is present and non-empty. **Resolution**: Added `decision_id` presence assertion to every normalization-path test (native tool calling, multiple tools ordering, JSON mode, JSON mode tool_calls, JSON mode malformed fallback, parsed text, parsed text markdown fence).
- Refinements applied:
  - 2026-05-24: H1 resolved — normalization-path descriptions in implementation steps now separate `ActionDecision` construction from `normalization_status` placement on `LLMInferenceResult`.
  - 2026-05-24: H2 resolved — added `parseLLMInferenceResult` and `parseActionDecision` parser round-trip tests for all normalization paths.
  - 2026-05-24: M1 resolved — tool call arguments `JSON.parse` failure now throws `LLMProviderError` instead of falling through.
  - 2026-05-24: M2 resolved — removed stale `ToolDefinition[]` cast reference; `projectToolSchemas` is called directly with `AvailableToolEntry[]`.
  - 2026-05-24: M3 resolved — endpoint trailing-slash normalization added to constructor step.
  - 2026-05-24: M4 resolved — unrecognized `normalization_mode` values default to `"native_tool"` without throwing.
  - 2026-05-24: M5 resolved — `ContextItem.role` mapping validates recognized roles and defaults unrecognized roles to `"user"`.
  - 2026-05-24: M6 resolved — `decision_id` presence check added to all normalization-path tests.
  - 2026-05-24: H1 (post-implementation) resolved — `LLMProviderError.requestId` was always `""` for errors thrown from private methods (`buildMessages()`, `callDeepSeekApi()`, `normalizeResponse()`, `extractNativeToolCalls()`). Added `requestId: string` parameter to all four methods and passed `request.request_id` from `infer()`. All `LLMProviderError` throws in those methods now use the parameter.
  - 2026-05-24: H2 (post-implementation) resolved — No test asserted `LLMProviderError.requestId` on error paths. Added `expect(e.requestId).toBe("req-xxx")` assertions to all error-path tests: HTTP 401 (`"req-401"`), HTTP 500 (`"req-500"`), network error (`"req-net"`), missing ContentResolver (`"req-001"`), unparseable tool call arguments (`"req-001"`), empty choices (`"req-001"`), null message (`"req-001"`).
  - 2026-05-24: H3 (post-implementation) resolved — Constructor defaults test was vacuous (only `toBeInstanceOf`). Replaced with a test that creates adapter with `{ temperature: undefined, maxOutputTokens: undefined }`, calls `infer()` via mock fetch, and asserts `body.temperature === 0` and `body.max_tokens === 4096`.
  - 2026-05-24: H4 (post-implementation) resolved — No test verified `temperature` or `max_tokens` in API request body. Added dedicated test for custom values (`temperature: 0.7`, `maxOutputTokens: 2048`) alongside the defaults test. Both inspect the fetch request body.

- Adversarial review findings — round 2 (2026-05-24):
  - **M1 (MEDIUM — resolved 2026-05-24)**: `ContentResolver` absent throws even with empty `context_items`. `buildMessages()` threw unconditionally when `resolveContent` was absent, even when `context_items` was empty (no resolution needed). **Resolution**: Changed guard from `if (!this.config.resolveContent)` to `if (contextItems.length > 0 && !this.config.resolveContent)`. Added non-null assertion after guard to satisfy TypeScript narrowing.
  - **M2 (MEDIUM — resolved 2026-05-24)**: Markdown-fence regex too restrictive. Regex `/```json\s*\n([\s\S]*?)\n````/` required literal newlines and wouldn't match inline fences like `` ```json {"kind":"respond"} ``` ``. **Resolution**: Changed regex to `/```json\s*([\s\S]*?)````/` to handle both inline and multi-line fence content.
  - **M3 (MEDIUM — resolved 2026-05-24)**: Missing test for markdown fence without newlines. No test covered inline fence content (e.g., `` ```json {"kind":"abort","message":"Done."}``` ``). **Resolution**: Added test "extracts JSON from markdown fence without newlines as json_mode" that asserts `normalization_status: "json_mode"` for inline-fence JSON. Renamed existing multi-line test to "...with newlines...".
  - **M4 (MEDIUM — resolved 2026-05-24)**: Stale comment contradicts code for trace-write failure. Comment said `raw_trace_ref` is "still set" but code sets it to `undefined`. **Resolution**: Updated comment to "Trace write failure is non-fatal; clear the ref so consumers don't see a dangling reference."
- Refinements applied — round 2:
  - 2026-05-24: M1 resolved — `buildMessages()` now only throws when both `contextItems.length > 0` AND `resolveContent` is absent. Added local `resolveContent` binding with non-null assertion after guard.
  - 2026-05-24: M2 resolved — markdown fence regex changed to `/```json\s*([\s\S]*?)````/` supporting both `\n`-delimited and inline fence content.
  - 2026-05-24: M3 resolved — added test for inline markdown fence (no newlines). Existing multi-line test renamed for clarity.
  - 2026-05-24: M4 resolved — trace-write catch comment updated to accurately describe clearing the ref.

- Post-remediation validation (2026-05-24, round 2):
  - `pnpm --filter @argentum/llm-provider test`: 59 tests passed (34 in deepseek-adapter.test.ts, up from 33 pre-fix).
  - `pnpm typecheck`: passed with no errors.
