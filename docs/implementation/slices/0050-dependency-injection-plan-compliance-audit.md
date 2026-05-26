# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-26
- Implementation date: 2026-05-26
- Phase: 7 (Hardening)
- Owner: docs/

## Scope

- Slice name: Dependency injection plan compliance audit
- Target package or boundary: `docs/` — cross-package audit of dependency wiring against the DI plan spec
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/50-implementation/dependency-injection-plan.md](../../spec/50-implementation/dependency-injection-plan.md) — composition root wires concrete implementations together; core loop receives interfaces for provider access, tool execution, persistence, and event emission; channel modules depend on gateway-facing interfaces, not concrete gateway internals; tool implementations depend on execution drivers through explicit interfaces; swapping the provider adapter or execution driver must not require editing core-loop business logic
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md) — package dependencies must point inward toward contracts and core abstractions, not sideways through implementation details; the channel package must not depend on provider implementation code
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — contract validation tests for canonical DTO shapes
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — authoritative core-loop ownership and event flow for the orchestrator boundary
  - [docs/spec/40-modules/llm-provider/provider-abstraction.md](../../spec/40-modules/llm-provider/provider-abstraction.md) — provider-access seam owned by the provider abstraction module
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md) — execution-driver seam owned by the environment sandbox model
  - [docs/spec/40-modules/tool-layer/tool-registry.md](../../spec/40-modules/tool-layer/tool-registry.md) — tool-execution and registry-facing seam ownership
  - [docs/spec/40-modules/gateway/telemetry.md](../../spec/40-modules/gateway/telemetry.md) — event-emission and telemetry-boundary ownership
  - [docs/spec/50-implementation/persistence-plan.md](../../spec/50-implementation/persistence-plan.md) — persistence data classes and MVP direction; the DI-plan term "persistence" is resolved for this audit as the two core-loop-injected persistence seams (`TurnContentStore` and `EpisodicMemory`), with the future canonical seam being `SessionContextStore` (see `post-mvp-hardening-ideas.md`)
- Acceptance criteria:
  - An audit report under `docs/implementation/audits/0023-dependency-injection-plan-compliance.md` documents whether each DI-plan rule is satisfied by the current implementation.
  - The audit checks: (a) the composition root (`apps/runtime/src/composition-root.ts`) may instantiate concrete implementations, but the CoreLoopOrchestrator boundary is evidenced seam-by-seam against the owning leaf specs: provider access, tool execution, persistence, and event emission must each enter the core loop through public interfaces or public abstraction exports rather than concrete-only internals. The DI-plan term "persistence" is resolved for this audit as two evidence rows — `TurnContentStore` (content persistence) and `EpisodicMemory` (memory persistence) — both injected into the orchestrator. Gateway session persistence is excluded: it is owned by `@argentum/gateway` and is not a core-loop DI seam. A future `SessionContextStore` contract (recorded in `post-mvp-hardening-ideas.md`) may unify these into a single seam post-MVP; the audit report notes this forward path but does not require it. The audit report must provide one evidence-matrix row per seam naming the governing leaf spec, the injected abstraction, the consuming core-loop file, and the composition file that supplies it, (b) `@argentum/channel-cli` depends on gateway-facing public interfaces or remains gateway-agnostic, but does not import concrete gateway internals, (c) the runtime tool-registration/composition path and any concrete runtime tool implementations depend on execution-driver or host-service seams through explicit interfaces or facades judged against their owning leaf specs; if no concrete runtime tools currently exercise this seam, the audit report records the rule as presently vacuous and requiring re-audit when such tools land, (d) the LLM provider adapter can be swapped without editing files in `@argentum/agentic_core`, (e) the execution-driver seam is environment-owned and exposed through an explicit abstraction or facade at the actual dependency boundary, `@argentum/agentic_core` does not depend on execution-driver concretes, and if no concrete runtime tool path currently consumes `ExecutionDriver`, the audit report marks full driver-swap file impact as presently non-demonstrable, cites the files proving that vacuity, records whether the seam is a public package export or runtime-local composition facade, and records the trigger for re-audit once a concrete driver-backed tool path lands, (f) import and dependency validation is inventory-based: the audit derives the full direct package-edge list from every workspace `package.json`, derives the inter-package import list from source files importing workspace packages, records the exact derivation basis for both inventories, and reconciles every edge and import against the DI-plan and package-boundaries rules, (g) import review distinguishes composition-root concrete assembly from non-composition abstraction dependencies: concrete imports are only acceptable where a composition root is assembling the graph, while all non-composition packages must import contracts, interfaces, or explicit abstraction exports, and the evidence matrix records the rule that justifies each import.
  - Any gaps found are documented with severity (CRITICAL/HIGH/MEDIUM/LOW) and a recommended remediation slice reference.
  - The audit report includes an evidence matrix that cites the exact manifests and source files reviewed for each DI rule, enumerates every direct workspace package edge examined, enumerates every inter-package import surface checked, and cites the file proving any vacuous conclusion plus the trigger for re-audit.
  - If no gaps are found, the audit report confirms full compliance.
  - The audit does not modify any runtime code; it is a read-only inspection.
- Inputs crossing the boundary:
  - `apps/runtime/src/composition-root.ts` — composition wiring
  - `packages/environment/src/execution-driver.ts` and `packages/environment/src/index.ts` — execution-driver public seam
  - `packages/agentic_core/src/` — core-loop interface consumption
  - `packages/channel-cli/src/` — gateway interface dependency
  - `apps/runtime/src/tooling-composition.ts` and `apps/runtime/src/tooling-registration.ts` — runtime tool-host composition seams
  - `packages/tooling/src/` — public tooling surfaces consumed by runtime composition
  - `packages/llm_provider/src/` — provider adapter interface
  - All `package.json` files for dependency graph analysis
- Outputs crossing the boundary:
  - Audit report at `docs/implementation/audits/0023-dependency-injection-plan-compliance.md`

## Plan

- First contracts or interfaces to create:
  - None. This is a read-only audit.
- Minimal implementation steps:
  1. Inspect `apps/runtime/src/composition-root.ts` to verify that the composition root may build concrete instances, but the seams it passes into the core loop and runtime flow use public interfaces or abstraction exports rather than concrete-only internals.
  2. Inspect `packages/channel-cli/src/` imports to verify the package is either gateway-agnostic or depends only on gateway-facing public interfaces, not concrete gateway internals.
  3. Inspect `apps/runtime/src/tooling-composition.ts`, `apps/runtime/src/tooling-registration.ts`, and any concrete runtime tool implementations to verify tool-host bridging depends on explicit interfaces or facades rather than directly on host-specific concrete classes; if the seam is not yet exercised by concrete tools, record that as a vacuous check in the audit report.
  4. Trace the five CoreLoopOrchestrator DI seams separately: provider access, tool execution, content persistence (`TurnContentStore`), memory persistence (`EpisodicMemory`), and event emission. For each seam, capture the injected abstraction, the consuming core-loop file, and the composition file that supplies it. For `EpisodicMemory` specifically, classify whether injecting a concrete class (not a TypeScript `interface`) from the same package satisfies the DI-plan's "interfaces" requirement, and state the audit's interpretation explicitly (e.g., in-package concrete classes are acceptable; only cross-package boundaries require interfaces). Note that gateway session persistence is excluded — it is owned by `@argentum/gateway`, not the core-loop DI boundary.
  5. Trace `LLMProvider` usage in `@argentum/agentic_core` to confirm that swapping the adapter requires no edits to core-loop files. Inspect the `LLMProviderError` import in `core-loop-orchestrator.ts` and classify whether importing a concrete error class from `@argentum/llm-provider` satisfies or violates the DI-plan's "interfaces" rule for provider access. Record the justification, noting the TypeScript `instanceof` constraint and whether a future adapter swap would require a core-loop edit.
  6. Trace the execution-driver seam across `packages/agentic_core/src/`, `apps/runtime/src/composition-root.ts`, the runtime tool-registration/composition path, and the environment-owned execution-driver abstraction at the actual dependency boundary. Record whether the seam is exposed as a public package export or a runtime-local composition facade. If no concrete runtime tool path currently consumes `ExecutionDriver`, record the driver-swap file set as presently non-demonstrable, cite the proving files, and define the re-audit trigger.
  7. Derive the full direct workspace package-edge inventory from every workspace `package.json`, record the exact manifests scanned, and verify the graph stays inward-pointing and acyclic. Inspect the `@argentum/agentic_core` → `@argentum/tooling` dependency edge specifically: classify whether `@argentum/tooling` qualifies as a "core abstraction" per package-boundaries, or whether this sibling-package dependency should be flagged as a boundary concern; record the justification citing the specific symbol imported (`planToolExposure`).
  8. Derive the full inter-package import inventory from source files importing workspace packages, record the scan query or queries used plus whether tests and generated files are included or excluded, classify each import by caller role and symbol kind, and confirm that only composition roots assemble concrete implementations while non-composition packages stay on contracts, interfaces, or explicit abstraction exports. For packages that export both an interface and a concrete class under the same name (e.g., `Gateway`), verify the audit classifies each import separately and confirms the concrete import occurs only in the composition root.
  9. Write the audit report following the `docs/implementation/audits/0000-template.md` conventions, adding a `CRITICAL` section when needed and including the required evidence matrix plus the reconciled package-edge and import inventories, along with the raw hit lists or appendices used before reconciliation.
  10. Classify any gaps by severity and recommend remediation slices if needed.
- Required tests:
  - Not applicable. This is a documentation audit slice with no code changes.
- Narrow validation step:
  - Confirm the audit report contains explicit evidence-matrix rows for provider access, tool execution, content persistence (`TurnContentStore`), memory persistence (`EpisodicMemory`), and event emission at the core-loop boundary, each tied to its owning leaf spec.
  - Confirm the report includes a complete direct package-edge inventory derived from every workspace `package.json`, lists the exact manifests scanned, and reconciles each edge against the DI-plan and package-boundaries rules.
  - Confirm the report includes a complete inter-package import inventory derived from workspace source files, records the scan query or queries plus scope decisions, preserves the raw hit list or appendix before reconciliation, and records for each import whether it is allowed as composition-root concrete assembly or required to stay on contracts/interfaces/abstractions.
  - Confirm any vacuous conclusion cites the file proving vacuity and the trigger for re-audit, including the execution-driver seam if no concrete driver-backed tool path exists yet. For the execution-driver seam, confirm the audit distinguishes "seam exists (interface exported from environment) but no runtime consumer exercises it" from "seam contract missing."
  - For every import classified as "allowed" despite importing a concrete class or function from a non-composition package, confirm the report includes an explicit justification citing the DI-plan or package-boundaries rule that permits it.
  - Spot-check the three highest-risk imports (`LLMProviderError` from llm-provider, `planToolExposure` from tooling, and any concrete `Gateway` import) and confirm each has a justification paragraph, not just a classification label.

## Execution Strategy

- Autopilot suitability: not safe. The audit requires cross-package architecture judgment, interface-vs-concrete classification, and dependency-graph analysis that benefits from human review.
- Parallel subagent opportunities:
  - Read-only subagent to analyze `package.json` dependency graphs across all packages.
  - Read-only subagent to trace `LLMProvider` interface usage in `@argentum/agentic_core` and verify swappability.
  - Read-only subagent to inspect `@argentum/channel-cli` imports for gateway concrete-internals leakage.
- Out of scope:
  - Modifying any runtime code
  - Refactoring dependency graphs
  - Creating new interfaces or abstractions
- Deferred decisions that must remain deferred:
  - None specific to this audit

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **C1** — The DI-plan phrase "persistence" was ambiguous across gateway session persistence, core-loop content persistence, and episodic memory. **Resolved 2026-05-26 by human decision**: persistence is audited as two evidence rows — `TurnContentStore` (content) and `EpisodicMemory` (memory) — both injected at the core-loop boundary. Gateway session persistence is excluded. A future `SessionContextStore` contract may unify these post-MVP (see `post-mvp-hardening-ideas.md`).
  - **H1** — The slice incorrectly translated the DI rule into "interfaces, not concrete implementations" at the composition root. Refined criterion (a) and plan step 1 so the audit allows concrete instantiation in the composition root while checking that core-loop and runtime seams consume public interfaces or abstraction exports.
  - **H2** — Criterion (c) targeted `@argentum/tooling`, but the current tool-to-host DI seam lives in runtime composition. Re-scoped the audit to `apps/runtime/src/tooling-composition.ts`, `apps/runtime/src/tooling-registration.ts`, and any concrete runtime tool implementations, with an explicit vacuous-case note if concrete tools are not present yet.
  - **H3** — Manifest-only dependency review was too weak to prove boundary compliance. Expanded criterion (e) and plan steps 5-6 to require both package-edge/cycle review and source-import inspection for public-entrypoint usage.
  - **M1** — Planned audit path collided with existing audit prefix `0022`. Renumbered the target report path to `0023-dependency-injection-plan-compliance.md`.
  - **H4** — The card did not explicitly prove execution-driver swappability. Added criterion (e), execution-driver inputs, and plan step 5 to trace the driver seam and name the exact files that would change in a driver swap while keeping `@argentum/agentic_core` unchanged.
  - **H5** — Validation only checked report completeness. Replaced it with an evidence-based validation gate that requires rule-by-rule citations, direct package-edge enumeration, inter-package import review, and explicit proof for any vacuous conclusion.
  - **H6** — The DI audit did not explicitly prove the four core-loop seams named by the spec. Expanded criterion (a), plan step 4, and the validation gate so provider access, tool execution, persistence, and event emission each require their own evidence row.
  - **H7** — Execution-driver swappability asked for speculative future edit locations even though no concrete runtime tool currently consumes `ExecutionDriver`. Refined criterion (e), plan step 6, and the validation gate to require evidence-backed vacuity when the concrete driver-backed tool path is not yet present.
  - **H8** — The card relied on 50-implementation summaries without the owning leaf specs for the seams it audits. Added the relevant 30-core-loop and 40-modules leaf specs and required each DI seam to be judged against its owning leaf spec.
  - **H9** — Import review treated public package exports as sufficient. Tightened criteria, plan, and validation so only composition roots may assemble concrete implementations; all non-composition packages must stay on contracts, interfaces, or explicit abstraction exports, with justification recorded per import.
  - **H10** — Completeness validation still depended on reviewer memory. Replaced it with package-edge and inter-package import inventories derived from workspace manifests and source files, and required the audit report to reconcile every inventory item.
  - **H11** — The execution-driver seam was overconstrained as necessarily public. Refined criterion (e), plan step 6, and the validation gate to allow either a public package export or a runtime-local composition facade, so long as the dependency boundary remains explicit and environment-owned.
  - **H12** — Inventory validation needed reproducible derivation details. Expanded plan steps 7-9 and the validation gate to require the exact manifests scanned, scan queries and scope decisions, and raw inventory appendices before reconciliation.
  - **H1** (fifth review) — `LLMProviderError` concrete import into `@argentum/agentic_core` was not pre-identified as a classification risk. Added explicit bullet to plan step 5 requiring the audit to inspect and classify the `instanceof LLMProviderError` pattern in `core-loop-orchestrator.ts` and state whether a future adapter swap would require a core-loop edit.
  - **H2** (fifth review) — `EpisodicMemory` concrete class injected as persistence seam without interface-vs-concrete classification. Added to plan step 4 a requirement to classify whether injecting an in-package concrete class satisfies the DI-plan "interfaces" rule and to state the audit's interpretation.
  - **H3** (fifth review) — `@argentum/agentic_core` → `@argentum/tooling` dependency edge not targeted by a named plan step. Added plan step 7 sub-bullet requiring specific classification of this sibling-package edge and the `planToolExposure` import.
  - **H4** (fifth review) — Validation gate checked report completeness but not classification soundness. Added requirement that every "allowed" classification for a concrete import must have an explicit rule citation, and added a spot-check of the three highest-risk imports.
  - **H5** (fifth review) — The DI plan is underspecified relative to the audit's depth. Added note to plan step 9 that the methodology section must list every leaf spec that contributed to the interpretation.
- Refinements applied: 2026-05-26 — Resolved C1 and all HIGH/MEDIUM findings across five review rounds by re-scoping the audit to actual DI seams with five evidence rows (provider access, tool execution, content persistence, memory persistence, event emission), adding owning leaf specs for every seam, pre-identifying high-risk concrete imports for classification, requiring explicit import justifications with rule citations, and validating through reproducible manifest- and source-derived inventories with classification-soundness checks.
