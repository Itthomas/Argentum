---
name: spec-to-slice
description: 'Convert the Argentum spec into one bounded implementation slice. Use for backlog generation, sprint slicing, package sequencing, and deciding when autopilot or parallel subagents are safe.'
argument-hint: 'Target module, spec file, or behavior'
user-invocable: true
disable-model-invocation: false
---

# Spec To Slice

## When To Use

- Build the initial implementation backlog
- Turn a spec leaf into a ticket-sized slice
- Decide if a task is safe for autopilot
- Decide where read-only subagents help

## Inputs

- The target spec file, module, or behavior
- The spine docs in the spec index
- The relevant implementation and test strategy docs when sequencing matters

## Procedure

1. Read the spine docs named in [docs/spec/README.md](../../../docs/spec/README.md).
2. Read the owning leaf spec and any directly referenced contract or core-loop file.
3. Identify the owning package from [docs/spec/50-implementation/package-boundaries.md](../../../docs/spec/50-implementation/package-boundaries.md).
4. Extract the smallest slice that can be implemented and validated without resolving deferred decisions.
5. If bootstrap decisions are unresolved, update [docs/implementation/bootstrap-decisions.md](../../../docs/implementation/bootstrap-decisions.md) before planning code work.
6. Populate a durable slice card in [docs/implementation/slices](../../../docs/implementation/slices) using [the canonical template](../../../docs/implementation/slices/0000-template.md).
7. Update [docs/implementation/backlog.md](../../../docs/implementation/backlog.md) with the slice status.
8. Mark autopilot as safe only when the slice is bounded, testable, and has no unresolved planning ambiguity.
9. Mark subagents only for independent read-only tasks such as test extraction, risk review, or acceptance-criteria harvesting.

## Output Requirements

- Name the authoritative spec files.
- Name the target package or boundary.
- Name the acceptance criteria.
- Name the first contracts or interfaces to create.
- Name the narrowest executable validation.
- Name explicit out-of-scope items.
- Name the planning artifact paths updated.