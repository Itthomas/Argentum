# Implementation Audit — Slices 0028–0038 Deep Audit

## Metadata

- **Audit scope**: Slices 0028 through 0038, plus current workflow state in `docs/implementation/backlog.md`
- **Cluster**: Phase 4 agentic core (0028–0030, 0034), Phase 5 LLM provider (0031–0033), Phase 6 CLI channel (0035–0036), Phase 6/7 runtime composition (0037), Phase 7 telemetry (0038)
- **Auditor**: GitHub Copilot (argentum-implementation-auditor)
- **Audit date**: 2026-05-24
- **Audit type**: Deep comprehensive — implementation-vs-spec comparison, cross-slice integration audit, validation-rigor review, planning-artifact freshness review, and deferred-decision leakage scan
- **Prior audits**: [0015-slices-0028-0038-comprehensive-audit.md](./0015-slices-0028-0038-comprehensive-audit.md), [0014-slices-0030-0038-deep-audit.md](./0014-slices-0030-0038-deep-audit.md), [0011-slices-0020-0029-deep-audit.md](./0011-slices-0020-0029-deep-audit.md)
- **Repo readiness verdict**: `not-ready`

**Note**: This audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow.

---

## Sources Reviewed

### Governing spec files (authoritative)

- [docs/spec/README.md](../../spec/README.md)
- [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md)
- [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md)
- [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md)
- [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
- [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md)
- [docs/spec/40-modules/llm-provider/provider-normalization.md](../../spec/40-modules/llm-provider/provider-normalization.md)
- [docs/spec/40-modules/llm-provider/deepseek-adapter-mvp.md](../../spec/40-modules/llm-provider/deepseek-adapter-mvp.md)
- [docs/spec/40-modules/channel-cli/cli-adapter-mvp.md](../../spec/40-modules/channel-cli/cli-adapter-mvp.md)
- [docs/spec/40-modules/channel-cli/terminal-rendering.md](../../spec/40-modules/channel-cli/terminal-rendering.md)
- [docs/spec/40-modules/gateway/telemetry.md](../../spec/40-modules/gateway/telemetry.md)
- [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
- [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)

### Implementation files reviewed

- `packages/agentic_core/src/compaction-policy.ts`
- `packages/agentic_core/src/turn-governor.ts`
- `packages/agentic_core/src/validation-repair.ts`
- `packages/agentic_core/src/core-loop-orchestrator.ts`
- `packages/agentic_core/src/prompt-compiler.ts`
- `packages/agentic_core/src/episodic-memory.ts`
- `packages/agentic_core/src/turn-state-machine.ts`
- `packages/llm_provider/src/llm-provider.ts`
- `packages/llm_provider/src/tool-schema-projection.ts`
- `packages/llm_provider/src/content-resolver.ts`
- `packages/llm_provider/src/deepseek-adapter.ts`
- `packages/channel_cli/src/cli-input-normalizer.ts`
- `packages/channel_cli/src/terminal-renderer.ts`
- `packages/telemetry/src/telemetry-writer.ts`
- `packages/gateway/src/gateway-facade.ts`
- `packages/environment/src/artifact-store.ts`
- `apps/runtime/src/composition-root.ts`
- `apps/runtime/src/mock-llm-provider.ts`
- `apps/runtime/package.json`
- `apps/runtime/tsconfig.json`

### Test files reviewed

- `packages/agentic_core/tests/compaction-policy.test.ts`
- `packages/agentic_core/tests/turn-governor.test.ts`
- `packages/agentic_core/tests/validation-repair.test.ts`
- `packages/agentic_core/tests/core-loop-orchestrator.test.ts`
- `packages/llm_provider/tests/llm-provider.test.ts`
- `packages/llm_provider/tests/tool-schema-projection.test.ts`
- `packages/llm_provider/tests/deepseek-adapter.test.ts`
- `packages/channel_cli/tests/cli-input-normalizer.test.ts`
- `packages/channel_cli/tests/terminal-renderer.test.ts`
- `packages/telemetry/tests/telemetry-writer.test.ts`
- `apps/runtime/tests/e2e-happy-path.test.ts`
- `apps/runtime/tests/runtime-bootstrap.test.ts`

### Slice cards reviewed

- [0028-agentic-core-compaction-policy.md](../slices/0028-agentic-core-compaction-policy.md)
- [0029-agentic-core-turn-governor.md](../slices/0029-agentic-core-turn-governor.md)
- [0030-agentic-core-validation-repair-policy.md](../slices/0030-agentic-core-validation-repair-policy.md)
- [0031-llm-provider-abstraction-interface.md](../slices/0031-llm-provider-abstraction-interface.md)
- [0032-llm-provider-tool-schema-projection.md](../slices/0032-llm-provider-tool-schema-projection.md)
- [0033-llm-provider-deepseek-adapter.md](../slices/0033-llm-provider-deepseek-adapter.md)
- [0034-agentic-core-core-loop-orchestrator.md](../slices/0034-agentic-core-core-loop-orchestrator.md)
- [0035-channel-cli-input-normalization.md](../slices/0035-channel-cli-input-normalization.md)
- [0036-channel-cli-terminal-rendering.md](../slices/0036-channel-cli-terminal-rendering.md)
- [0037-runtime-composition-root-e2e-happy-path.md](../slices/0037-runtime-composition-root-e2e-happy-path.md)
- [0038-telemetry-event-persistence.md](../slices/0038-telemetry-event-persistence.md)

### Workflow artifacts reviewed

- [docs/implementation/backlog.md](../backlog.md)
- [docs/implementation/audits/0015-slices-0028-0038-comprehensive-audit.md](./0015-slices-0028-0038-comprehensive-audit.md)

---

## Implementation Status Summary

| Slice | Package | Code State | Card State | Audit Summary |
| --- | --- | --- | --- | --- |
| 0028 | agentic_core | Implemented | implemented | Internally solid, but downstream integration seam remains incomplete |
| 0029 | agentic_core | Implemented | implemented | Internally aligned with spec and card |
| 0030 | agentic_core | Implemented | validated | Internally aligned, but its output is not resolvable by the real provider path |
| 0031 | llm_provider | Implemented | validated | Aligned |
| 0032 | llm_provider | Implemented | validated | Aligned |
| 0033 | llm_provider | Implemented | validated | Aligned in isolation; blocked by unresolved content-resolution wiring |
| 0034 | agentic_core | Implemented | validated | Real tool-result and provider integration seams remain incomplete |
| 0035 | channel_cli | Implemented | validated | Aligned |
| 0036 | channel_cli | Implemented | validated | Aligned in code; approval metadata incomplete |
| 0037 | apps/runtime | Implemented | validated | Significant drift from its own acceptance criteria and cross-slice wiring goals |
| 0038 | telemetry | Implemented | implemented (pending validation) | Implementation exists, but approval/validation state is stalled and runtime does not compose it |

---

## Findings By Severity

### HIGH

- **H1 — Slice 0037 violates session-scoped memory ownership by composing one placeholder `EpisodicMemory` for all sessions**

  `startRuntime()` creates a single `EpisodicMemory` with a sentinel session ID (`"00000000-0000-0000-0000-000000000000"`) and injects that one instance into a single exported orchestrator. This directly contradicts the slice 0037 card, which requires one `EpisodicMemory` per resolved session using the gateway-provided `session_id`. The composition root comment explicitly acknowledges this is a placeholder rather than the intended per-session wiring.

  **Evidence**:
  - `apps/runtime/src/composition-root.ts` creates `placeholderSessionId` and `new EpisodicMemory(placeholderSessionId)`.
  - The returned `RuntimeContext` exposes a single orchestrator instance, not a per-session orchestrator or orchestrator factory.
  - The E2E tests never execute a second session through the orchestrator; they only prove second-session admission at the gateway boundary.

  **Impact**: Cross-session context contamination risk. Any future multi-session runtime use would share one episodic memory store across sessions, violating state ownership and making context selection non-deterministic across users.

- **H2 — Slice 0037 does not actually compose the CLI and telemetry seams it claims to validate**

  The runtime composition root does not import or wire `normalizeCliInput`, `renderStreamEvent`, or `TelemetryWriter`. The runtime package also omits `@argentum/telemetry` from both `apps/runtime/package.json` and `apps/runtime/tsconfig.json`. The happy-path E2E test bypasses the CLI boundary by hand-constructing `message_parts` and bypasses rendering by asserting `final_outcome` directly on the envelope.

  This drifts from both the slice 0037 acceptance criteria and the implementation test strategy, which call for an end-to-end happy path from CLI ingress to rendered output. It also leaves slice 0038 unconsumed by the runtime despite being in the audited implementation range.

  **Evidence**:
  - No runtime source usage of `normalizeCliInput`, `renderStreamEvent`, or `TelemetryWriter` was found.
  - `apps/runtime/package.json` and `apps/runtime/tsconfig.json` include `channel_cli` but omit `telemetry`.
  - `apps/runtime/tests/e2e-happy-path.test.ts` hand-builds ingress payloads and asserts `finalEnvelope.final_outcome` instead of proving CLI normalization or terminal rendering behavior.
  - `RuntimeContext.shutdown()` only closes the gateway; it does not flush telemetry.

  **Impact**: The claimed slice 0037 + 0038 integration has not happened. The current E2E signal is materially weaker than the card and spec imply, and runtime observability wiring remains absent.

- **H3 — The real-provider integration path is not executable because `ContextItem.content_ref` values have no backing content store or resolver wiring**

  Multiple implemented slices create `ContextItem` entries that contain only `ContentRef` metadata and a locator, but no corresponding text is persisted anywhere that the real provider adapter can resolve:

  - slice 0028 compaction creates inline, summary, and error `ContentRef` locators
  - slice 0030 validation-repair creates repair feedback `ContentRef` locators
  - slice 0034 stores response and abort context using `ContentRef` locators
  - slice 0037 seeds a boot `ContextItem` with a `ContentRef` locator

  Meanwhile, the real DeepSeek adapter requires a `ContentResolver` and calls `resolveContent(item.content_ref)` for each selected context item. The composition root does not wire a resolver, and there is no storage layer for these working-memory text locators.

  **Evidence**:
  - `packages/agentic_core/src/compaction-policy.ts` creates `content_ref` values via `makeContentRef(...)`; only the externalized raw content path persists anything, and only through `externalizer.store(callId, humanSummary)`.
  - `packages/agentic_core/src/validation-repair.ts` and `packages/agentic_core/src/core-loop-orchestrator.ts` create `ContentRef` locators without persisting corresponding text content.
  - `packages/llm_provider/src/deepseek-adapter.ts` throws if `ContentResolver` is not configured and otherwise resolves every `item.content_ref`.
  - `apps/runtime/src/composition-root.ts` wires `MockLLMProvider` only and provides no `ContentResolver`.

  **Impact**: The audited slices are not actually composable with the real provider path. Swapping the mock for `DeepSeekAdapter` would fail immediately on boot or on any later repair/response/tool-summary context item because the referenced content cannot be resolved.

### MEDIUM

- **M1 — Slice 0034 still has no externalization seam for large or truncated tool results**

  `CoreLoopOrchestrator` calls `compactionPolicy.compact(toolResult, newRevision)` without any `ArtifactExternalizer`. Slice 0028 explicitly requires an externalizer for large results or `truncated: true` results, and the compaction-policy tests explicitly prove that the large-result path throws when no externalizer is provided. The orchestrator tests never exercise a large or truncated tool result.

  **Impact**: A tool result that crosses the compaction threshold will abort the turn through the generic tool-execution failure path instead of following the intended externalization path. The slice is not robust to one of the core compaction-policy outcomes defined by spec.

- **M2 — The slice 0037 E2E validation is partially vacuous for the boundaries it claims to prove**

  The E2E test proves gateway admission and orchestrator completion with a mock provider, but it does not prove the actual slice-0035/0036 channel path or any slice-0038 runtime telemetry behavior. It also does not prove the per-session memory behavior required by slice 0037. This is not a zero-signal test, but it is materially narrower than the acceptance criteria it is treated as satisfying.

  **Impact**: The repo has a real happy-path test, but it overstates how much end-to-end surface is actually under test.

- **M3 — Workflow state is still stale and internally inconsistent after implementation completion**

  The backlog still reports:
  - implementation cursor at slice 0033
  - planned slices ahead of cursor: 0034–0038
  - duplicate slice-queue entries for 0030–0033

  This no longer matches the live codebase. The validation-state section is more current than the pipeline-state section, so the backlog now contradicts itself.

  **Impact**: Planning artifacts are no longer trustworthy as an execution source of truth for this slice range.

- **M4 — Slice 0038 remains in pending-validation / pending-approval limbo despite complete implementation**

  The telemetry slice card still says `State: implemented (pending validation)` and `Approval: pending`, even though the package has a non-vacuous test file, no compile errors, and the backlog describes telemetry as implemented.

  **Impact**: Approval state is stale, and the repo has no clear signal on whether telemetry is considered done or blocked.

- **M5 — Slice 0036 approval metadata is incomplete**

  The terminal-rendering card says `Approval: approved` but leaves `Approved by:` and `Approval date:` blank.

  **Impact**: Minor governance-trail gap.

### LOW

- **L1 — Telemetry chain-resilience validation is skipped on Windows**

  `packages/telemetry/tests/telemetry-writer.test.ts` skips the write-chain resilience test on `win32`. The remaining telemetry suite is still non-vacuous, but this leaves one OS-specific recovery-path assertion unproven on the current host OS.

  **Impact**: Limited platform-specific confidence gap, not a general validation failure.

- **L2 — `MockLLMProvider` still returns a fixed `decision_id`**

  The runtime mock is sufficient for the current single-step happy path, but repeated use across multi-step or repeated inference sequences would reuse the same `decision_id`.

  **Impact**: Low today because the mock is intentionally narrow, but it is not a durable stand-in for broader integration coverage.

---

## Drift By Category

### Spec Drift

- No current drift found in the core-loop-state-machine spec itself; the previously missing abort transitions are now present in the authoritative spec.
- Slice 0037 implementation drifts from its accepted runtime-composition behavior by not wiring the CLI and telemetry seams it claims to compose.

### Boundary Drift

- Session-scoped episodic memory ownership is violated in runtime composition by sharing one placeholder memory across all sessions.
- The runtime package does not yet consume the telemetry boundary at all.
- The compaction-to-provider content boundary is incomplete because `ContentRef` production is implemented without an accompanying text-resolution path.

### Validation Or Test Drift

- Runtime E2E coverage does not currently prove CLI normalization, terminal rendering, telemetry persistence wiring, or per-session memory isolation.
- Orchestrator tests do not cover large or truncated tool-result compaction at the boundary where the missing externalizer matters.
- Telemetry retains one skipped Windows-only recovery-path test.

### Planning-Artifact Drift

- Backlog pipeline state remains stale.
- Slice queue still contains duplicate entries for 0030–0033.
- Slice 0038 status/approval is stale.
- Slice 0036 approval metadata is incomplete.

### Deferred-Decision Leakage

- No deferred-decision leakage was found. The main problems are implemented-behavior and wiring gaps, not ad hoc resolution of roadmap items.

---

## Missing Tests Or Weak Validation

- Add a true slice-0037 E2E that starts from `normalizeCliInput(...)`, drives the runtime through the gateway/orchestrator path, and asserts rendered terminal output via `renderStreamEvent(...)`.
- Add runtime-level telemetry integration validation proving `TelemetryWriter` is instantiated, receives events, and is flushed on shutdown.
- Add an orchestrator boundary test for a large or `truncated: true` tool result so the missing externalizer seam cannot remain hidden.
- Add an integration test that runs the real `DeepSeekAdapter` with a concrete `ContentResolver` against runtime-produced context items. Today there is no proof that the content-ref chain is executable.
- Add a multi-session runtime test that executes turns for two sessions and proves episodic memory isolation.
- On Windows, add an alternative telemetry chain-resilience test strategy that does not rely on POSIX chmod semantics.

---

## Stale Or Inconsistent Planning Artifacts

- [docs/implementation/backlog.md](../backlog.md) still reports the implementation cursor as slice 0033 and claims 0034–0038 are planned ahead of cursor.
- [docs/implementation/backlog.md](../backlog.md) still duplicates slices 0030–0033 in the slice queue.
- [0038-telemetry-event-persistence.md](../slices/0038-telemetry-event-persistence.md) still reports pending validation/approval.
- [0036-channel-cli-terminal-rendering.md](../slices/0036-channel-cli-terminal-rendering.md) has blank approval metadata despite approved state.

---

## Deferred-Decision Leakage Or Unsafe Assumptions

- No roadmap deferred decision was inappropriately resolved in code.
- The main unsafe assumption is architectural rather than roadmap-related: several slices assume that a `ContentRef` locator is sufficient for later provider consumption, but no owning slice actually persists or resolves the corresponding text for working-memory context items.

---

## Recommended Corrective Actions

1. Rework slice 0037 runtime composition so session resolution creates session-scoped episodic memory and either a per-session orchestrator or a session-aware orchestrator factory.
2. Integrate `channel_cli` and `telemetry` into runtime composition for real: import `normalizeCliInput`, `renderStreamEvent`, and `TelemetryWriter`; add `@argentum/telemetry` to the runtime package graph; flush telemetry in `shutdown()`.
3. Introduce a real content-resolution seam for working-memory `ContextItem` text and wire it into the runtime so the real `DeepSeekAdapter` can consume runtime-produced context items.
4. Add an externalization seam at the orchestrator/runtime boundary for large tool results so slice 0028’s large-result path is actually reachable without aborting.
5. Refresh backlog pipeline state and resolve slice-card metadata drift for 0036 and 0038 after the behavioral gaps are addressed.

---

## Next-Slice Readiness

- **Verdict**: `not-ready`
- **Blocking issues**:
  - Session isolation is not correctly composed in runtime.
  - Runtime does not yet compose CLI and telemetry seams it claims to validate.
  - The real-provider content-resolution path is not executable.
  - Large tool-result externalization is not wired through the orchestrator/runtime boundary.
- **Safe next actions**:
  - Implement a bounded remediation slice for runtime composition and session-scoped memory ownership.
  - Implement a bounded remediation slice for context-content storage/resolution across episodic memory, compaction outputs, and the provider adapter.
  - After those land, refresh workflow artifacts and rerun a focused audit on 0034, 0037, and 0038.