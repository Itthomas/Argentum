# Framework Overview

## Purpose

Argentum is a modular agentic runtime built around a deterministic turn loop rather than a messaging gateway. The framework is optimized for local-first execution, explicit state ownership, and low-context implementation slices.

## System Goal

Argentum must allow one agent runtime to operate across interchangeable channels, provider adapters, tool registries, and execution environments without moving provider-specific behavior into the core loop.

## Architectural Shape

Argentum is composed of six top-level areas:

1. Channel modules normalize platform-specific input and render stream events.
2. The gateway manages session routing, queueing, locking, and telemetry.
3. The agentic layer owns the deterministic turn loop and episodic memory.
4. The LLM provider layer converts semantic context and tool schemas into one normalized action decision.
5. The tool layer exposes callable capabilities through provider-neutral registry definitions.
6. The environment layer provides workspace files, execution surfaces, and runtime configuration.

## Core Invariants

- State is owned locally by each module and crosses boundaries only through explicit contracts.
- The core loop consumes canonical internal contracts, not provider-native payloads.
- The tool registry is the source of truth for tool schema definitions.
- Large tool outputs are compacted before they are committed to episodic memory.
- Bedrock files are read-only during MVP execution.
- One session may have only one active turn at a time.

## Canonical Flow

1. A channel module emits normalized ingress.
2. The gateway resolves a session and creates a turn envelope.
3. The agentic layer builds context for the current step.
4. The LLM adapter returns a normalized action decision.
5. The core loop validates and branches on that decision.
6. Tool calls execute through the tool layer under an execution grant.
7. Tool results are compacted and committed to episodic memory.
8. A final response is emitted and the turn is finalized.

## Spec Navigation

- MVP boundaries: `mvp-scope.md`
- Shared principles: `design-principles.md`
- Terminology: `glossary.md`
- Canonical contracts: `../20-contracts/canonical-contracts.md`
- Core loop behavior: `../30-core-loop/core-loop-state-machine.md`

## Non-Goals For This Spec Set

- Defining post-MVP multi-agent orchestration
- Defining distributed execution or remote worker orchestration
- Standardizing provider-specific request payloads outside adapter boundaries
- Specifying full sandbox hardening for untrusted deployments