# Tool Discovery

## Purpose

This spec defines how the runtime exposes tools to the model without forcing all tool detail into every step.

## MVP Discovery Policy

- The runtime may expose a narrowed subset of tools per step.
- Tool discovery remains provider-neutral and is driven by registry metadata.
- A future discovery tool may exist, but it is not required for MVP.

## Rules

- Reduced tool exposure must not create hidden tools unavailable to policy or telemetry.
- When a tool is not exposed for a step, that is a prompt-compiler selection decision rather than a schema mutation.
- Tool discovery policy must preserve stable tool names.

## Open Questions

- Whether MVP should expose all tools each step or a curated subset is deferred to implementation planning.