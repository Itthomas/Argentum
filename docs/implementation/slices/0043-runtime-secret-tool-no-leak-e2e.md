# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-25
- Phase: 7 (Hardening)
- Owner: apps/runtime
- Execution readiness: implemented-and-validated. This slice reuses the validated slice 0041 `runCliTurn()` tool-call harness and injects the validated slice 0042 deterministic secret resolver through the narrower runtime-local tooling-registration seam, proving the happy-path secret value stays inside the execution boundary and out of emitted runtime surfaces.

## Scope

- Slice name: Runtime secret-using tool no-leak end-to-end proof
- Target package or boundary: `apps/runtime` (`@argentum/runtime`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/40-modules/environment/secrets-and-config.md](../../spec/40-modules/environment/secrets-and-config.md) — acceptance criteria require secret-using execution without secret values entering episodic memory, stream events, or contract payloads
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md)
  - [docs/spec/10-architecture/system-context.md](../../spec/10-architecture/system-context.md)
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — secret handles cross the boundary by handle name only
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - The supported `runCliTurn()` runtime seam can execute one secret-using fake tool with a slice 0042 test resolver injected at composition time, using the tool-call happy-path harness established by slice 0041 rather than a parallel runtime seam.
  - The tool implementation receives the resolved secret value inside the execution boundary only; canonical contracts and runtime events continue to carry handle names only when necessary and never carry the raw secret value.
  - The raw secret value does not appear in episodic memory commits, telemetry JSONL, provider raw-trace refs or raw-trace bodies, rendered output, `ToolResultDTO.human_summary`, stream-event payloads, artifact locators, artifact bodies, or any structured payload body emitted for the test turn.
  - If the secret-bearing happy path emits no persisted artifacts, structured payload bodies, or provider raw traces for the turn, the test explicitly proves their absence; otherwise every emitted artifact body, structured payload body, and provider raw-trace body is scanned and proven free of the raw secret value.
  - The final turn still completes successfully and renders a normal assistant response.
  - The slice stays test-harness scoped. It proves the runtime invariant without choosing a production secret backend, changing deny-path policy, or widening the supported runtime API.
- Inputs crossing the boundary:
  - `runCliTurn(rawInput, options?)`
  - One injected secret resolver test adapter
  - One fake secret-using tool registered in the runtime harness
- Outputs crossing the boundary:
  - Focused runtime E2E tests proving secret-safe execution and no-leak invariants

## Plan

- First contracts or interfaces to create:
  - Runtime-local secret-using tool double
  - Runtime-local helper for scanning memory, telemetry, rendered output, emitted artifact bodies, and structured payload bodies for forbidden secret values
- Minimal implementation steps:
  1. Compose runtime tests with the slice 0042 deterministic secret resolver on top of the validated slice 0041 tool-call happy-path harness.
  2. Register a fake tool that needs one secret handle and uses the resolved value internally without echoing it.
  3. Drive one `runCliTurn()` tool-call turn that exercises the secret-bearing path.
  4. Assert the resolved secret value never appears in memory entries, telemetry lines, provider raw traces, rendered output, `ToolResultDTO` summaries, stream-event payloads, artifact locators, artifact bodies, or structured payload bodies.
  5. Keep the proof package-owned by runtime; do not widen environment or telemetry public APIs just to inspect internals.
- Required tests:
  - Secret-using tool turn completes successfully.
  - Resolved secret value is absent from rendered output.
  - Resolved secret value is absent from telemetry JSONL.
  - Resolved secret value is absent from committed `ContextItem` content and summaries.
  - Resolved secret value is absent from `ToolResultDTO.human_summary` and any emitted `StreamEvent` payloads.
  - Persisted provider raw traces, artifact bodies, and structured payload bodies are either absent for the turn or, when present, are scanned and proven free of the raw secret value.
- Narrow validation step:
  - `pnpm --filter @argentum/runtime test -- secret`
  - `pnpm --filter @argentum/runtime build`

## Execution Strategy

- Autopilot suitability: conditional. The slice is a bounded runtime proof, but it depends on runtime composition, telemetry, memory, and the slice 0042 secret-resolver seam.
- Parallel subagent opportunities:
  - Read-only redaction checklist against [docs/spec/40-modules/environment/secrets-and-config.md](../../spec/40-modules/environment/secrets-and-config.md).
- Out of scope:
  - Production secret backend implementation
  - Session-secret support
  - Multi-tool secret flows
  - Missing-secret deny-path semantics and blocked-result proof, which stay with slice 0044
  - Generic secret redaction middleware beyond the targeted runtime proof
- Deferred decisions that must remain deferred:
  - Exact production secret-value backend
  - Any richer approval or operator workflow for secret-bearing tools

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - 2026-05-25 HIGH: The initial card excluded artifact locators but did not require proof over artifact bodies or structured payload bodies, leaving a direct no-leak gap against the secret-storage spec.
  - 2026-05-25 HIGH: The initial card mixed a missing-secret negative case into the happy-path slice without specifying the required blocked-grant semantics.
  - 2026-05-25 MEDIUM: The initial card named slice 0042 but did not explicitly pin dependency on the slice 0041 tool-call runtime seam.
- Refinements applied:
  - 2026-05-25 review refinement: Added execution-readiness dependencies on validated slices 0041 and 0042 and made the secret path explicitly reuse the 0041 tool-call harness.
  - 2026-05-25 review refinement: Expanded no-leak proof obligations to include artifact bodies and structured payload bodies, with an explicit absent-or-scanned test requirement.
  - 2026-05-25 review refinement: Removed missing-secret deny-path proof from this happy-path slice and left blocked-result semantics to slice 0044 so the boundary stays tight.
  - 2026-05-25 approval review: Re-review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. The card is approved.
  - 2026-05-25 implementation refinement: Added `apps/runtime/tests/secret-tool.no-leak.e2e.test.ts`, reusing the slice 0041 `runCliTurn()` tool-call harness with a narrower runtime-local tooling-registration mock that injects the slice 0042 `StaticSecretHandleResolver` and resolves the granted handle only inside the fake tool implementation.
  - 2026-05-25 implementation refinement: Added runtime-local no-leak assertions over rendered output, telemetry JSONL, rendered stream events, `ToolCallDTO`, `ToolResultDTO`, final envelope JSON, provider-visible `ContextItem` metadata, provider-resolved content, persisted working-area files, and absent artifact or structured-payload surfaces for the turn.
  - 2026-05-25 validation: Focused runtime validation passed: `pnpm --filter @argentum/runtime test -- secret` and `pnpm --filter @argentum/runtime build`.
  - 2026-05-25 adversarial review: Read-only subagent re-review of the implemented runtime proof did not surface any CRITICAL, HIGH, MEDIUM, or LOW findings.
  - 2026-05-25 HIGH: The implementation captured only provider-visible tool names, not the full `available_tools` payload or full `LLMInferenceRequest`, so a contract-payload secret leak outside tool names could regress unnoticed.
  - 2026-05-25 HIGH: The implementation proved one selected tool execution but did not explicitly prove zero decoy execution, exact single selected-tool lifecycle events, or a single selected-tool `tool_summary` item in the second provider request.
  - 2026-05-25 implementation refinement: Extended the runtime-local provider stub to capture the full provider-visible `available_tools` array and a full `LLMInferenceRequest` snapshot for every inference step, then asserted both serialized payloads remain secret-free on each step.
  - 2026-05-25 implementation refinement: Added explicit `decoyExecutionCount === 0`, exact one-each `tool.planned`/`tool.started`/`tool.finished` assertions for the selected tool, no decoy lifecycle-event references, and an exact single `tool_summary` proof in the second provider request.
  - 2026-05-25 validation: Revised slice 0043 validation passed: `pnpm --filter @argentum/runtime test -- secret` and `pnpm --filter @argentum/runtime build`.
  - 2026-05-25 adversarial review: Post-revision read-only subagent review was requested three times but did not complete because the subagent service timed out before returning findings.
  - 2026-05-25 HIGH: The repaired proof still constrained only `tool.planned`, `tool.started`, and `tool.finished`, leaving a gap where a decoy tool could still appear as `tool.blocked` without execution and pass the slice.
  - 2026-05-25 implementation refinement: Expanded the slice 0043 runtime proof to collect the full `tool.*` telemetry family, assert zero telemetry `tool.blocked` events for the turn, require every tool-family payload carrying `tool_name` to reference only the selected tool, and keep rendered tool lifecycle events free of any decoy tool references.
  - 2026-05-25 HIGH: The rendered-side proof remained implicit because it did not explicitly assert zero rendered `tool.blocked` events or explicit absence of the decoy tool name and blocked lifecycle text in user-visible rendered output.
  - 2026-05-25 implementation refinement: Tightened `apps/runtime/tests/secret-tool.no-leak.e2e.test.ts` to add a `renderedToolBlockedEvents` filter with an explicit zero-count assertion, plus explicit rendered-output negative assertions for decoy tool-name absence and blocked lifecycle text absence for both the selected and decoy tools.
  - 2026-05-25 validation: Rendered-side proof repair passed focused runtime validation: `pnpm --filter @argentum/runtime test -- secret` and `pnpm --filter @argentum/runtime build`.
  - 2026-05-25 adversarial review: Read-only subagent re-review after the rendered-side proof repair did not surface any new HIGH findings.
  - 2026-05-25 HIGH: The repaired proof still required the provider-visible tool list to equal the selected tool plus the decoy tool on both inference steps, which over-constrained slice 0043 to the current all-tools exposure choice and risked resolving a deferred tool-exposure decision inside a secret no-leak proof.
  - 2026-05-25 implementation refinement: Narrowed the provider-visible tool-list assertions so the slice requires only that the selected secret-using tool remains exposed when called, while keeping the decoy-tool non-execution, no-render, no-tool-event, and no-secret-leak proofs unchanged.
  - 2026-05-25 HIGH: The repaired test still asserted selected-tool exposure on the second provider request, which kept slice 0043 coupled to a future second-step exposure policy despite the slice owning only the no-leak invariant.
  - 2026-05-25 implementation refinement: Removed the second-request selected-tool exposure assertion and left only the first-step callable-tool check plus the existing no-leak scans over both provider-visible request payloads.
  - 2026-05-25 HIGH: The no-leak proof still ignored provider raw traces even though the runtime exposes a trace-writer seam and the persistence plan treats raw provider traces as persisted runtime data.
  - 2026-05-25 implementation refinement: Extended the slice 0043 provider stub to write deterministic `raw_trace_ref` artifacts through the runtime trace hook, required at least one emitted provider trace for the happy path, and added explicit no-leak scans over persisted log files, `raw_trace_ref` values, and raw trace bodies.
  - 2026-05-25 validation: Final slice 0043 validation passed after the provider-trace repair: `pnpm --filter @argentum/runtime test -- secret` and `pnpm --filter @argentum/runtime build`.
  - 2026-05-25 adversarial review: Final post-repair implementation review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. Slice 0043 is validated.