# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-25
- Phase: 6 (CLI Channel and end-to-end wiring)
- Owner: apps/runtime
- Execution readiness: ready-when-approved once slice 0040 is validated. This slice is the first runtime proof that must show the 0040 discovery seam is wired non-vacuously into `runCliTurn()` rather than merely tolerated by the composition harness.

## Scope

- Slice name: Runtime tool-call end-to-end happy path
- Target package or boundary: `apps/runtime` (`@argentum/runtime`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md) — turn lifecycle requires infer → validate → execute tools → compact → infer again → respond
  - [docs/spec/10-architecture/system-context.md](../../spec/10-architecture/system-context.md) — runtime wires channel, gateway, agentic core, provider, tooling, and telemetry boundaries
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — MVP `tool_calls` decisions execute sequentially and always re-enter `building_context` after compaction
  - [docs/spec/30-core-loop/compaction-policy.md](../../spec/30-core-loop/compaction-policy.md) — large tool outputs are summarized before memory commit
  - [docs/spec/40-modules/tool-layer/tool-discovery.md](../../spec/40-modules/tool-layer/tool-discovery.md) — runtime may expose a narrowed subset per step, but discovery remains registry-driven and provider-neutral
  - [docs/spec/20-contracts/turn-envelope.md](../../spec/20-contracts/turn-envelope.md) — `finalEnvelope.final_outcome` is the canonical finalized-outcome field and `step_count` tracks completed inference decision cycles
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires one end-to-end tool-call path with compaction and final response
  - [docs/spec/50-implementation/persistence-plan.md](../../spec/50-implementation/persistence-plan.md)
- Acceptance criteria:
  - `runCliTurn()` supports one deterministic tool-call turn from CLI input through final rendered response.
  - The runtime uses the slice 0040 discovery seam through the shipped `apps/runtime/src/tooling-composition.ts` path while the E2E harness registers one selected tool plus at least one decoy tool through a narrower runtime-local registration seam, proving the composition path is real rather than fully mocked.
  - Human approval resolves the former deferred MVP default-discovery question for this slice: runtime composition may expose all registered tools each step in deterministic registry order. The provider-facing tool list for both inference steps therefore contains the selected tool plus the decoy tool, `llm.started.tool_count` is `2`, and registry state still retains the decoy tool definition after the turn completes.
  - The injected provider test double returns a first `tool_calls` decision naming one registered tool, then a second `respond` decision after tool execution.
  - The tool executes exactly once through the supported runtime composition path; the turn re-enters inference after compaction and ends in `completed` state.
  - Compaction commits a `tool_summary` `ContextItem` before the second inference step, and the second provider request observes the committed summary rather than raw unbounded tool output inline.
  - Telemetry JSONL contains the first `llm.started`, then ordered `tool.planned`, `tool.started`, `tool.finished`, `memory.compaction_started`, `memory.compaction_committed`, the second `llm.started`, terminal `response.completed`, and terminal `turn.completed` records for the turn. Each asserted event includes the minimum contract payload fields from `docs/spec/20-contracts/stream-event-payloads.md`, including `llm.started.request_id`, `llm.started.tool_count`, `tool.*` call identity, `memory.compaction_*` revision fields, and `turn.completed.final_outcome` plus `turn.completed.step_count`.
  - Terminal telemetry semantics are explicit for this exact path: `turn.completed.step_count` equals `2` because one `tool_calls` decision completes compaction and one `respond` decision completes the terminal branch, and `turn.completed.final_outcome`, `response.completed.final_outcome`, and `runCliTurn(...).finalEnvelope.final_outcome` all carry the same completion value.
  - Turn-state telemetry proves the state-machine branch through `validating -> executing_tools -> compacting -> building_context -> inferring -> validating -> responding -> finalizing -> completed`, and the second `llm.started` occurs only after `memory.compaction_committed`.
  - Session lock release and telemetry flush still occur on shutdown after the tool-call turn completes.
  - The slice remains bounded to a single-tool happy path. Multi-tool ordering, blocked grants, and secret-bearing tools remain out of scope.
- Inputs crossing the boundary:
  - `runCliTurn(rawInput, options?)`
  - Runtime-composed gateway, agentic-core, tooling, telemetry, and provider seams
  - One selected fake tool, at least one registered decoy tool, and one provider test double
- Outputs crossing the boundary:
  - Completed `runCliTurn()` result for a tool-call turn
  - Focused runtime tests proving the tool-call happy path

## Plan

- First contracts or interfaces to create:
  - Runtime-local provider test double that emits one `tool_calls` decision and one follow-up `respond` decision
  - Runtime-local fake tool registration helper for the selected-tool plus decoy-tool E2E harness
  - Runtime-local helper for asserting ordered telemetry and state-transition evidence without widening the public runtime API
- Minimal implementation steps:
  1. Extend the runtime test harness to register one deterministic selected tool plus at least one decoy tool in the existing tool registry.
  2. Keep the shipped runtime composition default at human-approved all-tools exposure while moving test control to a narrower runtime-local tool-registration seam so the E2E still exercises the real discovery composition path.
  3. Add a provider double that first returns `tool_calls` and then a final `respond` decision after the tool result is committed.
  4. Assert the provider requests and both `llm.started` events prove the selected and decoy tools are exposed in deterministic registry order while only the selected tool executes.
  5. Assert the real runtime path executes the selected tool exactly once, compacts the result, emits ordered tool and memory events with minimum payload fields, re-enters `building_context`, reinfers, renders the final response, and flushes telemetry.
  6. Assert `turn.completed.step_count === 2` for the one-tool-call-plus-respond path and assert `final_outcome` equality across `response.completed`, `turn.completed`, and `runCliTurn(...).finalEnvelope.final_outcome`.
  7. Keep the implementation limited to the supported `runCliTurn()` seam; do not widen the public runtime API surface.
- Required tests:
  - One tool-call turn completes successfully through `runCliTurn()`.
  - The selected tool runs exactly once and the registered decoy tool does not execute.
  - Both provider requests expose the selected and decoy tools in deterministic registry order, both `llm.started` events assert `request_id` plus `tool_count = 2`, and the registry still retains the decoy after the turn.
  - The second inference request includes the compacted tool-summary context.
  - `turn.state_changed` events prove the branch through `executing_tools`, `compacting`, `building_context`, `responding`, and `finalizing`, and the second `llm.started` occurs only after `memory.compaction_committed`.
  - Rendered output includes acting and final-response states in deterministic order.
  - Telemetry JSONL contains ordered `tool.planned`, `tool.started`, `tool.finished`, `memory.compaction_started`, `memory.compaction_committed`, second-step `llm.started`, terminal `response.completed`, and terminal `turn.completed` records with the minimum required payload fields, including `final_outcome` and `step_count`.
  - `turn.completed.step_count` equals `2` for the one-tool-call-plus-respond path, matching `runCliTurn(...).finalEnvelope.step_count`.
  - `response.completed.final_outcome`, `turn.completed.final_outcome`, and `runCliTurn(...).finalEnvelope.final_outcome` all match exactly.
  - Shutdown still flushes telemetry and leaves the session unlock path intact.
- Narrow validation step:
  - `pnpm --filter @argentum/runtime test -- tool-call`
  - `pnpm --filter @argentum/runtime build`

## Execution Strategy

- Autopilot suitability: conditional. The slice is bounded to `apps/runtime`, but it depends on stable behavior from the runtime composition, tool registry, orchestrator, and telemetry seams.
- Parallel subagent opportunities:
  - Read-only test extraction from [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) and [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md).
- Out of scope:
  - Multi-tool decisions
  - Blocked-grant or denied-tool paths
  - Secret-bearing tool execution
  - Bedrock-mutation attempts
  - Provider-network integration beyond doubles already supported by runtime tests
- Deferred decisions that must remain deferred:
  - Exact initial tool catalog

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - 2026-05-25 HIGH: The initial card made the 0040 discovery integration vacuous by registering only one tool, which could not prove omitted-but-still-registered behavior.
  - 2026-05-25 HIGH: The initial card under-specified tool, memory, and turn-state telemetry ordering and minimum payload checks.
  - 2026-05-25 HIGH: The initial card did not prove the state-machine re-entry through compaction before the second inference step.
  - 2026-05-25 HIGH (follow-up review): Approval remained blocked until terminal telemetry assertions proved semantic correctness, not just field presence, by requiring `turn.completed.step_count = 2` for the one-tool-call-plus-respond path and matching `final_outcome` across `response.completed`, `turn.completed`, and `runCliTurn(...).finalEnvelope.final_outcome`.
  - 2026-05-25 HIGH (latest post-implementation review): Under the human-approved all-tools default, the runtime proof could still pass if composition bypassed `planToolExposure()` and forwarded the registry snapshot directly to the provider; the slice lacked one narrow assertion that the 0040 discovery seam itself was invoked.
  - 2026-05-25 HIGH (latest post-implementation review): `memory.compaction_committed.artifact_count` remained hardcoded in the runtime telemetry mapping instead of reflecting the real compaction output and stored-artifact count.
- Refinements applied:
  - 2026-05-25 review refinement: Added an explicit dependency on validated slice 0040 and required a decoy registered tool so narrowed discovery exposure is behaviorally provable.
  - 2026-05-25 review refinement: Acceptance criteria and tests now require exact ordered `tool.*`, `memory.*`, `llm.started`, `response.completed`, and `turn.state_changed` evidence with minimum payload fields.
  - 2026-05-25 review refinement: The card now explicitly proves the `executing_tools -> compacting -> building_context -> inferring` re-entry path and requires the second inference step to start only after `memory.compaction_committed`.
  - 2026-05-25 review refinement: Terminal success telemetry now explicitly requires `turn.completed` with `final_outcome` and `step_count`, rather than leaving completed-turn proof implicit in generic terminal `turn.*` wording.
  - 2026-05-25 review refinement: Terminal success telemetry now also requires semantic correctness, not just field presence, by asserting `turn.completed.step_count = 2`, matching `finalEnvelope.step_count`, and exact `final_outcome` agreement across `response.completed`, `turn.completed`, and `runCliTurn(...).finalEnvelope.final_outcome`.
  - 2026-05-25 validation refinement: Runtime validation proved the composed terminal telemetry order is `response.completed` followed by `turn.completed`; this remains spec-compliant because the stream-event contracts define minimum payload fields, not cross-family terminal ordering, and the state machine still terminates through `finalizing -> completed`.
  - 2026-05-25 validation refinement: The runtime telemetry pipeline now treats executor-emitted `tool.planned`, `tool.started`, and `tool.finished` records as the authoritative call-scoped tool lifecycle events, avoiding duplicate or ambiguously mapped tool telemetry.
  - 2026-05-25 approval review: Re-review returned no CRITICAL, HIGH, MEDIUM, or LOW findings. The card is approved.
  - 2026-05-25 post-fix adversarial review: No new CRITICAL, HIGH, MEDIUM, or LOW findings were identified after the runtime telemetry refinement and 0041 expectation update.
  - 2026-05-25 post-repair adversarial review: Re-review of the repaired runtime and core-loop terminal-order expectations found no CRITICAL, HIGH, MEDIUM, or LOW findings; the composed implementation, focused tests, and card wording are now aligned.
  - 2026-05-25 orchestrator review: Focused validation passed (`pnpm --filter @argentum/runtime test -- tool-call`, `pnpm --filter @argentum/runtime build`, plus adjacent `pnpm --filter @argentum/agentic-core test -- core-loop-orchestrator`), but the orchestrator's own post-implementation adversarial review found one CRITICAL and two HIGH blockers. CRITICAL: `apps/runtime/src/tooling-composition.ts` hardcodes all-tools exposure and thereby resolves the deferred MVP discovery-mode decision in implementation code. HIGH: the runtime E2E still mocks the entire tooling-composition module, so it does not prove the shipped runtime path uses the real 0040 discovery seam. HIGH: the runtime E2E checks `llm.started.tool_count` but not the required `llm.started.request_id` minimum payload field. Slice 0041 cannot be marked validated until human guidance resolves the CRITICAL default-discovery decision and the follow-on runtime proof is tightened accordingly.
  - 2026-05-25 human decision: MVP runtime composition is explicitly approved to use all-tools exposure by default. This closes the former 0041 CRITICAL blocker about resolving the deferred discovery-mode question in implementation code by human judgment rather than ad hoc agent choice.
  - 2026-05-25 repair: The runtime tool-call E2E no longer mocks `apps/runtime/src/tooling-composition.ts`; it now mocks only a narrower runtime-local tool-registration seam so the test executes the real runtime discovery composition path while registering one selected tool and one decoy tool for the harness.
  - 2026-05-25 repair: `llm.started` telemetry assertions now require both minimum payload fields on both inference steps: `request_id` and `tool_count`.
  - 2026-05-25 validation: `pnpm --filter @argentum/runtime test -- tool-call` passed and `pnpm --filter @argentum/runtime build` completed cleanly after the repair.
  - 2026-05-25 adversarial review: Post-repair review prompted one 0041-local card alignment refinement so the slice text matches the human-approved all-tools default and the narrower registration seam. Follow-up review after that refinement found no new CRITICAL, HIGH, or MEDIUM issues in the repaired implementation slice.
  - 2026-05-25 repair: Added a focused runtime tooling-composition test that spies on `planToolExposure()` and proves the shipped `composeRuntimeTooling()` path delegates to the 0040 discovery seam with the registry snapshot and `{ mode: "all" }`.
  - 2026-05-25 repair: Threaded `artifactCount` from `CoreLoopOrchestrator` compaction output into runtime `memory.compaction_committed` telemetry and updated the runtime tool-call E2E to compare emitted `artifact_count` against the actual stored artifact count under the runtime artifacts root.
  - 2026-05-25 validation: After refreshing the adjacent `@argentum/agentic-core` package export with `pnpm --filter @argentum/agentic-core build`, the required 0041 validation passed cleanly: `pnpm --filter @argentum/runtime test -- tool-call` and `pnpm --filter @argentum/runtime build`.
  - 2026-05-25 adversarial review: Post-repair re-review of the runtime discovery proof and compaction artifact telemetry returned no new CRITICAL or HIGH findings.