---
description: "Use when writing Argentum tests for contracts, state-machine transitions, queueing, grants, retries, adapter normalization, telemetry ordering, or end-to-end CLI behavior."
name: "Argentum Tests"
applyTo: ["tests/**", "**/tests/**", "**/*.test.*", "**/*.spec.*"]
---
# Argentum Test Guidance

## Required Coverage Categories

- Contract validation tests
- State-machine transition tests
- Gateway queue overflow and lock tests
- Tool grant and retry policy tests
- Provider normalization tests for native and fallback paths
- Environment tests for secret redaction and bedrock immutability
- Telemetry ordering and payload-minimum tests
- One end-to-end happy path from CLI ingress to final response

## Test Style

- Test module boundaries and deterministic outputs.
- Name the exact spec behavior being proved.
- Keep fixture data explicit and readable.
- Prefer one failure reason per test.

## Mandatory Assertions

- `step_count` increments per completed decision cycle, not per tool call.
- `tool_calls` always return to another inference step after compaction in MVP.
- Queue overflow rejects the newest ingress without displacing older queued items.
- Denied grants produce blocked outcomes rather than partial execution.