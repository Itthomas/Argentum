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

- Slice name: Operator documentation for runtime config and workspace layout
- Target package or boundary: `docs/` — operator-facing documentation
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/implementation/implementation-plan.md](../../implementation/implementation-plan.md) Phase 7 — operator documentation for runtime config and workspace layout. **Note:** this is a planning artifact under `docs/implementation/`, not part of the normative spec tree under `docs/spec/`.
  - [docs/spec/20-contracts/runtime-config.md](../../spec/20-contracts/runtime-config.md) — canonical `RuntimeConfigDTO` field definitions, types, and required-vs-optional status for every config section
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md) — `RuntimePolicyDTO` surface derived from config, including `enabled_tools` and `enabled_secret_handles`
  - [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md) — logical areas: `bedrock/`, `working/`, `artifacts/`, `logs/`; bedrock and working areas must be separated; paths through `ExecutionGrantDTO` must resolve to allowed workspace areas
  - [docs/spec/40-modules/environment/immutable-bedrock.md](../../spec/40-modules/environment/immutable-bedrock.md) — bedrock files are read-only during MVP runtime
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — authoritative semantics for `trusted_local_mode` and grant auto-approval/denial rules
  - [docs/spec/40-modules/gateway/queueing-and-locking.md](../../spec/40-modules/gateway/queueing-and-locking.md) — queue limit, FIFO policy, and reject-newest overflow semantics
  - [docs/spec/00-overview/mvp-scope.md](../../spec/00-overview/mvp-scope.md) — frozen MVP decisions including provider-neutral core loop, inline compaction, sequential multi-tool execution, and FIFO queuing with reject-newest overflow
  - `config/runtime.example.json` — the canonical example configuration file
- Acceptance criteria:
  - A new document `docs/operator-guide.md` (or equivalent operator-facing path) describes the runtime config schema, workspace layout, and operational constraints in plain language suitable for an operator who is not a contributor to the Argentum codebase.
  - The guide covers: (a) every field in `config/runtime.json` with its purpose, type, valid values, and whether it is required or optional per the `runtime-config.md` spec tables (specifically: all top-level sections except `features` are required; within `provider`, `temperature` and `max_output_tokens` are optional; within `features`, `enable_native_tool_calling` is optional), (b) the four logical workspace areas (`bedrock/`, `working/`, `artifacts/`, `logs/`) with their purpose, immutability rules, the requirement that all four workspace roots must be distinct and non-nested (no root may equal or be a subdirectory of another), and the `workspace_roots_not_distinct` startup error that results from overlapping or identical roots, (c) the session lifecycle (FIFO queuing, 8-item limit and `reject_newest` overflow policy both frozen in MVP), (d) how to configure the DeepSeek provider adapter, (e) how to enable/disable tools via `tool_policy.enabled_tools`, how `tool_policy.enabled_secret_handles` declares which handles the runtime expects, and how `trusted_local_mode` controls automatic tool-approval behavior — when `true`, grants may be auto-approved per `grant-resolution.md` rules; when `false`, all tool grants are unconditionally denied, (f) startup secret handle requirements including the two-layer interaction between `tool_policy.enabled_secret_handles` (handles the runtime expects) and the `ARGENTUM_SECRET_HANDLES` environment variable (handles available on the host, formatted as a newline-separated, comma-separated, or semicolon-separated list); note that `ARGENTUM_SECRET_HANDLES` is the MVP-specific mechanism and may evolve in future releases, (g) governor defaults and how to adjust them, (h) the `features.enable_native_tool_calling` flag and its effect, (i) the `telemetry` section (`format`, `persist_events`) and where telemetry output is written — output files are written to the `logs_root` workspace area with one JSONL file per session named `<session_id>.jsonl`, (j) common startup error conditions with their error codes, causes, and operator-facing remediation steps: `config_not_found`, `config_unreadable`, `config_invalid_json`, `config_invalid_shape` (contract validation failures), `config_invalid_runtime_rules` (frozen-MVP-rule violations), `workspace_roots_not_distinct` (overlapping or identical roots), and `secret_handles_unavailable` (expected handle missing from host).
  - Both `gateway.max_queued_ingress_per_session` (frozen at 8) and `gateway.queue_overflow_policy` (frozen at `"reject_newest"`) are documented as MVP-frozen.
  - The guide references `config/runtime.example.json` as the canonical starting point.
  - The guide does not duplicate spec content; it links to spec files for normative rules and focuses on operational how-to.
  - The guide is accurate against the validated implementation state at the time of writing (currently slices 0001–0049 as of 2026-05-26); the implementer must verify and update this range at execution time.
- Inputs crossing the boundary:
  - `config/runtime.example.json` — the canonical config example
  - `config/runtime.json` — the active runtime config
  - `packages/contracts/src/runtime-config.ts` — canonical field definition Sets (`ROOT_SECTIONS`, `WORKSPACE_FIELDS`, `PROVIDER_FIELDS`, `GOVERNOR_FIELDS`, `GATEWAY_FIELDS`, `TOOL_POLICY_FIELDS`, `TELEMETRY_FIELDS`, `FEATURES_FIELDS`) and `RuntimeConfigDTO` type
  - `packages/environment/src/runtime-startup-config.ts` — config loading, startup behavior, `getAvailableSecretHandles()`
  - Existing spec files for cross-reference
- Outputs crossing the boundary:
  - `docs/operator-guide.md` — operator-facing documentation

## Plan

- First contracts or interfaces to create:
  - None. This is a documentation slice.
- Minimal implementation steps:
  1. Read `docs/spec/20-contracts/runtime-config.md` and `docs/spec/20-contracts/runtime-policy.md` as the primary authoritative sources for field definitions, types, and required/optional status; then cross-reference `packages/contracts/src/runtime-config.ts` (which defines the per-section field-name Sets: `ROOT_SECTIONS`, `WORKSPACE_FIELDS`, `PROVIDER_FIELDS`, `GOVERNOR_FIELDS`, `GATEWAY_FIELDS`, `TOOL_POLICY_FIELDS`, `TELEMETRY_FIELDS`, `FEATURES_FIELDS`) and `packages/contracts/src/runtime-policy.ts` for implementation alignment. Also read `packages/environment/src/runtime-startup-config.ts` for startup-specific behaviors: the `getAvailableSecretHandles()` delimiter (`split(/[\n,;]+/)`), workspace root distinctness enforcement (`validateWorkspaceRoots`), and startup error codes.
  2. Read `docs/spec/40-modules/environment/workspace-model.md` to document the four logical workspace areas.
  3. Read `docs/spec/00-overview/mvp-scope.md` for frozen MVP decisions to document operational constraints.
  4. Write `docs/operator-guide.md` with sections: Runtime Config Reference (distinguishing required vs. optional fields), Workspace Layout (including root distinctness constraint and relative-path resolution from the runtime working directory), Workspace Path Resolution, Session Lifecycle, Provider Configuration, Tool Management (`trusted_local_mode`, `enabled_tools`, `enabled_secret_handles`, `max_tool_runtime_ms` — citing `grant-resolution.md`), Secret Handles (including the two-layer `enabled_secret_handles` vs `ARGENTUM_SECRET_HANDLES` interaction and the delimiter behavior), Governor Tuning, Feature Flags (`features.enable_native_tool_calling`), Telemetry Configuration, Startup Errors and Troubleshooting.
  5. Ensure every config field in `runtime.example.json` is documented.
  6. Validate the guide against the current implementation by cross-referencing `packages/contracts/src/runtime-config.ts` and `packages/environment/src/runtime-startup-config.ts`.
  7. Mark both `gateway.max_queued_ingress_per_session` (frozen at 8) and `gateway.queue_overflow_policy` (frozen at `"reject_newest"`) as MVP-frozen.
- Required tests:
  - Not applicable. This is a documentation slice with no code changes.
- Narrow validation step:
  - Confirm that every field in the `docs/spec/20-contracts/runtime-config.md` spec tables is documented in the guide.
  - Confirm that every field in `config/runtime.example.json` appears in the guide.
  - Confirm that workspace area descriptions match `workspace-model.md`.
  - Confirm that operational constraints match frozen MVP decisions and `queueing-and-locking.md`.
  - Confirm that startup error codes documented in the guide match those emitted by `packages/environment/src/runtime-startup-config.ts`. Specifically: `max_queued_ingress_per_session !== 8` → `config_invalid_runtime_rules`; `queue_overflow_policy !== 'reject_newest'` → `config_invalid_shape` (contract literal-type validation).
  - Confirm the `trusted_local_mode` behavioral description (auto-allow when `true`, all-denied when `false`) matches `packages/environment/src/grant-resolver.ts` steps 7–8 of `resolveGrant()`.
  - Confirm that both `runtime.example.json` and `runtime.json` were cross-referenced to guard against drift between example and active config.

## Execution Strategy

- Autopilot suitability: conditional. The guide requires accurate cross-referencing of spec files against the current implementation, which is mostly mechanical but benefits from human review for operator-facing clarity.
- Parallel subagent opportunities:
  - Read-only subagent to extract every field from `config/runtime.example.json` and `runtime-startup-config.ts` for the config reference section.
  - Read-only subagent to extract workspace layout rules from `workspace-model.md` and `immutable-bedrock.md`.
  - Read-only subagent to extract frozen MVP operational constraints from `mvp-scope.md`.
- Out of scope:
  - Modifying any runtime code
  - Creating deployment guides or hosting instructions
  - Documenting internal package architecture
  - Post-MVP feature documentation
- Deferred decisions that must remain deferred:
  - Exact DeepSeek endpoint and model selection (document the config field, note that the value is operator-selected)
  - Maintenance-mode bedrock write behavior
  - Queue coalescing behavior beyond FIFO

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1** (first review) — Bogus authoritative spec path referenced `docs/spec/50-implementation/implementation-plan.md` which does not exist. Replaced with the actual file at `docs/implementation/implementation-plan.md`. Added note that this is a planning artifact, not part of the normative spec tree.
  - **H1** (second review) — The secret-handle format was misdescribed as "comma-separated or JSON array." Corrected to "newline-separated, comma-separated, or semicolon-separated list" per the actual `getAvailableSecretHandles()` implementation which splits by `/[\n,;]+/`. Added note that `ARGENTUM_SECRET_HANDLES` is MVP-specific and may evolve.
  - **H1** (third review) — Missing authoritative spec files `docs/spec/20-contracts/runtime-config.md` and `docs/spec/20-contracts/runtime-policy.md`. Added to the authoritative spec list and made them the first reading sources in step 1, with implementation code as cross-reference.
  - **H2** (second review) — `trusted_local_mode` was missing from the guide coverage. Added to AC (e) as controlling automatic tool-approval behavior (`true` = auto-approve per policy, `false` = all grants denied) and to the guide-section list in step 4.
  - **H2** (third review) — Missing `grant-resolution.md` spec as authority for `trusted_local_mode` semantics. Added to the authoritative spec list and the step 4 reading list for the Tool Management section.
  - **H3** (second review) — `gateway.queue_overflow_policy` frozen status was missing. Added to AC (c) and to step 7 alongside the queue-cap freeze.
  - **H3** (third review) — Missing documentation of workspace root distinctness constraint. Added to AC (b): all four roots must be distinct and non-nested, with the `workspace_roots_not_distinct` startup error.
  - **H4** (third review) — Missing documentation of startup error codes. Added AC (j) covering all seven startup error codes with causes and remediation steps, plus a "Startup Errors and Troubleshooting" guide section to step 4.
  - **H5** (third review) — Phantom reference to non-existent `RUNTIME_CONFIG_FIELDS` Set. Replaced Inputs and validation references with the actual per-section field-name Sets (`ROOT_SECTIONS` through `FEATURES_FIELDS`) and made the canonical spec tables the primary validation checklist.
  - **M1** (first review) — Secret handle documentation did not include `ARGENTUM_SECRET_HANDLES` environment variable format. Expanded AC (f) and added dedicated "Secret Handles" section covering the environment variable format.
  - **M1** (second review) — `ARGENTUM_SECRET_HANDLES` has no canonical spec authority. Documented as MVP-specific with a note that the mechanism may evolve.
  - **M2** (first review) — `gateway.max_queued_ingress_per_session` not marked as frozen. Documented as frozen at 8 in MVP in AC (c) and implementation step 7.
  - **M3** (first review) — Missing topics for `features.enable_native_tool_calling` and telemetry section. Added AC (h) and (i), plus "Feature Flags" and "Telemetry Configuration" guide sections.
  - **M3** (second review) — Stale slice-range claim `0001-0045`. Replaced with "validated implementation state at the time of writing (currently slices 0001–0049 as of 2026-05-26)" and instruct the implementer to update at execution time.
  - **M4** (second review) — Implementation step 1 only referenced the environment config loader. Added `packages/contracts/src/runtime-config.ts` and `packages/contracts/src/runtime-policy.ts` as the primary canonical field-definition sources to read first.
  - **M5** (second review) — Telemetry output path relationship was indirect. Clarified in AC (i) that output files go to the `logs_root` workspace area as `<session_id>.jsonl`, not a direct config field.
  - **M1** (third review) — Error-code mapping asymmetric between `config_invalid_runtime_rules` (queue cap) and `config_invalid_shape` (overflow policy). Added per-rule error-code mapping to validation step.
  - **M2** (third review) — No validation step for `trusted_local_mode` grant-denial behavior. Added cross-reference to `grant-resolver.ts` steps 7–8 in the validation step.
  - **M3** (third review) — `max_tool_runtime_ms` omitted from the Tool Management guide section enumeration in step 4. Added alongside the other `tool_policy` fields.
  - **H1** (fourth review) — `trusted_local_mode: false` denial-code claim was factually wrong. Guide stated all denials carry `policy_denied`, but grant-resolver.ts evaluates in order: `tool_disabled` (step 1) → `secret_unavailable` (step 2) → `policy_denied` (step 8). Fixed the `false` bullet and behavioral description to accurately describe the cascading denial-code order.
  - **H2** (fourth review) — Governor budget relationship incorrectly described `max_inference_steps` and `max_repair_attempts` as "both consuming from the same step budget." They are independent counters (`step_count` for inference cycles, `repair_attempts_used` for repair loops). Fixed the relationship paragraph and the `max_repair_attempts` guidance row to state they are independent limits.
  - **H3** (fourth review) — `features.enable_native_tool_calling` is parsed and validated by contracts but not wired to the DeepSeek adapter at runtime. No runtime code reads this flag to configure adapter behavior. Added an MVP note warning operators that setting this flag has no operational effect in the current release.
  - **M1** (fourth review) — `provider.temperature` and `max_output_tokens` defaults misdescribed as "provider default." The adapter uses hardcoded defaults (`temperature: 0`, `maxOutputTokens: 4096`). Fixed to say "Omit to use the adapter default."
- Refinements applied: 2026-05-26 (first pass) — All HIGH and MEDIUM findings resolved. Bogus spec path fixed, secret handle env var documented, gateway queue limit frozen, feature flags and telemetry sections added.
- Refinements applied: 2026-05-26 (second pass) — Resolved H1-H3, M1, M3-M5 from adversarial review. Corrected secret-handle format to match actual `split(/[\n,;]+/)` behavior, added `trusted_local_mode` coverage, documented `queue_overflow_policy` as MVP-frozen, noted `ARGENTUM_SECRET_HANDLES` as MVP-specific, fixed stale slice-range claim, added contracts package as primary config source, and clarified telemetry output path location.
- Refinements applied: 2026-05-26 (third pass) — Resolved H1-H5 from adversarial review. Added three missing authoritative specs (`runtime-config.md`, `runtime-policy.md`, `grant-resolution.md`), distinguished required-vs-optional fields per spec tables, documented workspace root distinctness constraint, documented all seven startup error codes, and replaced the phantom `RUNTIME_CONFIG_FIELDS` Set with the actual per-section field-name Sets plus spec-table-based validation.
- Refinements applied: 2026-05-26 (fourth pass) — Resolved H1-H3 and M1 from adversarial review of the final guide text. Fixed `trusted_local_mode: false` to describe cascading denial codes (`tool_disabled` → `secret_unavailable` → `policy_denied`) per grant-resolver.ts steps 1-2-8. Fixed governor relationship to state independent counters (`step_count` vs `repair_attempts_used`) instead of a shared budget. Added MVP note that `enable_native_tool_calling` is not yet wired to the adapter. Fixed `temperature`/`max_output_tokens` defaults to reference adapter defaults (`0`/`4096`) instead of provider defaults.
