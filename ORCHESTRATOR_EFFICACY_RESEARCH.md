# Orchestrator Efficacy Research

> Research date: 2026-05-23
> Purpose: Assess the feasibility of an orchestrator agent that automates the current human workflow of planning, reviewing, implementing, and auditing Argentum slices using subagents.

---

## 1. Current Human Workflow Decomposition

The user's current workflow consists of these discrete steps, executed in a loop per slice:

| Step | Action | Agent/Prompt Used | Human Judgment Required |
|---|---|---|---|
| 1. Plan | Convert spec leaf → slice card | `argentum-spec-planner` via `/plan-argentum-slice` or `/spec-to-slice` | Moderate: scoping, sequencing |
| 2. Review | Adversarially review the slice card | `argentum-adversarial-review` via `/review-argentum-slice` | Low: reads findings |
| 3. Approve | Decide approve/refine/reject; update `Approval` field | Manual edit of slice card | **High: core judgment call** |
| 4. Implement | Code the slice + tests + validate | `argentum-implementer` via `/implement-argentum-slice` | Low-moderate: verify tests pass |
| 5. Validate | Run `pnpm --filter <pkg> test`, `pnpm typecheck` | Terminal / manual | Low: check exit codes |
| 6. Repair | If validation fails, re-invoke implementer with feedback | `argentum-implementer` again | Moderate: diagnose failure |
| 7. Audit | After a cluster of slices, run repo-wide audit | `argentum-implementation-auditor` via `/audit-argentum-implementation` | Low: reads findings |
| 8. Backlog | Update `backlog.md` with new status, reorder queue | Manual edit | Moderate: sequencing judgment |

The human's value-add is concentrated in **Steps 3 (approval judgment)**, **6 (failure diagnosis)**, and **8 (sequencing strategy)**. The remaining steps are largely mechanical.

---

## 2. VS Code Copilot Agent Infrastructure Analysis

### 2.1 Agent Definition Capabilities

Each custom agent (`.agent.md`) supports these frontmatter controls relevant to orchestration:

| Attribute | Purpose | Orchestrator Relevance |
|---|---|---|
| `tools` | Restrict available tool aliases | Can lock orchestrator to `[read, search, edit, execute, agent, todo]` — prevents direct code edits |
| `agents` | Restrict allowed subagents | Can allow: `[argentum-spec-planner, argentum-adversarial-review, argentum-implementer, argentum-implementation-auditor]` |
| `disable-model-invocation` | Prevent being invoked as subagent | Would keep orchestrator as top-level only |
| `user-invocable` | Show in agent picker | `true` so human can invoke orchestrator |
| `model` | Pin to specific model | Can select strongest available model for judgment calls |

### 2.2 Subagent Invocation (runSubagent Tool)

The `runSubagent` tool is the mechanism for agent-to-agent delegation. Key properties:

- **Discovery**: Subagents are discovered via their `description` field. The parent agent matches the task description against available subagent descriptions.
- **Stateless**: Each subagent invocation is a single, isolated call. The subagent receives one prompt and returns one final message. No conversational back-and-forth within a subagent session.
- **Context isolation**: Subagents operate in their own context window. Their full internal reasoning is not visible to the parent — only the final output.
- **No iterative refinement**: If a subagent's output is incomplete, the parent must start a NEW invocation with refined instructions. Cannot "continue" a previous subagent session.

### 2.3 Current Agent Invocation Graph

```
argentum-implementer
  ├── can invoke → argentum-spec-planner
  └── can invoke → argentum-adversarial-review

argentum-spec-planner          → agents: [] (no subagents)
argentum-adversarial-review     → agents: [] (no subagents)
argentum-implementation-auditor → agents: [] (no subagents)
```

The `argentum-implementer` already has limited orchestration capability — it can spawn a planner or reviewer as read-only subagents. An orchestrator would sit ABOVE this graph.

### 2.4 Tool Aliases Available

| Alias | What It Does | Orchestrator Needs? |
|---|---|---|
| `read` | Read files | ✅ Read specs, slice cards, test output |
| `search` | Search files/text | ✅ Find relevant spec leaves |
| `edit` | Edit files | ⚠️ Needed for backlog/slice-card updates, risky for code |
| `execute` | Run shell commands | ✅ Run `pnpm test`, `pnpm typecheck` |
| `agent` | Invoke subagents | ✅ Core capability |
| `todo` | Manage task lists | ✅ Track sub-steps |
| `web` | Web fetch/search | ❌ Not needed for this workflow |

---

## 3. Can The Workflow Be Automated? Step-by-Step Analysis

### Step 1: Planning (Automation Grade: A)

**Current human action**: Prompt `argentum-spec-planner` with the target module/spec file.

**Orchestrator action**: Invoke `argentum-spec-planner` as a subagent, passing the next slice target and current spec context.

**Feasibility**: **HIGH**. The planner agent is already designed for this. The orchestrator just needs to know which spec leaf to target next (which comes from the backlog).

**Risk**: The orchestrator must correctly identify the "next" slice from the backlog. This is deterministic if the backlog is well-maintained.

### Step 2: Review (Automation Grade: A)

**Current human action**: Prompt `argentum-adversarial-review` with the slice card.

**Orchestrator action**: Invoke `argentum-adversarial-review` as a subagent, passing the freshly created/updated slice card.

**Feasibility**: **HIGH**. The reviewer is read-only and returns structured findings by severity.

**Risk**: None significant. The reviewer agent has no side effects.

### Step 3: Approval Decision (Automation Grade: C)

**Current human action**: Read review findings, decide whether the slice is ready, update the `Approval` field.

**Orchestrator action**: Parse the review output for severity levels. Apply decision rules:
- `HIGH` findings → **escalate to human** (do not auto-approve)
- `MEDIUM` findings → attempt up to 1 auto-refinement cycle, then escalate
- `LOW` findings only → auto-approve
- No findings → auto-approve

**Feasibility**: **MODERATE**. This is the riskiest automation point. The quality of approval decisions depends on:
- How well the review agent distinguishes HIGH from MEDIUM severity
- Whether the orchestrator can correctly identify when a MEDIUM finding is actually blocking
- The orchestrator's ability to refine a slice card based on review feedback

**Critical risk**: Auto-approving a slice with insufficient validation coverage could accumulate technical debt that compounds across slices.

### Step 4: Implementation (Automation Grade: B+)

**Current human action**: Prompt `argentum-implementer` with the approved slice card.

**Orchestrator action**: Invoke `argentum-implementer` as a subagent, passing the approved slice card and any context from review findings.

**Feasibility**: **HIGH**. The implementer agent is already designed for autonomous slice execution. The orchestrator just needs to pass the right context.

**Risk**: The implementer may produce code that passes tests but violates spec intent in ways the tests don't catch. The orchestrator has no way to judge code quality beyond test results.

### Step 5: Validation (Automation Grade: A)

**Current human action**: Run `pnpm --filter <pkg> test` and `pnpm typecheck`.

**Orchestrator action**: Execute the test commands, parse exit codes.

**Feasibility**: **HIGH**. Purely mechanical.

### Step 6: Repair Loop (Automation Grade: C)

**Current human action**: If tests fail, diagnose the failure, re-invoke implementer with targeted feedback.

**Orchestrator action**: If validation fails, parse the test output for error messages, re-invoke implementer with the failure context. Cap retries at 2.

**Feasibility**: **MODERATE**. Simple failures (missing export, type mismatch) can be auto-repaired. Complex failures (spec misinterpretation, architectural flaw) cannot.

**Critical risk**: An orchestrator repair loop could run indefinitely or produce increasingly degraded code if the root cause isn't fixed by re-prompting.

### Step 7: Audit (Automation Grade: A)

**Current human action**: Prompt `argentum-implementation-auditor` after a cluster of slices.

**Orchestrator action**: After every N slices (e.g., N=3), invoke the auditor. Parse the readiness verdict.

**Feasibility**: **HIGH**. The auditor is designed for autonomous repo-wide review.

### Step 8: Backlog Maintenance (Automation Grade: B+)

**Current human action**: Update `backlog.md` with new slice statuses.

**Orchestrator action**: After each slice is validated, update the slice card's `State` to `validated`, update `backlog.md` status.

**Feasibility**: **HIGH**. Deterministic file edits.

**Risk**: The orchestrator might incorrectly reorder the backlog if it misunderstands dependency constraints between slices.

---

## 4. Architectural Risks

### 4.1 Context Window Starvation

Each subagent invocation adds its full output to the orchestrator's context window. A typical cycle:
- Planner output: ~100-200 lines
- Reviewer output: ~80-150 lines
- Implementer output: ~150-300 lines
- Test output: ~30-60 lines

**Total per slice**: ~360-710 lines of subagent output in the orchestrator's context, PLUS the orchestrator's own reasoning, PLUS spec files read, PLUS tool call overhead.

After 2-3 slices, the orchestrator's context window will be saturated. This means an orchestrator must be **single-slice scoped** — one orchestrator invocation = one slice, with the human relaunching for the next slice.

### 4.2 Nested Subagent Hierarchy

```
Human
  └── Orchestrator Agent
        ├── argentum-spec-planner (subagent)
        ├── argentum-adversarial-review (subagent)
        └── argentum-implementer (subagent)
              ├── argentum-spec-planner (sub-subagent)
              └── argentum-adversarial-review (sub-subagent)
```

The `argentum-implementer` already invokes its own subagents. This creates a 3-level hierarchy. Each level adds latency and context overhead. The implementer's internal subagent invocations are invisible to the orchestrator.

**Mitigation**: The orchestrator should prefer to do planning and review at its own level (before invoking the implementer) rather than relying on the implementer's internal subagent calls. The implementer's subagent access is a safety net, not the primary path.

### 4.3 Judgment Quality Degradation

The human's primary value is judgment:
- Is this review finding really HIGH severity or is the reviewer being overly cautious?
- Does this implementation capture the spec's intent, not just its letter?
- Is this test suite sufficient, or does it just check happy paths?

An orchestrator agent makes these judgments based on pattern matching against its training data and the repo's instruction files. It cannot develop genuine understanding of the spec's intent. Over many slices, judgment errors compound.

### 4.4 Deferred-Decision Leakage

The spec has explicit deferred decisions (exact DeepSeek endpoint, compaction thresholds, initial tool catalog). The orchestrator might accidentally resolve one of these to unblock a slice, violating the spec's authority rules.

**Mitigation**: The orchestrator's agent definition must include explicit rules: "If a slice requires resolving a deferred decision, STOP and escalate to human. Do not invent answers."

### 4.5 Tool Restriction Dilemma

The orchestrator needs `edit` tools to update slice cards and the backlog. But `edit` is the same tool used for code changes. There is no built-in mechanism to say "edit planning artifacts but not source code."

**Mitigation**: The orchestrator's agent definition can use strong constraints ("DO NOT edit files under `packages/`, `apps/`, `config/`, or `docs/spec/`") but this is non-deterministic guidance, not a technical enforcement. A hook could potentially enforce this deterministically.

---

## 5. Current Repo Readiness for Orchestration

### 5.1 What's Already in Place

| Asset | Readiness for Orchestration |
|---|---|
| `argentum-spec-planner` agent | ✅ Ready — well-scoped, structured output format |
| `argentum-adversarial-review` agent | ✅ Ready — returns severity-ranked findings |
| `argentum-implementer` agent | ✅ Ready — already uses subagents internally |
| `argentum-implementation-auditor` agent | ✅ Ready — produces structured audit reports |
| Slice card template (`0000-template.md`) | ✅ Ready — machine-parseable fields |
| `backlog.md` | ✅ Ready — structured status tracking |
| `copilot-instructions.md` | ✅ Ready — provides spec authority rules |
| Contract-first skill | ✅ Ready — guides implementer |
| Spec-to-slice skill | ✅ Ready — guides planner |
| Non-vacuous test gates | ✅ Ready — `pnpm --filter <pkg> test` returns reliable exit codes |
| `pnpm typecheck` | ✅ Ready — type-level validation |

### 5.2 What's Missing

| Gap | Impact on Orchestration |
|---|---|
| No orchestrator agent definition | Must be created |
| No structured status markers in subagent outputs | Orchestrator must parse natural language, which is brittle |
| No session persistence convention | Orchestrator can't resume across invocations |
| No hook to enforce tool boundaries | Orchestrator's `edit` constraint is guidance-only |
| No explicit retry/repair policy | Orchestrator may loop indefinitely |
| No human escalation protocol | Orchestrator may silently proceed past blockers |

---

## 6. The Current "Bug" in the Workflow: Slice 0011 Append-Surface Drift

The most recent audit (0006) found that slice 0011's implementation swallows append-surface failures, conflicting with the slice card's requirement. This is instructive:

- **The human workflow caught this**: The human invoked the auditor, which found the drift.
- **An orchestrator could also catch this**: The auditor subagent returns structured findings. The orchestrator could read HIGH-severity findings and re-invoke the implementer.
- **But would the orchestrator have prevented it?**: Probably not. The implementer ran tests that passed (because the test also validated the wrong behavior). The orchestrator, seeing green tests, would have marked the slice validated.

This illustrates the fundamental limitation: **an orchestrator validates process, not correctness**. Tests passing ≠ implementation correct. Only adversarial review and careful human judgment catch semantic drift.

---

## 7. Quantitative Feasibility Estimate

| Workflow Step | Automatable? | Confidence | Notes |
|---|---|---|---|
| Read backlog, pick next slice | ✅ Yes | 90% | Deterministic from backlog order |
| Invoke planner subagent | ✅ Yes | 95% | Mechanical |
| Invoke reviewer subagent | ✅ Yes | 95% | Mechanical |
| Parse review, decide approve/reject | ⚠️ Partial | 60% | Rule-based; misses nuance |
| Update slice card Approval | ✅ Yes | 90% | Deterministic edit |
| Invoke implementer subagent | ✅ Yes | 90% | Mechanical |
| Run validation commands | ✅ Yes | 100% | Mechanical |
| Detect pass/fail | ✅ Yes | 100% | Exit code parsing |
| Repair on failure (1-2 retries) | ⚠️ Partial | 50% | Works for simple failures only |
| Invoke auditor (every N slices) | ✅ Yes | 95% | Mechanical |
| Parse auditor verdict | ✅ Yes | 85% | Structured output |
| Update backlog after validation | ✅ Yes | 90% | Deterministic edit |
| Handle novel edge cases | ❌ No | 10% | Requires human |
| Resolve deferred decisions | ❌ No | 0% | Must escalate |
| Judge test quality/sufficiency | ❌ No | 20% | Requires semantic understanding |

**Overall workflow automation coverage**: ~70-80% of mechanical steps.
**Slices fully automatable end-to-end**: ~50-60% (well-bounded, contract-only, no deferred decisions).
**Slices requiring human intervention**: ~40-50% (new module boundaries, complex state machines, HIGH-severity review findings).

---

## 8. Key Findings Summary

1. **The technology exists.** VS Code Copilot's agent infrastructure (custom agents, `runSubagent` tool, tool restrictions, structured output formats) provides all the primitives needed for agent-to-agent orchestration.

2. **The project is ready.** Argentum's workflow infrastructure (4 custom agents, 4 prompts, 2 skills, 3 instruction files, slice template, backlog, audit template) provides a clean surface for an orchestrator to coordinate.

3. **The core loop is automatable.** Plan → Review → Approve/Reject → Implement → Validate → Backlog-update can be automated for well-bounded slices using subagent delegation.

4. **The pipeline model resolves context concerns.** The orchestrator uses the filesystem as extended memory — writing slice cards, review findings, and backlog state to disk rather than holding them in context. This enables multi-slice sessions without context starvation.

5. **The severity model is the linchpin.** The existing HIGH/MEDIUM/LOW tiers conflate "machine-resolvable blocker" with "genuinely needs human judgment." Adding a CRITICAL tier for spec ambiguity, deferred decisions, and architectural conflicts shrinks the human escalation surface to ~20% of current HIGH findings.

6. **The orchestrator should escalate, not guess.** The safest design pattern is "automate the process, auto-resolve routine blockers, escalate only on CRITICAL." The orchestrator delegates all code changes to the implementer subagent and never edits source code directly.

---

## 9. Revised Assessment: Pipeline Governor Model (2026-05-23, second pass)

### 9.1 Context Window Reassessment

The initial research (Section 4.1) identified context window starvation as a HIGH risk, limiting the orchestrator to 1-2 slices per invocation. This was based on an incorrect assumption: that the orchestrator must hold ALL subagent outputs in its active context simultaneously.

In practice, the workspace filesystem serves as persistent extended memory:

- Slice cards are written to `docs/implementation/slices/` and read only when needed
- Review findings are embedded in slice cards' Review Log
- Backlog state is a single file that can be read and written atomically
- Audit reports are durable files in `docs/implementation/audits/`

The orchestrator reads from disk only what's relevant to the current step, writes results to disk, and drops them from active context. A pipeline-governor session processing 4 implemented slices + 4 planned slices generates an estimated ~30,000–40,000 tokens of subagent output total, but only ~5,000–8,000 are in active context at any moment. This is well within modern context windows.

### 9.2 The 3-4 Slice Lookahead Requirement

The user's workflow insight: no slice should be implemented unless 3-4 future slices are already planned and approved. This prevents the implementation cursor from blocking on planning latency.

This changes the orchestrator's role from "single-slice executor" to **pipeline governor** — an agent whose primary job is maintaining the planning pipeline ahead of the implementation cursor. Implementation is the final, mechanical step; pipeline maintenance is the core responsibility.

### 9.3 CRITICAL vs HIGH: The Missing Severity Tier

Analysis of the user's workflow reveals that ~80% of what the adversarial review agent currently flags as HIGH is actually machine-resolvable:

| Finding Type | Example | Resolvable By |
|---|---|---|
| Missing contract field | "`ContextItem` is missing the `role` field required by spec" | Implementer, following reviewer's direction |
| Boundary violation | "Gateway release function imports from core-loop package" | Implementer, with explicit fix instruction |
| Missing test coverage | "No test for queue overflow reject-newest behavior" | Implementer, adding the named test |
| Weak validation | "Test asserts success on append failure, should assert error surfacing" | Implementer, rewriting the test |

The ~20% that genuinely needs human judgment:

| Finding Type | Example | Why Human Is Needed |
|---|---|---|
| Spec ambiguity | "The spec says compaction is inline, but doesn't define the size threshold" | Deferred decision — human must resolve |
| Architectural conflict | "The gateway needs turn-state info, but core-loop owns turn state and gateway can't import it" | Module boundary redesign needed |
| Spec gap | "The spec doesn't define what happens when a tool call times out mid-execution" | Spec change required |
| Contradictory requirements | "MVP scope says sequential tool execution, but tool-layer spec suggests parallel dispatch for read-only tools" | Human must reconcile or defer |

The fix is a new CRITICAL tier above HIGH. The reviewer uses CRITICAL for findings that require the human to make a decision, interpret ambiguous spec text, or resolve a conflict between module boundaries. HIGH remains for implementation defects and coverage gaps that an agent can fix given explicit direction.

### 9.4 Revised Automation Coverage

With the CRITICAL/HIGH distinction and pipeline model:

| Workflow Step | Automatable? | Confidence | Notes |
|---|---|---|---|
| Maintain 3-4 slice pipeline | ✅ Yes | 90% | Planner + reviewer subagents, filesystem as state |
| Auto-resolve HIGH findings | ✅ Yes | 80% | Feed reviewer's directions to implementer |
| Auto-resolve MEDIUM findings | ✅ Yes | 70% | 1 refinement cycle, then escalate |
| Auto-approve on LOW/None | ✅ Yes | 95% | Deterministic |
| Implement approved slice | ✅ Yes | 90% | Delegated to implementer subagent |
| Validate (tests + typecheck) | ✅ Yes | 100% | Mechanical |
| Repair on failure (≤2 retries) | ⚠️ Partial | 60% | Works for simple failures; complex ones escalate |
| Run periodic audit | ✅ Yes | 95% | Auditor subagent |
| Handle CRITICAL findings | ❌ No | 0% | Must escalate to human |
| Resolve deferred decisions | ❌ No | 0% | Must escalate to human |
| Judge when spec itself is wrong | ❌ No | 0% | Requires human spec authority |

**Overall pipeline automation**: ~85% of workflow steps.
**Human prompts replaced per orchestrator session**: ~15–25 (at ~4-5 prompts/slice × 4-5 slices/session).
**CRITICAL escalations expected**: ~1 per 5-8 slices.

7. **A hook could harden the orchestrator.** A `PreToolUse` hook that blocks edits to `packages/` and `apps/` would deterministically enforce the "orchestrator doesn't write code" constraint, eliminating the tool restriction dilemma.

---

## 9. References Consulted

### Project Files
- `.github/copilot-instructions.md` — Repo-wide agent guidelines
- `.github/agents/*.agent.md` — All 4 custom agent definitions
- `.github/prompts/*.prompt.md` — All 4 prompt definitions
- `.github/skills/*/SKILL.md` — Both skill definitions
- `.github/instructions/*.instructions.md` — All 3 instruction files
- `docs/implementation/copilot-workflow.md` — Formal workflow description
- `docs/implementation/implementation-plan.md` — 7-phase plan
- `docs/implementation/backlog.md` — Current slice queue
- `docs/implementation/bootstrap-decisions.md` — Stack and tooling decisions
- `docs/implementation/slices/README.md` — Slice card conventions
- `docs/implementation/slices/0000-template.md` — Slice card template
- `docs/implementation/audits/0006-*.md` — Most recent audit (append-surface drift)
- `docs/spec/README.md` — Spec index and authority rules
- `docs/spec/50-implementation/test-strategy.md` — Required test layers
- `docs/spec/70-roadmap/deferred-decisions.md` — Forbidden resolution targets

### VS Code Agent Infrastructure
- Agent-customization skill (`SKILL.md`) — Decision flow, frontmatter reference
- Agent-customization references (`references/agents.md`) — Agent definition schema, tool aliases, subagent invocation mechanics, hook support
- `runSubagent` tool — Observed in practice across slice 0001-0011 implementation
- Tool aliases: `read`, `edit`, `search`, `execute`, `agent`, `todo`, `web`

### Implementation Evidence
- Slices 0001-0011 implementation history — 11 slices completed via human + subagent workflow
- Slice 0011 append-surface drift (audit 0006) — Demonstrates limits of test-based validation
- Gateway package tests (`release-and-dequeue.test.ts`) — Example of test-passing ≠ spec-correct
