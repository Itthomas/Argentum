# Phase 4: Self-Extension And Hardening

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 18, 19, 22 through 29; Appendix sections 19 through 26
> Required reading: `docs/reference/conventions.md`, `docs/reference/governance-and-approvals.md`, `docs/reference/observability-and-operations.md`
> Intended use: implementation packet for governed self-extension, operational hardening, and deeper observability

## Objective

Introduce governed self-extension and production hardening without violating the core constraints on approvals, explicit tooling, provider policy, and auditability.

## Canonical Requirements Summary

- no meaningful real-world action should occur outside the explicit tooling surface
- generated tools must not activate without explicit human approval in the initial architecture
- provider degradation and fallback behavior should be policy-driven and visible
- observability must explain what the system did and why, especially for autonomous and high-consequence work
- restart recovery should reconstruct authoritative state from durable records rather than optimistic in-memory assumptions
- approval and verification must not be treated as an automatic global capability grant for generated tools

## Required Reading

1. `docs/reference/conventions.md`
2. `docs/reference/governance-and-approvals.md`
3. `docs/reference/observability-and-operations.md`

## Scope

- tool-authoring workflow and generated-tool lifecycle
- validation, testing, and approval-gated activation
- provider health handling and fallback visibility
- observability and reporting expansion
- hardening for restart recovery and operational diagnostics

## Included Subsystems

- Tooling and Execution Layer
- Self-Extending Tool System
- Observability and Reporting Layer

## Out Of Scope

- core durable task and claim foundations
- initial context assembly and approval pause/resume plumbing
- baseline memory and scheduling implementation

## Durable Schemas Touched

### ModelRoutingPolicy

Phase 4 deepens use of operation mappings, fallback profiles, timeout profiles, and budget profiles for high-consequence workflows such as tool authoring and verification.

### ProviderHealthRecord

Phase 4 should make provider degradation visible and actionable through health status, recent failures, degraded windows, and operator-facing notes.

### ArtifactRecord

Phase 4 should use artifact provenance for generated tool bundles, reports, test results, and structured outputs tied to verification and activation.

### Approval And Task Records

Governed activation should still link through durable approval and task state, even though those records originate in earlier phases.

## Governance Extract

Phase 4 must preserve the full self-extension lifecycle:

1. gap identification
2. tool proposal
3. code generation in a controlled workspace
4. schema validation
5. policy validation
6. test and verification execution
7. human approval
8. staged activation into a bounded initial scope
9. explicit scope widening when policy allows it
10. disablement, rollback, archival, or pruning when appropriate

Default activation rule:

- all generated tools require explicit human approval before activation
- approved and verified tools should begin in a bounded activation state rather than assuming immediate global enablement

## Staged Activation Extract

Phase 4 should explicitly define:

- generated-tool lifecycle states beyond proposal and approval
- which activation scopes are available, such as quarantine, shadow, limited, or global
- who or what may widen tool scope after initial activation
- how rollback and disablement are performed durably
- how regenerated tools preserve lineage through supersession or rollback linkage

## Observability Extract

Phase 4 should expand visibility across:

- tool execution history
- autonomous-action history
- provider routing and fallback outcomes
- cost and token accounting
- operator-facing summaries distinct from raw runtime records
- generated-tool lifecycle transitions such as verification, staged activation, scope widening, rollback, disablement, and supersession

## Recovery And Hardening Extract

Phase 4 should explicitly harden:

- interrupted high-consequence operations
- provider degradation response
- restart recovery for in-flight verification or activation work
- operator-visible failure paths when safe fallback is unavailable

## Implementation Tasks

- define tool proposal, validation, verification, approval, and activation boundaries
- specify global tool registration behavior after approval
- expand provider health tracking and routing fallback policy
- define observability surfaces for autonomous actions, tool use, and cost visibility
- harden restart and recovery flows for interrupted high-consequence operations

## Implemented Foundation

- generated-tool durable lifecycle records now exist with staged activation scope tracking and lifecycle transitions
- async runtime orchestration now flows through `TaskRuntime.run()` and `LLMOrchestrator.invoke_operation()`
- durable activity records now preserve provider-routing visibility, generated-tool lifecycle history, and task activity summaries
- Alembic-backed integration tests now cover approval-gated generated-tool activation and async runtime provider fallback visibility

## Failure Modes And Edge Cases

- generated tools must never activate without explicit approval
- generated tools must never widen from bounded activation to broader availability without explicit policy and auditable transition
- verification failure must stop activation cleanly and durably
- provider degradation must not silently route repeated high-consequence work into a failing provider
- observability should not collapse multiple summary surfaces into one overloaded blob

## Verification Tasks

- test approval-gated tool activation
- test provider degradation handling and eligible failover behavior
- test tool verification failure behavior before activation
- test observability outputs for high-consequence operations

## Exit Criteria

- generated tools cannot activate without explicit approval
- provider fallback and degradation behavior are visible and policy-driven
- high-consequence flows leave auditable records and have defined recovery behavior

## Risks And Open Questions

- self-extension increases system risk if validation, policy checks, and activation boundaries are weak
- observability can become noisy unless summaries and raw histories remain separate surfaces
