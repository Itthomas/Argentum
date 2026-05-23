---
description: "Audit the current Argentum implementation, a cluster of completed slices, one package area, or repo workflow state against the spec, then persist a durable audit report under docs/implementation/audits/."
name: "Audit Argentum Implementation"
argument-hint: "Audit scope, such as slices, package, phase, or repo readiness"
agent: "argentum-implementation-auditor"
---
Audit this Argentum implementation scope: ${input}

Requirements:

- Treat the spec tree under `docs/spec/` as authoritative.
- Review implementation code, slice cards, backlog state, and validation evidence that fall within scope.
- Look for spec drift, boundary drift, weak validation, missing tests, deferred-decision leakage, stale planning artifacts, and readiness risks for the next slice.
- Persist the audit to `docs/implementation/audits/` using the audit template and a stable numeric filename.
- Create a new audit report by default rather than rewriting an older report.
- Do not use this audit to replace slice approval; slice approval still belongs to the slice review workflow.

Return:

1. Findings by severity
2. Drift by category
3. Missing tests or weak validation
4. Stale or inconsistent planning artifacts
5. Deferred-decision leakage or unsafe assumptions
6. Repo readiness verdict for the next slice: `ready`, `ready-with-risks`, or `not-ready`
7. Audit report path