# Governance And Approvals

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 18 through 19, 22 through 24; Appendix sections 8, 16, 19, 25 through 26
> Intended use: working reference for governed actions, approval semantics, and self-extension controls
> Update rule: if approval or governance behavior changes, update this doc in the same change

## Purpose

This document summarizes how governed actions, approval flows, and self-extension controls should be treated in implementation.

## Governance Principles

- prompt instructions alone are insufficient for hard safety guarantees
- safety must be enforced through system design
- autonomy must remain policy-bound and auditable
- meaningful real-world action should occur through explicit tooling surfaces

## Approval Scope

At minimum, approvals should support:

- tool creation and activation
- high-risk shell or process execution
- destructive filesystem actions
- outward-facing side effects when policy requires them
- other governed actions defined by runtime policy

## Approval Requirements

Approvals must be:

- durable
- resumable
- linked to tasks and runs
- deliverable through Slack
- auditable after the fact
- resolvable only by authorized identities or equivalent policy-approved resolver sets
- idempotent against repeated equivalent responses

## Approval Lifecycle Summary

- reminder scheduling should be supported
- maximum waiting thresholds should be explicit
- reminder attempts should be durable and monotonic
- unanswered approvals should transition through policy-defined outcomes rather than suspend a task forever

## Approval State Machine Summary

- `pending` may move to `reminded`, `approved`, `denied`, `expired`, or `cancelled`
- `reminded` may loop on `reminded` or move to `approved`, `denied`, `expired`, or `cancelled`

## Governed Tooling Principles

- tools require explicit identity, schema, execution policy, timeout/resource controls where applicable, and output contract
- no meaningful real-world action should occur outside the explicit tooling surface
- tool generation and tool verification should use strong reasoning tiers by default

## Self-Extension Rules

The tool-authoring pipeline should support:

1. gap identification
2. tool proposal
3. code generation in a controlled workspace
4. schema validation
5. policy validation
6. test and verification execution
7. human approval
8. global activation
9. disablement, archival, or pruning when appropriate

Default activation rule:

- generated tools must require explicit human approval before activation
- approval should unlock staged activation, not force immediate global activation
- scope widening from quarantine or limited activation to global activation should remain explicit and auditable

## Safety And Boundary Controls

Governance should rely on:

- approval gates
- tool allow and deny policy
- execution boundaries
- runtime user permissions
- filesystem path controls
- resource limits
- validation pipelines for generated tools
- least-privilege secret access

## Self-Extension Lifecycle Guidance

- generated tools should have a durable lifecycle record covering proposal, validation, approval, activation scope, disablement, rollback, and supersession
- rollback should be treated as a first-class governed operation, not an implicit file replacement
- generated capabilities should be observable at the lifecycle level, not only through raw tool-execution logs

## High-Consequence Implementation Guidance

- validate structured outputs before allowing them to drive high-consequence behavior
- separate approval routing, session delivery, task durability, and runtime pause/resume even though they cooperate
- keep governed behavior explicit and testable rather than encoded only in prompts
