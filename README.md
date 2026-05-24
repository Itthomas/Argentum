# Argentum

**A modular agentic runtime built around a deterministic turn loop.**

Argentum is a local-first, provider-neutral agent framework that inverts the conventional architecture: the agentic loop is the control plane, and the messaging gateway is a thin I/O boundary. It communicates exclusively through typed contracts, keeps state ownership explicit, and compacts tool output before it enters working memory.

---

## Architecture at a Glance

```
[Channel] → [Gateway] → [Agentic Core Loop] → [LLM Adapter]
                           │          │
                           ▼          ▼
                    [Tool Layer]  [Environment]
```

- **Channel modules** normalize platform-specific input (CLI, Discord, Slack) into the framework's canonical ingress format.
- **Gateway** manages session routing, per-session locking, FIFO queuing (cap 8, reject-newest overflow), and telemetry.
- **Agentic Core** owns the deterministic ReAct state machine: `accepted → building_context → inferring → validating → executing_tools → compacting → responding → finalizing`.
- **LLM Provider Layer** translates semantic context arrays into provider-specific API calls and normalizes responses into canonical `ActionDecision` objects.
- **Tool Layer** registers capabilities, enforces input schemas, and provides progressive discovery to the model.
- **Environment Layer** provides the workspace filesystem, runtime configuration, execution grants, and the sandbox where tools run.

## Design Principles

- **Agent-first control plane** — the turn loop defines behavior; channels and gateways feed and observe it.
- **Explicit state ownership** — no global state; each layer owns its mutable data and communicates through typed DTOs.
- **Provider-neutral core** — the core loop never touches provider-native tool-call shapes or SDK objects.
- **Tool registry as canonical schema source** — tool definitions originate in the tool layer and are projected outward.
- **Compaction over transcript sprawl** — large tool outputs are summarized and referenced, not dumped into episodic memory.
- **Observability before magic** — every state transition emits a typed `StreamEvent`; execution is traceable via flat JSON-lines logs.

## Current State

Argentum is in **active MVP implementation**. The contracts-first pipeline is producing validated, tested slices:

| Package | Status |
| --- | --- |
| `@argentum/contracts` | ✅ Contracts for runtime config, ingress, stream events, content refs, turn envelopes, and context items (178 tests) |
| `@argentum/environment` | ✅ Runtime config loading with startup validation |
| `@argentum/gateway` | ✅ Ingress admission, session routing, active-turn claims, turn creation, lock release & queue dequeue |
| `@argentum/runtime` | ✅ Bootstrap composition with validated config |
| `@argentum/agentic_core` | 🧱 Shell — awaiting first implementation slice |
| `@argentum/llm_provider` | 🧱 Shell — awaiting first implementation slice |
| `@argentum/tooling` | 🧱 Shell — awaiting first implementation slice |
| `@argentum/channel_cli` | 🧱 Shell — awaiting first implementation slice |
| `@argentum/telemetry` | 🧱 Shell — awaiting first implementation slice |

Completed slices: 0001–0012. Up next: `ActionDecision` (0013), `ExecutionGrantDTO` (0015), `ToolCallDTO` / `ToolResultDTO` (0014), and the LLM adapter boundary (0016).

## Repo Structure

```
argentum/
├── apps/
│   └── runtime/              # Runtime composition & bootstrap
├── packages/
│   ├── contracts/            # Canonical DTOs shared across all modules
│   ├── environment/          # Workspace layout, grants, config loading
│   ├── gateway/              # Session routing, queueing, locking, turn creation
│   ├── agentic_core/         # Prompt compiler, episodic memory, turn loop
│   ├── llm_provider/         # Provider interface + DeepSeek adapter
│   ├── tooling/              # Tool registry, schemas, execution routing
│   ├── channel_cli/          # Terminal I/O adapter
│   └── telemetry/            # Event persistence & log formatting
├── config/
│   ├── runtime.json          # Active runtime configuration
│   └── runtime.example.json  # Annotated example config
├── runtime/                  # Runtime working directories
│   ├── bedrock/              # Immutable persona & policy files
│   ├── working/              # Mutable agent working area
│   ├── artifacts/            # Persisted tool output artifacts
│   └── logs/                 # Flat JSON-lines telemetry
├── docs/
│   ├── spec/                 # Authoritative implementation spec (source of truth)
│   └── implementation/       # Slice plans, audits, backlog
└── tsconfig.base.json        # Shared TypeScript configuration
```

## Quick Start

**Prerequisites:** Node.js ≥ 22, pnpm ≥ 11

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @argentum/gateway test

# Type-check the workspace
pnpm typecheck
```

## Spec as Source of Truth

For implementation work, the authoritative spec lives under [`docs/spec/`](docs/spec/README.md):

1. [`00-overview/framework-overview.md`](docs/spec/00-overview/framework-overview.md) — system intent and architectural shape
2. [`00-overview/mvp-scope.md`](docs/spec/00-overview/mvp-scope.md) — what is (and isn't) in MVP
3. [`20-contracts/canonical-contracts.md`](docs/spec/20-contracts/canonical-contracts.md) — the DTOs that cross module boundaries
4. [`30-core-loop/core-loop-state-machine.md`](docs/spec/30-core-loop/core-loop-state-machine.md) — deterministic turn execution semantics
5. Module leaf specs under [`40-modules/`](docs/spec/40-modules/)
6. ADRs under [`60-adr/`](docs/spec/60-adr/) for decision rationale
7. [`70-roadmap/deferred-decisions.md`](docs/spec/70-roadmap/deferred-decisions.md) for unresolved choices

The vision document at [`docs/Argentum_Modular_Agentic_Framework.md`](docs/Argentum_Modular_Agentic_Framework.md) provides non-normative roadmap context; where it conflicts with the spec tree, the spec tree wins.

## Development Workflow

Argentum follows a **contracts-first, slice-by-slice** implementation discipline:

1. Each slice starts from a leaf spec and defines owned contracts, acceptance criteria, and explicit out-of-scope items.
2. Implementation is bounded to one owning module or package boundary.
3. Every slice must pass its validation gate (build + focused tests) before the next slice begins.
4. Slices 0001–0011 are validated and non-vacuous; the pipeline continues contract-by-contract toward a complete core loop.

## MVP Scope

Argentum MVP targets one complete end-to-end path:

- **One** terminal CLI channel
- **One** gateway with local SQLite-backed session persistence
- **One** deterministic single-agent turn loop
- **One** hybrid LLM adapter (DeepSeek)
- **One** provider-neutral tool registry with native host execution
- Inline context compaction, immutable bedrock, sequential tool execution, flat structured telemetry

Post-MVP: multi-agent orchestration, distributed execution, parallel tools, multiple channel/provider implementations, and bedrock mutation workflows are explicitly deferred.

## License

_Not yet assigned._
