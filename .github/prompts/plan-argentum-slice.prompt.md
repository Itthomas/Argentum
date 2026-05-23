---
description: "Plan one bounded Argentum implementation slice from the spec, including package target, acceptance criteria, tests, validation, and whether autopilot or subagents should be used."
name: "Plan Argentum Slice"
argument-hint: "Target module, behavior, or spec file"
agent: "argentum-spec-planner"
---
Plan one bounded Argentum implementation slice for: ${input}

Use the canonical spec tree as the only source of truth.
If bootstrap prerequisites are unresolved, update [docs/implementation/bootstrap-decisions.md](../../docs/implementation/bootstrap-decisions.md) before planning a coding slice.
Persist the result by drafting or updating a slice card under [docs/implementation/slices](../../docs/implementation/slices) and reflecting its status in [docs/implementation/backlog.md](../../docs/implementation/backlog.md).

Return:

1. Slice name
2. Target package or boundary
3. Authoritative spec files
4. Acceptance criteria
5. Minimal interfaces or contracts to create first
6. Required tests and validation
7. Safe use of autopilot for this slice
8. Safe parallel subagent opportunities
9. Explicit out-of-scope items
10. Planning artifact paths updated