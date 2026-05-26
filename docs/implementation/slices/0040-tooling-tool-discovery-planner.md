# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-25
- Phase: 3/6 (Tooling and end-to-end wiring)
- Owner: tooling

## Scope

- Slice name: Tool discovery planner
- Target package or boundary: `tooling` (`@argentum/tooling`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/40-modules/tool-layer/tool-discovery.md](../../spec/40-modules/tool-layer/tool-discovery.md) — sole authority for provider-neutral discovery, narrowed per-step exposure, stable tool names, and the deferred all-tools-vs-curated default
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md) — registry metadata remains the source of truth for discovery inputs
  - [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md) — the prompt-compiler path in `@argentum/agentic_core` owns current-step tool-selection requests and attaches provider-neutral tool schemas to `LLMInferenceRequest`
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - `@argentum/tooling` exports a deterministic registry read seam such as `ToolRegistry.snapshotDefinitions(): readonly ToolDefinition[]` that returns canonical `ToolDefinition` values in registration order, plus a pure discovery seam such as `planToolExposure(snapshot, request): ToolExposurePlan` that derives the tools exposed for one inference step from that registry-owned snapshot.
  - The tooling-owned seam does not decide when a step should expose all tools versus an explicit subset. The prompt-compiler path in `@argentum/agentic_core` constructs `ToolExposureRequest` for the current step, and the same prompt-compiler path remains responsible for attaching the exposed provider-neutral tool schemas to `LLMInferenceRequest`.
  - `apps/runtime` may inject composition-time policy defaults or test-harness wiring into the prompt-compiler path, but it must not own per-step selection logic or construct `ToolExposureRequest` directly.
  - The discovery seam preserves registry-owned canonical tool definitions and stable tool names. It must not mutate tool schemas, rename tools, or create provider-specific copies.
  - The discovery seam supports two explicit caller-controlled modes only:
    - `mode = "all"` exposes every registered tool in deterministic registry order.
    - `mode = "explicit"` exposes only the caller-provided ordered subset of registered tool names and reports both registered-but-omitted names and requested-but-missing names deterministically.
  - `ToolExposurePlan` is explicit and deterministic:
    - `exposedTools: readonly ToolDefinition[]` preserves exposure order; for `mode = "all"` that is registry order, and for `mode = "explicit"` that is first-occurrence request order after duplicate collapse.
    - `omittedRegisteredToolNames: readonly string[]` lists registered tool names that remain in the registry snapshot but were not exposed for the step, preserving registry order.
    - `missingRequestedToolNames: readonly string[]` lists explicitly requested tool names not present in the registry snapshot, preserving first-occurrence request order after duplicate collapse.
  - Unknown requested tool names are reported deterministically through `missingRequestedToolNames`; they do not throw and do not cause hidden fallback exposure.
  - Duplicate requested tool names in `mode = "explicit"` are collapsed by first occurrence so one tool is never exposed twice and missing names are never reported twice.
  - The result includes both `omittedRegisteredToolNames` and `missingRequestedToolNames` so downstream prompt-compiler and telemetry slices can distinguish "registered but intentionally not exposed this step" from "requested but not registered."
  - The seam remains provider-neutral and registry-driven. It does not project provider-native tool schemas and does not decide prompt placement.
  - The slice does not resolve the deferred question of whether MVP should default to exposing all tools or a curated subset. Callers must choose the mode explicitly.
- Inputs crossing the boundary:
  - `readonly ToolDefinition[]` snapshot obtained from `ToolRegistry.snapshotDefinitions()` in registration order
  - `ToolExposureRequest` constructed by the prompt-compiler path in `@argentum/agentic_core` for the current step, describing `mode` and any explicit ordered tool-name subset
- Outputs crossing the boundary:
  - `ToolExposurePlan` containing deterministic `exposedTools`, `omittedRegisteredToolNames`, and `missingRequestedToolNames`
  - Public tooling discovery seam exported from `@argentum/tooling`; applying the resulting tool definitions to `LLMInferenceRequest` remains outside this slice

## Plan

- First contracts or interfaces to create:
  - `ToolRegistry.snapshotDefinitions(): readonly ToolDefinition[]`
  - `ToolExposureMode = "all" | "explicit"`
  - `ToolExposureRequest`
  - `ToolExposurePlan`
  - `planToolExposure(...)` or equivalent pure tooling entrypoint
- Minimal implementation steps:
  1. Add a deterministic registry snapshot API under `packages/tooling/src/registry.ts` that returns canonical definitions in registration order without exposing mutable registry internals.
  2. Add a tooling-local discovery module under `packages/tooling/src/` that consumes canonical `ToolDefinition` values from that snapshot.
  3. Define the request and result shapes in the tooling package without widening `@argentum/contracts`, including the exact `ToolExposurePlan` collections and ordering rules.
  4. Implement deterministic registry-order exposure for `mode = "all"`.
  5. Implement deterministic ordered-subset exposure for `mode = "explicit"`, including first-occurrence duplicate collapse, `omittedRegisteredToolNames`, and `missingRequestedToolNames`.
  6. Re-export the snapshot and discovery seams from `packages/tooling/src/index.ts`.
  7. Add focused tooling tests covering order preservation, omitted-versus-missing distinction, duplicate handling, and immutability.
  8. Keep any runtime or composition references limited to policy injection or test-harness wiring notes; do not move current-step request construction out of the prompt-compiler path.
- Required tests:
  - `mode = "all"` exposes all registered tools in deterministic registry order.
  - `mode = "explicit"` exposes only the requested ordered subset and preserves that order.
  - Registered-but-omitted tool names are reported in registry order separately from missing requested names.
  - Unknown requested tool names are reported deterministically through `missingRequestedToolNames` without throwing.
  - Duplicate requested tool names are collapsed by first occurrence and do not create duplicate exposure or duplicate missing-name entries.
  - Exposed `ToolDefinition` values remain structurally equal to the registry source definitions.
  - Empty explicit subsets yield an empty exposure plan without mutating registry state.
  - Repeated calls with identical inputs return structurally identical plans.
- Narrow validation step:
  - `pnpm --filter @argentum/tooling test -- tool-discovery`
  - `pnpm --filter @argentum/tooling build`

## Execution Strategy

- Autopilot suitability: safe. The slice is package-local, pure, deterministic, and does not resolve the deferred default-discovery policy.
- Parallel subagent opportunities:
  - Read-only spec checklist against [docs/spec/40-modules/tool-layer/tool-discovery.md](../../spec/40-modules/tool-layer/tool-discovery.md) and [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md).
- Out of scope:
  - Prompt-compiler ownership of current-step request construction or attachment of exposed tool schemas to `LLMInferenceRequest`
  - Prompt-compiler wiring
  - Provider-native schema projection
  - Telemetry emission
  - Tool-call execution
  - Any default curation heuristic beyond explicit caller choice
- Deferred decisions that must remain deferred:
  - Whether MVP defaults to exposing all tools each step or a curated subset
  - Any future discovery-tool UX beyond this provider-neutral planner

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - 2026-05-25 HIGH: The initial card left `ToolExposurePlan` under-specified and did not name the authoritative registry-read seam, so incompatible implementations could pass while bypassing the registry or conflating omitted and missing tool names.
  - 2026-05-25 MEDIUM: The initial card did not define duplicate-name behavior for explicit requests.
  - 2026-05-25 HIGH (follow-up review): Approval remained blocked until the card pinned current-step `ToolExposureRequest` construction to the prompt-compiler path in `@argentum/agentic_core`, with `apps/runtime` limited to composition-time wiring or test-harness setup rather than per-step selection logic.
  - 2026-05-25 MEDIUM (follow-up review): The repaired ownership regression in `packages/agentic_core/tests/prompt-compiler.test.ts` proved prompt-compiler-owned `ToolExposureRequest` forwarding only for `mode = "all"`, so the explicit-subset branch still lacked a regression proving forwarded request shape and narrowed `available_tools` ordering.
  - 2026-05-25 HIGH (implementation review): `ToolDefinition` normalization only shallow-froze top-level values, so nested `input_schema` and `defaults` plain-object data remained shared and mutable through `ToolRegistry.snapshotDefinitions()`, `planToolExposure(...).exposedTools`, and compiled `available_tools`.
- Refinements applied:
  - 2026-05-25 review refinement: Added `ToolRegistry.snapshotDefinitions()` as the deterministic registry-owned read seam and narrowed `planToolExposure()` to consume that snapshot rather than an ad hoc iterable.
  - 2026-05-25 review refinement: Defined `ToolExposurePlan` explicitly with `exposedTools`, `omittedRegisteredToolNames`, and `missingRequestedToolNames`, including ordering rules for each collection.
  - 2026-05-25 review refinement: Explicit-mode duplicate requested names now collapse by first occurrence, and focused tests now prove omitted-versus-missing distinction plus duplicate handling.
  - 2026-05-25 review refinement: Clarified ownership split so tooling owns registry-driven discovery primitives, while the prompt-compiler path in `@argentum/agentic_core` constructs the per-step request and attaches the resulting tool schemas to `LLMInferenceRequest`; `apps/runtime` is limited to composition-time wiring only.
  - 2026-05-25 approval review: Re-review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. The card is approved.
  - 2026-05-25 implementation: Added `ToolRegistry.snapshotDefinitions()`, the pure `planToolExposure()` seam plus local discovery contracts in `@argentum/tooling`, and focused deterministic tests for order preservation, duplicate collapse, omitted-versus-missing reporting, immutability, and repeated-call stability.
  - 2026-05-25 implementation validation: `pnpm --filter @argentum/tooling test -- tool-discovery` passed and `pnpm --filter @argentum/tooling build` completed cleanly.
  - 2026-05-25 implementation review: Post-validation adversarial review returned no CRITICAL, HIGH, MEDIUM, or LOW findings for the tooling discovery slice.
  - 2026-05-25 ownership repair implementation: Moved current-step `ToolExposureRequest` construction into `@argentum/agentic_core` by having `PromptCompiler` consume the registry snapshot, construct the default explicit `mode = "all"` request in the prompt-compiler path, call `planToolExposure(...)`, and attach the exposed schemas to `LLMInferenceRequest.available_tools`; `apps/runtime` now limits tooling composition to registration plus `snapshotDefinitions()` wiring.
  - 2026-05-25 ownership repair validation: `pnpm --filter @argentum/agentic-core test -- prompt-compiler`, `pnpm --filter @argentum/agentic-core test -- core-loop-orchestrator`, `pnpm --filter @argentum/runtime test -- tooling-composition`, `pnpm --filter @argentum/agentic-core build`, and `pnpm --filter @argentum/runtime build` all completed cleanly.
  - 2026-05-25 ownership repair review: Post-validation adversarial review found no HIGH, MEDIUM, or LOW implementation findings on the repaired ownership seam; the runtime-owned proof was replaced with an agentic-core regression proving the prompt-compiler path constructs the current-step exposure request and attaches the exposed `available_tools`.
  - 2026-05-25 HIGH (adversarial follow-up): `PromptCompiler` still hid the deferred all-tools default behind an internal fallback to `{ mode: "all" }` when composition injected no policy, so the ownership move landed without making the composition-time default choice explicit.
  - 2026-05-25 review refinement: Narrowed `PromptCompiler` to require an explicit composition-time discovery policy input, kept current-step `ToolExposureRequest` construction inside the prompt-compiler path, and wired `apps/runtime` to preserve shipped behavior by explicitly selecting `mode = "all"` at composition time.
  - 2026-05-25 review refinement: Added a focused `@argentum/agentic-core` prompt-compiler regression for the explicit-subset branch by instantiating `PromptCompiler` with an explicit composition-time policy, verifying the forwarded `ToolExposureRequest` shape via `planToolExposure(...)`, and asserting that `LLMInferenceRequest.available_tools` is narrowed to the requested subset in the same explicit order.
  - 2026-05-25 refinement validation: `pnpm --filter @argentum/agentic-core test -- prompt-compiler`, `pnpm --filter @argentum/agentic-core test -- core-loop-orchestrator`, `pnpm --filter @argentum/runtime test -- tooling-composition`, `pnpm --filter @argentum/agentic-core build`, and `pnpm --filter @argentum/runtime build` all completed cleanly after the explicit-subset regression was added.
  - 2026-05-25 refinement review: Post-validation adversarial re-review of the explicit-subset prompt-compiler regression found no CRITICAL, HIGH, MEDIUM, or LOW findings; the ownership seam is now covered for both the all-tools and explicit-subset composition-time policy branches.
  - 2026-05-25 review refinement: Repaired the remaining HIGH mutation leak at the canonical contract boundary by having `parseToolDefinition(...)` deep-clone and deep-freeze nested `input_schema` and `defaults` plain-object data before registry registration, preserving canonical registry-owned definitions without reopening exposure-policy ownership.
  - 2026-05-25 review refinement: Added focused regressions in `@argentum/tooling` and `@argentum/agentic_core` that attempt nested schema mutation through `snapshotDefinitions()`, `planToolExposure(...).exposedTools`, and compiled `available_tools`, then prove fresh registry reads remain unchanged.
  - 2026-05-25 refinement validation: `pnpm --filter @argentum/contracts test -- tool-definition`, `pnpm --filter @argentum/tooling test -- tool-discovery`, `pnpm --filter @argentum/tooling test -- registry`, `pnpm --filter @argentum/agentic-core test -- prompt-compiler`, `pnpm --filter @argentum/agentic-core test -- core-loop-orchestrator`, `pnpm --filter @argentum/runtime test -- tooling-composition`, `pnpm --filter @argentum/tooling build`, `pnpm --filter @argentum/agentic-core build`, and `pnpm --filter @argentum/runtime build` all completed cleanly after the deep-freeze repair.
  - 2026-05-25 refinement review: Post-validation adversarial re-review of the mutation-leak repair found no CRITICAL, HIGH, MEDIUM, or LOW findings; the remaining 0040 HIGH is closed.