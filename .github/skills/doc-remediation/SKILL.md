---
name: doc-remediation
description: Use this skill when a change to architecture, schema, lifecycle behavior, or governance requires documentation synchronization across canonical, derived, and workflow docs.
argument-hint: Describe the behavior change or the files that changed.
---

# Documentation Remediation

Use this skill when a code or documentation change may require synchronized updates across the repo's documentation layers.

## Steps

1. Inspect the reported behavior change or changed files.
2. Check the canonical docs first:
   - [docs/System Architecture Specification.md](../../../docs/System%20Architecture%20Specification.md)
   - [docs/System Technical Appendix.md](../../../docs/System%20Technical%20Appendix.md)
3. Identify affected derived docs under [docs/reference](../../../docs/reference) and [docs/phases](../../../docs/phases).
4. Check whether [docs/STATUS.md](../../../docs/STATUS.md), [docs/CURRENT_PHASE.md](../../../docs/CURRENT_PHASE.md), or [docs/PHASE_INDEX.md](../../../docs/PHASE_INDEX.md) also need updates.
5. Prefer the smallest complete update set that restores alignment.
6. Flag contradictions explicitly if canonical and derived docs disagree.

## Output

- affected canonical docs
- affected derived docs
- affected tracking docs
- minimum remediation plan
- unresolved contradictions or open questions

Do not treat derived docs as a source of truth when they conflict with canonical docs.
