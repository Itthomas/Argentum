# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core
- Execution readiness: ready-when-approved. This slice depends on `@argentum/contracts` for `ContextItem` (slice 0012), `LLMInferenceRequest` (slice 0016), and `ToolDefinition` (slice 0017). Slices 0024 (turn state machine) and 0025 (episodic memory) are planned predecessors; this slice does NOT depend on their implementation — it only needs the contract types they also consume. The `@argentum/agentic-core` package will have its `@argentum/contracts` dependency added by slice 0024.

## Scope

- Slice name: Agentic Core — Prompt Compiler
- Target package or boundary: `agentic_core` (`@argentum/agentic-core`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "Context compaction is inline in MVP" and "Multi-tool action decisions execute sequentially in MVP"
  - [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md) — **sole authority** for prompt assembly: select ContextItem values, order them for the provider adapter, attach provider-neutral tool schemas, produce `LLMInferenceRequest`
  - [docs/spec/40-modules/agentic-layer/context-selection.md](../../spec/40-modules/agentic-layer/context-selection.md) — upstream reference: the compiler receives already-selected items; it does not perform selection
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md) — `ContextItem` shape including `layer`, `role`, `content_ref`, `token_estimate`
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md) — `LLMInferenceRequest` target shape (fields: `request_id`, `turn_id`, `context_items`, `available_tools`, `inference_policy`)
  - [docs/spec/20-contracts/tool-definition.md](../../spec/20-contracts/tool-definition.md) — `ToolDefinition` shape consumed for `available_tools`
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `TurnBudget` for budget-awareness during assembly
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires contract-shape tests and deterministic-output tests
- Acceptance criteria:
  - **`PromptCompiler` class exported** from `@argentum/agentic-core` with a single public method: `compile(request: PromptCompilerInput): LLMInferenceRequest`.
  - **`PromptCompilerInput` type exported**: a validated input bag with:
    - `turnId: string` — the owning turn identifier (required)
    - `contextItems: ContextItem[]` — ordered context items selected for this step (required, must be non-empty for MVP; an empty array throws `PromptCompilerError`)
    - `registeredTools: ToolDefinition[]` — registry-owned canonical tool definitions available for this step (required, may be empty)
    - `requestId?: string` — optional override; if omitted, the compiler generates a unique `request_id`
    - `inferencePolicy?: InferencePolicy` — optional policy knobs (temperature, max output budget, normalization mode); if omitted, sensible defaults are applied
  - **`PromptCompilerDependencies` exported**: constructor dependencies include `defaultToolExposurePolicy`, an explicit composition-time discovery policy. The compiler still constructs the per-step `ToolExposureRequest` internally.
  - **`InferencePolicy` type exported**: a lightweight type with optional fields:
    - `temperature?: number` — clamped to [0, 2] during validation (default 0.7)
    - `max_output_tokens?: number` — must be > 0 if provided (default 4096)
    - `normalization_mode?: "native_tool" | "json_mode" | "parsed_text"` — preferred strategy hint (default `"native_tool"`)
  - **`PromptCompilerError` class exported**: a named `Error` subclass thrown for invalid inputs. Subtypes:
    - `EMPTY_CONTEXT_ITEMS` — `contextItems` array is empty
    - `MISSING_TURN_ID` — `turnId` is empty or not a string
    - `INVALID_CONTEXT_ITEM` — a `ContextItem` in the array fails validation (with `context_id` in the message)
    - `INVALID_TOOL_DEFINITION` — a `ToolDefinition` in the array fails validation (with `tool_name` in the message)
    - `INVALID_POLICY` — `inferencePolicy` fields are out of range
  - **Context item ordering preserved**: The compiler respects the caller-provided order of `contextItems`. It does NOT reorder items — ordering is the responsibility of the context selection policy (slice 0027). The compiler validates the input array as-is.
  - **`LLMInferenceRequest` output shape**: The returned object must have:
    - `request_id`: the provided `requestId` or a generated v4 UUID
    - `turn_id`: the provided `turnId`
    - `context_items`: a shallow copy of the validated `contextItems` array
    - `available_tools`: the exposed provider-neutral tool schemas derived from validated `registeredTools` under the compiler-owned current-step exposure request
    - `inference_policy`: the resolved `InferencePolicy` with defaults applied
  - **Provider neutrality enforced**: The compiler operates exclusively on `ContextItem` and `ToolDefinition` — it does NOT import, reference, or accept any provider-native types. The same compiler output can be consumed by any provider adapter without compiler changes.
  - **Budget awareness**: The compiler computes an estimated token count from `contextItems` (summing each item's `token_estimate` field, treating absent/undefined estimates as 0). If `turnBudget.max_tokens_per_step` is provided and the estimate exceeds it, the compiler does NOT reject — it emits a warning via a `onBudgetWarning` callback if provided, but proceeds. Budget enforcement is owned by the governor (future slice), not the compiler.
  - **Bedrock stability**: Bedrock-layer items (`layer === "bedrock"`) are treated as stable context — the compiler validates them identically to other layers and does not mutate them.
  - **Tool summary preference**: The compiler does not reorder items, but it validates that any `tool_summary`-layer items have a valid `content_ref` — if a tool summary item references a missing/invalid `content_ref`, the compiler throws `PromptCompilerError` with code `INVALID_CONTEXT_ITEM`.
  - **The module does NOT**:
    - Select which `ContextItem` values to include (slice 0027)
    - Call the LLM adapter or provider
    - Manage episodic memory
    - Enforce governor budget limits
    - Mutate input objects (all outputs are new objects or shallow copies)
- Inputs crossing the boundary:
  - `ContextItem[]` — selected and ordered context items (from context selection policy or caller)
  - `ToolDefinition[]` — registry-owned canonical tool definitions (from tool registry snapshot)
  - `turnId: string` — owning turn identifier
  - Optional `InferencePolicy` overrides
  - Optional `requestId` override
  - Optional `onBudgetWarning` callback
  - Explicit composition-time `defaultToolExposurePolicy`
- Outputs crossing the boundary:
  - `LLMInferenceRequest` — fully assembled, provider-neutral inference request
  - `PromptCompiler` class exported from `@argentum/agentic-core`
  - `PromptCompilerInput` type exported
  - `InferencePolicy` type exported
  - `PromptCompilerError` class exported
  - `PromptCompilerErrorCode` enum/union exported (for error discrimination)

## Plan

- First contracts or interfaces to create:
  - `InferencePolicy` type — lightweight policy knobs with defaults
  - `PromptCompilerInput` type — validated input bag
  - `PromptCompilerError` class — named Error subclass with error code discrimination
  - `PromptCompilerErrorCode` — union of error code string literals
  - `PromptCompiler` class — single-responsibility compiler with one public method
- Minimal implementation steps:
  1. Ensure `@argentum/contracts` is a workspace dependency in `packages/agentic_core/package.json` (added by slice 0024).
  2. Ensure `packages/agentic_core/tsconfig.json` references `../contracts` (added by slice 0024).
  3. Create `packages/agentic_core/src/prompt-compiler.ts`:
     - Import `ContextItem`, `LLMInferenceRequest`, `ToolDefinition`, `TurnBudget` from `@argentum/contracts`
     - Import `randomUUID` from `node:crypto`
     - Define and export `InferencePolicy` type
     - Define and export `PromptCompilerInput` type
     - Define and export `PromptCompilerErrorCode` type (union of string literals)
     - Define and export `PromptCompilerError` class (extends Error, has `code: PromptCompilerErrorCode`)
     - Define and export `PromptCompiler` class:
       - `compile(input: PromptCompilerInput): LLMInferenceRequest`
       - Internal validation methods: `validateContextItems`, `validateToolDefinitions`, `validatePolicy`, `estimateTokens`
       - Apply defaults for optional fields
       - Generate `request_id` if not provided
       - Return fully assembled `LLMInferenceRequest`
  4. Update `packages/agentic_core/src/index.ts` to export all public symbols from `prompt-compiler.ts`
- Required tests:
  - **Happy path — basic request**: Provide valid `turnId` + 3 `ContextItem` values + 1 `ToolDefinition`. Assert returned `LLMInferenceRequest` has correct `turn_id`, `context_items` length 3, `available_tools` length 1, generated `request_id` is a non-empty string.
  - **Happy path — custom requestId**: Provide `requestId: "custom-req-1"`. Assert `request_id === "custom-req-1"`.
  - **Happy path — empty tools**: Provide `registeredTools: []`. Assert `available_tools` is an empty array (no-tool step).
  - **Happy path — inference policy defaults**: Omit `inferencePolicy`. Assert returned policy has `temperature: 0.7`, `max_output_tokens: 4096`, `normalization_mode: "native_tool"`.
  - **Happy path — custom inference policy**: Provide `inferencePolicy: { temperature: 0.3, max_output_tokens: 2048, normalization_mode: "json_mode" }`. Assert policy fields match exactly.
  - **Happy path — bedrock items preserved**: Include a `ContextItem` with `layer: "bedrock"`. Assert it appears in output unchanged.
  - **Happy path — tool summary items with valid content_ref**: Include a `ContextItem` with `layer: "tool_summary"` and a valid `content_ref` (all required fields). Assert it appears in output unchanged.
  - **Error — empty context items**: Provide `contextItems: []`. Assert `PromptCompilerError` thrown with code `EMPTY_CONTEXT_ITEMS`.
  - **Error — missing turnId**: Provide `turnId: ""`. Assert `PromptCompilerError` thrown with code `MISSING_TURN_ID`.
  - **Error — invalid context item**: Provide a `ContextItem` missing required field `context_id`. Assert `PromptCompilerError` thrown with code `INVALID_CONTEXT_ITEM` and message includes the offending field.
  - **Error — invalid tool definition**: Provide a `ToolDefinition` missing required field `tool_name`. Assert `PromptCompilerError` thrown with code `INVALID_TOOL_DEFINITION`.
  - **Error — invalid policy temperature**: Provide `inferencePolicy: { temperature: 3.0 }` (out of [0,2] range). Assert `PromptCompilerError` thrown with code `INVALID_POLICY`.
  - **Error — invalid policy max_output_tokens**: Provide `inferencePolicy: { max_output_tokens: 0 }`. Assert `PromptCompilerError` thrown with code `INVALID_POLICY`.
  - **Budget warning callback**: Provide a budget with `max_tokens_per_step: 100` and context items whose `token_estimate` sum exceeds 100. Provide a mock `onBudgetWarning` callback. Assert the callback is invoked with the estimated and max token counts. Assert the request is still produced (compiler warns, does not reject).
  - **Budget warning — no callback**: Same as above but omit `onBudgetWarning`. Assert no error thrown and request is produced normally.
  - **Immutability — input not mutated**: Call `compile()` then assert the input `contextItems` array and its objects are not mutated (deep equality check).
  - **Immutability — output is independent**: Call `compile()`, mutate the returned `LLMInferenceRequest.context_items` array. Call `compile()` again with the same input. Assert the second output is unaffected.
  - **Provider-neutral type safety**: The module must compile cleanly with no provider-native types imported or referenced.
  - **Token estimation with missing estimates**: Include items where `token_estimate` is `undefined` or absent. Assert those items contribute 0 to the estimate total. Verify the warning callback (if provided) uses the correct total.
- Narrow validation step:
  - `pnpm --filter @argentum/agentic-core test`
  - `pnpm typecheck`
  - `pnpm --filter @argentum/agentic-core build`

## Execution Strategy

- Autopilot suitability: **safe**. The slice is bounded to a single new module in `agentic_core` with no cross-package wiring, no persistence, no external I/O beyond `node:crypto` for UUID generation. The implementation is a pure validation-and-assembly class (~150 lines) plus ~200 lines of focused tests. All input types (`ContextItem`, `ToolDefinition`, `LLMInferenceRequest`) are already validated in `@argentum/contracts`. The spec is unambiguous about compiler responsibilities and provider neutrality.
- Parallel subagent opportunities:
  - **Read-only validation scan** (safe for parallel subagent): Verify that `@argentum/contracts` exports `ContextItem`, `ToolDefinition`, `LLMInferenceRequest`, and `TurnBudget` with the shapes expected by the prompt compiler. Independent of implementation.
  - **Read-only spec cross-reference** (safe for parallel subagent): Verify that the compiler rules in this slice card exactly match `docs/spec/40-modules/agentic-layer/prompt-compiler.md` and flag any discrepancies.
- Out of scope:
  - Context item selection (slice 0027)
  - Episodic memory management (slice 0025)
  - LLM adapter calls or provider integration (Phase 5)
  - Governor budget enforcement
  - Turn state machine integration
  - Tool registry queries (the compiler receives `ToolDefinition[]`, it does not query the registry)
  - Context reordering (caller-owned; compiler preserves input order)
  - Any I/O, file system, or network access beyond `node:crypto`
- Deferred decisions that must remain deferred:
  - Exact `inference_policy` subfields beyond temperature, max_output_tokens, normalization_mode — spec defers to DeepSeek adapter MVP
  - Whether tool exposure per step is full-registry or curated subset — deferred in `docs/spec/70-roadmap/deferred-decisions.md`

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1 (HIGH — resolved)**: ToolDefinition→AvailableToolEntry conversion strips `side_effect_level`, `path_scope`, `required_secret_handles`, `network_access`, `default_timeout_ms`, `defaults`. Only `name`, `description`, `input_schema` remain. Verified by 2 tests asserting extra keys are absent.
  - **H2 (MEDIUM — resolved)**: Spec drift comment added to `PromptCompilerInput` JSDoc acknowledging that the prompt-compiler spec lists selection as compiler responsibility but this implementation delegates to context selection policy (slice 0027).
  - **H3 (MEDIUM — resolved)**: `onBudgetWarning?: (estimated: number, max: number) => void` added to `PromptCompilerInput`. 5 budget warning tests cover: called when exceeded, not called when under, no callback no error, no budget at all, max_tokens_per_step undefined.
  - **H4 (MEDIUM — resolved)**: `parseLLMInferenceRequest` round-trip tested in 2 tests — one with custom policy, one with defaults. Both pass through the contract parser without error.
  - **C1 (MEDIUM — resolved)**: `budget?: TurnBudget` added to `PromptCompilerInput`. `budget.max_tokens_per_step` used for budget awareness check in `checkBudget()`.
  - **R1 (LOW — noted)**: Compiler validation is structural but does not delegate to `parseContextItem`/`parseToolDefinition` from contracts. This is intentional: the compiler does "enough" validation for good error messages while avoiding coupling to contract parser internals. Full contract validation remains the caller's or downstream's responsibility.
  - **R2 (LOW — noted)**: `compile()` output is a plain object (not `Object.freeze()`d). Contract parser `parseLLMInferenceRequest` freezes on parse. Immutability tests confirm output independence. Non-freezing is acceptable because the caller receives a fresh object each invocation.
  - **R3 (LOW — noted)**: `normalization_mode` default is `"native_tool"` per slice card and `NormalizationStatus` contract type. The adversarial review prompt mentioned `"strict"` which is not a valid `NormalizationStatus` value — the spec authority (slice card) takes precedence.
- Refinements applied:
  - `budget` field added to `PromptCompilerInput` per C1
  - `onBudgetWarning` callback added per H3
  - Spec drift comment added per H2
  - ToolDefinition→AvailableToolEntry field stripping per H1
  - parseLLMInferenceRequest round-trip tests per H4
