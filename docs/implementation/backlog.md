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
- Slice 0009 remains a downstream look-ahead gateway turn-handoff card and now owns the shared gateway-local turn-start handoff contract that both the direct accepted path and the later queue-dequeue path must reuse
- Slice 0011 is now the downstream gateway lock-release and queued-ingress handoff seam that preserves FIFO after turn finalization by returning the shared slice-0009 turn-start handoff during `finalizing`, without widening into core-loop archival or fresh admission work

## Current Validation State

- `@argentum/contracts` has focused contract tests for runtime config, ingress, stream events, content references, and turn envelopes plus a package-entrypoint smoke test, and `pnpm --filter @argentum/contracts test` is non-vacuous.
- `@argentum/environment` has focused startup-loader tests, and `pnpm --filter @argentum/environment test` currently exercises real tests.
- `@argentum/gateway` has focused ingress-admission, session-router, and active-turn-claim boundary tests (including same-session race coverage and preservation-handoff assertions) plus source-entrypoint smoke coverage, and `pnpm --filter @argentum/gateway test` is now non-vacuous.
- `@argentum/runtime` has focused bootstrap tests in the repo, and its package script now uses a non-vacuous `vitest run` gate.
- The workspace-root [package.json](../../package.json) now uses a non-vacuous `vitest run` gate, so repo-level `pnpm test` fails if no tests are discovered anywhere in the workspace.

## Next Actions

1. Start [docs/implementation/slices/0009-gateway-turn-envelope-creation.md](./slices/0009-gateway-turn-envelope-creation.md) as the next active gateway slice now that the upstream slice-0010 exclusive turn-creation authority seam is implemented and validated.
2. Keep [docs/implementation/slices/0011-gateway-lock-release-and-queue-dequeue.md](./slices/0011-gateway-lock-release-and-queue-dequeue.md) inactive until slice 0009 stabilizes the shared turn-start handoff contract it must return during release-and-dequeue.
3. Keep package-level validation notes synchronized in slice cards immediately after future slice validation so the backlog does not drift again.

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
- Approved downstream gateway turn handoff slice; keep it downstream of slice 0010 so turn creation consumes an explicit exclusive authority seam and owns the shared turn-start handoff reused by later dequeue work: [docs/implementation/slices/0009-gateway-turn-envelope-creation.md](./slices/0009-gateway-turn-envelope-creation.md)
- Approved downstream gateway lock-release and queue-dequeue slice; keep it downstream of slices 0010 and 0009 so FIFO handoff after finalization returns the shared turn-start handoff and remains separate from turn creation and core-loop ownership: [docs/implementation/slices/0011-gateway-lock-release-and-queue-dequeue.md](./slices/0011-gateway-lock-release-and-queue-dequeue.md)