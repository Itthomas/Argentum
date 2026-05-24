# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (via orchestrator delegation)
- Approval date: 2026-05-24
- Phase: 4 (Agentic Core)
- Owner: agentic_core
- Execution readiness: implemented-and-validated. This slice depends on `@argentum/contracts` for `ToolResultDTO` (slice 0014), `ContextItem` (slice 0012), and `ContentRef` (slice 0007). It defines an `ArtifactExternalizer` interface that the `@argentum/environment` package will implement via `storeToolArtifact` (slice 0022). The compaction policy itself is a pure decision-engine module — it does not perform filesystem I/O. The `@argentum/agentic-core` package will have its `@argentum/contracts` dependency added by slice 0024.

## Scope

- Slice name: Agentic Core — Compaction Policy
- Target package or boundary: `agentic_core` (`@argentum/agentic-core`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include "Context compaction is inline in MVP" and "Bedrock files are immutable in MVP"
  - [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md) — **sole authority** for compaction: when it runs, outcomes (small/large/error), rules, revision tracking
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — cross-reference: after MVP `tool_calls` compaction, always returns to `building_context`; compaction runs between `executing_tools` and `building_context`
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md) — `ToolResultDTO` shape with `human_summary`, `artifact_refs`, `truncated`, `status`, `structured_payload_ref`
  - [docs/spec/20-contracts/context-item.md](../../spec/20-contracts/context-item.md) — `ContextItem` shape for committed compaction output
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — `ContentRef` shape for externalized artifact references
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `compaction_revision` field that must be incremented
  - [docs/spec/40-modules/agentic-layer/episodic-memory.md](../../spec/40-modules/agentic-layer/episodic-memory.md) — cross-reference: compacted tool summaries are stored in episodic memory; raw tool artifacts are referenced rather than stored inline
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "compaction tests proving raw outputs are externalized when needed"
- Acceptance criteria:
  - **`CompactionPolicy` class exported** from `@argentum/agentic-core` with a single public method: `compact(result: ToolResultDTO, currentRevision: number, externalizer?: ArtifactExternalizer): Promise<CompactionResult>`. The `currentRevision` is the turn's current `compaction_revision` (default 0 if omitted by caller). The `externalizer` is optional — when absent, `"externalized"` disposition will throw (the caller must provide one for externalization to work; tests use a mock). **Note (Audit 0011 H5)**: This signature differs from the originally planned `compact(result, externalizer, options?)`. The implementation signature is authoritative.
  - **`ArtifactExternalizer` interface exported**: a single-method interface that the environment package will implement:
    - `store(callId: string, content: string): Promise<ContentRef>` — writes content to artifact storage and returns a `ContentRef` reference. The `callId` matches the tool call ID. **Note (Audit 0011 H5/M2)**: The method name is `store`, not `externalize`. Integration with `@argentum/environment`'s `storeToolArtifact()` will require a thin adapter shim (the environment function has additional `artifactsRoot`, `kind`, and `suffix` parameters that must be supplied by the adapter).
  - **`CompactionOptions` type exported**: optional configuration bag:
    - `sizeThresholdBytes?: number` — the byte-size threshold above which a result is considered "large" and must be externalized. Default: 4096 (4 KiB). This is a reasonable MVP default; exact thresholds are deferred per `docs/spec/70-roadmap/deferred-decisions.md`.
  - **`CompactionResult` type exported**:
    - `contextItem: ContextItem` — the compacted representation for episodic memory (layer `"tool_summary"`)
    - `externalizedRefs: ContentRef[]` — `ContentRef` references to externalized raw artifacts (empty if nothing externalized)
    - `newRevision: number` — the incremented `compaction_revision` (only incremented when memory-affecting changes are committed; see revision rules below)
    - `disposition: CompactionDisposition` — what action was taken
  - **`CompactionDisposition` union exported**: `"inline" | "externalized" | "error_summary"`
  - **Three compaction outcomes per spec**:
    1. **Small result (`"inline"`)**: The `ToolResultDTO.human_summary` is short enough to keep inline. The policy creates a `ContextItem` with:
       - `layer: "tool_summary"`
       - `content_ref` pointing to the human_summary text (using a generated `ContentRef` with `kind: "text"`, `storage_area: "working"`)
       - `origin: "compaction"`
       - `retention: "rolling"`
       - `token_estimate` derived from summary length
       - The original `artifact_refs` from the `ToolResultDTO` are preserved in the `ContextItem`'s metadata (not as separate entries — the `content_ref` is the primary reference)
    2. **Large result (`"externalized"`)**: The raw output exceeds the threshold. The policy:
       - Calls `externalizer.store(callId, humanSummary)` to persist the summary to artifacts
       - Creates a concise summary from `human_summary` (truncated if needed to fit under threshold)
       - Creates a `ContextItem` with `layer: "tool_summary"`, `content_ref` pointing to the summary, and the externalized `ContentRef` in `externalizedRefs`
    3. **Error result (`"error_summary"`)**: The tool result `status` is `"error"` or `"blocked"`. The policy:
       - Creates a concise failure summary from `human_summary` and `error_code`
       - Includes diagnostic `artifact_refs` from the `ToolResultDTO` if available
       - Does NOT externalize (error outputs are typically short)
       - Creates a `ContextItem` with `layer: "tool_summary"`, `retention: "rolling"`
  - **Size threshold logic**: The policy measures the `human_summary` string length (in UTF-8 bytes via `Buffer.byteLength`). If > `sizeThresholdBytes`, the result is "large." If `truncated` is already `true` on the `ToolResultDTO`, the result is treated as "large" regardless of `human_summary` length — the tool already signaled truncation.
  - **Compaction revision increment rules**: `newRevision` = `currentRevision + 1` ONLY when:
    - Externalization occurs (new artifacts written) — always increments
    - A new summary `ContextItem` is produced that differs from the raw `human_summary` — increments
    - Error summary differs from raw `human_summary` — increments
    - If the result is small and the `human_summary` is used verbatim (no changes), `newRevision` = `currentRevision` (no increment — memory did not meaningfully change). This preserves the spec rule: "Compaction increments `TurnEnvelope.compaction_revision` whenever committed memory changes."
  - **Deterministic context_id**: The produced `ContextItem.context_id` is derived from `call_id` with a `"compaction:"` prefix — e.g., `"compaction:tool-call-001"`. This ensures stable, reproducible IDs for testing.
  - **Raw artifacts remain inspectable**: Externalized artifacts get a `ContentRef` with `storage_area: "artifacts"` — the raw output is available outside episodic memory via the artifact store.
  - **The module does NOT**:
    - Write to disk (delegated to `ArtifactExternalizer`)
    - Manage episodic memory (returns a `ContextItem` for the caller to commit)
    - Advance the turn state machine (caller owns state transitions)
    - Call an LLM for summarization (MVP uses rule-based truncation of `human_summary`)
    - Perform background summarization (excluded by MVP constraints)
    - Mutate input `ToolResultDTO`
- Inputs crossing the boundary:
  - `ToolResultDTO` — the tool execution result to compact
  - `ArtifactExternalizer` — interface for externalizing large outputs (implemented by `@argentum/environment`)
  - Optional `CompactionOptions` — size threshold override, current revision
- Outputs crossing the boundary:
  - `CompactionResult` — compacted `ContextItem`, externalized refs, new revision, disposition
  - `CompactionPolicy` class exported from `@argentum/agentic-core`
  - `ArtifactExternalizer` interface exported from `@argentum/agentic-core`
  - `CompactionOptions` type exported
  - `CompactionResult` type exported
  - `CompactionDisposition` type exported
  - `DEFAULT_COMPACTION_THRESHOLD_BYTES` constant exported (4096)

## Plan

- First contracts or interfaces to create:
  - `ArtifactExternalizer` interface — single-method contract for artifact I/O
  - `CompactionOptions` type — optional configuration
  - `CompactionDisposition` union — `"inline" | "externalized" | "error_summary"`
  - `CompactionResult` type — output bag
  - `CompactionPolicy` class — decision engine
- Minimal implementation steps:
  1. Ensure `@argentum/contracts` is a workspace dependency in `packages/agentic_core/package.json` (added by slice 0024).
  2. Ensure `packages/agentic_core/tsconfig.json` references `../contracts` (added by slice 0024).
  3. Create `packages/agentic_core/src/compaction-policy.ts`:
     - Import `ToolResultDTO`, `ContextItem`, `ContentRef`, `ContentRefKind` from `@argentum/contracts`
     - Import `randomUUID` from `node:crypto`
     - Import `Buffer` from `node:buffer` (for byte-length measurement)
     - Define and export `DEFAULT_COMPACTION_THRESHOLD_BYTES = 4096`
     - Define and export `ArtifactExternalizer` interface
     - Define and export `CompactionDisposition` type
     - Define and export `CompactionOptions` type
     - Define and export `CompactionResult` type
     - Define and export `CompactionPolicy` class:
       - `async compact(result: ToolResultDTO, currentRevision: number, externalizer?: ArtifactExternalizer): Promise<CompactionResult>`
       - Internal methods:
         - `isLarge(result, threshold)` — checks size or `truncated` flag
         - `isError(result)` — checks `status === "error" || status === "blocked"`
         - `measureBytes(text)` — returns `Buffer.byteLength(text, "utf-8")`
         - `createContextItem(callId, summary, layer, origin, retention)` — factory for ContextItem
         - `createContentRef(refId, kind, storageArea, locator)` — factory for ContentRef
         - `computeRevision(currentRevision, disposition, summaryChanged)` — revision increment logic
  4. Update `packages/agentic_core/src/index.ts` to export all public symbols from `compaction-policy.ts`
- Required tests:
  - **Small result — inline disposition**: Provide `ToolResultDTO` with `human_summary: "Short result"` (12 bytes, under 4096 threshold). Assert `disposition === "inline"`, `externalizedRefs` is empty, `contextItem.layer === "tool_summary"`.
  - **Small result — human_summary preserved**: Assert the produced `ContextItem.content_ref` resolves to the `human_summary` text (the `human_summary` is used verbatim when small).
  - **Small result — no revision increment**: Provide `currentRevision: 5`. Since summary is used verbatim (no changes), assert `newRevision === 5` (no increment).
  - **Large result — externalized disposition**: Provide `human_summary` that is 5000 bytes (> 4096 threshold). Assert `disposition === "externalized"`.
  - **Large result — externalizer called**: Provide a mock `ArtifactExternalizer`. Assert `externalizer.externalize()` is called exactly once with the `call_id`, the raw content, and the expected `kind`.
  - **Large result — externalized refs populated**: Assert `externalizedRefs` contains the `ContentRef` returned by the mock externalizer.
  - **Large result — revision increments**: Provide `currentRevision: 5`. Since externalization occurs, assert `newRevision === 6`.
  - **Truncated flag forces large**: Provide `truncated: true` with a short `human_summary: "OK"` (well under threshold). Assert `disposition === "externalized"` — the tool already signaled truncation, so the policy treats it as large regardless of summary length.
  - **Error result — error_summary disposition**: Provide `status: "error"`, `error_code: "E_TIMEOUT"`, `human_summary: "Tool timed out"`. Assert `disposition === "error_summary"`.
  - **Error result — includes error_code**: Assert the produced `ContextItem`'s content (in the `content_ref`) includes the `error_code` value.
  - **Error result — no externalization**: Assert `externalizedRefs` is empty (errors are short, no externalization needed).
  - **Error result — revision increments**: Provide `currentRevision: 5`. Error summary differs from raw `human_summary` (failure context added). Assert `newRevision === 6`.
  - **Blocked result — error_summary disposition**: Provide `status: "blocked"`. Assert `disposition === "error_summary"` (blocked is treated as an error outcome for compaction purposes).
  - **Custom threshold**: Provide `CompactionOptions.sizeThresholdBytes: 100`. Provide `human_summary` of 200 bytes. Assert `disposition === "externalized"` (overrides default).
  - **Exact threshold boundary**: Provide `human_summary` of exactly 4096 bytes. Assert `disposition === "inline"` (threshold is "greater than", not "greater than or equal").
  - **Zero-length summary**: Provide `human_summary: ""`. Assert `disposition === "inline"`, no error thrown.
  - **Deterministic context_id**: Call `compact()` for `call_id: "tool-abc"`. Assert `contextItem.context_id === "compaction:tool-abc"`.
  - **Artifact externalizer failure propagation**: Mock `externalizer.externalize()` to throw. Assert `compact()` rejects with the same error (no silent swallowing).
  - **Immutability — input not mutated**: Call `compact()` then assert the input `ToolResultDTO` object is not mutated.
  - **Revision never decrements**: For all dispositions, assert `newRevision >= currentRevision`.
  - **Multiple calls independent**: Call `compact()` twice with the same input. Assert both results are deeply equal (deterministic output).
- Narrow validation step:
  - `pnpm --filter @argentum/agentic-core test`
  - `pnpm typecheck`
  - `pnpm --filter @argentum/agentic-core build`

## Execution Strategy

- Autopilot suitability: **safe**. The slice is a pure decision-engine module with no filesystem I/O (delegated to the `ArtifactExternalizer` interface). The compaction rules are explicitly defined in the spec with three clear outcomes and deterministic revision semantics. All input types (`ToolResultDTO`, `ContextItem`, `ContentRef`) are already validated in `@argentum/contracts`. Implementation is ~200 lines plus ~250 lines of focused tests. The `ArtifactExternalizer` interface is defined but not implemented — the mock in tests is trivial.
- Parallel subagent opportunities:
  - **Read-only spec cross-reference** (safe for parallel subagent): Verify that the compaction rules in this slice card exactly match `docs/spec/30-core-loop/compaction-policy.md` and flag any discrepancies.
  - **Read-only contract dependency audit** (safe for parallel subagent): Verify that `@argentum/contracts` exports `ToolResultDTO`, `ContextItem`, `ContentRef`, and `ContentRefKind` with the shapes expected by the compaction policy.
  - **Read-only parallel with slices 0026 and 0027** (safe): The compaction policy, context selector, and prompt compiler have no mutual implementation dependencies — all three can be implemented in parallel by separate subagents.
- Out of scope:
  - Filesystem I/O (delegated to `ArtifactExternalizer`; implemented by `@argentum/environment` slice 0022)
  - Episodic memory writes (caller commits the returned `ContextItem`)
  - Turn state machine transitions (caller owns advancing from `compacting` to `building_context`)
  - LLM-based summarization (MVP uses rule-based truncation)
  - Background summarization worker (excluded by MVP constraints)
  - Automatic long-term memory writeback (excluded by MVP constraints)
  - Bedrock mutation or compaction of bedrock content
  - Provider-specific compaction strategies
- Deferred decisions that must remain deferred:
  - Exact size thresholds — deferred in `docs/spec/70-roadmap/deferred-decisions.md`. This slice uses a configurable default (4096 bytes) that can be overridden via `CompactionOptions.sizeThresholdBytes`.
  - Exact summarization strategy for large results — MVP uses rule-based truncation of `human_summary`; LLM-based summarization is a post-MVP concern.
  - Whether compaction summaries can mutate bedrock-like instructions — spec says this is a drift risk to avoid; the policy does not touch bedrock items.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **MEDIUM (API signature deviation from slice card)**: The `compact()` method signature is `compact(result, currentRevision, externalizer?)` — with `currentRevision` as second positional param and `externalizer` as optional third. The slice card specified `compact(result, externalizer, options?)`. The user's explicit implementation instructions requested this signature. The environment package (slice 0022) and any callers must use this signature.
  - **MEDIUM (Interface method name deviation)**: The `ArtifactExternalizer` interface uses `store(callId, content)` while the slice card specified `externalize(callId, content, kind?, suffix?)`. The user explicitly requested `store`. Integration with the environment package (slice 0022) requires the environment to implement `store` rather than `externalize`.
  - **LOW (ContentRef does not embed summary text)**: For inline and error dispositions, the returned `ContextItem.content_ref` uses `locator=callId` as a storage key. The actual summary text is not embedded in the `ContentRef` — the caller (episodic memory) is responsible for storing the summary keyed by this locator. This is consistent with the compaction policy being a pure decision engine that delegates I/O.
  - **LOW (Token estimate heuristic)**: Uses `Math.ceil(byteLength / 4)` as a rough token-count estimate for English text. Adequate for MVP; a more accurate tokenizer would be a post-MVP concern.
  - **LOW (Truncation suffix budget)**: The `"..."` truncation suffix (3 bytes) is reserved from the byte budget before truncation, ensuring the final summary stays within the threshold. Verified by tests.
- Refinements applied:
  - Fixed `buildExternalSummary` to reserve 3 bytes for the `"..."` suffix, preventing the truncated summary from exceeding the byte threshold.
  - All 38 compaction tests pass; 139 total agentic_core tests pass.
  - `pnpm typecheck` and `pnpm build` pass cleanly.
- **Card status updated to implemented 2026-05-24** (was stale at "planned" — see audit 0011 H4).
- **Audit 0011 H5**: API signature deviation (`externalizer` moved to optional third param, `currentRevision` added as second positional param, interface method `store()` not `externalize()`) — **RESOLVED 2026-05-24**: Card acceptance criteria updated to match implementation. The implementation signature is authoritative.
