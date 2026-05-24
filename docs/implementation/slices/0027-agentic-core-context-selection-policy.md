# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (adversarial review passed)
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core
- Execution readiness: ready-when-approved. This slice depends on `@argentum/contracts` for `ContextItem` (slice 0012), `TurnBudget` (slice 0007), and `ContentRef` (slice 0007). It does NOT depend on `EpisodicMemory` (slice 0025) — the selection policy operates on a plain `ContextItem[]` input. It does NOT depend on the prompt compiler (slice 0026) — the selector produces output that the compiler consumes, but the interfaces are independent. The `@argentum/agentic-core` package will have its `@argentum/contracts` dependency added by slice 0024.

## Scope

- Slice name: Agentic Core — Context Selection Policy
- Target package or boundary: `agentic_core` (`@argentum/agentic-core`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "Context compaction is inline in MVP"
  - [docs/spec/40-modules/agentic-layer/context-selection.md](../../spec/40-modules/agentic-layer/context-selection.md) — **sole authority** for context selection: selection order, priority rules, omission recording, budget respect
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md) — `ContextItem` shape including `layer`, `role`, `content_ref`, `token_estimate`, `retention`
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — `ContentRef` shape for omission references
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `TurnBudget` for token and step budget awareness
  - [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md) — cross-reference: compacted summaries are preferred over raw artifacts
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - **`ContextSelector` class exported** from `@argentum/agentic-core` with a single public method: `select(available: ContextItem[], budget: TurnBudget, options?: SelectionOptions): SelectionResult`.
  - **`SelectionOptions` type exported**: optional configuration bag:
    - `maxTokens?: number` — overrides `budget.max_tokens_per_step` for this selection (useful for testing)
    - `includeOmitted?: boolean` — if true, the `SelectionResult.omitted` array includes `OmissionRecord` entries for items that were available but not selected (default `true`)
  - **`SelectionResult` type exported**:
    - `selected: ContextItem[]` — ordered items chosen for the inference step (may be empty if no items fit budget)
    - `omitted: OmissionRecord[]` — items available but not selected, with reason (empty if `includeOmitted` is false)
    - `totalTokens: number` — sum of `token_estimate` for selected items (0 for missing estimates)
    - `budgetExhausted: boolean` — true if some items were omitted due to budget constraints
  - **`OmissionRecord` type exported**:
    - `contextId: string` — the `context_id` of the omitted item
    - `reason: OmissionReason` — why the item was omitted
    - `layer: string` — the `layer` of the omitted item (for diagnostics)
  - **`OmissionReason` union exported**: `"budget_exceeded" | "priority_filtered" | "layer_filtered"`
  - **Selection order per spec** (Section 1 of context-selection.md):
    1. Required system and bedrock items — ALWAYS selected first, never omitted for budget (they are mandatory)
    2. Current ingress and recent episodic items — selected in insertion order (newest first among episodic)
    3. Relevant compacted tool summaries — preferred over raw tool outputs
    4. Additional environment context — selected only if budget remains
  - **Bedrock priority rule**: Items with `layer === "bedrock"` or `layer === "system"` are mandatory and are placed FIRST in the output. They are never omitted for budget reasons — if bedrock+system items alone exceed the budget, the selector still includes them all and sets `budgetExhausted: true`. The caller (turn loop) is responsible for deciding how to handle this condition.
  - **Compact summary preference**: When both a `tool_summary`-layer item and a raw `episodic`-layer item reference the same tool result, the `tool_summary` item is selected and the raw item is omitted with reason `"priority_filtered"`. The selector detects this by matching `content_ref` values — if two items share the same `content_ref.ref_id`, the one with `layer === "tool_summary"` wins.
  - **Episodic ordering**: Episodic-layer items (`layer === "episodic"`) are selected in reverse insertion order (most recent first). The selector assumes the input array is in insertion order (oldest first) and reverses the episodic subset.
  - **Environment context last**: Items with `layer === "environment"` are selected only after all bedrock, system, episodic, and tool_summary items have been considered. They fill remaining budget.
  - **Layer filtering (audit 0011 M3)**: Items with a `layer` value not in the recognized set (`"bedrock"`, `"system"`, `"episodic"`, `"tool_summary"`, `"environment"`) are omitted with reason `"layer_filtered"`. This ensures only spec-defined layers participate in selection. The recognized set is determined by the canonical `ContextLayer` union from `@argentum/contracts`.
  - **Omission recording**: When `includeOmitted` is true (default), every item in `available` that was NOT selected appears in `omitted` with a `reason`. This ensures omitted-but-available context is recorded through references rather than silently lost, per spec.
  - **Token budget respect**: The selector tracks cumulative `token_estimate` and stops selecting when adding the next item would exceed the budget. Items with missing `token_estimate` are treated as having estimate 0 (they are always selected unless another rule filters them).
  - **Empty input**: If `available` is empty, `select()` returns `{ selected: [], omitted: [], totalTokens: 0, budgetExhausted: false }` — no error thrown.
  - **The module does NOT**:
    - Manage episodic memory (it consumes a plain array, not `EpisodicMemory`)
    - Call the prompt compiler (it produces output that the compiler consumes)
    - Enforce governor budget limits beyond token budget awareness
    - Perform retrieval over long-term vector memory (excluded by MVP constraints)
    - Use learned ranking models (excluded by MVP constraints)
    - Mutate input objects
- Inputs crossing the boundary:
  - `ContextItem[]` — all available context items (from episodic memory, bedrock store, environment)
  - `TurnBudget` — turn budget with `max_tokens_per_step` for token awareness
  - Optional `SelectionOptions` — overrides and behavior flags
- Outputs crossing the boundary:
  - `SelectionResult` — selected items, omission records, token total, budget flag
  - `ContextSelector` class exported from `@argentum/agentic-core`
  - `SelectionOptions` type exported
  - `SelectionResult` type exported
  - `OmissionRecord` type exported
  - `OmissionReason` type exported

## Plan

- First contracts or interfaces to create:
  - `OmissionReason` — union type: `"budget_exceeded" | "priority_filtered" | "layer_filtered"`
  - `OmissionRecord` — record of an omitted item with `contextId`, `reason`, `layer`
  - `SelectionOptions` — optional config bag
  - `SelectionResult` — output bag with `selected`, `omitted`, `totalTokens`, `budgetExhausted`
  - `ContextSelector` class — single-method selector
- Minimal implementation steps:
  1. Ensure `@argentum/contracts` is a workspace dependency in `packages/agentic_core/package.json` (added by slice 0024).
  2. Ensure `packages/agentic_core/tsconfig.json` references `../contracts` (added by slice 0024).
  3. Create `packages/agentic_core/src/context-selection.ts`:
     - Import `ContextItem`, `TurnBudget` from `@argentum/contracts`
     - Define and export `OmissionReason` type
     - Define and export `OmissionRecord` type
     - Define and export `SelectionOptions` type
     - Define and export `SelectionResult` type
     - Define and export `ContextSelector` class:
       - `select(available: ContextItem[], budget: TurnBudget, options?: SelectionOptions): SelectionResult`
       - Internal methods:
         - `selectMandatory(items)` — extracts bedrock + system items
         - `selectEpisodic(items, remainingBudget)` — selects episodic items newest-first
         - `selectToolSummaries(items, episodicSelected, remainingBudget)` — selects compacted summaries, filters raw duplicates
         - `selectEnvironment(items, remainingBudget)` — fills remaining budget with environment items
         - `recordOmission(item, reason)` — creates OmissionRecord
         - `tokenSum(items)` — computes total token estimate
  4. Update `packages/agentic_core/src/index.ts` to export all public symbols from `context-selection.ts`
- Required tests:
  - **Mandatory items always first**: Provide mix of bedrock, episodic, environment items. Assert `selected[0]` and `selected[1]` are the bedrock+system items, regardless of input order.
  - **Mandatory items never omitted**: Provide 10 bedrock items with large token estimates exceeding budget. Assert all 10 are in `selected` and `budgetExhausted` is `true`. No bedrock items in `omitted`.
  - **Episodic items newest first**: Provide 3 episodic items in insertion order (oldest first: `ep-1`, `ep-2`, `ep-3`). Assert they appear in `selected` as `ep-3`, `ep-2`, `ep-1` (newest first).
  - **Tool summary preferred over raw duplicate**: Provide a `tool_summary` item and an `episodic` item with the same `content_ref.ref_id`. Assert only the `tool_summary` item is selected; the `episodic` item is omitted with reason `"priority_filtered"`.
  - **Tool summary with unique ref_id**: Provide a `tool_summary` item with a `ref_id` that does NOT match any episodic item. Assert it is selected as a tool summary (not filtered).
  - **Environment context selected last**: Provide bedrock, episodic, tool_summary, and environment items. Assert all environment items appear after all non-environment items in `selected`.
  - **Environment context fills remaining budget**: Provide bedrock (10 tokens), episodic (50 tokens), environment items (20, 30, 40 tokens). Budget: 100 tokens. Assert bedrock (10) + episodic (50) = 60 used. First environment item (20) fits → 80 used. Second (30) would exceed → omitted with `"budget_exceeded"`. Third (40) also omitted.
  - **Budget respect with token estimates**: Provide items with known `token_estimate` values. Budget: 50. Assert items stop being selected when cumulative estimate would exceed 50.
  - **Zero-estimate items always selected**: Provide items with `token_estimate: 0` or missing `token_estimate`. Assert they are always selected (don't count against budget).
  - **Omission recording — budget**: Items omitted due to budget have `reason: "budget_exceeded"`.
  - **Omission recording — priority**: Items omitted due to summary preference have `reason: "priority_filtered"`.
  - **Omission recording disabled**: Provide `includeOmitted: false`. Assert `omitted` is an empty array.
  - **Empty input**: Provide `available: []`. Assert `selected` is empty, `omitted` is empty, `totalTokens: 0`, `budgetExhausted: false`.
  - **All items fit**: Provide items whose total token estimate is under budget. Assert all items are selected, `budgetExhausted: false`, no omissions.
  - **Immutability — input not mutated**: Call `select()` then assert the input array and its objects are not mutated.
  - **Deterministic output**: Call `select()` twice with identical inputs. Assert deep equality of both results.
  - **Layer filtering**: Items with `layer` outside the recognised set `{bedrock, system, episodic, tool_summary, environment}` are omitted with reason `"layer_filtered"`. The recognised set mirrors the `ContextLayer` union from `@argentum/contracts`. Test with `layer: "custom_unknown"`.
  - **Ingress prioritization**: Provide episodic items with mixed `origin` values (some matching `/ingress/i`, some not). Assert ingress-origin items appear before non-ingress items in `selected`, with newest-first ordering within each group.
  - **No budget enforcement**: Provide a `TurnBudget` without `max_tokens_per_step` and no `maxTokens` option. Assert all items are selected and `budgetExhausted` is `false`.
  - **Round-trip validity**: Call `select()` then pass `result.selected` through `parseContextItemArray` from `@argentum/contracts`. Assert no validation error is thrown.
- Narrow validation step:
  - `pnpm --filter @argentum/agentic-core test`
  - `pnpm typecheck`
  - `pnpm --filter @argentum/agentic-core build`

## Execution Strategy

- Autopilot suitability: **safe**. The slice is a pure selection algorithm with deterministic outputs. No external I/O, no cross-package wiring, no persistence. All input types are already validated in `@argentum/contracts`. The selection rules are explicitly defined in the spec with unambiguous ordering, priority, and budget semantics. Implementation is ~200 lines of pure functions plus ~250 lines of focused tests.
- Parallel subagent opportunities:
  - **Read-only spec cross-reference** (safe for parallel subagent): Verify that the selection rules in this slice card exactly match `docs/spec/40-modules/agentic-layer/context-selection.md` and flag any discrepancies.
  - **Read-only contract dependency audit** (safe for parallel subagent): Verify that `@argentum/contracts` exports `ContextItem`, `TurnBudget`, and `ContentRef` with the shapes expected by the selector.
  - **Read-only parallel with slice 0026** (safe): The context selector and prompt compiler have no mutual dependencies — they can be implemented in parallel by separate subagents.
- Out of scope:
  - Episodic memory management (the selector consumes a plain array, not the `EpisodicMemory` store)
  - Prompt compilation (slice 0026)
  - Bedrock retrieval (the selector receives bedrock items in the `available` array; it does not fetch them)
  - Governor budget enforcement beyond token budget awareness
  - Long-term vector memory retrieval (excluded by MVP constraints)
  - Learned ranking models (excluded by MVP constraints)
  - Any I/O, file system, or network access
- Deferred decisions that must remain deferred:
  - No learned ranking model for context selection — explicitly excluded by MVP constraints in spec
  - No retrieval over long-term vector memory — explicitly excluded by MVP constraints in spec
  - Exact token estimation strategy (using `token_estimate` field as-is) — model-specific tokenizers deferred

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **C1 (resolved)**: `TurnBudget.max_tokens_per_step` is optional. Selector uses `budget.max_tokens_per_step` for enforcement; when absent, all items are selected (no budget enforcement). Test: "selects all items when no budget is configured".
  - **H1 (resolved) — layer_filtered**: Items with layer outside the recognised set `{bedrock, system, episodic, tool_summary, environment}` are omitted with reason `"layer_filtered"`. Test: "omits items with unrecognised layer with reason layer_filtered". Note: this overrides the original slice card's "treat as episodic fallback" — unknown layers are now explicitly filtered per adversarial review.
  - **H2 (resolved) — ingress prioritisation**: Episodic items with `origin` matching `/ingress/i` are selected before other episodic items, regardless of insertion order. Within each group (ingress / non-ingress), items are ordered newest-first. Test: "prioritises ingress-origin episodic items before other episodic items".
  - **H3 (resolved) — parseContextItemArray round-trip**: `result.selected` items survive a `parseContextItemArray` call without validation errors. Test: "produces selected items that survive a parseContextItemArray round-trip".
  - **MEDIUM — compact-fallback gap**: When an episodic item matches a tool_summary by `ref_id`, the episodic item is unconditionally omitted with `"priority_filtered"` even if the tool_summary later fails budget. Both items can be lost. The spec does not define a fallback; this is noted for future enhancement but is correct per current spec.
  - **LOW — OmissionRecord.layer typed as `string`**: To accommodate `"layer_filtered"` items with unrecognised layer values, `OmissionRecord.layer` is `string` rather than the narrower `ContextLayer` union. This is intentional for diagnostics.
- Refinements applied:
  - Created `packages/agentic_core/src/context-selector.ts` (~170 lines) with `ContextSelector` class and all five exported types.
  - Updated barrel `packages/agentic_core/src/index.ts` with exports for `ContextSelector`, `OmissionReason`, `OmissionRecord`, `SelectionOptions`, `SelectionResult`.
  - Created `packages/agentic_core/tests/context-selector.test.ts` with 33 tests covering all acceptance criteria and adversarial review findings.
  - Fixed `locator` in test helpers from absolute (`/ctx/...`) to relative (`ctx/...`) to satisfy `ContentRef` validation in round-trip test.
- Validation results:
  - `pnpm --filter @argentum/agentic-core test`: **208 passed** (33 new + 175 existing), 0 failed.
  - `pnpm typecheck`: passed (exit code 0).
  - `pnpm --filter @argentum/agentic-core build`: passed (exit code 0).
