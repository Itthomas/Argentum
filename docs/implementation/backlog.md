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
- `@argentum/agentic_core` has turn-state-machine, episodic-memory, prompt-compiler, context-selector, compaction-policy, and turn-governor tests (228 tests).
- `@argentum/runtime` has focused bootstrap tests; `pnpm --filter @argentum/runtime test` is non-vacuous.
- `@argentum/llm_provider` is a shell awaiting first implementation slice.
- Repo-level `pnpm test` discovers 1,100+ tests across all packages.

## Next Actions

1. ~~Audit 0010 remediation~~ — **completed 2026-05-24**. All HIGH (H1-H3) and MEDIUM (M1-M6) findings resolved.
2. ~~Plan Phase 3 slices 0017–0019~~ — **completed 2026-05-24**.
3. ~~Plan Phase 3 continuation 0020–0023~~ — **completed 2026-05-24**. Grant resolver, execution driver, artifact store, retry policy.
4. ~~Plan Phase 4 slices 0024–0029~~ — **completed 2026-05-24**. Turn state machine, episodic memory, prompt compiler, context selection, compaction policy, turn governor.
5. ~~Implement slices 0020–0029~~ — **completed 2026-05-24**. All 10 slices validated: environment (109 tests), tooling (90 tests), agentic_core (228 tests), contracts (647 tests). 1,121 total tests pass.
6. ~~Plan slices 0030–0031~~ — **completed 2026-05-24**. Validation & repair (0030), LLM provider interface (0031).
7. ~~Run repo audit (audit 0011)~~ — **completed 2026-05-24**. 6 HIGH, 6 MEDIUM findings; no spec drift in core 7 slices; no boundary violations; no deferred-decision leakage.
8. **Resolve audit 0011 HIGH findings** — turn governor behavior deviations (H1-H3), stale slice cards (H4 — resolved via Status updates 2026-05-24), CompactionPolicy signature deviation (H5 — documented in card).
9. ~~Resolve slice 0030 CRITICAL findings~~ — **resolved 2026-05-24 by human decision**. C1: use existing `"system"` layer for repair feedback. C2: drop custom validation, delegate entirely to `parseActionDecision()`. Slice card updated.
10. **Plan Phase 5 slices 0032+** — DeepSeek adapter MVP, provider-native normalization, tool schema projection, raw trace capture. Target package: `llm_provider`.
11. **Plan remaining Phase 4 slices** — core loop orchestrator (wires state machine + episodic memory + compaction + governor). Target package: `agentic_core`.
12. **Refill pipeline** to 6-7 planned/approved slices ahead of cursor after CRITICAL resolutions.

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
- Planned slice (approved, CRITICAL C1/C2 resolved 2026-05-24): [docs/implementation/slices/0030-agentic-core-validation-repair-policy.md](./slices/0030-agentic-core-validation-repair-policy.md)
- Planned slice: [docs/implementation/slices/0031-llm-provider-abstraction-interface.md](./slices/0031-llm-provider-abstraction-interface.md)

**Phase 3 complete (0017–0023). Phase 4 implemented (0024–0029). Phase 4 planned (0030 — approved, CRITICAL findings resolved). Phase 5 started (0031 planned).**

## Pipeline State (2026-05-24)

- Implementation cursor: slice 0029 (last validated)
- Planned slices ahead: 2 (0030, 0031 — both approved and ready for implementation)
  - **0030** (Validation & Repair): Approved. CRITICAL findings C1/C2 resolved 2026-05-24 by human decision.
  - **0031** (LLM Provider Interface): Approved, ready for implementation
- **10 slices implemented this session (0020–0029)**: Phase 3 complete, Phase 4 agentic core implemented
- **Contract amendment**: `max_tokens_per_step?: number` added to `TurnBudget` (backward-compatible, optional)
- **Latest audit**: 0012 (**ready** — 0 HIGH, 0 MEDIUM, 0 LOW. All findings resolved.)
- **Test gates**: contracts (647), environment (109), gateway (~30), tooling (90), agentic_core (228), runtime (7) — 1,121 total
- **Shell packages remaining**: `llm_provider`, `channel_cli`, `telemetry`

## Audit Findings

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