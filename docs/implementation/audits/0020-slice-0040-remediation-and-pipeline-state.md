# Implementation Audit

## Metadata

- Audit scope: slice 0040 remediation after the ownership move into `@argentum/agentic_core` and nested tool-schema immutability repair, plus the current pipeline state recorded in [docs/implementation/backlog.md](../backlog.md)
- Auditor: GitHub Copilot (argentum-implementation-auditor)
- Audit date: 2026-05-25
- Repo readiness verdict: ready

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/llm-adapter-contract.md](../../spec/20-contracts/llm-adapter-contract.md)
  - [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md)
  - [docs/spec/40-modules/tool-layer/tool-discovery.md](../../spec/40-modules/tool-layer/tool-discovery.md)
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
  - [docs/spec/70-roadmap/deferred-decisions.md](../../spec/70-roadmap/deferred-decisions.md)
- Implementation files:
  - [packages/contracts/src/tool-definition.ts](../../packages/contracts/src/tool-definition.ts)
  - [packages/tooling/src/registry.ts](../../packages/tooling/src/registry.ts)
  - [packages/tooling/src/tool-discovery.ts](../../packages/tooling/src/tool-discovery.ts)
  - [packages/tooling/src/index.ts](../../packages/tooling/src/index.ts)
  - [packages/agentic_core/src/prompt-compiler.ts](../../packages/agentic_core/src/prompt-compiler.ts)
  - [packages/agentic_core/src/core-loop-orchestrator.ts](../../packages/agentic_core/src/core-loop-orchestrator.ts)
  - [packages/agentic_core/src/index.ts](../../packages/agentic_core/src/index.ts)
  - [apps/runtime/src/tooling-composition.ts](../../apps/runtime/src/tooling-composition.ts)
  - [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts)
- Test files:
  - [packages/contracts/tests/tool-definition.test.ts](../../packages/contracts/tests/tool-definition.test.ts)
  - [packages/tooling/tests/tool-discovery.test.ts](../../packages/tooling/tests/tool-discovery.test.ts)
  - [packages/tooling/tests/registry.test.ts](../../packages/tooling/tests/registry.test.ts)
  - [packages/agentic_core/tests/prompt-compiler.test.ts](../../packages/agentic_core/tests/prompt-compiler.test.ts)
  - [apps/runtime/tests/tool-call.tooling-composition.test.ts](../../apps/runtime/tests/tool-call.tooling-composition.test.ts)
  - [apps/runtime/tests/tool-call.e2e.test.ts](../../apps/runtime/tests/tool-call.e2e.test.ts)
- Slice cards:
  - [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md)
  - [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](../slices/0040-tooling-tool-discovery-planner.md)
  - [docs/implementation/slices/0041-runtime-tool-call-e2e-happy-path.md](../slices/0041-runtime-tool-call-e2e-happy-path.md)
  - [docs/implementation/slices/0045-runtime-repair-exhaustion-e2e.md](../slices/0045-runtime-repair-exhaustion-e2e.md)
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/audits/0000-template.md](./0000-template.md)
  - [docs/implementation/audits/0019-slices-0043-0045-and-pipeline-state.md](./0019-slices-0043-0045-and-pipeline-state.md)

## Findings By Severity

- High:
  - None.
- Medium:
  - None.
- Low:
  - L1 - The current pipeline record still presents the pre-remediation 0040 ownership finding as active. [docs/implementation/backlog.md](../backlog.md#L50) and [docs/implementation/backlog.md](../backlog.md#L110) still say shipped code decides tool exposure in runtime composition, but the inspected code now constructs the current-step request in [packages/agentic_core/src/prompt-compiler.ts](../../packages/agentic_core/src/prompt-compiler.ts), passes the registry snapshot into prompt compilation from [packages/agentic_core/src/core-loop-orchestrator.ts](../../packages/agentic_core/src/core-loop-orchestrator.ts#L215), and limits runtime to registration plus explicit composition-time policy injection in [apps/runtime/src/tooling-composition.ts](../../apps/runtime/src/tooling-composition.ts) and [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts#L291). Impact: the planning layer understates current repo readiness and keeps a closed medium risk open.
  - L2 - The prompt-compiler slice card is stale relative to the remediated 0040 seam. [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md#L32), [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md#L50), and [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md#L105) still describe a direct `availableTools` input and pre-discovery compiler surface, while the implemented compiler now consumes registry-owned `registeredTools`, constructs `ToolExposureRequest`, and attaches the exposed `available_tools` itself. Impact: adjacent planning docs around prompt compilation and package ownership can mis-scope follow-on slices even though the code is aligned.

## Drift By Category

- Spec drift:
  - None found in the inspected implementation for tool discovery, prompt compilation, or package ownership. The prompt-compiler path now constructs the current-step exposure request and attaches provider-neutral `available_tools`, which matches [docs/spec/40-modules/agentic-layer/prompt-compiler.md](../../spec/40-modules/agentic-layer/prompt-compiler.md) and [docs/spec/40-modules/tool-layer/tool-discovery.md](../../spec/40-modules/tool-layer/tool-discovery.md).
- Boundary drift:
  - None found in the remediated 0040 path. `@argentum/tooling` owns registry and pure discovery primitives, `@argentum/agentic_core` owns current-step request construction plus `LLMInferenceRequest.available_tools`, and `apps/runtime` only injects the explicit composition-time default policy and registry snapshot.
- Validation or test drift:
  - No additional validation gap was found for the remediated 0040 seam. Focused tests prove prompt-compiler-owned request construction for both `mode = "all"` and `mode = "explicit"`, runtime non-ownership of `planToolExposure()`, and nested-schema immutability across contracts, tooling, and agentic-core.
  - This audit did not re-run the recorded `pnpm` test and build commands from the current tool surface; diagnostics for the inspected implementation files were clean.
- Planning-artifact drift:
  - [docs/implementation/backlog.md](../backlog.md#L50) and [docs/implementation/backlog.md](../backlog.md#L110) still carry the superseded 0040 medium-risk wording from audit 0019.
  - [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md) still documents the pre-0040 prompt-compiler boundary.
- Deferred-decision leakage:
  - None found. The all-tools default is injected explicitly at composition time in [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts#L291) and is documented as a human-approved implementation choice rather than being resolved ad hoc inside tooling or prompt compilation.

## Missing Tests Or Weak Validation

- No additional missing tests were identified for the 0040 remediation scope.
- The focused regression set for this seam is strong: [packages/contracts/tests/tool-definition.test.ts](../../packages/contracts/tests/tool-definition.test.ts), [packages/tooling/tests/tool-discovery.test.ts](../../packages/tooling/tests/tool-discovery.test.ts), [packages/tooling/tests/registry.test.ts](../../packages/tooling/tests/registry.test.ts), [packages/agentic_core/tests/prompt-compiler.test.ts](../../packages/agentic_core/tests/prompt-compiler.test.ts), and [apps/runtime/tests/tool-call.tooling-composition.test.ts](../../apps/runtime/tests/tool-call.tooling-composition.test.ts) collectively cover the repaired ownership and immutability paths.
- This audit relied on the committed focused tests, slice validation history, and clean diagnostics rather than re-running the `pnpm` gates.

## Stale Or Inconsistent Planning Artifacts

- [docs/implementation/backlog.md](../backlog.md#L50) still lists “Resolve the carried 0040 ownership drift or re-baseline it” as an active next action even though the inspected implementation matches the approved 0040 boundary.
- [docs/implementation/backlog.md](../backlog.md#L110) still reports audit 0019 as the latest state and still says the only active medium repo risk is the unresolved 0040 ownership split.
- [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md#L32) still names `availableTools` as the compiler input instead of the current registry-snapshot-plus-exposure-policy seam.

## Recommended Corrective Actions

1. Refresh [docs/implementation/backlog.md](../backlog.md) so `Next Actions`, `Pipeline State`, and `Latest audit` reflect that the 0040 ownership repair is implemented and that this seam no longer carries an active medium repo risk.
2. Update [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](../slices/0026-agentic-core-prompt-compiler.md) so its documented inputs and acceptance criteria match the shipped `registeredTools` plus `defaultToolExposurePolicy` design.
3. Leave the inspected implementation code unchanged for this scope; the current contracts, tooling, agentic-core, and runtime surfaces are aligned with the governing tool-discovery and prompt-compiler specs.

## Next-Slice Readiness

- Verdict: ready
- Blocking issues:
  - None.
- Safe next actions:
  - Refresh the stale planning artifacts so the documented pipeline state matches the remediated implementation.
  - Refill the forward planning buffer from slice 0045 without carrying 0040 as an open implementation risk.