# Implementation Audits

Store durable repo audit reports in this directory.

## Purpose

These audit reports capture periodic repo-wide or multi-slice reviews against the authoritative spec, current implementation, and planning artifacts.

## Rules

- Use one markdown file per audit with a stable numeric prefix such as `0001-`.
- Audit reports may cover one package, one phase, several slices, or overall repo readiness.
- Findings should cite the owning spec files and affected implementation or planning artifacts.
- Audits should not directly rewrite slice cards or backlog state; they should report findings and recommended corrective actions.
- Create a new audit report by default rather than rewriting an older audit file.
- An audit verdict does not replace slice approval. Slice approval remains owned by the slice review flow in [docs/implementation/slices/README.md](../slices/README.md).

## Suggested Naming

- `0001-phase1-slices-0001-0004.md`
- `0002-contracts-package-audit.md`
- `0003-readiness-for-slice-0005.md`

Use [0000-template.md](./0000-template.md) as the starting point.