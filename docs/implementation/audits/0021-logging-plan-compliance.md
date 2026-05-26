# Implementation Audit — Logging Plan Compliance

## Metadata

- Audit scope: Cross-package compliance audit of MVP logging behavior against [docs/spec/50-implementation/logging-plan.md](../../spec/50-implementation/logging-plan.md)
- Auditor: argentum-implementer (automated audit, 2026-05-26)
- Audit date: 2026-05-26
- Repo readiness verdict: **ready-with-risks** — Core logging posture is compliant; three MEDIUM gaps (missing ingress-accepted event, incomplete E2E event-kind coverage, no runtime integration test for all MvpStreamEventKind payloads) should be addressed before declaring logging fully hardened.

Note: this audit does not set or replace slice Approval. Slice approval remains owned by the slice review workflow in [docs/implementation/slices/README.md](../slices/README.md).

## Sources Reviewed

- Governing spec files:
  - [docs/spec/50-implementation/logging-plan.md](../../spec/50-implementation/logging-plan.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
  - [docs/spec/30-core-loop/core-loop-state-machine.md](../../spec/30-core-loop/core-loop-state-machine.md)
  - [docs/spec/README.md](../../spec/README.md)
- Implementation files:
  - `packages/telemetry/src/telemetry-writer.ts` — JSONL append-only writer
  - `packages/telemetry/src/index.ts` — package exports
  - `packages/contracts/src/stream-event.ts` — `StreamEvent`, `MvpStreamEventKind`, `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS`, `parseStreamEvent`
  - `packages/contracts/src/content-ref.ts` — `ContentRef` shape and parser
  - `packages/contracts/src/turn-envelope.ts` — `TurnEnvelope` shape
  - `packages/gateway/src/gateway-telemetry.ts` — `assertGatewayTelemetryEvent`, `TurnSequenceCounter`
  - `packages/gateway/src/gateway-facade.ts` — `Gateway` facade (event emission wiring)
  - `packages/gateway/src/ingress-admission.ts` — queue event creation (`queue.queued`, `queue.rejected`)
  - `packages/gateway/src/release-and-dequeue.ts` — dequeue event creation (`queue.dequeued`)
  - `packages/gateway/src/turn-creation.ts` — `turn.started` event creation
  - `packages/agentic_core/src/core-loop-orchestrator.ts` — event emission during core loop
  - `packages/agentic_core/src/turn-state-machine.ts` — `TurnEventEmitter` interface, `executeTransition`
  - `packages/agentic_core/src/compaction-policy.ts` — `ContentRef` externalization for large payloads
  - `packages/agentic_core/src/validation-repair.ts` — validation/repair event emission
  - `packages/llm_provider/src/llm-provider.ts` — `LLMProvider` contract (raw trace ref requirement)
  - `apps/runtime/src/composition-root.ts` — `RuntimeStreamPipeline` (central event mapping and persistence), `startRuntime`
  - `apps/runtime/src/mock-llm-provider.ts` — mock provider for E2E
  - `packages/channel_cli/src/terminal-renderer.ts` — `renderStreamEvent` human-readable output
- Slice cards:
  - [0049-logging-plan-compliance-audit.md](../slices/0049-logging-plan-compliance-audit.md) — this audit's slice card
- Workflow artifacts:
  - All existing audits (0001–0020) under `docs/implementation/audits/`
  - `packages/contracts/tests/stream-event.test.ts` — exhaustive minimum-payload-field contract tests
  - `packages/telemetry/tests/telemetry-writer.test.ts` — JSONL format, ordering, serialization tests
  - `apps/runtime/tests/e2e-happy-path.test.ts` — E2E telemetry persistence test
  - `apps/runtime/tests/repair-exhaustion.e2e.test.ts` — E2E telemetry event-kind checks

## Audit Criteria

This audit checks six criteria derived from the logging plan spec and the slice card acceptance criteria:

| # | Criterion | Source |
|---|-----------|--------|
| (a) | All log/telemetry writes are append-only JSONL | logging-plan.md rules |
| (b) | Every emitted event carries correlation IDs (`session_id`, `turn_id` per scope) | logging-plan.md rules |
| (c) | Large payloads are stored by `ContentRef` rather than repeated inline in JSONL | logging-plan.md rules |
| (d) | Logs are human-inspectable (operator can reconstruct high-level execution path) | logging-plan.md acceptance criteria |
| (e) | Events flow through the canonical `StreamEvent` pipeline | logging-plan.md MVP direction |
| (f) | For every `MvpStreamEventKind` observed, the payload contains all fields listed in `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS` | slice card H1 resolution |

## Criterion-by-Criterion Findings

### (a) Append-Only JSONL — PASS

**Evidence:**

- `TelemetryWriter` (`packages/telemetry/src/telemetry-writer.ts`) writes events via `appendFile(filePath, line, "utf-8")` using Node.js `fs/promises` append mode.
- Output format is one JSON object per line: `JSON.stringify(event) + "\n"`.
- Files are named per session: `<session_id>.jsonl`.
- Concurrent writes are serialized via an internal `#writeChain` promise chain, guaranteeing deterministic line order matching call order.
- When `persistEvents` is `false`, `writeEvent` is a no-op — no files are created or written.
- No in-place edits, truncation, rotation, or log-level filtering is performed.
- The `telemetry-writer.test.ts` suite verifies: single-event write, multi-event ordering, concurrent write ordering, valid JSON per line, and full field serialization.

**Verdict:** Compliant. No gaps.

### (b) Correlation IDs — PASS

**Evidence:**

- `StreamEventBase` defines top-level `session_id`, `sequence`, `kind`, `timestamp`, `visibility`, `payload`.
- `SessionStreamEvent` (scope `"session"`) carries `session_id`; `turn_id` is optional.
- `TurnStreamEvent` (scope `"turn"`) carries both `session_id` and required `turn_id`.
- `GatewayTelemetryCorrelation` enforces `session_id` and optional `turn_id` at the gateway boundary.
- `assertGatewayTelemetryEvent()` validates correlation ID presence and consistency before any gateway-emitted event is returned to the caller.
- Gateway queue events (`queue.queued`, `queue.rejected`, `queue.dequeued`) carry `session_id` both top-level and in payload, plus `ingress_id` in payload.
- `GatewayTurnStartedEventPayload` carries `session_id` and `ingress_id`.
- `RuntimeStreamPipeline.#makeTurnEvent()` always includes `session_id`, `turn_id`, and `scope: "turn"` for all turn-scoped events.
- The `Gateway` facade asserts correlation IDs at every event emission point: `admitIngress` (queue events), `createTurnFromHandoff` (turn.started), `releaseActiveTurnAndDequeue` (dequeue events).

**Verdict:** Compliant. All events carry `session_id`; all turn-scoped events carry `turn_id`. Queue events additionally carry `ingress_id` in payload for ingress correlation.

### (c) Large Payloads via ContentRef — PASS

**Evidence:**

- `CompactionPolicy` (`packages/agentic_core/src/compaction-policy.ts`) defines `DEFAULT_COMPACTION_THRESHOLD_BYTES = 4096` (4 KiB). Results exceeding this threshold are externalized.
- The `compact()` method dispatches to `compactLarge()` for oversized results, which calls `ArtifactExternalizer.store()` to externalize raw content and returns `externalizedRefs: ContentRef[]`.
- The resulting `ContextItem` carries a `content_ref: ContentRef` pointing to working-area storage; the compacted text is written via `TurnContentStore.write(ref, content)`.
- Response messages and ingress text are also stored via `ContentRef` + external write, not inlined in events.
- The `LLMProvider` contract requires: "Raw provider payloads MUST remain adapter-private except by artifact reference (`raw_trace_ref` in the result)."
- `LLMInferenceResult` carries optional `raw_trace_ref: ContentRef` for provider traces.
- The `CompactionResult` emitted in telemetry includes `contentRef` (the `ContentRef` for the compacted context item) and `artifactCount` (count of externalized refs), not the raw content itself.

**Verdict:** Compliant. Large payloads are externalized and referenced by `ContentRef`; JSONL events carry references, not duplicated inline content.

### (d) Human-Inspectable Logs — PASS

**Evidence:**

- JSONL is plain text: one JSON object per line, human-readable with any text editor or `cat`/`jq`.
- `renderStreamEvent()` (`packages/channel_cli/src/terminal-renderer.ts`) provides a pure-function mapping from `StreamEvent` to human-readable plain-text strings.
- Turn lifecycle events render as: "Turn started (building_context).", "State: inferring → validating", "Done.", "Turn aborted: provider_failure".
- LLM events render as: "Thinking...", "Inference complete."
- Tool events render as: "Using read_file...", "read_file completed", "read_file blocked: grant_denied".
- Validation failures render with reason; response events render the `final_outcome` text.
- An operator can `cat <session_id>.jsonl | jq '.'` and trace the full execution path event-by-event.
- Visibility levels (`user`, `system`, `telemetry`) allow filtering for different audiences.

**Verdict:** Compliant. An operator can inspect one turn with ordinary local tooling and reconstruct the high-level execution path.

### (e) StreamEvent Pipeline — PASS

**Evidence:**

- `TelemetryWriter` accepts only `StreamEvent` and writes it to JSONL — the persistence layer is the `StreamEvent` pipeline.
- `RuntimeStreamPipeline` (`apps/runtime/src/composition-root.ts`) wraps `TelemetryWriter` and is the central event mapping layer.
- All orchestrator events flow through `TurnEventEmitter.emit()` → `RuntimeStreamPipeline.#recordMappedTurnEvents()` → `#mapTurnEvents()` → `#appendEvent()` → `telemetryWriter.writeEvent()`.
- Gateway-emitted events (`queue.queued`, `queue.rejected`, `queue.dequeued`) are `StreamEvent` instances validated by `parseStreamEvent` at creation time and persisted via `RuntimeStreamPipeline.recordEvent()`.
- There is no side channel — no separate logging framework, no `console.log`, no unstructured output — all telemetry flows through the `StreamEvent` pipeline.
- `StreamEvent` is the canonical type exported from `@argentum/contracts` and re-exported from `@argentum/telemetry`.

**Verdict:** Compliant. The `StreamEvent` pipeline is the single mechanism for telemetry. No gaps.

### (f) Minimum Payload Fields per MvpStreamEventKind — PASS (contract level), MEDIUM gap (runtime integration coverage)

**Contract-level evidence (PASS):**

- `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS` in `packages/contracts/src/stream-event.ts` defines required payload fields for all 20 `MvpStreamEventKind` variants.
- `parseStreamEvent()` calls `enforceMinimumPayloadFields()` which checks every known kind against the required field list.
- `stream-event.test.ts` has exhaustive coverage: a fixture for every MVP kind, a generated test case for every single missing-required-field across all 20 kinds, and explicit tests for additive extra fields.
- Every `RuntimeStreamPipeline` event emission site was inspected and verified to include all required payload fields for its kind:

| Event Kind | Emission Site | Required Fields | Present? |
|---|---|---|---|
| `turn.started` | `RuntimeStreamPipeline.#mapStateTransition` | `session_id`, `ingress_id`, `state` | ✅ |
| `turn.state_changed` | `RuntimeStreamPipeline.#mapStateTransition` | `from_state`, `to_state` | ✅ |
| `turn.completed` | `RuntimeStreamPipeline.#mapStateTransition` | `final_outcome`, `step_count` | ✅ |
| `turn.aborted` | `RuntimeStreamPipeline.#mapStateTransition` | `reason`, `error_code` | ✅ |
| `validation.failed` | `RuntimeStreamPipeline.#mapTurnEvents` (via `validation.aborted`) | `phase`, `reason`, `repairable` | ✅ |
| `validation.repair_requested` | `RuntimeStreamPipeline.#mapTurnEvents` | `phase`, `attempt_number` | ✅ |
| `llm.started` | `RuntimeStreamPipeline.#mapTurnEvents` | `request_id`, `tool_count` | ✅ |
| `llm.completed` | `RuntimeStreamPipeline.#mapTurnEvents` (via `llm.finished`) | `request_id`, `normalization_status` | ✅ |
| `llm.failed` | `RuntimeStreamPipeline.#mapTurnEvents` | `request_id`, `reason`, `error_code` | ✅ |
| `tool.planned` | `RuntimeStreamPipeline.recordToolPlanned` | `call_id`, `tool_name` | ✅ |
| `tool.started` | `RuntimeStreamPipeline.recordToolStarted` | `call_id`, `tool_name` | ✅ |
| `tool.finished` | `RuntimeStreamPipeline.recordToolFinished` | `call_id`, `tool_name`, `status`, `duration_ms` | ✅ |
| `tool.blocked` | `RuntimeStreamPipeline.recordToolBlocked` | `call_id`, `tool_name`, `reason`, `error_code` | ✅ |
| `memory.compaction_started` | `RuntimeStreamPipeline.#mapTurnEvents` | `call_id`, `compaction_revision` | ✅ |
| `memory.compaction_committed` | `RuntimeStreamPipeline.#mapTurnEvents` | `call_id`, `compaction_revision`, `artifact_count` | ✅ |
| `response.started` | `RuntimeStreamPipeline.#mapTurnEvents` (via `response.emitted`) | `response_kind` | ✅ |
| `response.completed` | `RuntimeStreamPipeline.#mapTurnEvents` | `response_kind`, `final_outcome` | ✅ |
| `queue.queued` | `ingress-admission.ts:createQueuedEvent` | `session_id`, `ingress_id`, `queue_length` | ✅ |
| `queue.dequeued` | `release-and-dequeue.ts:createQueueDequeuedEvent` | `session_id`, `ingress_id`, `queue_length` | ✅ |
| `queue.rejected` | `ingress-admission.ts:createRejectedEvent` | `session_id`, `ingress_id`, `queue_length`, `reason` | ✅ |

**Runtime integration gap (MEDIUM):**

The E2E test suite exercises the `StreamEvent` pipeline end-to-end (event emission → JSONL persistence → read-back) but only covers a subset of event kinds. The happy-path test uses `MockLLMProvider` which returns a `respond` decision — this exercises `turn.*`, `llm.*`, `response.*`, and `validation.*` kinds but **not** `tool.*` or `memory.*` kinds. The repair-exhaustion test adds coverage for `validation.repair_requested` and `validation.failed` but still does not exercise tool-call or memory-compaction paths. Queue events (`queue.*`) are never exercised because tests start with empty queues.

This means 8 of 20 `MvpStreamEventKind` variants (`tool.planned`, `tool.started`, `tool.finished`, `tool.blocked`, `memory.compaction_started`, `memory.compaction_committed`, `queue.queued`, `queue.dequeued`) have **never been observed in an integration test** with actual JSONL output. The contract-level validation in `parseStreamEvent` ensures these shapes are correct, but the runtime wiring could contain a bug where, e.g., `call_id` is emitted as `callId` (wrong field name) and this would not be caught until a tool-call E2E test is added.

## Findings By Severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

- **M-1: No event emitted when ingress is accepted directly (no `ingress.accepted` event).**
  - **What:** When the gateway admits an ingress with `disposition: "accepted"` (active turn slot free, queue empty), no `StreamEvent` is emitted at admission time. The first observable event is `turn.started` which is emitted later when `createTurnFromHandoff` runs.
  - **Impact:** An operator inspecting the log cannot distinguish "ingress was accepted immediately and a turn started" from "ingress was queued, then dequeued, and a turn started" without external knowledge of queue state. The `ingress_id` is present in `turn.started.payload` for correlation, but the ingress lifecycle event itself is missing.
  - **Spec reference:** logging-plan.md: "turn, session, ingress, request, and tool-call identifiers must be preserved for correlation." The identifier is preserved, but the discrete ingress lifecycle is not observable.
  - **Remediation:** Add an `ingress.accepted` (or `gateway.ingress_accepted`) `MvpStreamEventKind` to `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS` with payload fields `session_id`, `ingress_id`. Emit it from `Gateway.admitIngress()` when `disposition === "accepted"`. Recommended slice: a new hardening slice under Phase 7.
  - **Severity:** MEDIUM — does not block production use but reduces operator observability of ingress lifecycle.

- **M-2: No runtime integration test covering all 20 MvpStreamEventKind variants end-to-end through JSONL persistence.**
  - **What:** The E2E test suite only exercises 12 of 20 `MvpStreamEventKind` variants. The 8 unexercised kinds are: `tool.planned`, `tool.started`, `tool.finished`, `tool.blocked`, `memory.compaction_started`, `memory.compaction_committed`, `queue.queued`, `queue.dequeued`.
  - **Impact:** A field-name mismatch or missing field bug in the runtime event emission code for these kinds would not be caught until a tool-call or queue-congestion scenario is manually tested or hits production.
  - **Spec reference:** test-strategy.md: "Telemetry tests for event ordering and minimum payload presence." The contract tests cover payload presence for `parseStreamEvent`; the runtime does not have an equivalent integration test for actual emission.
  - **Remediation:** Add an E2E or integration test that uses a mock LLM provider returning `tool_calls` decisions and exercises the full tool-execution + compaction path, then validates that all emitted `tool.*` and `memory.*` events carry the required minimum payload fields. Similarly, add a queue-congestion test that verifies `queue.queued` and `queue.dequeued` event payloads. Recommended slice: a new hardening slice under Phase 7.
  - **Severity:** MEDIUM — contract validation provides defense-in-depth but runtime path coverage is incomplete.

### LOW

- **L-1: Session-scoped sequence numbers are always 0.**
  - **What:** Queue events (`queue.queued`, `queue.rejected`, `queue.dequeued`) emitted by the gateway always carry `sequence: 0`. `RuntimeStreamPipeline` tracks session-level sequences but only sets the last value, never increments it. There is no session-scoped sequence counter.
  - **Impact:** If a session experiences multiple queue events, they all have `sequence: 0`. The JSONL line order still provides canonical ordering, but the `sequence` field cannot be used to reconstruct event order for session-scoped events.
  - **Remediation:** Add a session-level sequence counter to `RuntimeStreamPipeline` (or the gateway) that increments for each session-scoped event. Recommended slice: could be folded into the M-1 remediation or handled separately.
  - **Severity:** LOW — JSONL line order is the primary ordering mechanism; sequence numbers are a secondary consistency check.

- **L-2: `validation.passed` event kind is emitted by orchestrator but dropped by RuntimeStreamPipeline.**
  - **What:** The orchestrator emits `validation.passed` after successful `parseActionDecision`. `RuntimeStreamPipeline.#mapTurnEvents` has no case for `validation.passed`, so it falls through to `default: return []` and is never persisted.
  - **Impact:** An operator cannot confirm from the log that validation passed — they can only infer it from the absence of `validation.failed` or `validation.repair_requested`. However, `validation.passed` is not a defined `MvpStreamEventKind` in `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS`, so this behavior is consistent with the contract. The gap is an observability gap, not a contract violation.
  - **Remediation:** Either add `validation.passed` as a new `MvpStreamEventKind` with appropriate payload fields, or remove the emission from the orchestrator to eliminate dead code. Recommended slice: can be addressed in any hardening pass.
  - **Severity:** LOW — operator can infer validation success from absence of failure events.

- **L-3: No write-time StreamEvent shape validation in TelemetryWriter.**
  - **What:** `TelemetryWriter.#doWrite()` serializes the event with `JSON.stringify(event)` without passing it through `parseStreamEvent` first. A bug that produces a malformed `StreamEvent` object (wrong field types, missing fields) would be silently written to the JSONL log.
  - **Impact:** Malformed log entries would only be detected at read time when passed through `parseStreamEvent`. The TelemetryWriter's own JSDoc acknowledges this: "When reading events back from a JSONL log, consumers should pass each parsed line through parseStreamEvent."
  - **Remediation:** Optionally add an optional `validateBeforeWrite` config flag to `TelemetryWriterConfig` that calls `parseStreamEvent` before appending. This would add CPU overhead per event but would catch bugs earlier. Recommended slice: post-MVP hardening.
  - **Severity:** LOW — documented design choice; read-time validation provides a safety net.

- **L-4: `GatewayFinalizingEventAppendSurface` is a no-op in MVP.**
  - **What:** `Gateway.releaseActiveTurnAndDequeue()` creates a `finalizingAppendSurface` whose `append()` method is a no-op (`// MVP: no-op durable-event-log append.`).
  - **Impact:** The dual-write durable-event-log channel is not implemented. However, finalizing events (`turn.completed`, `turn.aborted`) ARE persisted through the primary `StreamEvent` pipeline via `RuntimeStreamPipeline`, so no events are lost.
  - **Remediation:** Implement the durable-event-log append surface when post-MVP durability requirements are defined. No immediate action needed.
  - **Severity:** LOW — explicitly deferred MVP scope; primary telemetry path covers the same events.

## Drift By Category

### Spec Drift
None. The implementation faithfully follows the logging plan spec. The logging plan is concise and all its rules are satisfied.

### Boundary Drift
None. `StreamEvent` types are defined in `@argentum/contracts` and consumed by `@argentum/telemetry`, `@argentum/gateway`, `@argentum/agentic_core`, and `apps/runtime` through explicit imports. No boundary violation observed.

### Validation or Test Drift
- **M-2** (MEDIUM): Contract-level validation for minimum payload fields is exhaustive (`stream-event.test.ts` tests every field of every kind), but runtime integration coverage is incomplete for 8 of 20 event kinds. This is a test coverage gap, not a spec drift.
- **L-3** (LOW): Write-time validation is intentionally omitted; read-time validation is the documented path.

### Planning-Artifact Drift
None. The slice card (0049-logging-plan-compliance-audit.md) accurately describes the audit scope and criteria.

### Deferred-Decision Leakage
None. The no-op `finalizing_append_surface` (L-4) is consistent with MVP scope — it is not a leaked deferred decision.

## Missing Tests Or Weak Validation

1. **No E2E test with `tool_calls` decision path** — This would exercise `tool.planned`, `tool.started`, `tool.finished`, `tool.blocked`, `memory.compaction_started`, `memory.compaction_committed` event kinds through the full JSONL persistence pipeline. See M-2.

2. **No E2E test with queue congestion** — This would exercise `queue.queued`, `queue.dequeued`, `queue.rejected` event kinds. See M-2.

3. **No test verifying `TelemetryWriter` behavior with non-`persistEvents`** — The `persistEvents: false` path is tested only implicitly (the test for flush spy doesn't verify no files were created). This is a minor edge case not required by the logging plan.

4. **No test for `renderStreamEvent` output coverage across all event kinds** — The `terminal-renderer.ts` function handles all `MvpStreamEventKind` values but there are no dedicated tests verifying rendering output for each kind.

## Stale Or Inconsistent Planning Artifacts

None identified. The slice card and logging plan spec are consistent with each other and with the implementation.

## Recommended Corrective Actions

1. **[Slice: ingress-accepted-event]** Add `ingress.accepted` as a new `MvpStreamEventKind` with payload fields `session_id`, `ingress_id`. Emit from `Gateway.admitIngress()` when `disposition === "accepted"`. Add contract test fixture and update `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS`. (Addresses M-1)

2. **[Slice: tool-call-e2e-telemetry]** Create an E2E test that uses a mock LLM provider returning `tool_calls` decisions. Verify that all `tool.*` and `memory.*` event kinds are emitted with correct minimum payload fields and persisted to JSONL. (Addresses M-2, tool/memory half)

3. **[Slice: queue-congestion-e2e-telemetry]** Create an E2E test that fills the ingress queue to capacity, verifying `queue.queued` and `queue.rejected` events. Then drain the queue and verify `queue.dequeued` events. Validate minimum payload fields. (Addresses M-2, queue half)

4. **[Slice: session-sequence-counter]** Add a session-scoped sequence counter (similar to the existing turn-scoped counter in `RuntimeStreamPipeline`) that increments for each session-scoped event. Update gateway event allocators to use it. (Addresses L-1)

5. **[Slice: validation-passed-observability]** Either add `validation.passed` to `MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS` and persist it, or remove the dead emission from the orchestrator. (Addresses L-2)

## Next-Slice Readiness

- **Verdict:** The logging foundation is solid. The repo can proceed with planned implementation slices without blocking on logging concerns.
- **Blocking issues:** None. All findings are non-blocking for core-loop and module implementation work.
- **Safe next actions:**
  - Continue planned implementation slices (tooling, LLM provider, channel CLI).
  - Schedule the three recommended remediation slices (ingress-accepted-event, tool-call-e2e-telemetry, queue-congestion-e2e-telemetry) in Phase 7 (Hardening) before declaring logging fully hardened.
  - The session-sequence-counter and validation-passed-observability slices are low priority and can be deferred to post-MVP.
