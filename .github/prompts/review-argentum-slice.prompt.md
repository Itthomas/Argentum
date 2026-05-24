---
description: "Review an Argentum plan or implementation slice for spec drift, missing tests, unsafe scope expansion, and weak validation."
name: "Review Argentum Slice"
argument-hint: "Plan, file, or change set to review"
agent: "argentum-adversarial-review"
---
Review this Argentum slice critically: ${input}

## Severity Classification

Use four tiers. Be precise — misclassification between CRITICAL and HIGH is the most consequential error you can make.

### CRITICAL — Human judgment required
- Spec ambiguity: the spec is unclear or self-contradictory on a point this slice depends on
- Deferred decision required: the slice forces resolution of an item in `docs/spec/70-roadmap/deferred-decisions.md`
- Architectural conflict: two module boundaries conflict requiring boundary redesign
- Spec gap: a missing concept in the spec itself, not just a missing contract field
- **CRITICAL findings cannot be resolved by an implementer agent. Only a human can resolve them.**

### HIGH — Blocking but machine-resolvable
- Spec drift: implementation/plan contradicts the authoritative spec
- Missing contract fields: DTO missing a spec-required field
- Boundary violation: import from a forbidden package per `docs/spec/50-implementation/package-boundaries.md`
- Missing required tests: test category from `docs/spec/50-implementation/test-strategy.md` is absent
- Weak validation: planned validation can pass while implementation is wrong
- **For every HIGH finding, provide actionable revision instructions an implementer can follow directly.**

### MEDIUM — Should fix, may block
- Insufficient edge-case coverage the spec implies but doesn't mandate
- Validation that asserts the wrong outcome
- Stale planning artifacts that don't affect correctness
- Missing package-entrypoint exports

### LOW — Non-blocking observation
- Style, naming, documentation, redundant patterns

## Output Requirements

1. Findings by severity (CRITICAL first, then HIGH, MEDIUM, LOW)
   - Each: severity label, file/line ref, spec citation, and for HIGH — actionable revision instructions
2. Missing tests or validation
3. Unsafe assumptions
4. Approval recommendation: `blocked`, `planned`, or `approved`
5. Minimal refinements to resolve all HIGH findings