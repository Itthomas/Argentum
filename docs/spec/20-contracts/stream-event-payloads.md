# Stream Event Payloads

## Purpose

This document defines the minimum required payload fields for MVP stream events.

## `turn.*`

- `turn.started`: `session_id`, `ingress_id`, `state`
- `turn.state_changed`: `from_state`, `to_state`
- `turn.completed`: `final_outcome`, `step_count`
- `turn.aborted`: `reason`, `error_code`

## `validation.*`

- `validation.failed`: `phase`, `reason`, `repairable`
- `validation.repair_requested`: `phase`, `attempt_number`

## `llm.*`

- `llm.started`: `request_id`, `tool_count`
- `llm.completed`: `request_id`, `normalization_status`
- `llm.failed`: `request_id`, `reason`, `error_code`

## `tool.*`

- `tool.planned`: `call_id`, `tool_name`
- `tool.started`: `call_id`, `tool_name`
- `tool.finished`: `call_id`, `tool_name`, `status`, `duration_ms`
- `tool.blocked`: `call_id`, `tool_name`, `reason`, `error_code`

## `memory.*`

- `memory.compaction_started`: `call_id`, `compaction_revision`
- `memory.compaction_committed`: `call_id`, `compaction_revision`, `artifact_count`

## `response.*`

- `response.started`: `response_kind`
- `response.completed`: `response_kind`, `final_outcome`

## `queue.*`

- `queue.queued`: `session_id`, `ingress_id`, `queue_length`
- `queue.dequeued`: `session_id`, `ingress_id`, `queue_length`
- `queue.rejected`: `session_id`, `ingress_id`, `queue_length`, `reason`

## Rules

- Payloads may include additional fields, but these minimum fields are required in MVP.
- Large diagnostic content must be referenced through artifacts rather than embedded directly.
- Event consumers may depend on these minimum fields across implementations.