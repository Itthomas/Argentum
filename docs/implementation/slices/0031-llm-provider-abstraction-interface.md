# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: orchestrator (via implementer delegation, 2026-05-24)
- Approval date: 2026-05-24
- Phase: 5 (LLM Provider Integration)
- Owner: llm_provider
- Execution readiness: ready-when-approved. This is the **first implementation slice** for the `@argentum/llm-provider` package (currently a shell with `export {}`). Slice 0016 (`LLMInferenceRequest` / `LLMInferenceResult` contracts) is validated and available. No upstream `llm_provider` slices exist — this slice creates the package's first real module and the provider abstraction that all future adapters must implement.

## Scope

- Slice name: LLM Provider Abstraction Interface
- Target package or boundary: `llm_provider` (`@argentum/llm-provider`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "MVP uses a hybrid LLM adapter strategy with strict normalization into canonical internal contracts"
  - [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md) — **sole authority** for provider module responsibilities, input/output contracts, rules, and MVP constraints
  - [docs/spec/40-modules/llm-provider/provider-normalization.md](../../spec/40-modules/llm-provider/provider-normalization.md) — normalization strategy context (allowed internal strategies, required output guarantees, drift risks)
  - [docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md](../../spec/40-modules/llm-provider/deepseek-adapter-mvp.md) — DeepSeek adapter responsibilities (contextual; the interface definition must accommodate this future implementation)
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md) — `LLMInferenceRequest` and `LLMInferenceResult` shape authority (already implemented in slice 0016)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — contract set definition and normalization boundary rules
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "adapter normalization tests for DeepSeek-native and fallback paths" (future slices); this slice only requires contract validation and interface usability tests
- Acceptance criteria:
  - **Provider abstraction interface exists**: The `@argentum/llm-provider` package exports an `LLMProvider` interface defining the single seam through which the core loop invokes LLM inference. The core loop calls `infer(request)` and receives an `LLMInferenceResult` — it never constructs provider-native API payloads or parses provider-native response shapes.
  - **Interface shape**: `LLMProvider` exports a single async method:
    - `infer(request: LLMInferenceRequest): Promise<LLMInferenceResult>`
    - JSDoc documents that implementations accept a canonical `LLMInferenceRequest`, translate context items and tool schemas into provider-native formats internally, normalize responses into `LLMInferenceResult`, and may use native tool calling, JSON mode, or parsed text internally per the normalization spec.
  - **Contract consumption only**: The interface consumes only canonical `@argentum/contracts` types (`LLMInferenceRequest`, `LLMInferenceResult`). No provider-native types, SDK types, or raw payload types appear in the interface signature or its JSDoc.
  - **Controlled adapter failure type**: The package exports an `LLMProviderError` class (extending `Error`) for adapter-level failures (network errors, authentication failures, malformed provider responses that cannot be repaired). The error carries:
    - `providerId: string` — stable identifier of the provider instance that failed
    - `requestId: string` — the `request_id` from the originating `LLMInferenceRequest`
    - `cause?: unknown` — the underlying error, if available
    - `message` — a descriptive error message
    - The error is a simple named `Error` subclass, not a multi-issue validation result. It represents a single deterministic adapter failure.
    - JSDoc documents that `LLMProviderError` is the standard failure surface for `LLMProvider.infer()` — implementations should throw this (or a subclass) on adapter failure, and callers should catch it to distinguish adapter failures from other errors.
  - **Provider-neutral**: The `LLMProvider` interface must be implementable by any LLM provider adapter (DeepSeek, OpenAI, Anthropic, etc.) without importing or referencing any provider-specific types. The interface signature and JSDoc must remain provider-agnostic.
  - **MVP constraint — single adapter**: The interface is designed for one provider implementation in MVP (DeepSeek) but defines a contract that future multi-provider support can use without interface changes.
  - **MVP constraint — no failover**: The interface does NOT define failover semantics, provider selection logic, or routing between multiple adapters. A single `LLMProvider` implementation is injected into the core loop at composition time.
  - **MVP constraint — sequential execution**: The interface does NOT expose parallel tool execution semantics. Multi-tool decisions are normalized into sequential `tool_calls` entries per the normalization spec. The interface JSDoc documents this constraint.
  - **Package exports**: The `llm-provider` package exports `LLMProvider` (interface), `LLMProviderError` (class), and all public types from its entrypoint.
  - The slice does NOT implement any concrete adapter, DeepSeek API translation, provider-native tool schema projection, normalization logic, raw trace capture, or provider event emission.
- Inputs crossing the boundary:
  - `LLMInferenceRequest` from `@argentum/contracts` (slice 0016) — the canonical inference request carrying `request_id`, `turn_id`, `context_items`, `available_tools`, and `inference_policy`
- Outputs crossing the boundary:
  - `LLMProvider` interface exported from `@argentum/llm-provider`
  - `LLMProviderError` class exported from `@argentum/llm-provider`
  - `LLMInferenceResult` (returned by implementations, not re-exported — consumed from `@argentum/contracts`)

## Plan

- First contracts or interfaces to create:
  - `LLMProvider` interface with a single method:
    - `infer(request: LLMInferenceRequest): Promise<LLMInferenceResult>`
    - JSDoc documents:
      - Implementations accept a canonical `LLMInferenceRequest` from the core loop.
      - Implementations translate `context_items` and `available_tools` into provider-native request shapes internally.
      - Implementations may use provider-native tool calling, JSON mode, or parsed text internally (`normalization_status` in the result reflects the strategy used).
      - Implementations must return one normalized `LLMInferenceResult` per request, containing a canonical `ActionDecision`.
      - Provider-native tool schemas must be generated from the tool registry source of truth (the `available_tools` array in the request).
      - Raw provider payloads remain adapter-private except by artifact reference (`raw_trace_ref` in the result).
      - Multi-tool action decisions execute sequentially in MVP — the adapter must not expose parallel execution semantics to the core loop.
      - Implementations should throw `LLMProviderError` (or a subclass) on adapter-level failure (network errors, auth failures, malformed responses that cannot be repaired).
      - The interface is provider-neutral — any LLM backend can implement this contract without interface changes.
  - `LLMProviderError` class:
    - Extends `Error`.
    - Constructor accepts `providerId: string`, `requestId: string`, `message: string`, and optional `cause?: unknown`.
    - Exposes `providerId`, `requestId`, and `cause` as readonly properties.
    - `name` is set to `"LLMProviderError"`.
- Minimal implementation steps:
  1. Add `@argentum/contracts` as a workspace dependency in `packages/llm_provider/package.json`:
     - Add `"@argentum/contracts": "workspace:*"` to `dependencies`.
  2. Add TypeScript project reference: update `packages/llm_provider/tsconfig.json` to include `"references": [{ "path": "../contracts" }]` so that `tsc -b` correctly resolves the contracts dependency.
  3. Create `packages/llm_provider/src/llm-provider.ts`:
     - Import `LLMInferenceRequest`, `LLMInferenceResult` from `@argentum/contracts`.
     - Define and export `LLMProvider` interface with `infer(request: LLMInferenceRequest): Promise<LLMInferenceResult>`.
     - Add comprehensive JSDoc to the interface and method covering all behavioral contracts listed above.
     - Define and export `LLMProviderError` class extending `Error` with `providerId`, `requestId`, `cause` properties.
  4. Update `packages/llm_provider/src/index.ts`:
     - Replace `export {};` with barrel exports for `LLMProvider`, `LLMProviderError` from `./llm-provider.js`.
  5. Remove `"test": "vitest run --passWithNoTests"` from `packages/llm_provider/package.json` and replace with `"test": "vitest run"` (tests will be non-vacuous after this slice).
- Required tests:
  - **Interface existence test**: Verify `LLMProvider` is importable from `@argentum/llm-provider`. TypeScript interfaces do not exist at runtime — the test documents this and verifies the import does not crash.
  - **Interface implementability test**: Define a minimal valid implementation of `LLMProvider` (a test class or object literal) and verify:
    - The implementation compiles without type errors.
    - The `infer` method accepts `LLMInferenceRequest` and returns `Promise<LLMInferenceResult>`.
    - An instance can be assigned to a variable typed `LLMProvider`.
  - **Interface method invocation test**: Create a minimal mock implementation that returns a valid `LLMInferenceResult` (constructed with `request_id`, a minimal `ActionDecision`, `normalization_status: "parsed_text"`). Call `infer()` with a minimal valid `LLMInferenceRequest` and assert the returned result matches.
  - **Provider-neutral type safety test**: Verify the `LLMProvider` interface definition file does NOT import any provider-specific types, SDK types, or raw payload types. Only `@argentum/contracts` types are imported. (A grep or static analysis test, or simply verified by clean TypeScript compilation.)
  - **LLMProviderError construction test**: Create an `LLMProviderError` with all constructor arguments and assert:
    - `instanceof Error` is `true`.
    - `instanceof LLMProviderError` is `true`.
    - `name === "LLMProviderError"`.
    - `providerId`, `requestId` match constructor arguments.
    - `cause` matches the optional cause argument.
    - `message` is the provided message.
  - **LLMProviderError without cause test**: Create an `LLMProviderError` without the optional `cause` argument and assert `cause` is `undefined`.
  - **LLMProviderError throw and catch test**: Throw an `LLMProviderError` from within a mock `infer()` implementation, catch it, and assert the error properties are preserved through the throw/catch cycle.
  - **Package entrypoint smoke test**: Verify `@argentum/llm-provider` exports `LLMProvider` and `LLMProviderError` (import and type-check from the barrel).
  - **No adapter implementation test**: Verify the package does NOT export any concrete adapter class, DeepSeek-specific types, or provider-native payload types. Only the interface and error class are public.
- Narrow validation step:
  - `pnpm --filter @argentum/llm-provider test` passes with real (non-vacuous) tests.
  - `pnpm --filter @argentum/llm-provider build` succeeds (TypeScript compilation).
  - `pnpm --filter @argentum/llm-provider lint` passes.
  - `pnpm typecheck` passes (full-project type checking, verifying no cross-package type errors introduced).

## Execution Strategy

- Autopilot suitability: **safe**. This slice is:
  - Fully bounded: one interface, one error class, barrel exports, focused tests.
  - Contract-consumer only: consumes existing validated `LLMInferenceRequest`, `LLMInferenceResult` from `@argentum/contracts`.
  - No external dependencies, no side effects, no filesystem or network access.
  - No deferred decisions to resolve — DeepSeek endpoint/model selection is deferred but irrelevant to the interface definition.
  - Clear acceptance criteria with deterministic test assertions.
  - Implementation is ~60 lines of interface/class definitions plus ~80 lines of tests.
- Parallel subagent opportunities:
  - **Read-only contract availability check** (safe for parallel subagent): A read-only subagent can verify that `LLMInferenceRequest`, `LLMInferenceResult`, `ActionDecision`, `NormalizationStatus`, and `AvailableToolEntry` are exported from `@argentum/contracts` and match the shapes expected by this slice. This is independent of implementation.
  - **Read-only spec cross-reference** (safe for parallel subagent): A read-only subagent can verify that the `LLMProvider` interface shape and behavioral contract align with `docs/spec/40-modules/llm-provider/provider-abstraction.md` and flag any gaps. This is independent of implementation.
- Out of scope:
  - Any concrete adapter implementation (DeepSeek or otherwise).
  - Provider-native API translation (request/response body construction).
  - Provider-native tool schema projection from `available_tools`.
  - Normalization logic (native tool calling → `ActionDecision`, JSON mode → `ActionDecision`, parsed text → `ActionDecision`).
  - Raw trace capture or `raw_trace_ref` construction.
  - Provider event emission (`llm.*` stream events).
  - Provider configuration resolution.
  - Provider failover, routing, or multi-provider selection.
  - Prompt compilation or context selection (owned by `agentic_core`).
  - Integration with the core loop or turn state machine.
- Deferred decisions that must remain deferred:
  - Exact DeepSeek endpoint and model selection (deferred per `docs/spec/70-roadmap/deferred-decisions.md`).
  - Exact `inference_policy` subfields (deferred to DeepSeek adapter MVP per `docs/spec/20-contracts/llm-adapter-contract.md`).
  - Whether tool exposure per step is full-registry or curated subset in MVP (deferred per roadmap).

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **No CRITICAL or HIGH findings.** The slice defines a single interface + one error class with zero external dependencies, no I/O, and no deferred-decision triggers.
  - **LOW — Shell package**: `@argentum/llm-provider` currently has `export {}`. This slice creates the package's first real module. Ensure `tsconfig.json` has a `references` entry for `../contracts` and `package.json` adds `@argentum/contracts` as `workspace:*`.
- Refinements applied:
  - Card approved 2026-05-24. Ready for implementation.
  - Audit 0012 M3: empty Review Log populated.
