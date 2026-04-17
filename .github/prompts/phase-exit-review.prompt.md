---
name: phase-exit-review
description: Check whether an implementation phase is ready to be marked complete.
agent: plan
argument-hint: Optional summary of what was implemented in the phase.
---

Read [docs/CURRENT_PHASE.md](../../docs/CURRENT_PHASE.md), the active phase doc under [docs/phases](../../docs/phases), and the workflow tracking docs under [docs](../../docs).

Evaluate:

1. Which deliverables appear complete.
2. Which verification-gate items are satisfied, missing, or untested.
3. Which workflow docs need updates before the phase can be marked complete.
4. The remaining risks or blockers.

Return a concise readiness assessment with a recommended next action.
