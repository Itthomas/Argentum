# Implementation Audit — Slices 0034–0038 and Planned Slice 0039

## Metadata

- Audit scope: implemented slices 0034 (Core Loop Orchestrator), 0035 (CLI Input Normalization), 0036 (CLI Terminal Rendering), 0037 (Composition Root & E2E Happy Path), 0038 (Telemetry Event Persistence), and planned slice 0039 (Environment internal workspace path guard)
- Auditor: GitHub Copilot (argentum-implementation-auditor)
- Audit date: 2026-05-25
- Repo readiness verdict: ready-with-risks

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/10-architecture/eventing-model.md](../../spec/10-architecture/eventing-model.md)
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md)
  - [docs/spec/20-contracts/stream-event-payloads.md](../../spec/20-contracts/stream-event-payloads.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/40-modules/channel-cli/cli-adapter-mvp.md](../../spec/40-modules/channel-cli/cli-adapter-mvp.md)
  - [docs/spec/40-modules/channel-cli/terminal-rendering.md](../../spec/40-modules/channel-cli/terminal-rendering.md)
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md)
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md)
  - [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md)
  - [docs/spec/40-modules/gateway/telemetry.md](../../spec/40-modules/gateway/telemetry.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Implementation files:
  - [packages/agentic_core/src/core-loop-orchestrator.ts](../../packages/agentic_core/src/core-loop-orchestrator.ts)
  - [packages/channel_cli/src/cli-input-normalizer.ts](../../packages/channel_cli/src/cli-input-normalizer.ts)
  - [packages/channel_cli/src/terminal-renderer.ts](../../packages/channel_cli/src/terminal-renderer.ts)
  - [packages/telemetry/src/telemetry-writer.ts](../../packages/telemetry/src/telemetry-writer.ts)
  - [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts)
  - [apps/runtime/src/mock-llm-provider.ts](../../apps/runtime/src/mock-llm-provider.ts)
  - [packages/gateway/src/gateway-facade.ts](../../packages/gateway/src/gateway-facade.ts)
- Test files:
  - [packages/agentic_core/tests/core-loop-orchestrator.test.ts](../../packages/agentic_core/tests/core-loop-orchestrator.test.ts)
  - [packages/channel_cli/tests/terminal-renderer.test.ts](../../packages/channel_cli/tests/terminal-renderer.test.ts)
  - [packages/telemetry/tests/telemetry-writer.test.ts](../../packages/telemetry/tests/telemetry-writer.test.ts)
  - [apps/runtime/tests/e2e-happy-path.test.ts](../../apps/runtime/tests/e2e-happy-path.test.ts)
  - [packages/environment/tests/runtime-startup-config.test.ts](../../packages/environment/tests/runtime-startup-config.test.ts)
- Slice cards:
  - [docs/implementation/slices/0034-agentic-core-core-loop-orchestrator.md](../slices/0034-agentic-core-core-loop-orchestrator.md)
  - [docs/implementation/slices/0035-channel-cli-input-normalization.md](../slices/0035-channel-cli-input-normalization.md)
  - [docs/implementation/slices/0036-channel-cli-terminal-rendering.md](../slices/0036-channel-cli-terminal-rendering.md)
  - [docs/implementation/slices/0037-runtime-composition-root-e2e-happy-path.md](../slices/0037-runtime-composition-root-e2e-happy-path.md)
  - [docs/implementation/slices/0038-telemetry-event-persistence.md](../slices/0038-telemetry-event-persistence.md)
  - [docs/implementation/slices/0039-environment-workspace-path-guard.md](../slices/0039-environment-workspace-path-guard.md)
- Workflow artifacts:
  - [docs/implementation/backlog.md](../backlog.md)
  - [docs/implementation/audits/0016-slices-0028-0038-deep-audit.md](./0016-slices-0028-0038-deep-audit.md)

## Findings By Severity

- High:
  - None.
- Medium:
  - M1 — The composed runtime path does not expose all slice-0036 terminal lifecycle signals that its own rendering contract expects. In [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts), `RuntimeStreamPipeline` maps `llm.finished` to canonical `llm.completed` with `visibility: "telemetry"` and maps `turn.started` with `visibility: "telemetry"`. In [packages/channel_cli/src/terminal-renderer.ts](../../packages/channel_cli/src/terminal-renderer.ts), telemetry events are intentionally hidden, while slice 0036 and the terminal-rendering spec require reachable render behavior for `llm.completed` and `turn.started`. The result is that the composed CLI path cannot render `"[system] Inference complete."` or `"Turn started..."` even though the channel slice correctly implements those cases. Impact: slice 0036 is correct in isolation, but slice 0037 does not fully honor that contract in the live runtime path.
  - M2 — `shutdown()` overstates cleanup guarantees relative to the actual implementation. [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts) documents `shutdown` as releasing locks, closing DB, and flushing telemetry, and slice 0037 acceptance criteria say shutdown should release locks and verify cleanup. The current implementation only flushes telemetry and calls `gateway.close()`. [packages/gateway/src/gateway-facade.ts](../../packages/gateway/src/gateway-facade.ts) exposes no shutdown-time release-all operation, and [apps/runtime/tests/e2e-happy-path.test.ts](../../apps/runtime/tests/e2e-happy-path.test.ts) only proves telemetry flush. Impact: lower-level callers using the exported `gateway` and `orchestrator` surfaces can rely on a stronger shutdown contract than the runtime currently enforces.
- Low:
  - L1 — Telemetry write-chain resilience remains unproven on the current host OS. [packages/telemetry/tests/telemetry-writer.test.ts](../../packages/telemetry/tests/telemetry-writer.test.ts) explicitly skips the failed-write recovery test on `win32`, so one recovery-path assertion for slice 0038 is still platform-conditional. Impact is limited because the rest of the telemetry suite is non-vacuous and no implementation defect was found in the writer itself.

## Drift By Category

- Spec drift:
  - The slice-0036 rendering contract is only partially reachable in the composed runtime path because `turn.started` and `llm.completed` are emitted as telemetry-only events in [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts), while the authoritative rendering specs in [docs/spec/40-modules/channel-cli/terminal-rendering.md](../../spec/40-modules/channel-cli/terminal-rendering.md) and [docs/spec/40-modules/channel-cli/cli-adapter-mvp.md](../../spec/40-modules/channel-cli/cli-adapter-mvp.md) require the CLI path to render user-distinguishable lifecycle progress from `StreamEvent` values.
- Boundary drift:
  - The runtime shutdown surface promises lock release but currently implements only telemetry flush plus database close. That is a drift between the runtime boundary described in slice 0037 and the actual behavior exported by [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts).
  - No package-dependency or contract-layer boundary violations were found in slices 0034, 0035, 0036, 0038, or the planned 0039 seam.
- Validation or test drift:
  - Runtime integration tests in [apps/runtime/tests/e2e-happy-path.test.ts](../../apps/runtime/tests/e2e-happy-path.test.ts) assert final response text and telemetry persistence, but they do not assert the progress-output sequence required to prove the rendered `turn.started` and `llm.completed` boundaries in the composed path.
  - Runtime tests also do not prove the shutdown lock-release claim from slice 0037.
  - Telemetry recovery-path validation remains skipped on Windows for the failed-write chain-resilience case.
- Planning-artifact drift:
  - Slice 0037 still describes shutdown as releasing locks and calls for cleanup verification, but the implementation and tests currently prove only telemetry flush plus database close.
  - Planning artifacts for slice 0039 are otherwise fresh and internally aligned with the updated environment specs and backlog state.
- Deferred-decision leakage:
  - None found. Slice 0039 now correctly keeps workspace-path authorization as an environment-internal helper seam and does not resolve deferred execution-driver or maintenance-mode questions ad hoc.

## Missing Tests Or Weak Validation

- Add a runtime-level regression test that asserts the composed `renderedOutput` sequence for a full turn includes the intended progress markers, especially `turn.started` and the `llm.completed` completion boundary, not just the final assistant text.
- Add a runtime-level test that proves or narrows the shutdown contract. Either verify active-turn claims are released on shutdown, or reduce the documented shutdown guarantee so tests match the actual boundary.
- Add a Windows-compatible alternative for the telemetry failed-write recovery proof so slice 0038’s chain-resilience behavior is validated on the current host OS rather than skipped.
- Add one integrated failure-path runtime test for at least one deterministic abort path across slices 0034–0038, such as governor exhaustion or provider failure, to complement the strong package-level unit coverage.

## Stale Or Inconsistent Planning Artifacts

- [docs/implementation/slices/0037-runtime-composition-root-e2e-happy-path.md](../slices/0037-runtime-composition-root-e2e-happy-path.md) still claims shutdown releases locks and that cleanup is verified, but the current implementation and tests do not prove that exact guarantee.
- No stale backlog or slice-queue drift was found for slices 0034–0039. [docs/implementation/backlog.md](../backlog.md) correctly places the implementation cursor at 0038 and describes 0039 as the next pending-approval candidate.

## Recommended Corrective Actions

1. Align the runtime event-visibility mapping in [apps/runtime/src/composition-root.ts](../../apps/runtime/src/composition-root.ts) with slice 0036’s intended rendered lifecycle surface, or narrow slice 0037/0036 acceptance language if the hidden-events behavior is intentional.
2. Either implement explicit shutdown-time claim cleanup for the runtime boundary or update slice 0037 and the runtime API documentation so the shutdown contract matches the code.
3. Add the narrow runtime tests needed to prove progress rendering and shutdown semantics, then keep slice 0039 implementation scoped to the environment-internal helper described in its current card.
4. Replace the Windows telemetry skip with a host-compatible recovery-path test strategy when practical.

## Next-Slice Readiness

- Verdict: ready-with-risks
- Blocking issues:
  - None that block slice 0039 specifically.
- Safe next actions:
  - Approve and implement slice 0039 as planned; its scope, spec anchors, and internal-seam boundary are now coherent.
  - In parallel or immediately after 0039, remediate the runtime visibility drift and shutdown-contract drift identified above so the already-implemented 0034–0038 path matches its documented behavior more closely.