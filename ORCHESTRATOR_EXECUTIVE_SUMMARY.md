# Orchestrator Executive Summary

> **Question**: Can an agent replace the human's current role of coordinating planning, reviewing, implementing, and auditing Argentum slices via subagents?
>
> **Answer**: **Yes.** The orchestrator acts as a pipeline governor — planning and approving 3–4 slices ahead of the implementation cursor, implementing one at a time, auto-resolving routine blockers, and escalating only when human judgment is genuinely required. A single orchestrator session replaces ~15–25 human prompts.

---

## Recommendation

**Build a pipeline-governor orchestrator agent (`argentum-orchestrator`).** It should maintain a rolling 3–4 slice planning lookahead, delegate implementation to subagents, auto-resolve machine-fixable blockers, and escalate only on CRITICAL findings that require human judgment.

The orchestrator is not a single-slice convenience tool. It is a **continuous pipeline governor** — one invocation covers 2–4 implemented slices plus 3–4 planned-ahead slices, replacing the equivalent of ~15–25 manual prompts.

---

## The Pipeline Model

The orchestrator maintains a lookahead window:

```
Implementation cursor →  [0011]  validated
Pipeline (ready)      →  [0012]  approved, ready to implement
                         [0013]  approved
Pipeline (planned)    →  [0014]  planned, reviewed, approved
                         [0015]  planned, reviewed
                         [0016]  planned

Orchestrator's job: keep 3–4 slices planned & approved ahead of the cursor.
```

The loop is not "do one slice end-to-end." It is:

1. **Fill the pipeline** — Are 3–4 slices planned ahead? If not, invoke planner subagent(s).
2. **Review the front** — Are the next 1–2 upcoming slices reviewed and approved? If not, invoke reviewer, auto-resolve or refine.
3. **Advance the cursor** — Implement the next approved slice. Validate. If green, mark validated, advance.
4. **Refill** — Plan one more slice to maintain the lookahead.
5. **Periodic audit** — Every ~3 slices, invoke auditor.

---

## Revised Severity Model: The Critical Insight

The original adversarial review output conflates two fundamentally different things under "HIGH." The orchestrator's efficacy depends on separating them:

| Tier | Meaning | Orchestrator Action |
|---|---|---|
| **LOW** | Cosmetic, non-blocking observation | Auto-approve; may apply refinement |
| **MEDIUM** | Weak validation, missing edge-case coverage | Auto-refine (1 cycle); escalate if unresolved |
| **HIGH** | Spec drift, missing contract fields, boundary violation, missing tests | **Blocking but machine-resolvable.** Feed reviewer's recommended revisions to the implementer. Retry up to 2 times. |
| **CRITICAL** | Spec ambiguity, deferred decision required, architectural conflict between module boundaries, spec gap that needs a spec change | **ESCALATE TO HUMAN.** The orchestrator cannot resolve these. |

In practice, ~80% of what the reviewer currently flags as HIGH is actually machine-resolvable — the implementer just needs explicit direction to add the missing field, fix the boundary, or add the test. Only ~20% genuinely needs human judgment (spec ambiguity, deferred decisions, architectural tradeoffs).

### Changes Required In The Review Agent

The `argentum-adversarial-review` agent and `/review-argentum-slice` prompt must be updated to:

1. Add `CRITICAL` as a severity tier above `HIGH`
2. Reserve `CRITICAL` for findings where: the spec is ambiguous, a deferred decision must be resolved, two module boundaries conflict architecturally, or the finding requires a spec change — not an implementation change
3. Reserve `HIGH` for: spec drift in implementation, missing contract fields, missing tests, boundary violations, validation gaps — all resolvable by the implementer following the reviewer's explicit recommendations
4. For every HIGH finding, include actionable revision instructions the implementer can follow directly

---

## What The Orchestrator Does (Revised Pipeline Loop)

```
Human: "Orchestrate. Advance from slice 0011."

Orchestrator enters pipeline-governor loop:

  ┌─ PIPELINE FILL ──────────────────────────────────────┐
  │ 1. Read backlog.md. Count planned+approved slices     │
  │    ahead of cursor.                                   │
  │ 2. If count < 3: invoke argentum-spec-planner for     │
  │    next spec leaf. Repeat until pipeline has 3-4.     │
  │ 3. For each newly planned slice:                      │
  │    a. Invoke argentum-adversarial-review              │
  │    b. Parse findings by severity                      │
  │    c. CRITICAL → ESCALATE TO HUMAN, stop              │
  │    d. HIGH → refine slice card with reviewer's        │
  │       recommendations, re-review                      │
  │    e. MEDIUM → auto-refine, re-review (1 cycle)       │
  │    f. LOW/None → auto-approve, update Approval field  │
  └──────────────────────────────────────────────────────┘
                         │
  ┌─ ADVANCE CURSOR ─────────────────────────────────────┐
  │ 4. Take next approved slice from front of pipeline.   │
  │ 5. Invoke argentum-implementer.                       │
  │ 6. Run pnpm --filter <pkg> test && pnpm typecheck    │
  │ 7. If validation fails:                               │
  │    a. If HIGH findings existed in review → feed them  │
  │       explicitly to implementer, retry (max 2)        │
  │    b. If still failing → ESCALATE TO HUMAN            │
  │ 8. If validation passes:                              │
  │    a. Mark slice State → validated                    │
  │    b. Update backlog.md                               │
  │    c. Advance cursor                                  │
  └──────────────────────────────────────────────────────┘
                         │
  ┌─ REFILL & AUDIT ─────────────────────────────────────┐
  │ 9. Plan one more slice to maintain 3-4 lookahead.    │
  │ 10. Every ~3 implemented slices: invoke               │
  │     argentum-implementation-auditor. Report verdict.  │
  │ 11. If auditor returns not-ready → ESCALATE TO HUMAN  │
  │ 12. Return to Pipeline Fill (step 1).                 │
  └──────────────────────────────────────────────────────┘
```

A single session continues until:
- The human's requested scope is complete, OR
- A CRITICAL finding is encountered, OR
- Validation fails after 2 repair attempts, OR
- An audit returns `not-ready`, OR
- The human interrupts

---

## Why Multi-Slice Sessions Work: Filesystem as Extended Memory

The original concern about context window starvation assumed the orchestrator must hold all subagent outputs simultaneously. It doesn't. The workspace filesystem is persistent memory:

- Slice cards live in `docs/implementation/slices/` — the orchestrator writes them and moves on
- Review findings live in slice cards' Review Log — the orchestrator reads only what's needed
- Backlog state lives in `backlog.md` — single authoritative source of pipeline status
- Audit reports live in `docs/implementation/audits/` — durable, re-readable

The orchestrator reads from disk only what's relevant to the current step. It writes results to disk and drops them from active context. A pipeline-governor session processing 4 implemented slices + 4 planned slices generates an estimated ~30,000–40,000 tokens of subagent output — but only ~5,000–8,000 are in the orchestrator's active context at any moment.

---

## Feasibility By The Numbers

| Metric | Assessment |
|---|---|
| **Pipeline planning (3-4 slices ahead)** | Fully automatable — planner + reviewer subagents |
| **HIGH findings auto-resolution** | ~80% automatable — implementer follows reviewer's directions |
| **CRITICAL findings requiring human** | ~1 per 5-8 slices — genuine spec ambiguity is rare |
| **Slices per orchestrator session** | 2–4 implemented + 3–4 planned = 5–8 slices processed |
| **Human prompts replaced per session** | ~15–25 (at ~4-5 prompts/slice currently) |
| **Context window risk** | Low — filesystem as extended memory |
| **Risk of silent spec drift** | Low-moderate — multi-tier review catches most; auditor catches rest |
| **Risk of repair-loop death** | Low — hard cap at 2 retries, then escalate |

---

## Required Changes To Existing Assets

### New Assets

| Asset | Path | Purpose |
|---|---|---|
| Orchestrator agent | `.github/agents/argentum-orchestrator.agent.md` | Pipeline governor with subagent delegation |
| Orchestrator guard hook (optional) | `.github/hooks/orchestrator-guard.json` | Deterministically block edits to `packages/`, `apps/` |

### Modified Assets

| Asset | Change |
|---|---|
| `argentum-adversarial-review.agent.md` | Add `CRITICAL` severity tier; require actionable revision instructions on HIGH findings |
| `/review-argentum-slice` prompt | Update severity vocabulary and escalation criteria |
| Slice card template (`0000-template.md`) | Add `CRITICAL` to review log severity options |
| `copilot-workflow.md` | Document orchestrator as default operating mode |

---

## Risks And Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **CRITICAL vs HIGH misclassification** — reviewer flags something as HIGH that actually needs human judgment | Medium | Over time, reviewer prompt refinement narrows this. Orchestrator escalates if it detects the same HIGH finding persisting across 2 repair cycles. |
| **Pipeline planning drifts from spec** — planner invents scope not in spec | Medium | Reviewer validates every planned slice against spec. Auditor catches cumulative drift. |
| **Silent approval of weak tests** — orchestrator approves slices with insufficient coverage | Low-medium | Reviewer explicitly checks test coverage against `test-strategy.md`. MEDIUM findings block auto-approval. |
| **Deferred-decision leakage** | Low | CRITICAL tier explicitly captures this. Orchestrator has hard rule: "If finding mentions a deferred decision, escalate." |
| **Orchestrator edits source code** | Low | Agent constraints + optional hook. Orchestrator delegates all code changes to implementer subagent. |
| **Human loses spec familiarity** | Low-medium | Human reviews auditor reports, CRITICAL escalations, and end-of-phase boundaries. Spot-checks any slice. |

---

## What The Human Still Does

The orchestrator handles **process and routine blockers.** The human handles **judgment and strategy:**

1. **Launch**: Start the orchestrator with a scope ("Advance from slice 0011 through the contracts cluster").
2. **CRITICAL escalations**: When the reviewer finds genuine spec ambiguity or architectural conflict, the human decides.
3. **Phase boundaries**: Before moving from contracts → gateway, gateway → tooling, tooling → agentic core, the human verifies the boundary.
4. **Strategic decisions**: Which phase to work on, when to cut scope, when to update the spec.
5. **Spot-checking**: Randomly inspect 1 in 5 slices to verify quality.
6. **Deferred-decision resolution**: When the spec intentionally leaves a gap, only the human fills it.

---

## Comparison: Current vs. Orchestrated Workflow

| Aspect | Current (Human-Driven) | Proposed (Pipeline Governor) |
|---|---|---|
| **Prompts per slice** | 4–5 human prompts | ~0.2 human prompts (1 launch covers ~5 slices) |
| **Planning lookahead** | 0–1 slices (just-in-time) | 3–4 slices (continuously maintained) |
| **Human attention per session** | 15–60 minutes of active prompting | ~30 seconds to launch, then periodic review |
| **Pipeline stalls** | Frequent — human busy, context-switching | Rare — orchestrator fills pipeline autonomously |
| **Error detection** | Human catches during review | Multi-tier: reviewer → auto-refine → auditor → human spot-check |
| **Momentum** | Gated by human availability | Continuous; one session covers a cluster |
| **Risk of compounding errors** | Low — human reviews every step | Low-moderate — mitigated by CRITICAL escalation + periodic human review |

---

## Phased Rollout Plan

### Phase A: Severity Model Update (immediate, no code impact)
1. Update `argentum-adversarial-review.agent.md` with CRITICAL/HIGH/MEDIUM/LOW tiers
2. Update `/review-argentum-slice` prompt with revised severity vocabulary
3. Update slice card template with new severity options
4. Validate by re-reviewing an existing slice (e.g., 0011) — confirm the reviewer correctly distinguishes CRITICAL from HIGH

### Phase B: Orchestrator Shadow Mode (1–2 slices)
1. Create `.github/agents/argentum-orchestrator.agent.md`
2. Run orchestrator on already-validated slices (e.g., re-plan and re-implement 0012–0013 from scratch in a shadow branch)
3. Compare orchestrator decisions against the human's original decisions
4. Tune agent definition, escalation rules, and pipeline thresholds

### Phase C: Contracts-Only Live Run (slices 0013–0016)
1. Use orchestrator for the remaining contracts slices
2. Lowest-risk environment — DTO definitions and parser tests, no runtime behavior
3. Human reviews each orchestrator session summary
4. Validate that pipeline planning produces correct, spec-compliant slice cards

### Phase D: Full Pipeline (Phase 3+ — tooling, agentic core, LLM provider, CLI)
1. Expand to runtime slices
2. First slice of each new module boundary: human reviews plan and implementation personally
3. Subsequent slices in same boundary: orchestrator runs autonomously
4. Human spot-checks 1 in 5 slices

### Phase E: Default Operating Mode
1. Orchestrator becomes the standard workflow
2. Human launches at session start, reviews CRITICAL escalations and audit reports
3. Direct subagent invocation remains available for one-off tasks and debugging

---

## Final Verdict

**Feasible today. Worth building.**

The VS Code Copilot agent infrastructure provides all necessary primitives. The Argentum project's workflow conventions — structured slice cards, dedicated subagents, non-vacuous test gates, adversarial review — are already well-suited to pipeline-orchestration.

The key architectural insight is the **CRITICAL vs HIGH distinction.** Once the review agent separates "machine-resolvable blocker" from "genuinely needs human judgment," the orchestrator's escalation surface shrinks dramatically. ~80% of blockages are auto-resolved by feeding the reviewer's recommendations to the implementer. The remaining ~20% — spec ambiguity, deferred decisions, architectural conflicts — are exactly where human judgment belongs.

The orchestrator is not "set and forget." It is a **force multiplier** — it eliminates the mechanical coordination work (~80% of prompts) and reserves the human's attention for the decisions that actually need it.

---

*Detailed research findings: [ORCHESTRATOR_EFFICACY_RESEARCH.md](./ORCHESTRATOR_EFFICACY_RESEARCH.md)*
