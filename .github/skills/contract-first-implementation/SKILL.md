---
name: contract-first-implementation
description: 'Implement one Argentum slice from contracts outward. Use for DTOs, module seams, queueing, grants, compaction, adapter normalization, and any slice that should start with boundary definitions and focused validation.'
argument-hint: 'Planned slice or target behavior'
user-invocable: true
disable-model-invocation: false
---

# Contract First Implementation

## When To Use

- Implement a new canonical contract or boundary
- Start a greenfield package from the spec
- Add tests before orchestration code
- Keep autopilot bounded during early repo construction

## Procedure

1. Read the spine docs, the owning leaf spec, and the approved slice card whose `Approval` field is `approved`.
2. State one falsifiable local hypothesis for the slice.
3. Create the smallest contract, interface, or schema surface needed.
4. Add the first narrow test or validation target.
5. Implement the minimal behavior required to satisfy that test.
6. Run the focused validation immediately after the first substantive edit.
7. If the slice is non-trivial, request a critical review against [the checklist](./assets/validation-checklist.md).

## Guardrails

- Do not solve deferred roadmap items while implementing the slice.
- Do not widen scope after the first edit until a focused validation runs.
- Do not let provider-native or tool-runtime internals become canonical contracts.
- Do not put raw tool outputs into episodic memory when compaction should externalize them.

## Output Requirements

- What was implemented
- Which spec files it satisfies
- What validation ran
- What remains intentionally out of scope