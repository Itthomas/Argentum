---
description: "Use when adding or updating Argentum DTOs, contracts, interfaces, module boundaries, schema validation, or any slice that should start from the canonical contract layer before implementation details."
name: "Contract First"
---
# Contract-First Guidance

## Boundary Rules

- Shared DTOs belong to the canonical contract layer, not to provider or tool internals.
- Keep provider-native payloads, raw SDK objects, and execution-driver internals out of canonical contracts.
- The core loop consumes only normalized contracts.
- Tool-layer schema validation owns tool argument validation after `ToolCallDTO` creation.

## Implementation Order

1. Define or scaffold the canonical type shape
2. Add boundary validation tests
3. Add the owning service or interface
4. Add the first minimal implementation
5. Validate through the narrowest executable check

## Drift Checks

- Does this change leak provider-specific fields into the core loop?
- Does this change let raw tool output enter episodic memory directly?
- Does this change move state mutation outside the owning module?
- Does this change invent behavior that belongs in a deferred decision?