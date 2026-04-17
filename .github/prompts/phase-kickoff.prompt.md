---
name: phase-kickoff
description: Start work in the active phase by loading the right docs and producing an implementation checklist.
agent: plan
argument-hint: Optional focus area or task to prioritize within the active phase.
---

Read [docs/CURRENT_PHASE.md](../../docs/CURRENT_PHASE.md), identify the active phase, then read the corresponding phase doc under [docs/phases](../../docs/phases) and any reference docs that phase requires.

Produce:

1. A concise scope summary for the active phase.
2. A checklist of in-scope implementation tasks for the current request.
3. A list of explicitly out-of-scope areas that should not be pulled in.
4. A verification checklist based on the phase verification gate and exit criteria.

If the user supplied a focus area, prioritize the checklist around that focus area.
