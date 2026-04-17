---
name: Schema And Lifecycle Rules
description: Durable schema and lifecycle invariants for application code that touches canonical records.
applyTo: "src/argentum/**/*.py"
---

# Schema And Lifecycle Rules

- Preserve canonical enums and lifecycle states from the technical appendix.
- Do not add freeform status mutation where a governed state transition is required.
- Keep event authentication, authorization, replay, queue, and retry semantics durable rather than in-memory only.
- Preserve claim exclusivity and lease semantics for active task execution.
- Approval decisions are `approve`, `deny`, or `cancel`; do not reintroduce a `modify` decision state.
- Generated-tool lifecycle changes must preserve auditability, staged activation, rollback linkage, and disablement history.
