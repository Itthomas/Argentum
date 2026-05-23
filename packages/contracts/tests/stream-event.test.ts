import { describe, expect, it } from "vitest";

import {
  MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS,
  StreamEventValidationError,
  parseStreamEvent,
} from "../src/index.js";

type MvpKind = keyof typeof MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS;

type EventFixture = {
  scope: "session" | "turn";
  visibility: "user" | "system" | "telemetry";
  payload: Record<string, unknown>;
};

const MVP_EVENT_FIXTURES: { [K in MvpKind]: EventFixture } = {
  "turn.started": {
    scope: "turn",
    visibility: "system",
    payload: {
      session_id: "session-123",
      ingress_id: "ingress-456",
      state: "running",
    },
  },
  "turn.state_changed": {
    scope: "turn",
    visibility: "system",
    payload: {
      from_state: "planning",
      to_state: "executing",
    },
  },
  "turn.completed": {
    scope: "turn",
    visibility: "system",
    payload: {
      final_outcome: "completed",
      step_count: 3,
    },
  },
  "turn.aborted": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      reason: "budget_exhausted",
      error_code: "TURN_BUDGET_EXHAUSTED",
    },
  },
  "validation.failed": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      phase: "decision_validation",
      reason: "schema_mismatch",
      repairable: true,
    },
  },
  "validation.repair_requested": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      phase: "decision_validation",
      attempt_number: 1,
    },
  },
  "llm.started": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      request_id: "req-123",
      tool_count: 2,
    },
  },
  "llm.completed": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      request_id: "req-123",
      normalization_status: "normalized",
    },
  },
  "llm.failed": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      request_id: "req-123",
      reason: "timeout",
      error_code: "LLM_TIMEOUT",
    },
  },
  "tool.planned": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      call_id: "call-123",
      tool_name: "functions.read_file",
    },
  },
  "tool.started": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      call_id: "call-123",
      tool_name: "functions.read_file",
    },
  },
  "tool.finished": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      call_id: "call-123",
      tool_name: "functions.read_file",
      status: "completed",
      duration_ms: 125,
    },
  },
  "tool.blocked": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      call_id: "call-123",
      tool_name: "functions.read_file",
      reason: "grant_denied",
      error_code: "TOOL_BLOCKED",
    },
  },
  "memory.compaction_started": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      call_id: "call-123",
      compaction_revision: 2,
    },
  },
  "memory.compaction_committed": {
    scope: "turn",
    visibility: "telemetry",
    payload: {
      call_id: "call-123",
      compaction_revision: 2,
      artifact_count: 1,
    },
  },
  "response.started": {
    scope: "turn",
    visibility: "user",
    payload: {
      response_kind: "final",
    },
  },
  "response.completed": {
    scope: "turn",
    visibility: "user",
    payload: {
      response_kind: "final",
      final_outcome: "completed",
    },
  },
  "queue.queued": {
    scope: "session",
    visibility: "telemetry",
    payload: {
      session_id: "session-123",
      ingress_id: "ingress-456",
      queue_length: 2,
    },
  },
  "queue.dequeued": {
    scope: "session",
    visibility: "telemetry",
    payload: {
      session_id: "session-123",
      ingress_id: "ingress-456",
      queue_length: 1,
    },
  },
  "queue.rejected": {
    scope: "session",
    visibility: "telemetry",
    payload: {
      session_id: "session-123",
      ingress_id: "ingress-456",
      queue_length: 8,
      reason: "reject_newest",
    },
  },
};

const MVP_EVENT_KINDS = Object.keys(MVP_EVENT_FIXTURES) as MvpKind[];

const MISSING_REQUIRED_FIELD_CASES = (
  Object.entries(MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS) as Array<[MvpKind, readonly string[]]>
).flatMap(([kind, fields]) => fields.map((field) => ({ kind, field })));

describe("parseStreamEvent", () => {
  it("accepts a session-scoped queue event without turn_id", () => {
    const event = makeEvent("queue.queued");
    const parsed = parseStreamEvent(event);

    expect(parsed).toEqual(event);
    expect(parsed.scope).toBe("session");
    expect(parsed).not.toHaveProperty("turn_id");
  });

  it("accepts a turn-scoped MVP event and preserves additive payload fields", () => {
    const event = makeEvent("turn.started");
    event.payload.extra_detail = { stage: "bootstrap" };

    const parsed = parseStreamEvent(event);

    expect(parsed).toEqual(event);
    expect(parsed.payload).toHaveProperty("extra_detail");
  });

  it("accepts open non-MVP kinds without forcing a closed kind enum", () => {
    const event = makeEvent("queue.queued");
    event.kind = "custom.notice";
    event.payload = { anything: true };

    const parsed = parseStreamEvent(event);

    expect(parsed.kind).toBe("custom.notice");
    expect(parsed.payload).toEqual({ anything: true });
  });

  it("does not forbid turn_id on session-scoped events", () => {
    const event = makeEvent("queue.queued");
    event.turn_id = "turn-optional";

    const parsed = parseStreamEvent(event);

    expect(parsed.turn_id).toBe("turn-optional");
  });

  it("requires turn_id when scope is turn", () => {
    const event = makeEvent("turn.started") as Record<string, unknown>;

    delete event.turn_id;

    expectIssues(event, [{ path: "turn_id", code: "missing_required" }]);
  });

  it("rejects queue events with turn scope", () => {
    const event = makeEvent("queue.queued");
    event.scope = "turn";
    event.turn_id = "turn-123";

    expectIssues(event, [{ path: "scope", code: "invalid_scope" }]);
  });

  it("rejects required turn-scoped families when they are marked as session events", () => {
    const event = makeEvent("turn.started");
    event.scope = "session";
    delete event.turn_id;

    expectIssues(event, [{ path: "scope", code: "invalid_scope" }]);
  });

  it("rejects unknown top-level fields", () => {
    const event = makeEvent("queue.queued") as Record<string, unknown>;
    event.provider_trace = { raw: true };

    expectIssues(event, [{ path: "provider_trace", code: "unknown_key" }]);
  });

  it("rejects wrong top-level primitive types and non-object payloads", () => {
    const event = makeEvent("queue.queued") as Record<string, unknown>;
    event.event_id = 123;
    event.payload = ["not", "an", "object"];

    expectIssues(event, [
      { path: "event_id", code: "invalid_type" },
      { path: "payload", code: "invalid_type" },
    ]);
  });

  it("rejects non-plain payload objects", () => {
    class PayloadBox {
      constructor(readonly call_id: string) {}
    }

    const event = makeEvent("tool.finished") as Record<string, unknown>;
    event.payload = new PayloadBox("call-123");

    expectIssues(event, [{ path: "payload", code: "invalid_type" }]);
  });

  it("rejects invalid enum values", () => {
    const event = makeEvent("queue.queued");
    event.scope = "global" as never;
    event.visibility = "private" as never;

    expectIssues(event, [
      { path: "scope", code: "invalid_literal" },
      { path: "visibility", code: "invalid_literal" },
    ]);
  });

  it("rejects non-integer sequence values", () => {
    const event = makeEvent("queue.queued");
    event.sequence = 1.5;

    expectIssues(event, [{ path: "sequence", code: "invalid_integer" }]);
  });

  it("rejects malformed or non-UTC timestamps", () => {
    const malformed = makeEvent("queue.queued");
    malformed.timestamp = "not-a-timestamp";

    expectIssues(malformed, [{ path: "timestamp", code: "invalid_format" }]);

    const nonUtc = makeEvent("queue.queued");
    nonUtc.timestamp = "2026-05-22T10:30:00+02:00";

    expectIssues(nonUtc, [{ path: "timestamp", code: "invalid_format" }]);

    const impossibleDate = makeEvent("queue.queued");
    impossibleDate.timestamp = "2026-02-30T10:30:00Z";

    expectIssues(impossibleDate, [{ path: "timestamp", code: "invalid_format" }]);
  });

  it("enforces documented minimum payload fields for MVP kinds while allowing extras", () => {
    const missingField = makeEvent("turn.started");
    delete missingField.payload.ingress_id;

    expectIssues(missingField, [{ path: "payload.ingress_id", code: "missing_required" }]);

    const withExtras = makeEvent("tool.finished");
    withExtras.payload.extra = "ok";

    const parsed = parseStreamEvent(withExtras);

    expect(parsed.payload).toMatchObject({
      call_id: "call-123",
      tool_name: "functions.read_file",
      status: "completed",
      duration_ms: 125,
      extra: "ok",
    });
  });

  for (const kind of MVP_EVENT_KINDS) {
    it(`accepts required MVP kind "${kind}" with its minimum payload fields`, () => {
      const event = makeEvent(kind);

      expect(parseStreamEvent(event)).toEqual(event);
    });
  }

  for (const { kind, field } of MISSING_REQUIRED_FIELD_CASES) {
    it(`rejects missing payload field "${field}" for required kind "${kind}"`, () => {
      const event = makeEvent(kind);

      delete event.payload[field];

      expectIssues(event, [{ path: `payload.${field}`, code: "missing_required" }]);
    });
  }

  it("preserves correlation identifiers and payload minima needed by telemetry persistence", () => {
    const turnEvent = makeEvent("tool.finished");
    const sessionEvent = makeEvent("queue.rejected");

    const parsedTurn = parseStreamEvent(turnEvent);
    const parsedSession = parseStreamEvent(sessionEvent);

    expect(parsedTurn).toMatchObject({
      event_id: turnEvent.event_id,
      session_id: turnEvent.session_id,
      scope: "turn",
      turn_id: turnEvent.turn_id,
      sequence: turnEvent.sequence,
      kind: turnEvent.kind,
      timestamp: turnEvent.timestamp,
      visibility: turnEvent.visibility,
    });
    expect(parsedTurn.payload).toMatchObject({
      call_id: "call-123",
      tool_name: "functions.read_file",
      status: "completed",
      duration_ms: 125,
    });

    expect(parsedSession).toMatchObject({
      event_id: sessionEvent.event_id,
      session_id: sessionEvent.session_id,
      scope: "session",
      sequence: sessionEvent.sequence,
      kind: sessionEvent.kind,
      timestamp: sessionEvent.timestamp,
      visibility: sessionEvent.visibility,
    });
    expect(parsedSession.payload).toMatchObject({
      session_id: "session-123",
      ingress_id: "ingress-456",
      queue_length: 8,
      reason: "reject_newest",
    });
  });
});

function expectIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getIssues(value);

  expect(issues).toEqual(
    expect.arrayContaining(
      expected.map((issue) => expect.objectContaining(issue)),
    ),
  );
}

function getIssues(value: unknown) {
  try {
    parseStreamEvent(value);
  } catch (error) {
    if (error instanceof StreamEventValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected stream-event parsing to fail.");
}

function makeEvent(kind: MvpKind) {
  const fixture = MVP_EVENT_FIXTURES[kind];
  const sequence = MVP_EVENT_KINDS.indexOf(kind) + 1;
  const second = String(sequence).padStart(2, "0");

  return {
    event_id: `event-${kind.replace(/\./g, "-")}`,
    session_id: "session-123",
    scope: fixture.scope,
    ...(fixture.scope === "turn" ? { turn_id: "turn-123" } : {}),
    sequence,
    kind,
    timestamp: `2026-05-22T10:30:${second}Z`,
    visibility: fixture.visibility,
    payload: {
      ...fixture.payload,
    },
  };
}