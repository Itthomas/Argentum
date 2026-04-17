---
name: doc-sync-check
description: Check whether canonical, derived, and tracking docs are aligned after a behavioral change.
agent: plan
argument-hint: Describe the behavior or files that changed.
---

Review the described change and determine which documentation surfaces must be updated.

Always inspect:

- [docs/System Architecture Specification.md](../../docs/System%20Architecture%20Specification.md)
- [docs/System Technical Appendix.md](../../docs/System%20Technical%20Appendix.md)
- [docs/reference](../../docs/reference)
- [docs/phases](../../docs/phases)
- [docs/STATUS.md](../../docs/STATUS.md)
- [docs/CURRENT_PHASE.md](../../docs/CURRENT_PHASE.md)
- [docs/PHASE_INDEX.md](../../docs/PHASE_INDEX.md)

Return:

1. Which docs are already aligned.
2. Which docs require edits.
3. Any contradiction between canonical and derived guidance.
4. The minimum update set needed to restore alignment.
