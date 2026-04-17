# State Machines

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 10, 20 through 22, 25; Appendix sections 14 through 18
> Intended use: working reference for legal transitions and lifecycle rules
> Update rule: if any canonical transition set or transition rule changes, update this doc in the same change

## Purpose

This document consolidates the state machines used across the system. It is derived and non-normative.

## Task State Machine

Allowed transitions:

```text
proposed -> active
proposed -> scheduled
proposed -> abandoned

active -> waiting_human
active -> blocked
active -> scheduled
active -> completed
active -> failed
active -> stalled
active -> abandoned
active -> needs_operator_attention

waiting_human -> active
waiting_human -> blocked_timeout
waiting_human -> abandoned
waiting_human -> needs_operator_attention

blocked -> active
blocked -> blocked_timeout
blocked -> abandoned
blocked -> failed
blocked -> needs_operator_attention

scheduled -> active
scheduled -> expired
scheduled -> abandoned

stalled -> active
stalled -> abandoned
stalled -> needs_operator_attention

blocked_timeout -> active
blocked_timeout -> abandoned
blocked_timeout -> failed_timeout

needs_operator_attention -> active
needs_operator_attention -> abandoned

completed -> (terminal)
failed -> (terminal)
failed_timeout -> (terminal)
expired -> (terminal unless explicitly reopened)
abandoned -> (terminal unless explicitly reopened)
```

Task transition rules:

- terminal states may be reopened only by explicit recovery or operator action
- entering `waiting_human` requires a linked `ApprovalRecord`
- entering `active` requires an active valid claim
- leaving `active` for terminal or suspended states should release or finalize the active claim

## Claim State Machine

```text
active -> released
active -> expired
active -> invalidated
active -> superseded

expired -> superseded
expired -> invalidated

released -> (terminal)
superseded -> (terminal)
invalidated -> (terminal)
```

Claim rules:

- only one `active` claim may exist per task at any moment
- a new claim may supersede an expired claim, not an active healthy claim
- maintenance may invalidate claims proven inconsistent with task state

## Approval State Machine

```text
pending -> reminded
pending -> approved
pending -> denied
pending -> expired
pending -> cancelled

reminded -> reminded
reminded -> approved
reminded -> denied
reminded -> expired
reminded -> cancelled

approved -> (terminal)
denied -> (terminal)
expired -> (terminal)
cancelled -> (terminal)
```

Approval rules:

- reminder count must be durable and monotonic
- expiration must be evaluated against an authoritative time source
- approval decisions must be idempotent by `approval_id`
- approval responders must be validated against the authorized resolver set or equivalent policy surface
- changing the requested action requires a new request path rather than a `modify` decision state

## Subagent State Machine

```text
proposed -> running
proposed -> cancelled

running -> completed
running -> failed
running -> timed_out
running -> lost
running -> cancelled

completed -> (terminal)
failed -> (terminal)
timed_out -> (terminal or retry path)
lost -> (terminal or recovery path)
cancelled -> (terminal)
```

Subagent rules:

- parent tasks must never wait indefinitely on child status alone
- child timeout or `lost` state must trigger explicit parent update policy
- parent update policy must be explicit in runtime logic

## Event Consumption State Machine

```text
received -> rejected_unauthenticated
received -> rejected_unauthorized
received -> deduplicated
received -> queued
received -> consumed
received -> ignored
received -> failed

queued -> consumed
queued -> failed
queued -> dead_lettered

failed -> queued
failed -> dead_lettered

rejected_unauthenticated -> (terminal)
rejected_unauthorized -> (terminal)
deduplicated -> (terminal)
ignored -> (terminal)
consumed -> (terminal)
dead_lettered -> (terminal)
```

Event consumption rules:

- external events must pass authentication and authorization checks before entering ordinary queue processing
- replay rejection and duplicate rejection are distinct terminal outcomes even when both avoid execution
- retry requeue should use durable timing fields rather than ad hoc in-memory retry loops

## Generated Tool State Machine

```text
proposed -> validating
proposed -> archived

validating -> verified
validating -> disabled
validating -> archived

verified -> approval_pending
verified -> disabled

approval_pending -> approved
approval_pending -> disabled
approval_pending -> archived

approved -> quarantined
approved -> limited
approved -> global
approved -> disabled

quarantined -> limited
quarantined -> disabled
quarantined -> archived

limited -> global
limited -> disabled
limited -> superseded

global -> disabled
global -> superseded

disabled -> archived
disabled -> limited

superseded -> archived
archived -> (terminal)
```

Generated tool rules:

- approval does not by itself require immediate global activation
- activation scope widening should happen through explicit lifecycle transitions
- rollback and disablement must leave durable lifecycle evidence rather than silently removing a tool

## Lifecycle Guidance

- do not treat statuses as loose labels
- expose legal transitions through governed helpers or policy logic
- enforce claim and approval dependencies alongside status changes
- use lifecycle tests to guard against accidental architectural drift
