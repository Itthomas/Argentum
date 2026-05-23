# Retry Policy

## Purpose

This spec defines the narrow automatic retry behavior allowed for MVP tool execution.

## Owner

The tool layer owns automatic retries. The core loop does not perform its own automatic tool retries in MVP.

## MVP Retry Rule

- At most one automatic retry is allowed for a tool call.
- Automatic retry is allowed only when `side_effect_level = read_only`.
- Automatic retry is allowed only for transient execution failures that occur before any partial mutation or external effect is observed.
- Tools with `side_effect_level = workspace_mutation`, `host_mutation`, or `external_effect` must not be retried automatically.

## Result Rules

- Automatic retries happen inside the tool-layer boundary and do not create additional `ActionDecision` steps.
- The final returned `ToolResultDTO` reflects the post-retry outcome.
- `retryable = true` means a later retry would still be safe under the policy, not that the core loop will automatically retry again.

## Acceptance Criteria

- Two implementations do not diverge on whether a mutating tool call is retried automatically in MVP.