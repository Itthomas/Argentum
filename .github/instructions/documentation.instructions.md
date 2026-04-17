---
name: Documentation Rules
description: Lean documentation rules for canonical, derived, and workflow-tracking markdown files.
applyTo: "docs/**/*.md,.github/copilot-instructions.md,REMEDIATION_PLAN.md"
---

# Documentation Rules

- Treat `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md` as the only normative architectural source.
- Treat docs under `docs/reference/` and `docs/phases/` as derived, non-normative working docs.
- When canonical behavior changes, update the affected derived docs in the same change.
- Keep `docs/STATUS.md`, `docs/PHASE_INDEX.md`, `docs/CURRENT_PHASE.md`, and the active phase doc aligned with actual progress.
- Do not introduce new behavior in derived docs that is not supported by the canonical docs.
- Prefer small, targeted edits that preserve section structure and existing cross-references.
