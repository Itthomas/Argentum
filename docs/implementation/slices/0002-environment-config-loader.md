# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: audited repo-state sync plus focused validation review
- Approval date: 2026-05-22
- Phase: 1
- Owner: environment
- Execution readiness: validated
- Validation note: focused `@argentum/environment` startup-loader tests are present, and local validation passed with `pnpm --filter @argentum/environment test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Runtime config loader and startup validation path
- Target package or boundary: `environment` plus composition-root seam
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
  - [docs/spec/50-implementation/config-loading-and-validation.md](../../spec/50-implementation/config-loading-and-validation.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - Startup can load one runtime JSON document from `config/runtime.json` or an explicit override path.
  - Invalid config fails startup explicitly before provider, gateway, tool registry, or execution-driver initialization.
  - Valid config produces the derived workspace-root and policy inputs required by later slices.
- Inputs crossing the boundary:
  - File path to the runtime config JSON document.
  - Parsed JSON content validated by the contracts layer.
- Outputs crossing the boundary:
  - Validated runtime-config object available to the composition root.
  - Derived workspace-root and policy inputs for downstream modules.

## Plan

- First contracts or interfaces to create:
  - Config-reader interface or function boundary
  - Startup-facing validation result boundary that consumes the contracts validator
- Minimal implementation steps:
  - Read config from the approved repo-local default path.
  - Support an explicit override path without changing the default.
  - Fail fast on missing or invalid config.
  - Return the validated config object for composition.
- Required tests:
  - Successful load from `config/runtime.json`.
  - Explicit failure for missing file.
  - Explicit failure for invalid config shape.
- Narrow validation step:
  - `pnpm --filter @argentum/environment test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: conditional. The slice is bounded, but it should start only after slice 0001 provides the contracts validator it depends on.
- Parallel subagent opportunities:
  - Read-only review of startup-failure requirements from [docs/spec/50-implementation/config-loading-and-validation.md](../../spec/50-implementation/config-loading-and-validation.md)
- Out of scope:
  - Provider client initialization
  - Gateway startup
  - Secret-value storage backend
  - Hot reload
- Deferred decisions that must remain deferred:
  - Local persistence mechanism implementation
  - Hot-reload behavior for runtime config

## Review Log

- Adversarial review findings:
- Refinements applied: