# Core Loop State Machine

## Purpose

This document defines the deterministic state machine for one Argentum turn.

## States

| State | Meaning |
| --- | --- |
| `accepted` | The turn has been created from a validated ingress |
| `building_context` | The prompt compiler is selecting context items |
| `inferring` | The LLM adapter is producing one normalized decision |
| `validating` | The current decision or adapter output is being checked |
| `executing_tools` | One or more planned tool calls are being executed sequentially |
| `compacting` | Tool results are being summarized and committed |
| `responding` | A final or clarification response is being emitted |
| `finalizing` | The turn is committing final metadata and releasing resources |
| `completed` | The turn ended successfully |
| `aborted` | The turn ended through controlled failure or governor stop |

## Allowed Transition Order

1. `accepted` -> `building_context`
2. `building_context` -> `inferring`
3. `building_context` -> `aborted` when governor triggers pre-inference abort (step limit, repair limit, or wall clock exceeded)
4. `inferring` -> `validating`
5. `inferring` -> `aborted` when the LLM provider fails (network error, auth failure, irrecoverable malformed response)
6. `validating` -> `building_context` when repair context must be added
7. `validating` -> `executing_tools` when `ActionDecision.kind = tool_calls`
8. `validating` -> `responding` when `ActionDecision.kind = respond` or `clarify`
9. `validating` -> `aborted` when `ActionDecision.kind = abort` or validation cannot recover
10. `executing_tools` -> `compacting`
11. `executing_tools` -> `aborted` when tool execution or compaction throws an unrecoverable error
12. `compacting` -> `building_context` after every MVP `tool_calls` decision
13. `responding` -> `finalizing`
14. `finalizing` -> `completed` or `aborted`

## Step Semantics

- One inference step yields exactly one normalized `ActionDecision`.
- One `tool_calls` decision may contain multiple tool calls.
- Multiple tool calls execute sequentially in listed order during MVP.
- MVP `tool_calls` decisions always require another inference step after compaction.
- Tool execution and compaction do not terminate a turn directly in MVP.
- `step_count` measures completed inference decision cycles, not individual tool calls.
- `step_count` increments once when a `respond`, `clarify`, or `abort` decision completes its terminal branch, or once when a `tool_calls` decision completes compaction and is ready to re-enter `building_context`.

## Terminal Outcomes

- `completed`: final response or clarification emitted successfully
- `aborted`: turn stopped by irrecoverable validation failure, tool-policy block, governor stop, or provider failure

## Invariants

- The core loop never consumes provider-native tool-call objects.
- Every state transition emits a `turn.*` event.
- Large tool outputs are compacted before entering episodic memory.
- Finalization releases the session lock before archival work starts.

## Cross-References

- Contracts: `../20-contracts/canonical-contracts.md`
- Validation policy: `validation-and-repair.md`
- Compaction policy: `compaction-policy.md`
- Turn governor: `turn-governor.md`