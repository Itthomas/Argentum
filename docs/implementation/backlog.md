# Argentum Implementation Backlog

## Purpose

This backlog is the durable queue for planned and in-progress implementation slices.

## Workflow Rules

- Each active coding slice must have a corresponding file under [docs/implementation/slices](./slices).
- Do not start a coding slice until its bootstrap prerequisites are resolved in [docs/implementation/bootstrap-decisions.md](./bootstrap-decisions.md).
- Update this file after planning, after validation, and after adversarial review.

## Current Status

- Phase 0 planning layer: completed
- Phase 1 bootstrap runtime skeleton: implemented in repo and locally validated across the current contracts, environment, runtime-bootstrap, and gateway-admission slices
- Global bootstrap decisions: approved in [docs/implementation/bootstrap-decisions.md](./bootstrap-decisions.md)
- Slices 0001 through 0004 are implemented in the repo and their slice-card status now reflects validated current state
- Slice 0005 is validated as the upstream `@argentum/contracts` boundary for canonical ingress handling
- Slice 0006 is validated as the gateway ingress-creation and queue-admission boundary, and the `@argentum/gateway` package test gate is now non-vacuous
- Slice 0007 is validated as the canonical `@argentum/contracts` boundary for `ContentRef`, `TurnState`, `TurnBudget`, and `TurnEnvelope`
- Slice 0008 is validated as the gateway session-routing and read-only admission-snapshot seam, and its reviewed validation state now includes same-key concurrency coverage plus a source-entrypoint smoke for the exported session-router surface while keeping active-turn claim mutation out of scope
- Slice 0010 is validated as the gateway active-turn-claim seam that owns the first claim-capable persistence boundary plus the preservation handoff needed to avoid dropping accepted ingress before downstream turn creation
- Slice 0009 is validated as the gateway turn-start handoff-to-artifact seam, now remediated to keep lock-state mutation out of turn creation while preserving canonical `TurnEnvelope` and `turn.started` construction
- Slice 0011 is validated as the gateway release-and-dequeue seam, with authority consumption delegated to the slice 0010 seam and append-surface failures now triggering a full transaction rollback (H1 resolved 2026-05-23). **H1 resolved:** the `finalizing_append_surface.append()` call now occurs inside the SQLite transaction so an append throw rolls back the dequeue mutation. **M2 resolved:** `GatewayFinalizingEventAppendSurface.append` JSDoc now documents the throw-on-failure contract.
- Slices 0012 through 0016 are validated as the canonical `@argentum/contracts` boundaries for `ContextItem`, `ActionDecision`, `ToolCallDTO`/`ToolResultDTO`, `ExecutionGrantDTO`, and `LLMInferenceRequest`/`LLMInferenceResult`. All have passed adversarial review with no HIGH/CRITICAL findings. Shared validation helpers extracted to `packages/contracts/src/validation-helpers.ts`.
- Slices 0017 through 0019 are validated as the canonical `@argentum/contracts` boundaries for `ToolDefinition` and `RuntimePolicyDTO`, plus the first `@argentum/tooling` implementation slice (`ToolRegistry`). All have passed testing gates (636+ contract tests, 44 tooling tests). Audit 0010 found no spec drift and no boundary violations across all 8 slices.
- Slices 0020 through 0029 are validated (10 slices implemented 2026-05-24): grant resolver (0020), execution driver interface (0021), artifact store (0022), retry policy handler (0023), turn state machine (0024), episodic memory (0025), prompt compiler (0026), context selection policy (0027), compaction policy (0028), turn governor (0029). All packages now have non-vacuous test gates: environment (109 tests), tooling (90 tests), agentic_core (228 tests).
- `max_tokens_per_step` added to canonical `TurnBudget` contract (optional field, backward-compatible).

## Current Validation State

- `@argentum/contracts` has focused contract tests for all canonical DTOs including the newly added `max_tokens_per_step` on `TurnBudget`, and `pnpm --filter @argentum/contracts test` is non-vacuous (647 tests).
- `@argentum/environment` has startup-loader, grant-resolver, execution-driver, and artifact-store tests (109 tests).
- `@argentum/gateway` has focused gateway boundary tests plus source-entrypoint smoke coverage; `pnpm --filter @argentum/gateway test` is non-vacuous.
- `@argentum/tooling` has registry, schema-validator, retry-policy, and package-entrypoint tests (90 tests).
- `@argentum/agentic_core` has turn-state-machine, episodic-memory, prompt-compiler, context-selector, compaction-policy, turn-governor, validation-repair, and core-loop-orchestrator tests (312 tests).
- `@argentum/llm_provider` is fully implemented with 59 tests (LLMProvider interface, tool schema projection, DeepSeek adapter).
- `@argentum/channel-cli` is fully implemented with 92 tests (CLI input normalization, terminal rendering).
- `@argentum/telemetry` is implemented with 21 tests (JSONL event persistence, 1 test skipped on Windows).
- `@argentum/runtime` has 15 tests (runtime bootstrap plus the supported `runCliTurn()` happy-path seam, session isolation, telemetry persistence/flush, resolver-backed content rehydration, secret no-leak, blocked-grant termination, and repair-exhaustion hardening proofs).
- Repo-level `pnpm test` discovers 1,373 tests across all 43 test files.
- **All shell packages are now non-vacuous.**

## Next Actions

1. **Remediate audit 0022 planning-artifact drift** — **partially completed 2026-05-26**. Slice 0049 now reflects the completed logging audit, slices 0046–0048 now align with their validated state, and backlog approval/state drift for the tail of the pipeline has been corrected.
2. **Clarify the slice 0050 DI persistence seam** — **blocked pending human decision**. The latest adversarial review found a CRITICAL ambiguity in the DI-plan term `persistence`: slice 0050 cannot be approved until a human decides whether this audit should treat persistence as gateway session persistence, core-loop content persistence, episodic memory, or multiple separate seams.
3. **After persistence-scope clarification, re-review and execute slice 0050** — the DI compliance audit is otherwise tightened and review-ready aside from the blocking persistence-scope question.
4. **Execute slice 0051 after 0050 is resolved** — create `docs/operator-guide.md` and validate it against runtime config, workspace layout, queueing rules, feature flags, secret-handle setup, governor defaults, and telemetry output paths.
5. **Refill the forward implementation buffer with concrete hardening slices** — plan follow-up remediation slices for audit 0021 MEDIUM gaps: direct-ingress telemetry (`ingress.accepted`) and end-to-end coverage for the remaining `MvpStreamEventKind` variants.

## Slice Queue

- Validated current slice: [docs/implementation/slices/0001-contracts-runtime-config.md](./slices/0001-contracts-runtime-config.md)
- Validated current slice: [docs/implementation/slices/0002-environment-config-loader.md](./slices/0002-environment-config-loader.md)
- Validated current slice: [docs/implementation/slices/0003-runtime-composition-startup-gate.md](./slices/0003-runtime-composition-startup-gate.md)
- Validated current slice: [docs/implementation/slices/0004-contracts-stream-event.md](./slices/0004-contracts-stream-event.md)
- Validated current slice: [docs/implementation/slices/0005-contracts-ingress-contract.md](./slices/0005-contracts-ingress-contract.md)
- Validated current slice with a non-vacuous gateway boundary-test gate: [docs/implementation/slices/0006-gateway-ingress-admission.md](./slices/0006-gateway-ingress-admission.md)
- Validated current slice: [docs/implementation/slices/0007-contracts-turn-envelope.md](./slices/0007-contracts-turn-envelope.md)
- Validated current slice: [docs/implementation/slices/0008-gateway-session-router.md](./slices/0008-gateway-session-router.md)
- Validated current slice: [docs/implementation/slices/0010-gateway-exclusive-turn-creation-authority.md](./slices/0010-gateway-exclusive-turn-creation-authority.md)
- Validated current slice: [docs/implementation/slices/0009-gateway-turn-envelope-creation.md](./slices/0009-gateway-turn-envelope-creation.md)
- Validated current slice (with known H1/M2 issues, see Audit Findings): [docs/implementation/slices/0011-gateway-lock-release-and-queue-dequeue.md](./slices/0011-gateway-lock-release-and-queue-dequeue.md)
- Validated current slice: [docs/implementation/slices/0012-contracts-context-item.md](./slices/0012-contracts-context-item.md)
- Validated current slice: [docs/implementation/slices/0013-contracts-action-decision.md](./slices/0013-contracts-action-decision.md)
- Validated current slice: [docs/implementation/slices/0015-contracts-execution-grant.md](./slices/0015-contracts-execution-grant.md)
- Validated current slice: [docs/implementation/slices/0016-contracts-llm-adapter-boundary.md](./slices/0016-contracts-llm-adapter-boundary.md)
- Validated current slice: [docs/implementation/slices/0014-contracts-tool-call-and-result.md](./slices/0014-contracts-tool-call-and-result.md)
- Validated current slice: [docs/implementation/slices/0017-contracts-tool-definition.md](./slices/0017-contracts-tool-definition.md)
- Validated current slice: [docs/implementation/slices/0018-contracts-runtime-policy-parser.md](./slices/0018-contracts-runtime-policy-parser.md)
- Validated current slice: [docs/implementation/slices/0019-tooling-registry-implementation.md](./slices/0019-tooling-registry-implementation.md)
- Validated current slice: [docs/implementation/slices/0020-environment-grant-resolver.md](./slices/0020-environment-grant-resolver.md)
- Validated current slice: [docs/implementation/slices/0021-environment-execution-driver-interface.md](./slices/0021-environment-execution-driver-interface.md)
- Validated current slice: [docs/implementation/slices/0022-environment-artifact-store.md](./slices/0022-environment-artifact-store.md)
- Validated current slice: [docs/implementation/slices/0023-tooling-retry-policy-handler.md](./slices/0023-tooling-retry-policy-handler.md)
- Validated current slice: [docs/implementation/slices/0024-agentic-core-turn-state-machine.md](./slices/0024-agentic-core-turn-state-machine.md)
- Validated current slice: [docs/implementation/slices/0025-agentic-core-episodic-memory.md](./slices/0025-agentic-core-episodic-memory.md)
- Validated current slice: [docs/implementation/slices/0026-agentic-core-prompt-compiler.md](./slices/0026-agentic-core-prompt-compiler.md)
- Validated current slice: [docs/implementation/slices/0027-agentic-core-context-selection-policy.md](./slices/0027-agentic-core-context-selection-policy.md)
- Validated current slice: [docs/implementation/slices/0028-agentic-core-compaction-policy.md](./slices/0028-agentic-core-compaction-policy.md)
- Validated current slice: [docs/implementation/slices/0029-agentic-core-turn-governor.md](./slices/0029-agentic-core-turn-governor.md)
- Validated current slice: [docs/implementation/slices/0030-agentic-core-validation-repair-policy.md](./slices/0030-agentic-core-validation-repair-policy.md)
- Validated current slice: [docs/implementation/slices/0031-llm-provider-abstraction-interface.md](./slices/0031-llm-provider-abstraction-interface.md)
- Validated current slice: [docs/implementation/slices/0032-llm-provider-tool-schema-projection.md](./slices/0032-llm-provider-tool-schema-projection.md)
- Validated current slice: [docs/implementation/slices/0033-llm-provider-deepseek-adapter.md](./slices/0033-llm-provider-deepseek-adapter.md)
- Validated current slice: [docs/implementation/slices/0034-agentic-core-core-loop-orchestrator.md](./slices/0034-agentic-core-core-loop-orchestrator.md)
- Validated current slice: [docs/implementation/slices/0035-channel-cli-input-normalization.md](./slices/0035-channel-cli-input-normalization.md)
- Validated current slice: [docs/implementation/slices/0036-channel-cli-terminal-rendering.md](./slices/0036-channel-cli-terminal-rendering.md)
- Validated current slice: [docs/implementation/slices/0037-runtime-composition-root-e2e-happy-path.md](./slices/0037-runtime-composition-root-e2e-happy-path.md)
- Validated current slice: [docs/implementation/slices/0038-telemetry-event-persistence.md](./slices/0038-telemetry-event-persistence.md)
- Validated current slice: [docs/implementation/slices/0039-environment-workspace-path-guard.md](./slices/0039-environment-workspace-path-guard.md)
- Validated current slice: [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](./slices/0040-tooling-tool-discovery-planner.md)
- Validated current slice: [docs/implementation/slices/0041-runtime-tool-call-e2e-happy-path.md](./slices/0041-runtime-tool-call-e2e-happy-path.md)
- Validated current slice: [docs/implementation/slices/0042-environment-secret-handle-resolver-interface.md](./slices/0042-environment-secret-handle-resolver-interface.md)
- Validated current slice: [docs/implementation/slices/0043-runtime-secret-tool-no-leak-e2e.md](./slices/0043-runtime-secret-tool-no-leak-e2e.md)
- Validated current slice: [docs/implementation/slices/0044-runtime-blocked-grant-tool-path.md](./slices/0044-runtime-blocked-grant-tool-path.md)
- Validated current slice: [docs/implementation/slices/0045-runtime-repair-exhaustion-e2e.md](./slices/0045-runtime-repair-exhaustion-e2e.md)
- Validated current slice: [docs/implementation/slices/0046-environment-bedrock-immutability.md](./slices/0046-environment-bedrock-immutability.md)
- Validated current slice: [docs/implementation/slices/0047-gateway-telemetry-event-ordering.md](./slices/0047-gateway-telemetry-event-ordering.md)
- Validated current slice: [docs/implementation/slices/0048-tooling-canonical-schema-model-validation.md](./slices/0048-tooling-canonical-schema-model-validation.md)
- Validated current slice: [docs/implementation/slices/0049-logging-plan-compliance-audit.md](./slices/0049-logging-plan-compliance-audit.md)
- Validated current slice: [docs/implementation/slices/0050-dependency-injection-plan-compliance-audit.md](./slices/0050-dependency-injection-plan-compliance-audit.md)
- Validated current slice: [docs/implementation/slices/0051-operator-documentation.md](./slices/0051-operator-documentation.md)

**Phase 3 complete (0017–0023). Phase 4 implemented and validated through slice 0034. Phase 5 implemented and validated through slice 0033. Phase 6/7 are validated through slice 0051. No further slices are planned.**

## Pipeline State (2026-05-26)

- Implementation cursor: slice 0051 (last validated)
- **All planned and approved slices have been implemented and validated.** The pipeline is at end.
- Planned slices ahead of cursor: 0.
- **Buffer**: 0 slices. Follow-up hardening slices for audit 0021 MEDIUM findings are identified in `post-mvp-hardening-ideas.md` but not yet planned as formal slice cards.
- **Latest audit**: [docs/implementation/audits/0023-dependency-injection-plan-compliance.md](./audits/0023-dependency-injection-plan-compliance.md) returned `ready` for DI-plan compliance. One MEDIUM finding (agentic_core → tooling sideways edge via `planToolExposure`). 
- **Next pending slices**: None. The pipeline is drained.
- **Focused test gates after remediation**: contracts (647), environment (109), gateway (~30), tooling (90), agentic_core (312), llm_provider (59), channel_cli (92), telemetry (21, 1 skipped on Windows), runtime (15)
- **Shell packages remaining**: none. All workspace packages now have non-vacuous test gates.

## Audit Findings

### Audit 0023 (2026-05-26) — DI Plan Compliance

Audit report: [docs/implementation/audits/0023-dependency-injection-plan-compliance.md](./audits/0023-dependency-injection-plan-compliance.md)

Repo readiness verdict: **ready** — 0 HIGH, 1 MEDIUM (agentic_core → tooling sideways edge). All five core-loop DI seams verified as interface-typed. Provider swappability confirmed. Execution-driver seam confirmed as environment-owned but vacuous until concrete tools land.

### Audit 0022 (2026-05-26) — Resolved

All CRITICAL and planning-artifact findings from audit 0022 have been resolved. Slice 0050 persistence-seam ambiguity resolved by human decision (2026-05-26). Slice 0051 approved and validated.

### Audit 0012 (2026-05-24) — Post-Remediation

Audit report: [docs/implementation/audits/0012-post-remediation-state.md](./audits/0012-post-remediation-state.md)

Repo readiness verdict: **ready** — 0 HIGH, 0 MEDIUM, 0 LOW. All findings resolved. M1 (spec table gap) resolved 2026-05-24 by human spec edit. No spec drift, no boundary violations, no deferred-decision leakage.

### Audit 0011 (2026-05-24) — Remediated

Audit report: [docs/implementation/audits/0011-slices-0020-0029-deep-audit.md](./audits/0011-slices-0020-0029-deep-audit.md)

Repo readiness verdict: **ready-with-risks** — 10 slices implemented, 1,121 tests pass, no boundary violations, no deferred-decision leakage. 6 HIGH, 6 MEDIUM findings. Slice 0030 CRITICAL findings C1/C2 resolved by human decision 2026-05-24.

#### Active HIGH Findings

- **H1 — Turn Governor abort reason literals differ from slice card** (RESOLVED 2026-05-24): Card updated to match implementation. Literals: `"step_limit_exceeded" | "repair_limit_exceeded" | "wall_clock_exceeded"`.
- **H2 — Turn Governor budget-check priority order differs from slice card** (RESOLVED 2026-05-24): Card updated to match implementation. Priority: steps → repairs → wall clock.
- **H3 — Turn Governor missing `now` parameter for deterministic testing** (RESOLVED 2026-05-24): Card updated. Signature: `evaluateGovernor(envelope, startedAt: number)`. Deterministic testing via `vi.useFakeTimers()`.
- **H4 — Slice cards 0021, 0028, 0029 were stale** (RESOLVED 2026-05-24): All three cards updated to `State: implemented`, `Approval: approved`.
- **H5 — CompactionPolicy API signature deviates from slice card** (RESOLVED 2026-05-24): Card acceptance criteria updated to match implementation. Method: `compact(result, currentRevision, externalizer?)`. Interface method: `store()`.
- **H6 — Backlog comprehensively stale** (RESOLVED 2026-05-24): Next Actions, Audit Findings, Pipeline State all refreshed.

#### Active MEDIUM Findings

- **M1 — `max_tokens_per_step` added to `TurnBudget` in code but missing from authoritative spec table** (DOCUMENTED): Spec `docs/spec/20-contracts/turn-envelope.md` budget table should be updated. **Requires spec edit** — orchestrator cannot edit `docs/spec/`. Human action needed.
- **M2 — `ArtifactExternalizer.store()` signature incompatible with environment's `storeToolArtifact()`** (DOCUMENTED): Adapter shim needed when wiring compaction policy into execution pipeline. Noted in slice 0028 card.
- **M3 — Slice 0027 acceptance criteria not updated after adversarial review changed unknown-layer behavior** (RESOLVED 2026-05-24): Added "Layer filtering" bullet to 0027 AC documenting `"layer_filtered"` omission for unrecognized layers.
- **M4 — No adversarial review entries for slices 0021, 0028, 0029** (RESOLVED 2026-05-24): Review logs populated.
- **M5 — Turn Governor `startedAt` changed from `Date` to `number`** (RESOLVED 2026-05-24): Card updated to match implementation. `startedAt: number` (epoch ms).
- **M6 — Audit 0010 H1 (at-path exports) was resolved but backlog listed remediation as "in progress"** (RESOLVED 2026-05-24): Backlog now reflects current state.

### Audit 0010 (2026-05-24) — Remediated

Audit report: [docs/implementation/audits/0010-slices-0012-0019-deep-audit.md](./audits/0010-slices-0012-0019-deep-audit.md)

All HIGH (H1-H3) and MEDIUM (M1-M6) findings resolved 2026-05-24. No remaining active findings.

### Audit 0007 (2026-05-23) — Remediated

Audit report: [docs/implementation/audits/0007-slices-0011-0015-implemented-and-planned.md](./audits/0007-slices-0011-0015-implemented-and-planned.md)

All findings (H1, M1, M2, L1, L2, L3) resolved as of 2026-05-24.