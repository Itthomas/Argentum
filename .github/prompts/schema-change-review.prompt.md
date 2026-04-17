---
name: schema-change-review
description: Review a durable schema or lifecycle change for appendix, docs, and test impact.
agent: plan
argument-hint: Describe the schema or lifecycle change under review.
---

Assess the requested schema or lifecycle change against the canonical appendix and phase requirements.

Return:

1. The durable objects and enums affected.
2. The state machines or invariants affected.
3. The code areas likely to change.
4. The documentation surfaces that must change with it.
5. The tests that should be added or updated.

Prefer identifying the smallest complete change set rather than a broad rewrite.
