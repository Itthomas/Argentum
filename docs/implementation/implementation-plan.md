# Argentum Implementation Plan

## Purpose

This plan converts the authoritative Argentum spec into a sequence of implementation phases that can be executed with the repo's Copilot workflow.

## Planning Principles

- Implement the MVP in spec order, not by convenience.
- Prefer contract-first and package-local slices.
- Keep deferred decisions deferred unless the spec is updated.
- Require focused validation after each non-trivial slice.

## Phase 0: Planning Layer And Repo Workflow

Objective: establish the shared Copilot operating layer before runtime code exists.

Deliverables:

- Repo-wide instruction file
- On-demand planning and test instructions
- Runnable prompts for planning, implementation, and review
- Custom agents for planning, implementation, and adversarial review
- Audit agent and prompt for repo-wide implementation reviews
- Skills for spec slicing and contract-first implementation
- Durable planning artifacts under `docs/implementation/`
- This implementation plan and the Copilot workflow document

Exit criteria:

- A contributor can derive, persist, execute, and review one slice entirely through repo-local Copilot assets.

## Phase 1: Bootstrap Runtime Skeleton

Objective: create the first code-bearing structure without widening beyond the package plan.

Precondition:

- The global bootstrap decisions recorded in [docs/implementation/bootstrap-decisions.md](./bootstrap-decisions.md) are filled and approved.
- Slice-specific bootstrap blockers remain allowed where they only affect later slices.

Target packages:

- `contracts`
- `environment`
- `telemetry`
- composition root package or application entry package

Initial slices:

1. Project scaffold and package layout matching [docs/spec/50-implementation/package-boundaries.md](../spec/50-implementation/package-boundaries.md)
2. Canonical contract definitions for the config, content, ingress, turn, action, tool, event, and adapter boundaries
3. JSON runtime config loading and validation
4. Flat stream-event emitter and telemetry persistence seam

Required validation:

- Contract-shape tests
- Config validation tests
- Telemetry minimum-payload tests

Autopilot guidance:

- Safe for individual contract groups and config-loading slices
- Not safe for choosing the language stack or persistence technology unless explicitly decided first

## Phase 2: Gateway Core

Objective: implement deterministic session routing, queueing, locking, and turn creation.

Initial slices:

1. Session identity and routing key resolution
2. Ingress creation before admission outcome
3. FIFO queueing with reject-newest overflow at 8 queued items
4. Turn-envelope creation with stamped budget defaults
5. Session-scoped queue events and turn-start events

Required validation:

- Queue overflow tests
- Lock exclusivity tests
- Event ordering tests for queue transitions

Parallel review opportunity:

- Independent extraction of gateway edge cases from [docs/spec/40-modules/gateway/queueing-and-locking.md](../spec/40-modules/gateway/queueing-and-locking.md)

## Phase 3: Tooling And Environment Boundary

Objective: implement the tool registry, grant resolution, native execution-driver seam, and artifact persistence.

Initial slices:

1. Canonical tool schema model and registry APIs
2. Grant resolver from tool metadata plus `RuntimePolicyDTO`
3. Native execution-driver interface and blocked-grant path
4. Tool result artifact storage and `ContentRef` creation
5. Retry-policy handling for read-only tools only

Required validation:

- Tool schema validation tests
- Grant derivation tests
- Blocked grant tests
- Retry policy tests
- Bedrock immutability enforcement tests

Autopilot guidance:

- Safe for registry and grant slices
- Conditional for execution-driver slices until the stack and host-execution APIs are fixed

## Phase 4: Agentic Core

Objective: implement prompt compilation, context selection, episodic memory, validation-and-repair, and the deterministic turn state machine.

Initial slices:

1. Turn state enum and transition guards
2. Prompt-compiler input model from `ContextItem`
3. Episodic memory commit boundaries
4. Inline compaction behavior and compaction revision tracking
5. Governor enforcement for steps, repairs, and wall clock

Required validation:

- State-machine tests for allowed and forbidden transitions
- Step-count tests for multi-tool decisions
- Compaction tests proving raw outputs are externalized when needed
- Repair exhaustion and governor exhaustion tests

Parallel review opportunity:

- Adversarial review against [docs/spec/30-core-loop/core-loop-state-machine.md](../spec/30-core-loop/core-loop-state-machine.md) and [docs/spec/30-core-loop/compaction-policy.md](../spec/30-core-loop/compaction-policy.md)

## Phase 5: LLM Provider Layer

Objective: implement the provider-neutral interface and the MVP DeepSeek adapter.

Initial slices:

1. `LLMInferenceRequest` and `LLMInferenceResult` boundary wiring
2. Tool-schema projection from registry data
3. Native-tool normalization path
4. Fallback structured JSON or parsed-text normalization path
5. Raw trace persistence by `ContentRef`

Required validation:

- Adapter fixture tests for native and fallback normalization
- Ordering tests for multi-tool decisions
- Failure-path tests for adapter failure and malformed output repair exhaustion inside the adapter

Autopilot guidance:

- Safe for request and result boundary slices
- Conditional for DeepSeek API integration until endpoint and model are explicitly selected

## Phase 6: CLI Channel And End-To-End Wiring

Objective: implement the terminal channel and wire the full MVP path.

Initial slices:

1. CLI input normalization to one text `MessagePart`
2. Terminal rendering from `StreamEvent`
3. Composition root wiring across all packages
4. One end-to-end happy path from input to response
5. One end-to-end tool-call path with compaction and final response

Required validation:

- End-to-end CLI tests
- Terminal rendering tests for user-visible events
- Replayable telemetry inspection for one complete turn

## Phase 7: Hardening And Spec Audit

Objective: prove the MVP invariants before broader feature work begins.

Initial slices:

1. Full spec compliance review against the frozen MVP decisions
2. Test-gap closure against [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md)
3. Operator documentation for runtime config and workspace layout

Required validation:

- Full targeted test suite
- Adversarial review of package boundaries and deferred decisions
- Manual inspection of telemetry and artifact outputs for one representative turn
- Durable audit reports under [docs/implementation/audits](./audits)

## Default Slice Template

Every implementation slice should capture:

- Target package or boundary
- Authoritative spec files
- First contracts or interfaces
- Planned tests
- Focused validation step
- Autopilot suitability
- Parallel subagent opportunities
- Out-of-scope items

Persist each slice as a file under [docs/implementation/slices](./slices).

Use the `/spec-to-slice` skill to generate the next slice card, and treat `/plan-argentum-slice` as an alternate prompt wrapper rather than the default workflow entrypoint.