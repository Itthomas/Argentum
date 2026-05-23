---
description: "Implement one bounded Argentum slice using the spec-first workflow, including targeted tests and immediate focused validation after the first substantive edit."
name: "Implement Argentum Slice"
argument-hint: "Planned slice or target spec behavior"
agent: "argentum-implementer"
---
Implement this Argentum slice: ${input}

Follow the repo workflow:

- If no slice card with `Approval: approved` exists yet, stop and create or review one first.
- Read the spine docs and the owning leaf spec.
- Keep scope to one owning boundary.
- Prefer contract-first changes.
- After the first substantive edit, run the narrowest focused validation before widening scope.
- If useful, spawn read-only subagents for adversarial review or test extraction.

Finish by summarizing what changed, what validated, and any remaining risk.