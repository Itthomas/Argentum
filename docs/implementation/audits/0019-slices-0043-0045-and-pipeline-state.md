# Implementation Audit

## Metadata

- Audit scope: validated slices 0043 (Runtime secret tool no-leak E2E), 0044 (Runtime blocked-grant tool path), 0045 (Runtime repair-exhaustion E2E), plus the current pipeline state recorded in [docs/implementation/backlog.md](../backlog.md)
- Auditor: GitHub Copilot (argentum-implementation-auditor)
- Audit date: 2026-05-25
- Repo readiness verdict: ready-with-risks

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/30-core-loop/turn-governor.md](../../spec/30-core-loop/turn-governor.md)
  - [docs/spec/30-core-loop/validation-and-repair.md](../../spec/30-core-loop/validation-and-repair.md)
  - [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md)
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md)
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md)
  - [docs/spec/40-modules/environment/secrets-and-config.md](../../spec/40-modules/environment/secrets-and-config.md)
  - [docs/spec/40-modules/tool-layer/tool-discovery.md](../../spec/40-modules/tool-layer/tool-discovery.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Implementation files:
  - [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts)
  - [apps/runtime/src/index.ts](../../apps/runtime/src/index.ts)
  - [apps/runtime/src/tooling-composition.ts](../../apps/runtime/src/tooling-composition.ts)
  - [packages/agentic_core/src/core-loop-orchestrator.ts](../../packages/agentic_core/src/core-loop-orchestrator.ts)
  - [packages/agentic_core/src/prompt-compiler.ts](../../packages/agentic_core/src/prompt-compiler.ts)
  - [packages/agentic_core/src/validation-repair.ts](../../packages/agentic_core/src/validation-repair.ts)
  - [packages/environment/src/grant-resolver.ts](../../packages/environment/src/grant-resolver.ts)
  - [packages/environment/src/secret-handle-resolver.ts](../../packages/environment/src/secret-handle-resolver.ts)
  - [packages/tooling/src/tool-discovery.ts](../../packages/tooling/src/tool-discovery.ts)
- Test files:
  - [apps/runtime/tests/secret-tool.no-leak.e2e.test.ts](../../apps/runtime/tests/secret-tool.no-leak.e2e.test.ts)
  - [apps/runtime/tests/blocked-grant.e2e.test.ts](../../apps/runtime/tests/blocked-grant.e2e.test.ts)
  - [apps/runtime/tests/repair-exhaustion.e2e.test.ts](../../apps/runtime/tests/repair-exhaustion.e2e.test.ts)
  - [packages/environment/tests/secret-handle-resolver.test.ts](../../packages/environment/tests/secret-handle-resolver.test.ts)
- Slice cards:
  - [docs/implementation/slices/0042-environment-secret-handle-resolver-interface.md](../slices/0042-environment-secret-handle-resolver-interface.md)
  - [docs/implementation/slices/0043-runtime-secret-tool-no-leak-e2e.md](../slices/0043-runtime-secret-tool-no-leak-e2e.md)
  - [docs/implementation/slices/0044-runtime-blocked-grant-tool-path.md](../slices/0044-runtime-blocked-grant-tool-path.md)
  - [docs/implementation/slices/0045-runtime-repair-exhaustion-e2e.md](../slices/0045-runtime-repair-exhaustion-e2e.md)
  - [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](../slices/0040-tooling-tool-discovery-planner.md)
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/audits/0000-template.md](./0000-template.md)
  - [docs/implementation/audits/0018-slices-0039-0041-and-pipeline-state.md](./0018-slices-0039-0041-and-pipeline-state.md)

## Findings By Severity

- High:
  - None.
- Medium:
  - M1 - The active pipeline risk from slice 0040 remains unresolved in shipped code. [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](../slices/0040-tooling-tool-discovery-planner.md) and [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md) still assign current-step tool-exposure request construction and `LLMInferenceRequest.available_tools` attachment to the prompt-compiler path in `@argentum/agentic_core`, but the live implementation continues to decide exposure in runtime composition at [apps/runtime/src/tooling-composition.ts](../../apps/runtime/src/tooling-composition.ts) and passes a fixed available-tools list into the orchestrator. Slices 0043 through 0045 correctly build on that shipped path, but the pipeline-level boundary drift remains active.
- Low:
  - L1 - [docs/implementation/backlog.md](../backlog.md) is stale in two places even though its cursor and slice queue are current. The `Next Actions` section still says slices 0039 through 0045 are "queued as planned," which conflicts with the validated slice queue and pipeline cursor, and the runtime bullet in `Current Validation State` still describes only the earlier happy-path and content-rehydration coverage rather than the now-validated blocked-grant, secret no-leak, and repair-exhaustion runtime proofs.

## Drift By Category

- Spec drift:
  - No new spec drift was found in slices 0043 through 0045. Their implementation and cards remain aligned with the governing secret-handling, blocked-grant, and repair-exhaustion specs.
  - The previously-audited 0040 ownership split still drifts from the prompt-compiler spec: runtime composition constructs the current exposure decision instead of the prompt-compiler path.
- Boundary drift:
  - No new boundary violations were found in the 0043 through 0045 runtime slices. Secret resolution stays in the environment plus execution harness, blocked grants stay inside the execution boundary, and repair exhaustion stays in the validation-repair and runtime orchestration path.
  - The pipeline still carries the 0040 boundary drift where `apps/runtime` owns the current-step exposure choice that the approved slice card assigns to `@argentum/agentic_core`.
- Validation or test drift:
  - Slice 0043 now proves the no-leak invariant across rendered output, telemetry, persisted working files, provider-visible request payloads, raw trace refs, and raw trace bodies.
  - Slice 0044 now proves the blocked `ToolResultDTO`, authoritative `tool.blocked` payload, deterministic abort path, persisted telemetry, and shutdown flush without widening the public runtime API.
  - Slice 0045 now proves exact repair-attempt counts and ordering, the terminal `validation.failed` plus `turn.aborted` path, and deterministic cleanup. No new slice-local validation gap was found.
  - The remaining validation gap is pipeline-level: there is still no agentic-core-owned proof that the prompt-compiler path constructs the per-step tool-exposure request if slice 0040's approved ownership split is retained.
- Planning-artifact drift:
  - [docs/implementation/backlog.md](../backlog.md) mixes current pipeline state with stale planning language for 0039 through 0045 and stale runtime validation-summary text.
- Deferred-decision leakage:
  - None found in slices 0043 through 0045. Slice 0043 explicitly avoids re-resolving future tool-exposure policy, slice 0044 stays within MVP `auto_allow` versus `deny`, and slice 0045 stays within the frozen MVP repair budget semantics.

## Missing Tests Or Weak Validation

- No new missing tests were identified for slices 0043 through 0045 relative to their approved scope.
- If slice 0040's approved ownership split remains authoritative, add one focused agentic-core or runtime regression that proves the prompt-compiler path constructs the current-step `ToolExposureRequest` and attaches the resulting exposed tool schemas, rather than receiving a runtime-preselected fixed list.
- This audit could not re-run the recorded `pnpm` commands from the current tool surface; workspace diagnostics for the inspected implementation and test files were clean.

## Stale Or Inconsistent Planning Artifacts

- [docs/implementation/backlog.md](../backlog.md) `Next Actions` still describes slices 0039 through 0045 as planned, despite the validated queue and `Implementation cursor: slice 0045` pipeline state.
- [docs/implementation/backlog.md](../backlog.md) `Current Validation State` still summarizes the runtime test surface as earlier happy-path and rehydration coverage instead of reflecting the validated 0043 through 0045 hardening proofs.
- After this audit report lands, [docs/implementation/backlog.md](../backlog.md) will also need its `Latest audit` pointer refreshed from audit 0018 to this report.

## Recommended Corrective Actions

1. Decide whether slice 0040's approved ownership split is still the intended MVP contract. If yes, move current-step tool-exposure request construction into the prompt-compiler path in `@argentum/agentic_core`. If no, narrow the 0040 card and adjacent planning artifacts so they match the shipped runtime-owned exposure design.
2. Refresh [docs/implementation/backlog.md](../backlog.md) so `Next Actions`, `Current Validation State`, and `Latest audit` reflect the validated 0043 through 0045 state and this audit result.
3. Keep the 0043 through 0045 cards as-is; no slice-local corrective edit is required from this audit.

## Next-Slice Readiness

- Verdict: ready-with-risks
- Blocking issues:
  - None that block forward planning or the next bounded implementation slice directly.
- Safe next actions:
  - Refresh backlog pipeline metadata so the planning layer matches the validated repo state through slice 0045.
  - Resolve or explicitly re-baseline the 0040 ownership split before any slice that depends on narrowed per-step tool exposure or prompt-compiler-owned exposure policy.