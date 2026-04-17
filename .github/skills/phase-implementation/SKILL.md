---
name: phase-implementation
description: Use this skill when starting or resuming implementation work in the active project phase. It loads the active phase packet, required references, and produces an in-scope implementation and verification plan.
argument-hint: Optional task or focus area within the active phase.
---

# Phase Implementation

Use this skill when the task is to implement or plan work within the current project phase.

## Steps

1. Read [docs/CURRENT_PHASE.md](../../../docs/CURRENT_PHASE.md).
2. Identify the active phase and read the corresponding phase doc under [docs/phases](../../../docs/phases).
3. Read the specific reference docs listed in that phase packet before expanding to broader repo exploration.
4. Extract the active phase objective, in-scope systems, out-of-scope systems, verification tasks, and exit criteria.
5. Build a minimal implementation checklist tied to the user's request.
6. Call out any documentation or test updates that are required by the phase packet.

## Output

- concise scope summary
- implementation checklist
- verification checklist
- risks or blockers tied to the current phase

Keep the result phase-specific and avoid pulling in later-phase work unless the active phase doc explicitly requires it.
