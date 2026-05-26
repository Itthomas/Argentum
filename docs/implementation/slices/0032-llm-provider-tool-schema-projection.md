# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: orchestrator (adversarial review clean after H1/M1-M3 refinement, 2026-05-24)
- Approval date: 2026-05-24
- Phase: 5 (LLM Provider Integration)
- Owner: llm_provider
- Execution readiness: ready-when-approved. This is the **second implementation slice** for the `@argentum/llm-provider` package. Slice 0031 (`LLMProvider` interface + `LLMProviderError`) defines the provider abstraction seam. This slice adds the first DeepSeek-specific utility: a pure tool schema projection function. Slice 0016 (`LLMInferenceRequest` / `AvailableToolEntry` contracts) is validated and available — the projection function consumes `AvailableToolEntry[]` (the canonical contract shape used in `LLMInferenceRequest.available_tools`), not `ToolDefinition[]`. ToolDefinition→AvailableToolEntry stripping is already handled by the prompt compiler (slice 0026). Slice 0031 must be implemented first (this slice builds on the package scaffolding and dependency wiring established in 0031).

## Scope

- Slice name: Tool Schema Projection (DeepSeek Adapter)
- Target package or boundary: `llm_provider` (`@argentum/llm-provider`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "MVP uses a hybrid LLM adapter strategy with strict normalization into canonical internal contracts"
  - [docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md](../../spec/40-modules/llm-provider/deepseek-adapter-mvp.md) — **sole authority** for the DeepSeek adapter requirement: "Project provider-neutral tool schemas into the DeepSeek-native tool definition format when native tool calling is enabled"
  - [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md) — rule: "Provider-native tool schemas must be generated from the tool registry source of truth."
  - [docs/spec/40-modules/llm-provider/provider-normalization.md](../../spec/40-modules/llm-provider/provider-normalization.md) — normalization policy context; "Maintaining provider-facing tool schemas separately from the registry" is identified as a drift risk
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md) — `LLMInferenceRequest.available_tools` is `AvailableToolEntry[]` (slice 0016 implementation), the provider-neutral source array consumed by the LLM adapter
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — contract set: `ToolDefinition` is the canonical provider-neutral tool schema; `LLMInferenceRequest`/`LLMInferenceResult` define the provider adapter boundary
  - [docs/spec/40-modules/tool-layer/tool-schema-model.md](../../spec/40-modules/tool-layer/tool-schema-model.md) — `ToolDefinition` field definitions (`name`, `description`, `input_schema`, etc.); `AvailableToolEntry` is the minimal subset used at the adapter boundary
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
- Acceptance criteria:
  - **Projection function exists**: The `@argentum/llm-provider` package exports a `projectToolSchemas` function that translates canonical `AvailableToolEntry[]` into DeepSeek-native tool schema objects. The function consumes the same shape that appears in `LLMInferenceRequest.available_tools`. The prompt compiler (slice 0026) already strips execution-policy fields from `ToolDefinition` to produce `AvailableToolEntry` before constructing the inference request — the adapter never sees `ToolDefinition`.
  - **Function signature**: `projectToolSchemas(tools: readonly AvailableToolEntry[]): DeepSeekToolSchema[]` — pure synchronous function, no async, no side effects, no API calls.
  - **Output shape — `DeepSeekToolSchema`**: Each output element is a plain object with the following shape:
    - `type`: literal `"function"` (always).
    - `function`: object containing:
      - `name`: `string` — copied from `AvailableToolEntry.name`.
      - `description`: `string` — copied from `AvailableToolEntry.description`.
      - `parameters`: `Record<string, unknown>` — copied from `AvailableToolEntry.input_schema`. The function does NOT validate, modify, or enrich the JSON Schema — it passes the `input_schema` through as-is. The tool author is responsible for providing a valid JSON Schema in `input_schema`.
  - **Type export**: `DeepSeekToolSchema` type is exported from the package so downstream adapter code (slice 0033) can reference it.
  - **Empty input**: `projectToolSchemas([])` returns `[]` (empty array). No error thrown.
  - **Ordering preserved**: The output array preserves the same order as the input array. Element at index *i* in the output corresponds to element at index *i* in the input.
  - **Pure projection — no enrichment**: The function does not add, remove, or transform fields beyond the structural mapping described above. Since `AvailableToolEntry` already contains only `name`, `description`, and `input_schema` (execution-policy fields like `side_effect_level`, `path_scope`, etc. are stripped upstream by the prompt compiler), the projection is a direct structural mapping with no field filtering needed.
  - **No provider SDK**: The function does NOT import any DeepSeek SDK, OpenAI SDK, or any third-party API client library. It is a pure data transformation.
  - **No normalization**: The function does NOT normalize responses, handle API errors, or construct API requests. It only projects tool schemas.
  - **Package exports**: The `llm-provider` package exports `projectToolSchemas` (function) and `DeepSeekToolSchema` (type) from its barrel entrypoint, alongside the exports from slice 0031.
- Inputs crossing the boundary:
  - `AvailableToolEntry[]` from `@argentum/contracts` (slice 0016) — the canonical minimal tool entry shape used in `LLMInferenceRequest.available_tools`. Each entry carries only `name`, `description`, `input_schema`. The prompt compiler (slice 0026) strips execution-policy fields from `ToolDefinition` → `AvailableToolEntry` before the adapter receives the request.
- Outputs crossing the boundary:
  - `DeepSeekToolSchema[]` — provider-native tool definition objects suitable for inclusion in DeepSeek API chat completion requests

## Plan

- First contracts or interfaces to create:
  - `DeepSeekToolSchema` type — a simple object type representing one DeepSeek-native tool definition:
    ```typescript
    interface DeepSeekToolSchema {
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }
    ```
    - The `parameters` field is `Record<string, unknown>` to match `AvailableToolEntry.input_schema`'s type. No further type narrowing is applied — the JSON Schema structure is the tool author's responsibility.
  - `projectToolSchemas` function:
    ```typescript
    function projectToolSchemas(tools: readonly AvailableToolEntry[]): DeepSeekToolSchema[]
    ```
    - JSDoc documents: "Projects canonical Argentum AvailableToolEntry values into DeepSeek-native tool schema objects suitable for inclusion in DeepSeek API chat completion requests. This is a pure transformation — no API calls, no side effects, no schema validation. The function maps name → function.name, description → function.description, and input_schema → function.parameters. The input is the same AvailableToolEntry shape that appears in LLMInferenceRequest.available_tools; execution-policy fields are already stripped upstream by the prompt compiler."
- **Scaffolding checklist (prerequisites)**: Before writing code, verify:
  - (a) `packages/llm_provider/package.json` has `"@argentum/contracts": "workspace:*"` in `dependencies`.
  - (b) `packages/llm_provider/tsconfig.json` has `"references": [{ "path": "../contracts" }]` for TypeScript project reference resolution.
  - (c) `packages/llm_provider/package.json` test script is `"test": "vitest run"` (not `"vitest run --passWithNoTests"` — tests will be non-vacuous after this slice).
  - (d) Vitest config exists at `packages/llm_provider/vitest.config.ts` (or equivalent) with at least a basic configuration.
  - (e) `AvailableToolEntry` is exported from `@argentum/contracts` (verified in slice 0016 — importable from the barrel).
- Minimal implementation steps:
  1. Ensure slice 0031 has been implemented (package scaffolding, `@argentum/contracts` dependency, TypeScript project reference, test infrastructure). If not yet implemented, this slice must perform the scaffolding steps documented in 0031 first. Verify all scaffolding checklist items above.
  2. Create `packages/llm_provider/src/tool-schema-projection.ts`:
     - Import `AvailableToolEntry` from `@argentum/contracts`.
     - Define and export `DeepSeekToolSchema` interface.
     - Define and export `projectToolSchemas(tools: readonly AvailableToolEntry[]): DeepSeekToolSchema[]`.
     - Implementation: `tools.map(t => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.input_schema } }))`.
     - Add JSDoc to both the type and the function. JSDoc must clarify that the function performs no API calls — it is a pure data transformation.
  3. Update `packages/llm_provider/src/index.ts`:
     - Add barrel exports for `projectToolSchemas` and `DeepSeekToolSchema` from `./tool-schema-projection.js`.
  4. Create `packages/llm_provider/tests/tool-schema-projection.test.ts` (if not yet existing, also create `packages/llm_provider/vitest.config.ts` or equivalent).
- Required tests:
  - **Single tool projection test**: Create one valid `AvailableToolEntry` (with `name`, `description`, and `input_schema` as a JSON Schema object with `type`, `properties`, `required`). Call `projectToolSchemas([tool])`. Assert:
    - Returns array of length 1.
    - Output element has `type: "function"`.
    - `function.name` matches `tool.name`.
    - `function.description` matches `tool.description`.
    - `function.parameters` is deep-equal to `tool.input_schema` (the function passes the object through, verified via `toEqual`/deep equality — not strict reference equality, since the implementation may or may not clone).
  - **Empty array test**: `projectToolSchemas([])` returns `[]`. Assert length 0 and type is array.
  - **Multiple tools ordering test**: Create 3 `AvailableToolEntry` values with distinct names. Call `projectToolSchemas([toolA, toolB, toolC])`. Assert output length is 3. Assert `output[0].function.name === toolA.name`, `output[1].function.name === toolB.name`, `output[2].function.name === toolC.name`.
  - **Output shape correctness test** (replaces former non-schema field exclusion test): Create an `AvailableToolEntry` with `name`, `description`, `input_schema`. Call `projectToolSchemas([tool])`. Assert the output element has exactly the keys `type` and `function` at top level (use `Object.keys()` and assert the set matches). Assert `function` has exactly the keys `name`, `description`, `parameters`. Since `AvailableToolEntry` already excludes execution-policy fields, the test verifies structural mapping correctness rather than field filtering.
  - **Edge case — empty `input_schema`**: Create an `AvailableToolEntry` with `input_schema: {}` (empty object). Call `projectToolSchemas([tool])`. Assert `output[0].function.parameters` is `{}` (deep-equal). The function passes empty schemas through without error or modification.
  - **No side effects test**: Call `projectToolSchemas` with an `AvailableToolEntry[]` and then verify the original input array and its elements are not mutated (the function does not modify its inputs).
  - **No provider SDK import test**: A grep or static analysis test verifying that `packages/llm_provider/src/tool-schema-projection.ts` does NOT import from any third-party API SDK (no `openai`, `@anthropic-ai/sdk`, deepseek SDK, etc.). Only imports from `@argentum/contracts` are permitted.
  - **Package entrypoint smoke test**: Verify `@argentum/llm-provider` exports `projectToolSchemas` (function) and `DeepSeekToolSchema` (type). Import from the barrel and verify `typeof projectToolSchemas === "function"`.
  - **TypeScript compilation test**: Verify that assigning the return of `projectToolSchemas` to a variable typed `DeepSeekToolSchema[]` compiles without errors.
- Narrow validation step:
  - `pnpm --filter @argentum/llm-provider test` passes with real (non-vacuous) tests.
  - `pnpm --filter @argentum/llm-provider build` succeeds (TypeScript compilation).
  - `pnpm --filter @argentum/llm-provider lint` passes.
  - `pnpm typecheck` passes (full-project type checking).

## Execution Strategy

- Autopilot suitability: **safe**. This slice is:
  - Fully bounded: one type, one pure function (~5 lines of implementation), barrel exports, focused tests.
  - Contract-consumer only: consumes validated `AvailableToolEntry` from `@argentum/contracts` (slice 0016). The prompt compiler (slice 0026) already converts `ToolDefinition` → `AvailableToolEntry` before constructing `LLMInferenceRequest`.
  - Pure data transformation: no I/O, no side effects, no external dependencies, no async.
  - No deferred decisions to resolve — the DeepSeek-native format is the well-known OpenAI-compatible `{ type: "function", function: { name, description, parameters } }` shape. The spec explicitly requires this projection and the target format is unambiguous.
  - Clear acceptance criteria with deterministic test assertions.
  - Implementation is ~15 lines of type/function definitions plus ~80 lines of tests.
  - Slice 0031 must be implemented first to establish package scaffolding, but once 0031 is done, 0032 has no additional blockers.
- Parallel subagent opportunities:
  - **Read-only contract shape verification** (safe for parallel subagent): A read-only subagent can verify that `AvailableToolEntry` is exported from `@argentum/contracts` with the expected fields (`name`, `description`, `input_schema`) and that `input_schema` is typed as `Record<string, unknown>`. Also verify that `LLMInferenceRequest.available_tools` is typed as `readonly AvailableToolEntry[]`. This is independent of implementation.
  - **Read-only spec cross-reference** (safe for parallel subagent): A read-only subagent can verify that the `projectToolSchemas` function design aligns with the spec requirements in `docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md` and `docs/spec/40-modules/llm-provider/provider-abstraction.md`, and flag any gaps. This is independent of implementation.
- Out of scope:
  - The DeepSeek adapter itself (that's slice 0033) — this slice only provides the tool schema projection utility that the adapter will consume.
  - HTTP calls to any API (including DeepSeek API).
  - Provider SDK imports or usage.
  - Normalization of DeepSeek responses into `LLMInferenceResult` or `ActionDecision`.
  - Raw trace capture or `raw_trace_ref` construction.
  - Provider event emission (`llm.*` stream events).
  - Provider configuration resolution.
  - `LLMProvider.infer()` implementation (the DeepSeek adapter that calls the API).
  - Prompt compilation or context selection (owned by `agentic_core`).
  - Tool schema validation against `input_schema` — the function passes the schema through without inspecting it.
  - Enrichment or transformation of `input_schema` (e.g., adding `additionalProperties: false`, auto-wrapping in `{ type: "object", properties: ... }`). The tool author is responsible for providing a valid JSON Schema.
- Deferred decisions that must remain deferred:
  - Exact DeepSeek endpoint and model selection (deferred per `docs/spec/70-roadmap/deferred-decisions.md`).
  - Exact `inference_policy` subfields (deferred per `docs/spec/20-contracts/llm-adapter-contract.md`).
  - Whether tool exposure per step is full-registry or curated subset in MVP (deferred per roadmap). The projection function accepts any `AvailableToolEntry[]` and is agnostic to how the array is constructed.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1 (HIGH — resolved 2026-05-24)**: Function input type `ToolDefinition[]` contradicts the canonical `LLMInferenceRequest` contract. `LLMInferenceRequest.available_tools` is `AvailableToolEntry[]` (slice 0016). The prompt compiler (slice 0026) already strips execution-policy fields from `ToolDefinition` → `AvailableToolEntry` before constructing the inference request. The adapter never sees `ToolDefinition`. **Resolution**: Changed function signature from `projectToolSchemas(tools: readonly ToolDefinition[])` to `projectToolSchemas(tools: readonly AvailableToolEntry[])`. Updated all references throughout the card: spec citations, acceptance criteria, inputs crossing the boundary, Plan types and JSDoc, implementation steps, test descriptions, Execution Strategy, parallel subagent, and deferred decisions.
  - **M1 (MEDIUM — resolved 2026-05-24)**: Redesign the "non-schema field exclusion test" since `AvailableToolEntry` doesn't have execution-policy fields. **Resolution**: Replaced with "Output shape correctness test" that verifies exact key sets: top-level has only `type` and `function`; `function` has only `name`, `description`, `parameters`. The test now validates structural mapping correctness rather than field filtering.
  - **M2 (MEDIUM — resolved 2026-05-24)**: No explicit scaffolding checklist. **Resolution**: Added "Scaffolding checklist (prerequisites)" section enumerating: (a) `@argentum/contracts: workspace:*` in dependencies, (b) `"references": [{ "path": "../contracts" }]` in tsconfig.json, (c) test script `"vitest run"` (not `--passWithNoTests`), (d) vitest config exists, (e) `AvailableToolEntry` is importable from contracts barrel.
  - **M3 (MEDIUM — resolved 2026-05-24)**: No edge-case test for `input_schema` as empty object `{}`. **Resolution**: Added "Edge case — empty `input_schema`" test: create `AvailableToolEntry` with `input_schema: {}`, call projection, assert `output[0].function.parameters` is `{}` (deep-equal).
  - **L1 (LOW — noted, not actioned)**: Naming tension — `projectToolSchemas` is a generic name but the output type is `DeepSeekToolSchema` (provider-specific). Acceptable for MVP with single provider; rename can be deferred to multi-provider support.
  - **L3 (LOW — resolved 2026-05-24)**: Reference-equality test (`===`) for `parameters` is overly strict. The implementation may or may not clone. **Resolution**: Relaxed to deep-equality (`toEqual`/deep equality) in the single tool projection test.
  - **L4 (LOW — resolved 2026-05-24)**: JSDoc should explicitly clarify that function performs no API calls. **Resolution**: Updated JSDoc in Plan section to state "no API calls, no side effects, no schema validation" and added explicit note in implementation steps that JSDoc must clarify this.
- Refinements applied:
  - 2026-05-24: H1 resolved — all `ToolDefinition` references replaced with `AvailableToolEntry` throughout the card.
  - 2026-05-24: M1 resolved — "non-schema field exclusion test" redesigned as "output shape correctness test".
  - 2026-05-24: M2 resolved — scaffolding checklist added.
  - 2026-05-24: M3 resolved — empty `input_schema` edge-case test added.
  - 2026-05-24: L3 resolved — reference-equality relaxed to deep-equality.
  - 2026-05-24: L4 resolved — JSDoc clarified to state no API calls.
