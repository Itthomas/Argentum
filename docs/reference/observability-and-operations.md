# Observability And Operations

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 14, 20 through 27; Appendix sections 20 through 23, 25 through 26
> Intended use: working reference for runtime visibility, commit semantics, recovery, and operational behavior
> Update rule: if recovery, observability, commit semantics, or operational characteristics change, update this doc in the same change

## Purpose

This document summarizes the operational and observability expectations for the system. It is derived and non-normative.

## Observability Surfaces

Minimum visibility should include:

- structured runtime logging
- task activity records
- approval history
- memory commit history
- tool execution history
- generated-tool lifecycle history
- autonomous-action history
- cost and token accounting
- model-routing and provider-fallback visibility

## Reporting Surfaces

The system should maintain distinct summary forms for:

- run summary
- task summary
- operator-facing message summary
- heartbeat or scheduler activity summary

## Commit Semantics

Each meaningful run should commit through a controlled path that updates:

- task status
- task summary
- artifact references
- memory candidates or committed memories
- approval resolution when applicable
- transcript or message linkage where relevant

## Runtime Summary Distinctions

Keep separate:

- what happened in the run
- the durable current state of the task
- what should be communicated externally to the operator

## Scheduling And Heartbeat Summary

- support recurring heartbeat ticks, cron triggers, one-shot follow-ups, and task-driven delayed continuation
- heartbeat-triggered runs should start with fresh working state
- heartbeat runs may consult open-task summaries, blocked or waiting tasks, scheduled commitments, and relevant recent memory
- heartbeat autonomy is allowed when policy and approval state permit it

## Stale-State Policy Summary

Define timeout or TTL behavior for at least:

- tasks waiting on human approval
- blocked tasks awaiting external conditions
- scheduled follow-ups that are missed or no longer relevant
- subagents that fail to report progress or completion within expected bounds
- stale execution leases whose runtime owner has disappeared

## Recovery Policy Table Summary

Stale task claim:

- detect expired lease
- mark claim expired
- permit recovery claim
- write recovery activity record

Unanswered approval:

- send reminder according to policy
- increment reminder count
- transition to `expired`, `abandoned`, `blocked_timeout`, or `needs_operator_attention` after the final threshold

Lost child task:

- mark child `lost` or `timed_out`
- write child failure summary
- transition parent according to explicit parent-child policy

Prompt overflow:

- reassemble context under stricter budget
- retry same or alternative provider according to fallback profile

Provider degradation:

- update provider health state
- route eligible operations to an alternate provider when available

Generated tool rollback or disablement:

- write lifecycle transition records
- preserve approval and verification linkage
- keep the disabled or superseded state queryable for audit and recovery

## Operational Characteristics

- optimize for correctness, recoverability, and contextual quality first
- remain mindful of Raspberry Pi memory and CPU limits
- prefer API-centric inference over local heavy inference
- bound concurrency and control filesystem and process usage
- reconstruct authoritative state from durable records after restart

## Restart And Crash Recovery

On restart, support:

- stale task claim detection
- recovery of pending approvals
- recovery or reconciliation of in-flight child tasks
- resumption or reclassification of interrupted scheduled work
- safe handling of partially applied delivered events
- preservation of generated-tool activation state and rollback history across restart

## Architectural Success Criteria Summary

An implementation is not architecturally successful unless it can demonstrate:

- durable task creation or resolution from ingress
- bounded context assembly
- a lean reason-act-reflect runtime loop
- approval pause/resume
- durable summaries, artifacts, and memory commits
- heartbeat-driven continuation with fresh runtime state
- bounded subagent execution
- approval-gated generated tool activation
- exclusivity against competing runtime loops for the same task
- policy-driven handling of stale work and provider failures
