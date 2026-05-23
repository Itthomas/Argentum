# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: argentum-adversarial-review plus workflow synthesis
- Approval date: 2026-05-21
- Phase: 1
- Owner: contracts
- Execution readiness: validated
- Validation note: focused `@argentum/contracts` runtime-config tests and package-entrypoint validation are present, and local validation passed with `pnpm --filter @argentum/contracts test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Runtime config contract and validation schema
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package defines a canonical `RuntimeConfigDTO` shape that matches the required sections and fields in the spec.
  - The slice includes a schema or validator that can reject missing required sections, invalid required fields, and wrong primitive types without inventing hidden defaults.
  - Validation is strict: unknown sections, unknown fields, key stripping, and value coercion are rejected rather than silently accepted.
  - Contract-focused tests prove valid and invalid runtime-config shapes deterministically.
- Inputs crossing the boundary:
  - Operator-authored JSON configuration content intended for `RuntimeConfigDTO` validation.
- Outputs crossing the boundary:
  - Typed runtime-config contract exports for the composition root and environment layer.
  - A local validation helper or schema surface suitable for later reuse by the environment slice, while remaining contract-only and free of loader or environment-specific result DTOs.

## Plan

- First contracts or interfaces to create:
  - `RuntimeConfigDTO` TypeScript type surface
  - Runtime-config validation schema or parser
- Minimal implementation steps:
  - Add `contracts` exports for the runtime-config contract.
  - Encode the required section and field rules from the spec.
  - Add contract validation tests for accepted and rejected configs.
- Required tests:
  - Contract validation tests for valid config documents.
  - Contract validation tests for missing required sections.
  - Contract validation tests for invalid constrained values such as `provider.name`, `queue_overflow_policy`, and `telemetry.format`.
  - Contract validation tests proving optional fields may be omitted or present without hidden defaults being materialized in the contracts layer.
  - Contract validation tests covering the `features` section when omitted, when present with the supported toggle, and when unknown feature keys are supplied.
  - Contract validation tests for wrong primitive types in integer and boolean fields.
  - Contract validation tests proving unknown sections, unknown nested fields, key stripping, and coercion are rejected.
  - Contract validation tests rejecting unsupported secret-bearing fields such as `api_key` or nested secret blobs, rather than treating them as tolerated extras.
  - A boundary-focused test that exercises the public exported validator or parser entrypoint in strict mode, not just schema internals.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck` as secondary confirmation

## Execution Strategy

- Autopilot suitability: safe. This is a single-package, contract-first slice with concrete spec ownership and a narrow validation target.
- Parallel subagent opportunities:
  - Read-only extraction of exact required fields from [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md)
  - Read-only test-case extraction from [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Out of scope:
  - Updating `config/runtime.json` or `config/runtime.example.json`
  - Loading config from disk
  - Resolving relative paths
  - Provider initialization
  - `RuntimePolicyDTO` derivation implementation
  - Loader-facing result or error DTO design
  - Any contracts beyond the runtime-config slice unless required for the runtime-config contract itself
- Deferred decisions that must remain deferred:
  - Local persistence implementation details
  - Exact DeepSeek endpoint/model choice beyond the current bootstrap defaults

## Review Log

- Adversarial review findings:
  - Do not let example config files become the authority for the runtime-config contract.
  - Keep loader-facing result surfaces out of the `contracts` slice.
  - Expand required tests to cover optional fields, invalid provider selection, and wrong primitive types.
  - Require strict validation for unknown fields and unsupported secret-bearing extras.
  - Keep the exported validator or schema contract-only and explicitly cover the optional `features` section.
- Refinements applied:
  - Reworded the implementation steps so the spec remains authoritative and example configs follow it.
  - Removed the implied loader-facing validation result surface from the slice.
  - Expanded the required test obligations and narrowed the primary validation gate to the contracts package test suite.
  - Removed config-file maintenance from scope and added strict unknown-field rejection to the acceptance criteria and test list.
  - Added explicit `features`-section coverage and a public-entrypoint validation test.

## Approval Note

- This slice is approved for the first agentic implementation run.
- The slice enforces shape-level strictness for unsupported secret-bearing fields, not semantic secret detection inside otherwise allowed string fields.