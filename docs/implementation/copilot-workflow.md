# Argentum Copilot Workflow

## Purpose

This document explains how the repo-level Copilot planning layer should be used before and during implementation.

## Active Repo Surfaces

- Repo-wide instructions: [.github/copilot-instructions.md](../../.github/copilot-instructions.md)
- On-demand instructions: [.github/instructions](../../.github/instructions)
- Reusable prompts: [.github/prompts](../../.github/prompts)
- Custom agents: [.github/agents](../../.github/agents)
- Skills: [.github/skills](../../.github/skills)
- Hooks: [.github/hooks](../../.github/hooks)
- Implementation plan: [docs/implementation/implementation-plan.md](./implementation-plan.md)
- Durable audit reports: [docs/implementation/audits](./audits)

## Default Operating Mode: Orchestrator

The preferred workflow for advancing the implementation is the **`argentum-orchestrator`** pipeline governor. Launch it with a scope and let it coordinate planning, review, implementation, and audit subagents autonomously.

```
Human: "Orchestrate. Advance from slice 0012 through the contracts cluster."
```

The orchestrator will:
1. Maintain a 3-4 slice planning lookahead (plan + review + approve ahead of the cursor)
2. Implement one slice at a time at the cursor
3. Auto-resolve routine blockers (HIGH severity findings, validation failures)
4. Escalate only on CRITICAL findings that require human judgment
5. Run periodic audits every ~3 slices
6. Report a session summary when done or blocked

See [.github/agents/argentum-orchestrator.agent.md](../../.github/agents/argentum-orchestrator.agent.md) for the full pipeline-governor procedure.

## Manual Workflow (Fallback)

When the orchestrator is not suitable (one-off tasks, debugging, spec changes), use the manual prompt-and-agent workflow:

### Default Operating Loop

1. Confirm the bootstrap prerequisites in [docs/implementation/bootstrap-decisions.md](./bootstrap-decisions.md).
2. Use the `/spec-to-slice` skill as the canonical planning entrypoint to create or update a slice card under [docs/implementation/slices](./slices).
3. Run `/review-argentum-slice` or invoke `argentum-adversarial-review`, then update the slice card's `Approval` field.
4. Update [docs/implementation/backlog.md](./backlog.md) with the current queue and status.
5. Decide whether the approved slice is safe for autopilot.
6. If safe, run `/implement-argentum-slice` or the `argentum-implementer` custom agent against that slice.
7. Refine the plan or slice before moving to the next package.
8. Run `/audit-argentum-implementation` after a cluster of implemented slices or before a risky next slice.

`/plan-argentum-slice` remains available as a prompt wrapper around the same planning behavior, but the `/spec-to-slice` skill is the default planner because it bundles the slice template and planning procedure.

## Severity Model

Adversarial review uses four severity tiers. These drive both orchestrator and manual decision-making:

| Tier | Meaning | Action |
|---|---|---|
| **CRITICAL** | Spec ambiguity, deferred decision required, architectural conflict, spec gap | **Escalate to human.** Cannot be resolved by an agent. |
| **HIGH** | Spec drift, missing contract fields, boundary violation, missing required tests, weak validation | Blocking but machine-resolvable. Feed reviewer's revision instructions to implementer. |
| **MEDIUM** | Insufficient edge-case coverage, wrong-outcome assertions, stale artifacts | Should fix. Auto-refine once. May proceed if unresolved. |
| **LOW** | Style, naming, documentation, redundant patterns | Note and proceed. Does not block. |

## When To Use Autopilot

In this repo, autopilot means handing one approved slice to the `argentum-implementer` custom agent or `/implement-argentum-slice` prompt so it can execute the slice end-to-end. The orchestrator automates this decision as part of the pipeline loop.

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

Run `/audit-argentum-implementation` (or let the orchestrator run it automatically every ~3 slices) when:

- Two or more slices have been implemented and you want to check for cumulative drift.
- The backlog, slice cards, and implemented code may have diverged.
- The next slice is riskier or wider than the previous slice cluster.
- You want a durable audit report before moving to a new package boundary or phase.

The audit prompt and agent are repo-wide review surfaces, not slice-approval replacements. Continue using `/review-argentum-slice` for slice approval and use `/audit-argentum-implementation` for broader implementation and workflow audits. Audit verdicts describe repo readiness, not slice approval.

## Recommended Roles

- `argentum-orchestrator`: **primary workflow driver** — pipeline governor that coordinates all other agents
- `argentum-spec-planner`: turns the spec into one bounded slice
- `argentum-implementer`: executes one slice with focused validation
- `argentum-adversarial-review`: searches for drift, missing tests, and weak assumptions; classifies by CRITICAL/HIGH/MEDIUM/LOW
- `argentum-implementation-auditor`: audits implemented slices, workflow state, and next-slice readiness against the spec

## Suggested Session Pattern

### Orchestrator-Driven (Preferred)

1. Launch `argentum-orchestrator` with a scope ("Advance through the contracts cluster").
2. Orchestrator plans 3-4 slices ahead, reviews, approves, and implements one at a time.
3. Human reviews session summary and any CRITICAL escalations.
4. Repeat for the next cluster.

### Manual (Fallback)

1. Start with the planner on the next module or contract boundary.
2. Review the slice card and mark `Approval: approved` only when it has concrete acceptance criteria and no CRITICAL or HIGH findings.
3. Keep the implementation agent on one slice until focused validation passes.
4. Request adversarial review before widening to the next slice.
5. Update the implementation backlog and slice-card status after each validated slice.
6. Run a repo audit after a small cluster of slices or before a risky next slice, and persist the report in [docs/implementation/audits](./audits).

## First Practical Use

Before any runtime code is written:

1. Fill the global blockers in [docs/implementation/bootstrap-decisions.md](./bootstrap-decisions.md).
2. Create the first slice cards under [docs/implementation/slices](./slices) from the package plan in [docs/spec/50-implementation/package-boundaries.md](../spec/50-implementation/package-boundaries.md).
3. Use [docs/spec/50-implementation/test-strategy.md](../spec/50-implementation/test-strategy.md) to populate required validation in each slice.