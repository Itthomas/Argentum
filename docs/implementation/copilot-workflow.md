# Argentum Copilot Workflow

## Purpose

This document explains how the repo-level Copilot planning layer should be used before and during implementation.

## Active Repo Surfaces

- Repo-wide instructions: [.github/copilot-instructions.md](../../.github/copilot-instructions.md)
- On-demand instructions: [.github/instructions](../../.github/instructions)
- Reusable prompts: [.github/prompts](../../.github/prompts)
- Custom agents: [.github/agents](../../.github/agents)
- Skills: [.github/skills](../../.github/skills)
- Implementation plan: [docs/implementation/implementation-plan.md](./implementation-plan.md)
- Durable audit reports: [docs/implementation/audits](./audits)

## Default Operating Loop

1. Confirm the bootstrap prerequisites in [docs/implementation/bootstrap-decisions.md](./bootstrap-decisions.md).
2. Use the `/spec-to-slice` skill as the canonical planning entrypoint to create or update a slice card under [docs/implementation/slices](./slices).
3. Run `/review-argentum-slice` or invoke `argentum-adversarial-review`, then update the slice card's `Approval` field.
4. Update [docs/implementation/backlog.md](./backlog.md) with the current queue and status.
5. Decide whether the approved slice is safe for autopilot.
6. If safe, run `/implement-argentum-slice` or the `argentum-implementer` custom agent against that slice.
7. Refine the plan or slice before moving to the next package.
8. Run `/audit-argentum-implementation` after a cluster of implemented slices or before a risky next slice.

`/plan-argentum-slice` remains available as a prompt wrapper around the same planning behavior, but the `/spec-to-slice` skill is the default planner because it bundles the slice template and planning procedure.

## When To Use Autopilot

In this repo, autopilot means handing one approved slice to the `argentum-implementer` custom agent or `/implement-argentum-slice` prompt so it can execute the slice end-to-end.

Autopilot is appropriate when all of the following are true:

- The slice has one owning boundary.
- The authoritative spec files are known.
- The acceptance criteria are concrete.
- The first validation step is narrow and executable.
- The task does not require resolving a deferred decision.

Autopilot is not appropriate for cross-cutting architecture decisions, package reshaping across multiple modules, or any task whose success depends on choosing among deferred roadmap items.

## When To Use Parallel Subagents

Use parallel or independent subagents for read-only work that can be merged by the main thread:

- Acceptance-criteria extraction from leaf specs
- Test-matrix extraction from [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md)
- Risk review against module boundaries
- Adversarial critique of a draft implementation plan

Do not use parallel subagents for overlapping edits or for two agents to evolve the same contract at once.

## When To Run A Repo Audit

Run `/audit-argentum-implementation` when:

- Two or more slices have been implemented and you want to check for cumulative drift.
- The backlog, slice cards, and implemented code may have diverged.
- The next slice is riskier or wider than the previous slice cluster.
- You want a durable audit report before moving to a new package boundary or phase.

The audit prompt and agent are repo-wide review surfaces, not slice-approval replacements. Continue using `/review-argentum-slice` for slice approval and use `/audit-argentum-implementation` for broader implementation and workflow audits. Audit verdicts describe repo readiness, not slice approval.

## Recommended Roles

- `argentum-spec-planner`: turns the spec into one bounded slice
- `argentum-implementer`: executes one slice with focused validation
- `argentum-adversarial-review`: searches for drift, missing tests, and weak assumptions
- `argentum-implementation-auditor`: audits implemented slices, workflow state, and next-slice readiness against the spec

## Suggested Session Pattern

1. Start with the planner on the next module or contract boundary.
2. Review the slice card and mark `Approval: approved` only when it has concrete acceptance criteria and no blocking findings.
3. Keep the implementation agent on one slice until focused validation passes.
4. Request adversarial review before widening to the next slice.
5. Update the implementation backlog and slice-card status after each validated slice.
6. Run a repo audit after a small cluster of slices or before a risky next slice, and persist the report in [docs/implementation/audits](./audits).

## First Practical Use

Before any runtime code is written:

1. Fill the global blockers in [docs/implementation/bootstrap-decisions.md](./bootstrap-decisions.md).
2. Create the first slice cards under [docs/implementation/slices](./slices) from the package plan in [docs/spec/50-implementation/package-boundaries.md](../spec/50-implementation/package-boundaries.md).
3. Use [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md) to populate required validation in each slice.