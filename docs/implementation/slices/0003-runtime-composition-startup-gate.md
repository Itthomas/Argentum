# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: Human review plus adversarial review
- Approval date: 2026-05-22
- Phase: 1
- Owner: apps/runtime
- Execution readiness: validated
- Validation note: focused `@argentum/runtime` bootstrap tests are present, and local validation passed with `pnpm --filter @argentum/runtime test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Runtime composition-root startup gate
- Target package or boundary: `apps/runtime` composition root
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
  - [docs/spec/50-implementation/config-loading-and-validation.md](../../spec/50-implementation/config-loading-and-validation.md)
  - [docs/spec/50-implementation/dependency-injection-plan.md](../../spec/50-implementation/dependency-injection-plan.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The runtime composition root invokes `loadRuntimeStartupConfig` before any provider, gateway, tool registry, agentic-core, execution-driver, or telemetry initialization begins.
  - The composition root may supply an optional override path, but it must reuse the environment-owned startup loader contract rather than introducing a second config-loading DTO or validation seam.
  - If startup config loading fails, runtime bootstrap fails explicitly and no downstream initializer is invoked.
  - If startup config loading succeeds, the composition root returns an app-local bootstrap context that preserves the environment-owned startup result for later wiring, including `configPath`, `runtimeConfig`, `workspaceRoots`, `runtimePolicy`, `governorDefaults`, and `gatewayDefaults`.
  - The slice remains limited to startup gating and composition ordering. It does not begin concrete provider, gateway, tooling, agentic-core, or telemetry wiring beyond proving the gate.
- Inputs crossing the boundary:
  - Optional runtime-config override path supplied to the runtime entry boundary.
  - `RuntimeStartupConfigResult` or `RuntimeStartupConfigError` returned by `@argentum/environment`.
- Outputs crossing the boundary:
  - An app-local runtime bootstrap context ready for later module composition.
  - A fail-fast startup outcome that prevents downstream initialization when config loading fails.

## Plan

- First contracts or interfaces to create:
  - App-local `RuntimeBootstrapOptions` carrying the optional config override path.
  - App-local `RuntimeBootstrapContext` or equivalent composition-state type that reuses `RuntimeStartupConfigResult` without reshaping it into a second cross-package contract.
  - App-local downstream-initializer seam used only to prove bootstrap ordering in focused tests.
- Minimal implementation steps:
  - Add a runtime bootstrap or composition function under `apps/runtime`.
  - Invoke `loadRuntimeStartupConfig` at the start of bootstrap and forward any optional override path.
  - Stop composition immediately on startup-config failure and preserve explicit failure semantics.
  - Return the validated environment-owned startup result inside an app-local bootstrap context for later slices.
  - Keep downstream initializer wiring minimal and app-local so this slice proves ordering without scaffolding provider, gateway, tooling, agentic-core, or telemetry implementations.
- Required tests:
  - A runtime bootstrap test that proves `loadRuntimeStartupConfig` runs before any downstream initializer hook.
  - A runtime bootstrap test that proves an explicit override path is forwarded unchanged to the environment loader.
  - A runtime bootstrap test that proves downstream initializer hooks are not invoked when startup config loading fails.
  - A runtime bootstrap test that proves a successful bootstrap exposes the environment-owned startup result fields required by later slices without redefining them.
  - A runtime bootstrap test that proves startup failure remains explicit to the caller, using the environment-layer error surface rather than a new runtime-specific config error DTO.
- Narrow validation step:
  - `pnpm --filter @argentum/runtime test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe. The slice is bounded to `apps/runtime`, depends on an existing environment-owned seam, and has a narrow validation target in the runtime package test suite plus workspace typecheck.
- Parallel subagent opportunities:
  - Read-only extraction of startup gating requirements from [docs/spec/50-implementation/config-loading-and-validation.md](../../spec/50-implementation/config-loading-and-validation.md) and [docs/spec/50-implementation/dependency-injection-plan.md](../../spec/50-implementation/dependency-injection-plan.md)
  - Read-only extraction of the exact `RuntimeConfigDTO` consumer obligations from [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) and [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
- Out of scope:
  - Provider adapter initialization
  - Gateway, tooling, agentic-core, or telemetry composition beyond a minimal ordering seam
  - CLI flag parsing or operator-facing command design beyond passing an override path into the runtime bootstrap function
  - Secret backend changes
  - Hot reload
- Deferred decisions that must remain deferred:
  - Concrete CLI interface for supplying a runtime-config override path
  - Provider endpoint and model choices beyond the validated runtime config
  - Local persistence implementation details
  - Hot-reload behavior for runtime config

## Review Log

- Adversarial review findings:
  - Pending
- Refinements applied:
  - Narrowed the slice to `apps/runtime` so the environment package remains the sole owner of config loading, validation reuse, and derived startup outputs.
  - Required explicit proof that runtime bootstrap blocks downstream initialization instead of beginning broader composition scaffolding.
  - Kept the startup result authoritative at the environment boundary and limited app-local types to composition state rather than introducing a second loader contract.