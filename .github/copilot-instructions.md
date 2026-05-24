# Argentum Project Guidelines

## Spec Authority

- Treat [docs/spec/README.md](../docs/spec/README.md) as the entrypoint for any implementation task.
- Treat the spec tree under [docs/spec](../docs/spec) as the authoritative source of truth for MVP behavior.
- Do not edit the canonical spec unless the user explicitly asks for spec changes.
- Ignore derived guidance in [docs/Argentum_Modular_Agentic_Framework.md](../docs/Argentum_Modular_Agentic_Framework.md) when it conflicts with the spec tree.

## Frozen MVP Rules

- Preserve provider-neutral core-loop behavior and canonical contracts at every module boundary.
- Keep one implementation per modular boundary for MVP.
- Execute multi-tool decisions sequentially.
- Compact tool outputs inline before they enter episodic memory.
- Treat bedrock as immutable during normal runtime.
- Enforce one active turn per session with FIFO queued ingress and reject-newest overflow at 8 queued items.
- Load and validate one JSON runtime config before composition completes.

## Implementation Style

- Work spec-first and contract-first.
- Keep each implementation slice bounded to one owning module or boundary.
- Prefer small vertical slices with focused validation over broad scaffolding.
- Follow the package targets in [docs/spec/50-implementation/package-boundaries.md](../docs/spec/50-implementation/package-boundaries.md).
- Follow the testing obligations in [docs/spec/50-implementation/test-strategy.md](../docs/spec/50-implementation/test-strategy.md).

## Planning Defaults

- Start from the relevant spine docs, then the owning leaf spec, then the nearest acceptance criteria.
- When planning, name the target package, owned contracts, acceptance criteria, validation command or test, and explicit out-of-scope items.
- Defer unresolved choices listed in [docs/spec/70-roadmap/deferred-decisions.md](../docs/spec/70-roadmap/deferred-decisions.md) instead of inventing durable answers.

## Current Repo State

- Slices 0001–0011 are validated (contracts boot, environment config loading, runtime bootstrap, gateway admission through release/dequeue).
- Packages `contracts`, `environment`, `gateway`, and `apps/runtime` have real implementation code and non-vacuous test gates.
- Packages `agentic_core`, `llm_provider`, `tooling`, `channel_cli`, and `telemetry` are shells awaiting their first implementation slices.
- The `argentum-orchestrator` agent is the recommended workflow driver for advancing the implementation pipeline.
- If a build, test, or lint command does not exist yet for a target package, the slice may create the minimum project scaffolding needed.