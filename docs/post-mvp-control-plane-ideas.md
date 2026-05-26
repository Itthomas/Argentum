# Post-MVP Control-Plane Ideas

> Non-normative idea document.
>
> This note sketches one possible post-MVP direction for two adjacent additions:
>
> 1. scheduled session or task triggers
> 2. direct client-invoked tool commands that bypass LLM inference
>
> The authoritative MVP implementation contract remains under `docs/spec/`.
> This file does not amend the current spec or authorize immediate implementation.

## Purpose

Argentum MVP is intentionally narrow: channel-originated ingress enters the gateway, the gateway creates one accepted turn, and the agentic layer decides whether tools run. After MVP is complete and working, two nearby extensions become attractive:

- a scheduler that can trigger future work without an active human message
- a direct client command path for slash-command-style tool execution without an LLM step

This document sketches a shape for those additions that preserves the architectural principles already established by MVP:

- explicit state ownership
- canonical internal contracts
- narrow, module-owned boundaries
- one active turn per session unless a separate control-path invariant is explicitly defined
- registry-authoritative capability definitions

## Status

- Scope: post-MVP idea only
- Authority: non-normative
- Intended use: future design discussion, backlog shaping, and contract sketching

## Problem Statement

After MVP, Argentum may need to support more than one way to initiate work:

- a user sends a normal message to the agent
- a scheduler fires because a session or task is due
- a client sends a slash command such as `/tool_name arg1 arg2`

These triggers are adjacent, but they are not identical.

Normal agent ingress should continue to flow through the deterministic turn loop and LLM adapter. Direct client commands should not pretend to be agent decisions when no inference occurs. Scheduled work should not force scheduler policy into the gateway.

The design challenge is to add these capabilities without collapsing multiple concerns into the gateway or leaking internal tool-execution contracts to external clients.

## Design Goals

- Preserve the gateway as a routing, locking, queueing, and telemetry boundary.
- Keep the tool registry canonical for internal capability definitions.
- Avoid exposing canonical `ToolCallDTO` directly to clients.
- Allow direct client commands to execute one bounded capability without LLM inference.
- Allow scheduling to trigger future work without inventing a second session lifecycle model.
- Keep client-visible command exposure narrower than agent-visible tool exposure.
- Make it possible to add authz, audit, and idempotency policy later without reopening every channel implementation.

## Non-Goals

- Redefining the MVP gateway contract.
- Adding multi-tool direct client execution in one message.
- Mixing direct commands and free-form agent messages in the same client payload.
- Choosing a permanent post-MVP authn or authz model.
- Designing a full distributed job system.
- Exposing raw internal execution grants or canonical tool-call DTOs to clients.

## High-Level Recommendation

The most compatible near-term post-MVP shape is:

1. add a dedicated scheduler module that submits future work through existing gateway-facing seams
2. add a dedicated direct-command path adjacent to the gateway for slash-command-style execution
3. derive a client command catalog from the canonical tool registry through a policy projection layer
4. avoid introducing a large general-purpose orchestrator or control-plane module until shared policy becomes substantial enough to justify extraction

In other words, start with narrowly bounded additions rather than a broad post-MVP orchestration layer.

## Why Not A Broad Orchestrator First

A future control-plane extraction may eventually make sense, but it should not be the starting point.

If introduced too early, an orchestrator module risks becoming a thinly coupled coordination blob that partially duplicates:

- gateway routing and queueing
- runtime composition
- direct-command policy
- scheduler behavior

That would weaken the MVP architecture rather than extend it.

The cleaner starting point is to add two bounded features with clear ownership:

- scheduler-owned due work production
- direct-command-owned one-tool execution path

If later post-MVP work introduces several more non-agent triggers that all need the same authz, dedupe, audit, and routing rules, those shared concerns can be extracted into a thin control-plane boundary later.

## Proposed Post-MVP Additions

### 1. Scheduler Module

The scheduler should be a separate module, not a gateway responsibility.

Its job is to:

- persist schedule definitions
- compute when scheduled work becomes due
- materialize due work into a bounded request
- submit that request through a gateway-facing seam

Its job is not to:

- execute tools directly
- own session locking
- create `TurnEnvelope` values by bypassing gateway logic
- define queueing policy

The scheduler should behave like a producer of future work, not a second execution runtime.

### 2. Direct Client Command Path

The direct client command path is for slash-command-style interactions where the user explicitly requests one command and no LLM decision is needed.

Example shape:

- client message: `/workspace.read_file docs/spec/README.md`
- channel parses it as one direct command request
- the request is validated against a client-visible command catalog
- the system executes one bounded capability through normal internal execution seams
- the result is rendered directly back to the client

This path should remain separate from ordinary agent turns.

It may still use session identity and lock ownership, but it should not masquerade as an LLM-driven `ActionDecision` when no inference has occurred.

## Client Tool Access: Recommended Shape

### Key Principle

Clients should not submit canonical `ToolCallDTO` values.

`ToolCallDTO` is an internal contract created only after internal validation and grant resolution. A client-facing direct-command surface should instead use a separate external contract that is translated into internal execution once policy checks succeed.

### Recommended Layering

1. channel parses slash-command syntax
2. direct-command boundary validates the command request
3. client command projection policy determines whether the command is exposed
4. client argument policy narrows the allowed argument surface
5. internal translation maps the validated request into canonical tool execution
6. normal grant resolution, schema validation, execution, and telemetry still apply

This preserves the distinction between:

- public client command requests
- internal tool execution requests

## Client Command Catalog Projection

The canonical tool registry should remain the source of truth for internal tool definitions. Client-visible commands should be derived from that registry through a projection layer rather than maintained as a totally separate registry.

### Why A Projection Layer Helps

It allows the system to:

- expose only a subset of tools to clients
- restrict the arguments clients can send
- keep canonical internal tool names and schemas authoritative
- evolve client-facing command UX without redefining core tool behavior

### Client Exposure Capabilities

For each client-visible command, the projection layer may:

- expose or hide the command entirely
- keep the same name as the canonical tool
- expose a client alias while mapping to the canonical tool name internally
- remove some arguments entirely
- fix some arguments to predefined values
- restrict enums to a safe subset
- clamp numeric ranges
- restrict path arguments to tighter roots or subpaths
- require channel- or role-specific policy checks before exposure

### Important Constraint

The projection layer should remain declarative.

It should not become a second tool-implementation surface with arbitrary logic. Its job is to filter, narrow, and map. The canonical tool implementation still owns actual behavior.

## Suggested Contract Families

The following names are placeholders, not recommendations for immediate implementation.

### Scheduler-Owned Contracts

- `ScheduleDefinitionDTO`
- `ScheduleTargetDTO`
- `ScheduledTriggerDTO`
- `ScheduleMutationResultDTO`

These would define persisted schedule intent and due-work materialization.

### Client Command Contracts

- `ClientCommandRequestDTO`
- `ClientCommandArgumentDTO` or a normalized arguments object
- `ClientCommandResultDTO`
- `ClientCommandCatalogEntryDTO`

These would define the public direct-command boundary.

### Projection / Policy Contracts

- `ClientCommandExposurePolicyDTO`
- `ClientCommandArgumentPolicyDTO`
- `ClientCommandCatalogProjection`

These would define how client-visible commands are derived from the canonical registry.

## Proposed Internal Flows

### Scheduled Work Flow

```text
Schedule Definition
  -> Scheduler persistence
  -> Due trigger materialization
  -> Gateway-facing submission seam
  -> Session resolution / queue / lock
  -> Normal turn execution
```

This is closest to channel-originated ingress and should likely reuse the existing turn-based execution model.

### Direct Client Command Flow

```text
Slash command message
  -> Channel parser
  -> ClientCommandRequestDTO
  -> Client command projection / policy check
  -> Internal translation
  -> Grant resolution
  -> Tool schema validation
  -> Tool execution
  -> Client command result rendering
```

This is intentionally not the same as:

```text
IngressDTO -> TurnEnvelope -> LLM inference -> ActionDecision -> ToolCallDTO
```

No LLM decision exists in the direct-command path, so the design should not force one.

## Session And Locking Considerations

Direct client commands should probably remain session-scoped and lock-taking by default.

Reasons:

- it preserves one-owner-at-a-time semantics for session-affecting work
- it avoids races between an active agent turn and a direct command touching the same working state
- it keeps queueing, telemetry correlation, and cleanup semantics coherent

That does not necessarily mean direct commands must create ordinary agent turns. It means they should likely honor the same session ownership invariant unless explicitly designed otherwise.

## Memory Considerations

Direct client commands should not automatically commit their results into episodic memory.

That behavior is appropriate for agent-driven turns because the model may need the result on the next inference step. For direct client commands, the default should likely be:

- no episodic-memory mutation
- explicit artifact or rendered response only

If a future command explicitly means "perform this action and make it part of the session narrative," that should be a separate design decision rather than the default.

## Telemetry Considerations

Direct client commands still need first-class observability.

Recommended properties:

- append-only telemetry remains the rule
- direct-command events should be distinct from normal `turn.*` events when no LLM turn exists
- correlation identifiers should still include session, tool, and command request identity
- telemetry must not become a hidden control channel

The system should be able to replay:

- who requested the command
- what client-visible command was invoked
- how it mapped to canonical execution
- whether policy narrowed arguments
- whether execution was allowed, blocked, or failed

## Security And Policy Notes

The client-visible command surface should be treated as stricter than the agent-visible tool surface.

The projection layer is not a replacement for grants. Both are needed:

- client exposure policy decides what the client is allowed to ask for
- grants decide what the internal execution boundary is allowed to do

This separation is valuable because it allows a tool to remain valid for agent use while still being unavailable or more restricted for direct client invocation.

## Incremental Adoption Path

An incremental post-MVP path could look like this:

### Phase A: Scheduler Only

- add a scheduler module
- add schedule definition contracts
- submit due work through gateway-facing seams
- keep all scheduled work as normal turn ingress

### Phase B: Direct Client Commands

- add a client command request contract
- add a small projected client command catalog
- support one direct command per client message
- execute through grants plus canonical tool validation

### Phase C: Policy Refinement

- add argument narrowing rules
- add channel- or role-specific command exposure
- add idempotency and audit refinements

### Phase D: Optional Future Extraction

Only if several non-agent triggers accumulate and start duplicating policy logic:

- extract shared authz, audit, dedupe, and routing rules into a thin control-plane module

That extraction should be driven by repeated concrete needs, not by a desire to pre-abstract.

## Recommendation Summary

- add scheduling as a separate producer module
- add slash-command execution as a separate direct-command path
- keep both additions narrow and bounded
- derive client-visible command exposure from the canonical tool registry through a declarative policy projection layer
- do not expose raw canonical `ToolCallDTO` to clients
- do not introduce a broad control-plane or orchestrator module unless later post-MVP growth proves the shared policy is real and substantial

## Open Questions For Future Design Work

- Should direct client commands always take the session lock, or are some commands explicitly safe to remain session-independent?
- Should any direct client commands write to episodic memory, or should that always require ordinary agent ingress?
- Should client-visible command aliases be allowed, or must client command names remain identical to canonical internal tool names?
- Where should client-command exposure policy live: runtime config, channel config, or a dedicated policy package?
- Should scheduled work always become normal ingress, or are there later post-MVP cases where scheduling should trigger direct command execution instead?
- What authz model should govern client-visible command exposure across channels and roles?
