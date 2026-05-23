---
description: "Review an Argentum plan or implementation slice for spec drift, missing tests, unsafe scope expansion, and weak validation."
name: "Review Argentum Slice"
argument-hint: "Plan, file, or change set to review"
agent: "argentum-adversarial-review"
---
Review this Argentum slice critically: ${input}

Look for:

- Drift from the authoritative spec
- Boundary violations between modules
- Missing or weak tests
- Deferred decisions being resolved ad hoc
- Unsafe autopilot usage
- Gaps in validation or observability

Return findings first, ordered by severity, then concrete refinements.
State whether the slice should remain blocked, stay planned, or be marked `Approval: approved`.