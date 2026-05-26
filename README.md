# Argentum

Argentum is a modular, local-first agent runtime built around a deterministic turn loop. The agentic core is the control plane, the gateway is a routing boundary, and every module communicates through canonical TypeScript contracts.

This repository is intentionally spec-first. The authoritative MVP behavior lives under [`docs/spec/`](docs/spec/README.md), and the implementation advances one bounded slice at a time against that spec.

## Why Argentum

- Deterministic single-agent turn execution with explicit state transitions and bounded repair/governor behavior
- Provider-neutral core loop with normalized LLM decisions behind a concrete DeepSeek adapter
- FIFO session queueing with one active turn per session and reject-newest overflow at 8 queued items
- Inline compaction for large tool outputs before they enter episodic memory
- Flat JSONL telemetry plus persisted content references for replayable debugging
- Immutable bedrock and separate working, artifact, and log roots for runtime state

## Current Status

Argentum's MVP reference implementation is in-repo and validated through slice 0040.

| Package | Current responsibility |
| --- | --- |
| `@argentum/contracts` | Canonical DTOs and validators for config, ingress, turn, tool, provider, telemetry, and content boundaries |
| `@argentum/environment` | Startup config loading, grant resolution, execution-driver seam, artifact storage, and workspace path guarding |
| `@argentum/gateway` | Session routing, queueing, active-turn claims, turn creation, release, and dequeue |
| `@argentum/agentic-core` | State machine, episodic memory, prompt compiler, context selection, compaction, governor, validation repair, and orchestrator |
| `@argentum/llm-provider` | Provider abstraction, tool-schema projection, and DeepSeek adapter |
| `@argentum/tooling` | Tool registry, schema validation, retry policy, and discovery planning |
| `@argentum/channel-cli` | CLI input normalization and terminal rendering |
| `@argentum/telemetry` | JSONL event persistence and flush behavior |
| `@argentum/runtime` | Composition root plus the supported `startRuntime()` -> `runCliTurn()` happy-path seam |

- `pnpm test` currently discovers 1,373 tests across 43 files.
- All workspace packages now have non-vacuous test gates.
- The active implementation cursor and approved next slices live in [`docs/implementation/backlog.md`](docs/implementation/backlog.md).

## Architecture At A Glance

```text
[CLI Channel] -> [Gateway] -> [Agentic Core] -> [LLM Provider]
                                                 |             |
                                                 v             v
                                    [Telemetry]    [Tooling]
                                                                                     |
                                                                                     v
                                                                       [Environment]
```

- **Channel layer** normalizes terminal input and renders stream events back to the user.
- **Gateway** owns session identity, one-active-turn enforcement, FIFO queueing, and turn handoff boundaries.
- **Agentic core** executes the deterministic loop: `accepted -> building_context -> inferring -> validating -> executing_tools -> compacting -> responding -> finalizing`.
- **LLM provider layer** converts provider-specific responses into canonical `ActionDecision` results.
- **Tooling** owns tool definitions, validation, retry policy, and discovery surfaces.
- **Environment** owns runtime config, workspace roots, grants, artifact persistence, and host-execution seams.
- **Telemetry** persists flat JSONL event streams suitable for replay and debugging.

## Repository Layout

```text
argentum/
|- apps/
|  `- runtime/              # Runtime composition root and end-to-end seams
|- packages/
|  |- contracts/            # Canonical shared contracts
|  |- environment/          # Config loading, grants, artifacts, execution seams
|  |- gateway/              # Session routing, queueing, turn ownership
|  |- agentic_core/         # Deterministic loop and memory orchestration
|  |- llm_provider/         # Provider abstraction and DeepSeek adapter
|  |- tooling/              # Registry, schemas, retry, discovery
|  |- channel_cli/          # Terminal input/output adapter
|  `- telemetry/            # JSONL event persistence
|- config/
|  |- runtime.json          # Active runtime configuration
|  `- runtime.example.json  # Example config shape
|- runtime/
|  |- bedrock/              # Immutable runtime inputs
|  |- working/              # Mutable session working area
|  |- artifacts/            # Persisted tool output artifacts
|  `- logs/                 # Telemetry output
`- docs/
       |- spec/                 # Authoritative MVP spec
       `- implementation/       # Backlog, slice cards, and audits
```

## Quick Start

Prerequisites: Node.js 22+ and pnpm 11+

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Before composing the runtime, review [`config/runtime.json`](config/runtime.json). The example at [`config/runtime.example.json`](config/runtime.example.json) shows the expected JSON shape, including workspace roots, governor defaults, gateway queue policy, tool policy, telemetry settings, and the DeepSeek provider block.

## Runtime Entry Points

Argentum does not yet expose a polished root-level CLI command. The supported runtime surface today is the composed API in [`apps/runtime/`](apps/runtime/):

- [`apps/runtime/src/index.ts`](apps/runtime/src/index.ts) exposes `bootstrapRuntime()` and re-exports the runtime composition entrypoint.
- [`apps/runtime/src/composition-root.ts`](apps/runtime/src/composition-root.ts) exposes `startRuntime()` and the supported `runCliTurn()` happy-path seam.
- [`apps/runtime/tests/e2e-happy-path.test.ts`](apps/runtime/tests/e2e-happy-path.test.ts) shows the end-to-end CLI response path.
- [`apps/runtime/tests/tool-call.e2e.test.ts`](apps/runtime/tests/tool-call.e2e.test.ts) shows the tool-call path through the composed runtime.

## Spec Source Of Truth

For implementation work, start with [`docs/spec/README.md`](docs/spec/README.md) and follow the repo's frozen reading order:

1. [`docs/spec/00-overview/framework-overview.md`](docs/spec/00-overview/framework-overview.md)
2. [`docs/spec/00-overview/mvp-scope.md`](docs/spec/00-overview/mvp-scope.md)
3. [`docs/spec/20-contracts/canonical-contracts.md`](docs/spec/20-contracts/canonical-contracts.md)
4. [`docs/spec/30-core-loop/core-loop-state-machine.md`](docs/spec/30-core-loop/core-loop-state-machine.md)
5. The relevant leaf spec under [`docs/spec/40-modules/`](docs/spec/40-modules/)
6. ADRs under [`docs/spec/60-adr/`](docs/spec/60-adr/) when rationale is needed

The vision document at [`docs/Argentum_Modular_Agentic_Framework.md`](docs/Argentum_Modular_Agentic_Framework.md) is non-normative. If it conflicts with the spec tree, the spec tree wins.

## Development Workflow

Argentum uses a contract-first, slice-by-slice workflow:

1. Plan against the authoritative spec and keep the slice bounded to one owning package or boundary.
2. Implement from contracts outward, not from incidental wiring inward.
3. Validate with focused package tests before widening scope.
4. Record cursor state, approved next slices, and audits under [`docs/implementation/`](docs/implementation/).

If you want the live implementation queue rather than a summary, see [`docs/implementation/backlog.md`](docs/implementation/backlog.md).

## MVP Scope

Included in MVP:

- One terminal CLI channel module
- One gateway implementation with local session persistence
- One deterministic single-agent turn loop
- One hybrid DeepSeek adapter behind a provider-neutral boundary
- One provider-neutral tool registry with native host execution
- Inline compaction, immutable bedrock, sequential tool execution, and flat structured telemetry

Explicitly deferred until after MVP:

- Multi-agent orchestration
- Distributed workers or remote execution pools
- Parallel tool execution
- Multiple channel implementations
- Multiple provider implementations
- Bedrock mutation during normal runtime

## License

Not yet assigned.
