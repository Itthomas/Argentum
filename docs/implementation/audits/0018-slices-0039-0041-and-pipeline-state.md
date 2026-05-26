# Implementation Audit — Slices 0039–0041 and Current Pipeline State

## Metadata

- Audit scope: validated slices 0039 (Environment internal workspace path guard), 0040 (Tool discovery planner), 0041 (Runtime tool-call E2E happy path), plus the current pipeline state recorded in [docs/implementation/backlog.md](../backlog.md)
- Auditor: GitHub Copilot (argentum-implementation-auditor)
- Audit date: 2026-05-25
- Repo readiness verdict: ready-with-risks

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/10-architecture/system-context.md](../../spec/10-architecture/system-context.md)
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md)
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md)
  - [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md)
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md)
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md)
  - [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md)
  - [docs/spec/40-modules/tool-layer/tool-discovery.md](../../spec/40-modules/tool-layer/tool-discovery.md)
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Implementation files:
  - [packages/environment/src/workspace-path-guard.ts](../../packages/environment/src/workspace-path-guard.ts)
  - [packages/environment/src/index.ts](../../packages/environment/src/index.ts)
  - [packages/tooling/src/registry.ts](../../packages/tooling/src/registry.ts)
  - [packages/tooling/src/tool-discovery.ts](../../packages/tooling/src/tool-discovery.ts)
  - [packages/tooling/src/index.ts](../../packages/tooling/src/index.ts)
  - [packages/agentic_core/src/core-loop-orchestrator.ts](../../packages/agentic_core/src/core-loop-orchestrator.ts)
  - [packages/agentic_core/src/prompt-compiler.ts](../../packages/agentic_core/src/prompt-compiler.ts)
  - [packages/gateway/src/gateway-facade.ts](../../packages/gateway/src/gateway-facade.ts)
  - [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts)
  - [apps/runtime/src/tooling-composition.ts](../../apps/runtime/src/tooling-composition.ts)
  - [apps/runtime/src/tooling-registration.ts](../../apps/runtime/src/tooling-registration.ts)
- Test files:
  - [packages/environment/tests/workspace-path-guard.test.ts](../../packages/environment/tests/workspace-path-guard.test.ts)
  - [packages/tooling/tests/tool-discovery.test.ts](../../packages/tooling/tests/tool-discovery.test.ts)
  - [apps/runtime/tests/tool-call.e2e.test.ts](../../apps/runtime/tests/tool-call.e2e.test.ts)
  - [apps/runtime/tests/tool-call.tooling-composition.test.ts](../../apps/runtime/tests/tool-call.tooling-composition.test.ts)
- Slice cards:
  - [docs/implementation/slices/0039-environment-workspace-path-guard.md](../slices/0039-environment-workspace-path-guard.md)
  - [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](../slices/0040-tooling-tool-discovery-planner.md)
  - [docs/implementation/slices/0041-runtime-tool-call-e2e-happy-path.md](../slices/0041-runtime-tool-call-e2e-happy-path.md)
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/audits/0000-template.md](./0000-template.md)
  - [docs/implementation/audits/0017-slices-0034-0039-deep-audit.md](./0017-slices-0034-0039-deep-audit.md)

## Findings By Severity

- High:
  - None.
- Medium:
  - M1 — Slice 0040's ownership split is not implemented as approved. [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](../slices/0040-tooling-tool-discovery-planner.md#L25) and [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md#L11) require the prompt-compiler path in `@argentum/agentic_core` to construct the current-step exposure request and attach the exposed tool schemas to `LLMInferenceRequest`, with `apps/runtime` limited to composition-time policy injection. The shipped code still constructs the exposure request in runtime composition at [apps/runtime/src/tooling-composition.ts](../../apps/runtime/src/tooling-composition.ts#L16), passes a fixed tool list into the orchestrator at [packages/agentic_core/src/core-loop-orchestrator.ts](../../packages/agentic_core/src/core-loop-orchestrator.ts#L220), and has no `ToolExposureRequest` or `planToolExposure()` usage in `packages/agentic_core`. Impact: the current all-tools happy path works, but the approved package boundary for per-step tool exposure remains unresolved and future narrowed-exposure work would have to change runtime composition instead of the prompt-compiler path.
- Low:
  - L1 — Slice 0039's focused validation misses one card-required precedence case. [packages/environment/tests/workspace-path-guard.test.ts](../../packages/environment/tests/workspace-path-guard.test.ts#L39) and [packages/environment/tests/workspace-path-guard.test.ts](../../packages/environment/tests/workspace-path-guard.test.ts#L55) prove deny-first behavior for forbidden request paths and duplicate matching roots, but there is no explicit `approval_mode = "deny"` plus malformed grant-root regression even though [docs/implementation/slices/0039-environment-workspace-path-guard.md](../slices/0039-environment-workspace-path-guard.md#L104) requires that precedence proof. Impact: behavior appears correct in code, but one approved validation obligation is unproven.
  - L2 — Slice and pipeline metadata are stale or internally inconsistent. [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](../slices/0040-tooling-tool-discovery-planner.md#L5) still says `State: implemented` while [docs/implementation/backlog.md](../backlog.md#L93) lists 0040 as validated, and [docs/implementation/slices/0041-runtime-tool-call-e2e-happy-path.md](../slices/0041-runtime-tool-call-e2e-happy-path.md#L5) contains both `State: planned` and `State: validated`. The current runtime surface also still documents `shutdown` as releasing locks and closing DB at [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts#L97), while the implementation only flushes telemetry and closes the gateway database via [packages/gateway/src/gateway-facade.ts](../../packages/gateway/src/gateway-facade.ts#L250). Impact: the backlog and slice cards overstate how cleanly validated state and runtime-shutdown guarantees are documented.

## Drift By Category

- Spec drift:
  - The approved 0040 boundary that places current-step tool exposure in the prompt-compiler path is not reflected in code. Runtime composition owns `planToolExposure(..., { mode: "all" })` in [apps/runtime/src/tooling-composition.ts](../../apps/runtime/src/tooling-composition.ts#L16), while the prompt compiler only receives an already-selected tool list in [packages/agentic_core/src/prompt-compiler.ts](../../packages/agentic_core/src/prompt-compiler.ts#L45).
- Boundary drift:
  - `apps/runtime` still owns the current tool-exposure request shape and decision point for the shipped path, contrary to slice 0040's approved package split.
  - The exported runtime shutdown surface still advertises stronger cleanup semantics than the implementation currently enforces.
- Validation or test drift:
  - Slice 0039's test suite is strong overall, but it does not explicitly prove deny-first precedence over malformed grant roots.
  - Slice 0040 has good package-local planner tests, but there is no agentic-core or runtime test proving the approved ownership path where prompt compilation constructs the exposure request per step.
- Planning-artifact drift:
  - 0040 and 0041 slice status metadata are inconsistent with backlog state.
  - Backlog pipeline status is otherwise current for the 0039–0041 cursor and the human-approved all-tools default recorded for 0041.
- Deferred-decision leakage:
  - None found. The former all-tools-versus-curated discovery default for 0041 is explicitly resolved by human judgment in [docs/implementation/slices/0041-runtime-tool-call-e2e-happy-path.md](../slices/0041-runtime-tool-call-e2e-happy-path.md#L112), and the current implementation follows that documented decision rather than inventing a new default ad hoc.

## Missing Tests Or Weak Validation

- Add one `packages/environment/tests/workspace-path-guard.test.ts` case that proves `approval_mode = "deny"` short-circuits before malformed grant-root validation.
- Add an agentic-core or runtime-level regression that proves the prompt-compiler path, not runtime composition, owns current-step tool-exposure request construction if slice 0040's approved boundary is retained.
- Add a focused runtime shutdown-contract test, or narrow the runtime API documentation so the shutdown guarantee matches the actual implementation.

## Stale Or Inconsistent Planning Artifacts

- [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](../slices/0040-tooling-tool-discovery-planner.md#L5) still marks slice 0040 as implemented instead of validated.
- [docs/implementation/slices/0041-runtime-tool-call-e2e-happy-path.md](../slices/0041-runtime-tool-call-e2e-happy-path.md#L5) still carries both planned and validated state markers.
- [docs/implementation/backlog.md](../backlog.md#L93) and [docs/implementation/backlog.md](../backlog.md#L94) correctly place 0040 and 0041 at validated, so the drift is in the slice-card metadata rather than in the backlog cursor.

## Recommended Corrective Actions

1. Decide whether slice 0040's approved ownership split is still the intended MVP contract. If yes, move current-step tool-exposure request construction into the prompt-compiler path in `@argentum/agentic_core` and keep `apps/runtime` limited to composition-time defaults. If no, narrow the 0040 slice card and adjacent planning artifacts so they match the shipped all-tools runtime design.
2. Add the missing 0039 deny-first malformed-grant regression and keep the environment guard's strong host-independent coverage intact.
3. Normalize 0040/0041 slice status metadata and narrow the runtime shutdown documentation to the behavior actually implemented today.

## Next-Slice Readiness

- Verdict: ready-with-risks
- Blocking issues:
  - None that block slice 0042 directly.
- Safe next actions:
  - Implement slice 0042 as planned; its environment-owned secret-resolution seam is not blocked by the 0040 ownership drift.
  - Before or during the next runtime-facing slices, either realign tool-exposure ownership with slice 0040 or explicitly re-baseline the slice documentation so later runtime work does not build on the wrong boundary assumption.