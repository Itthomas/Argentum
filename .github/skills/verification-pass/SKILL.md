---
name: verification-pass
description: Use this skill to determine the correct validation steps for the active phase and assess whether the current work satisfies its verification gate.
argument-hint: Optional summary of the change set to validate.
---

# Verification Pass

Use this skill before declaring work complete or before marking a phase milestone as satisfied.

## Steps

1. Read [docs/CURRENT_PHASE.md](../../../docs/CURRENT_PHASE.md).
2. Read the active phase doc in [docs/phases](../../../docs/phases) and identify its verification tasks, verification gate, and exit criteria.
3. Review the relevant changed code, docs, and tests.
4. Determine which checks can be run now and which checks are still missing.
5. Distinguish between completed verification, unrun verification, and blocked verification.
6. Summarize residual risk if the work is not fully verified.

## Output

- verification gate checklist with status
- tests or checks already satisfied
- tests or checks still required
- residual risks and blockers

Do not claim validation is complete when checks were only inferred rather than run or inspected.
