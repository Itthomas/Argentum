# Validation And Repair

## Purpose

This document defines how Argentum handles malformed or non-conforming model output.

## Validation Layers

1. Provider adapter normalization
2. `ActionDecision` schema validation
3. Tool-layer schema validation of `ToolCallDTO.arguments` before execution
4. Governor checks on turn budgets and allowed behavior

## Rules

- Provider adapters own provider-native repair attempts.
- The core loop validates only canonical contracts.
- Tool argument schema validation is owned by the tool layer, not by the core loop.
- Failed tool argument validation does not bypass the tool layer.
- Validation errors must produce explicit `validation.*` events.
- Repair context appended to the next inference step must be compact and operational.
- Each canonical repair attempt increments `TurnEnvelope.budget.repair_attempts_used`.
- Canonical repair attempts must stop when `repair_attempts_used` reaches `max_repair_attempts`.

## Recovery Paths

- Recoverable adapter normalization failure: retry inside the adapter boundary.
- Recoverable canonical validation failure: append repair feedback and re-enter `building_context`.
- Unrecoverable validation failure: abort the turn in a controlled manner.

## Non-Goals

- Preserving hidden chain-of-thought during repair
- Delegating schema repair to channel modules or tools

## Open Questions

- None.