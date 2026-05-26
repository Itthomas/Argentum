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

- Slice name: Logging plan compliance audit
- Target package or boundary: `docs/` — cross-package audit of logging behavior against the logging plan spec
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md)
  - [docs/spec/50-implementation/logging-plan.md](../../spec/50-implementation/logging-plan.md) — logs must be append-only and structured; turn, session, ingress, request, and tool-call identifiers must be preserved for correlation; large payloads must be stored by artifact reference rather than repeated inline; logs must be human-inspectable without a specialized observability backend; prefer JSON-lines; emit event records from the canonical `StreamEvent` pipeline
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — telemetry tests for event ordering and minimum payload presence
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md) — every state transition emits a `turn.*` event
- Acceptance criteria:
  - An audit report under `docs/implementation/audits/0021-logging-plan-compliance.md` documents whether each logging-plan rule is satisfied by the current implementation.
  - The audit checks: (a) all log/telemetry writes are append-only, (b) turn, session, ingress, request, and tool-call correlation IDs are present in logged events, (c) large payloads are stored by `ContentRef` rather than inline in JSONL, (d) logs are human-inspectable JSONL, (e) events flow through the canonical `StreamEvent` pipeline, (f) for every `MvpStreamEventKind` observed in emitted events, the payload contains all fields listed in `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS` in `packages/contracts/src/stream-event.ts`.
  - Any gaps found are documented with severity (CRITICAL/HIGH/MEDIUM/LOW) and a recommended remediation slice reference.
  - If no gaps are found, the audit report confirms full compliance.
  - The audit does not modify any runtime code; it is a read-only inspection.
- Inputs crossing the boundary:
  - Current `@argentum/telemetry` implementation (`telemetry-writer.ts`)
  - Current `@argentum/gateway` event emission paths
  - Current `@argentum/agentic_core` event emission paths
  - Current `@argentum/contracts` `StreamEvent` shape
  - Sample telemetry output from E2E test runs
- Outputs crossing the boundary:
  - Audit report at `docs/implementation/audits/0021-logging-plan-compliance.md`

## Plan

- First contracts or interfaces to create:
  - None. This is a read-only audit.
- Minimal implementation steps:
  1. Inspect `packages/telemetry/src/telemetry-writer.ts` for append-only behavior and JSONL format.
  2. Inspect `packages/gateway/src/` event emission paths for correlation ID presence.
  3. Inspect `packages/agentic_core/src/` event emission paths for correlation ID presence.
  4. Check whether large payloads (tool results, inference results) use `ContentRef` rather than inline duplication.
  5. Inspect a sample telemetry output file from a recent E2E test run for human readability.
  6. Write the audit report following the `docs/implementation/audits/0000-template.md` conventions.
  7. Classify any gaps by severity and recommend remediation slices if needed.
- Required tests:
  - Not applicable. This is a documentation audit slice with no code changes.
- Narrow validation step:
  - Manual inspection of the audit report for completeness against the logging plan spec.
  - Cross-reference each logging-plan rule with a finding in the report.

## Execution Strategy

- Autopilot suitability: not safe. The audit requires cross-package code inspection, judgment about human readability, and gap-severity classification that benefits from human review.
- Parallel subagent opportunities:
  - Read-only subagent to inspect `@argentum/telemetry` for append-only and JSONL compliance.
  - Read-only subagent to inspect `@argentum/gateway` and `@argentum/agentic_core` for correlation ID presence in emitted events.
  - Read-only subagent to check `ContentRef` usage for large payloads across the codebase.
- Out of scope:
  - Modifying any runtime code
  - Creating new test suites
  - Remediation of any gaps found (remediation slices should be planned separately)
- Deferred decisions that must remain deferred:
  - None specific to this audit

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1** — Missing audit criterion for minimum payload field presence per `MvpStreamEventKind`. Added explicit check: "(f) for every `MvpStreamEventKind` observed in emitted events, the payload contains all fields listed in `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS` in `packages/contracts/src/stream-event.ts`."
- Implementation and validation summary:
  - 2026-05-26 — Audit report written to `docs/implementation/audits/0021-logging-plan-compliance.md` and verified against the slice acceptance criteria. The audit returned `ready-with-risks` with 2 MEDIUM and 4 LOW findings, no CRITICAL or HIGH findings.
- Refinements applied: 2026-05-26 — H1 resolved. Criterion (f) added to acceptance criteria.
