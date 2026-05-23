# Compaction Policy

## Purpose

This document defines how inline compaction works in MVP.

## When Compaction Runs

- After each tool result is available
- Before raw result content would otherwise enter episodic memory
- Before the next inference step sees tool output summaries

## Compaction Outcomes

- Small result: commit the tool's `human_summary` and any necessary artifact references
- Large result: externalize raw output to artifacts, create a concise summary, and commit only the summary plus references
- Error result: commit a concise failure summary and any diagnostic references required for retry logic

## Rules

- Inline compaction is synchronous with turn progress in MVP.
- Compaction increments `TurnEnvelope.compaction_revision` whenever committed memory changes.
- Raw artifacts remain inspectable outside episodic memory.
- Compaction must preserve enough information for the next inference step to act correctly.
- Completion of compaction after a `tool_calls` decision always returns the turn to `building_context` for the next inference step in MVP.

## Drift Risks

- Accidentally storing full raw outputs in the transcript
- Letting compaction summaries mutate bedrock-like instructions
- Making compaction provider-specific instead of tool-result-driven

## Open Questions

- Exact size thresholds are deferred to implementation planning and runtime tuning.