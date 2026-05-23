# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: workflow synthesis plus adversarial review
- Approval date: 2026-05-22
- Phase: 2
- Owner: contracts
- Execution readiness: validated
- Validation note: focused `@argentum/contracts` ingress and package-entrypoint tests are present, and local validation passed with `pnpm --filter @argentum/contracts test` plus `pnpm typecheck` on 2026-05-22.

## Scope

- Slice name: Canonical ingress contract and nested message-part validation
- Target package or boundary: `contracts`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/00-overview/mvp-scope.md](../../spec/00-overview/mvp-scope.md)
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md)
  - [docs/spec/20-contracts/ingress-contract.md](../../spec/20-contracts/ingress-contract.md)
  - [docs/spec/20-contracts/message-part.md](../../spec/20-contracts/message-part.md)
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The `contracts` package exports canonical `IngressDTO` and `MessagePart` type surfaces plus stable parse or validate entrypoints that later gateway and channel slices can import directly.
  - The exported contract surface models `IngressDTO` and `MessagePart` as read-only canonical data and does not introduce gateway-local defaults, channel-local fields, or provider-specific payloads.
  - `MessagePart` validation enforces the MVP rule that `kind = text` requires a `text` string, rejects unknown keys, and `IngressDTO.message_parts` preserves caller-provided ordering exactly.
  - `IngressDTO` validation enforces the required top-level ingress fields from [docs/spec/20-contracts/ingress-contract.md](../../spec/20-contracts/ingress-contract.md), validates `received_at` as a UTC ISO-8601 timestamp string, requires `metadata` to be an object when present, and rejects unknown top-level fields.
  - The validator composes the canonical `MessagePart` contract for `message_parts` and does not merge transport `metadata` into semantic content automatically.
  - The slice keeps attachment shape deferred: `attachments` may be omitted or an empty array, but when present it must validate as an array and this slice does not define or validate a non-empty attachment item schema before attachments are in MVP scope.
  - The slice remains contract-only. It does not assign `ingress_id`, resolve sessions, perform queue admission, create `TurnEnvelope` values, or normalize channel-specific payloads.
- Inputs crossing the boundary:
  - Ingress-shaped values produced by channel normalization seams or gateway-owned callers before admission decisions.
  - Message-part-shaped values nested inside `IngressDTO.message_parts`.
- Outputs crossing the boundary:
  - Typed `IngressDTO` and `MessagePart` exports reused by gateway and channel packages.
  - Stable contract-owned parser or validator entrypoints and validation issue surfaces for ingress input.

## Plan

- First contracts or interfaces to create:
  - `MessagePart` type export for the canonical inbound content unit.
  - Contract-owned parser or validator entrypoint for `MessagePart` plus issue or error surfaces consistent with the existing `@argentum/contracts` package pattern.
  - `IngressDTO` type export for canonical inbound user input.
  - Contract-owned parser or validator entrypoint for `IngressDTO` plus issue or error surfaces consistent with the existing `@argentum/contracts` package pattern.
  - Public index exports for the new message-part and ingress-contract surfaces.
- Minimal implementation steps:
  - Add a `message-part` contract module under `packages/contracts` that enforces the MVP `text` part shape, rejects unknown keys, and does not widen to post-MVP part kinds.
  - Add an `ingress-contract` module under `packages/contracts` that composes the `MessagePart` validator, validates the required ingress fields, enforces UTC timestamp parsing rules for `received_at`, and keeps `metadata` as a non-semantic object field.
  - Keep `attachments` intentionally narrow by requiring an array when present and allowing only omission or an empty array, so the implementation does not invent a durable attachment item schema ahead of the deferred spec decision.
  - Export only the stable public contract surfaces from `packages/contracts/src/index.ts`.
  - Leave ingress-id assignment, session resolution, queue admission, and `TurnEnvelope` creation to later owning slices.
- Required tests:
  - Contract validation tests for a valid `MessagePart` with `kind = text`.
  - Contract validation tests for a valid `IngressDTO` with ordered `message_parts`, omitted `attachments`, and optional object `metadata`.
  - Contract validation tests for a valid `IngressDTO` with an explicit empty `attachments` array.
  - Contract validation tests rejecting missing required ingress fields, wrong primitive types, invalid `received_at` timestamps, non-object `metadata`, non-array `attachments`, and unknown top-level fields.
  - Contract validation tests rejecting invalid `MessagePart` values, including unsupported `kind` values, missing `text`, unknown keys, and non-object items inside `message_parts`.
  - Contract validation tests proving `message_parts` ordering is preserved by the public validator entrypoint.
  - Contract validation tests rejecting non-empty `attachments` input until a later slice defines the canonical attachment item shape.
  - Boundary-focused tests that exercise the public exports from `@argentum/contracts` rather than schema internals.
- Narrow validation step:
  - `pnpm --filter @argentum/contracts test`
  - `pnpm typecheck`

## Execution Strategy

- Autopilot suitability: safe. This is a single-package, contract-first slice with a named owner, concrete acceptance criteria, no unresolved bootstrap blockers, and a non-vacuous package test target.
- Parallel subagent opportunities:
  - Read-only extraction of ingress-field and message-part edge cases from [docs/spec/20-contracts/ingress-contract.md](../../spec/20-contracts/ingress-contract.md) and [docs/spec/20-contracts/message-part.md](../../spec/20-contracts/message-part.md) for test planning.
  - Read-only downstream scan of gateway-facing planning artifacts to confirm the public export surface needed by [docs/implementation/slices/0006-gateway-ingress-admission.md](./0006-gateway-ingress-admission.md) stays minimal.
- Out of scope:
  - Ingress ID generation timing beyond the contract rule that the gateway owns assignment.
  - Session resolution, queue admission, queue events, or any gateway persistence behavior.
  - `TurnEnvelope` creation or any agentic-core orchestration.
  - Channel-specific normalization logic for terminal input.
  - Non-empty attachment metadata or artifact-reference schema.
  - Provider-facing prompt content or any provider adapter behavior.
- Deferred decisions that must remain deferred:
  - The exact canonical shape of non-empty attachment metadata once attachments enter MVP scope.

## Review Log

- Adversarial review findings:
  - Initial review found that the ingress contract could not be implemented cleanly without also exporting the directly referenced canonical `MessagePart` surface.
  - Initial review found that attachment handling would leak a deferred decision unless the slice explicitly kept non-empty `attachments` out of scope.
  - Follow-up adversarial review found no additional blocking drift, boundary, validation, or deferred-decision issues once the slice was kept contract-only and the attachment scope was narrowed.
  - Follow-up slice review found that the card should explicitly require `attachments` to validate as an array when present and should make unknown-key rejection explicit for nested `MessagePart` values.
  - Post-implementation review found one low-severity boundary-test gap: the tests exercised the source index rather than the built package entrypoint, so the package export surface itself was not yet proved.
- Refinements applied:
  - Chose `@argentum/contracts` as the owner because slice 0006 is blocked on a missing upstream canonical `IngressDTO` boundary.
  - Kept the slice bounded to `IngressDTO` plus its direct nested `MessagePart` dependency instead of widening into gateway or channel behavior.
  - Converted the attachment ambiguity into an explicit out-of-scope rule so the slice does not invent a durable schema ahead of the spec.
  - Marked autopilot safe because the slice has a single owning boundary and a narrow executable validation target in the existing contracts package.
  - Tightened the acceptance criteria, implementation steps, and tests so `attachments` must be an array when present and nested `MessagePart` values reject unknown keys.
  - Added a package-entrypoint smoke test through `@argentum/contracts` and updated the package test command to build before running Vitest so the published export surface is validated directly.