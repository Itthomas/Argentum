# Bootstrap Decisions

## Purpose

This file records the implementation choices that must be settled before Phase 1 code scaffolding begins.

These are planning decisions, not spec changes. They must stay consistent with the authoritative spec and must not resolve deferred behavior beyond what is needed to scaffold the MVP reference implementation.

## Status

- Global blockers must be filled before the first code-bearing slice starts.
- Slice-specific blockers may remain pending until a dependent slice is ready.

## Global Blockers

### Implementation Language And Runtime

- Status: approved
- Decision: TypeScript targeting Node.js 22 LTS.
- Rationale: This is the best fit for the MVP's contract-heavy, package-oriented architecture. TypeScript gives strong DTO and boundary modeling for the canonical contracts, while Node provides straightforward local filesystem, process-execution, and CLI integration for the environment, tool, and channel layers. This choice supports the package split in the spec without adding unnecessary ceremony to the first implementation slices.
- Affects packages: contracts, channel_cli, gateway, agentic_core, llm_provider, tooling, environment, telemetry, and the composition root.

### Build And Test Tooling

- Status: approved
- Decision: Use `pnpm` for workspace/package management, TypeScript project references for package boundaries, Vitest for unit and boundary tests, and ESLint for static linting.
- Rationale: This toolchain matches the spec's recommended package split and the required MVP test matrix. `pnpm` keeps the workspace lean and supports a multi-package layout cleanly. TypeScript project references reinforce package-local boundaries. Vitest is fast enough for contract, state-machine, gateway, tooling, and end-to-end harness tests. ESLint provides an early guardrail against drift while the repo is still greenfield.
- Affects packages: contracts, channel_cli, gateway, agentic_core, llm_provider, tooling, environment, telemetry, tests, and the composition root.

### Runtime Config File Location

- Status: approved
- Decision: Store the operator-facing runtime config at `config/runtime.json`, with a checked-in example file such as `config/runtime.example.json`. The composition root may later accept an override path, but the default repo-local location is `config/runtime.json`.
- Rationale: The spec requires one validated JSON runtime config document before composition completes. A repo-local default path keeps the config discoverable for implementation, test setup, and local execution, while still preserving the rule that secret values stay out of the file. This gives Phase 1 a concrete bootstrap target without committing the runtime to a permanent deployment-specific path.
- Affects packages: environment, gateway, tooling, llm_provider, telemetry, and the composition root.

## Slice-Specific Blockers

### Startup Secret Handle Discovery Convention

- Status: decided for current bootstrap slices
- Decision: Until a concrete host-managed secret backend is implemented, the environment package checks startup secret-handle availability by reading handle names from the host-provided `ARGENTUM_SECRET_HANDLES` variable. This temporary seam is limited to handle-name discovery and must not carry raw secret values.
- Rationale: Slice 0002 requires explicit startup validation for config-referenced secret handles, while the spec still leaves the concrete secret-loading mechanism deferred. Recording the current host convention makes the bootstrap seam explicit for implementers and tests without resolving the longer-term secret backend choice ad hoc.
- Affects packages: environment, tooling, llm_provider, and the composition root.

### Local Persistence Technology

- Status: decided for dependent slices
- Decision: Use SQLite as the local persistence mechanism for session metadata, lock state, queued ingress, and turn metadata when the gateway and persistence slices begin.
- Rationale: SQLite is the cleanest fit for deterministic local persistence once queueing, locking, and turn lifecycle state become real implementation concerns. It provides stronger correctness guarantees than ad hoc file-backed storage while staying simple to inspect locally during MVP development. This decision intentionally does not block the initial contract, config-loading, telemetry, or composition slices.
- Current implementation note: the MVP reference implementation currently uses Node.js 22's built-in `node:sqlite` driver, including `DatabaseSync`, for the first SQLite-backed gateway persistence seam. This records the active adapter choice without changing the higher-level SQLite decision.
- Affects packages: gateway, environment, telemetry, and any persistence adapter or storage seam introduced by the composition root.

## Notes

- Do not use this file to redefine canonical runtime behavior.
- When a decision is still unclear, keep it pending and do not start the dependent code slice.
- These choices are implementation bootstrap decisions for the MVP reference implementation, not new normative spec behavior.