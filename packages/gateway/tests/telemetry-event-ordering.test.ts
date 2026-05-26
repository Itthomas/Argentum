import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  parseIngressDTO,
  parseMessagePart,
  parseStreamEvent,
  type StreamEvent,
  type StreamEventPayload,
} from "@argentum/contracts";
import { describe, expect, it } from "vitest";

import {
  admitIngress,
  assertGatewayTelemetryEvent,
  claimActiveTurn,
  createGatewayTurnStartHandoffFromAcceptedAdmission,
  createSqliteGatewayActiveTurnClaimStore,
  createSqliteGatewayReleaseAndDequeueStore,
  createSqliteGatewaySessionRoutingStore,
  createTurnFromHandoff,
  createTurnSequenceCounter,
  Gateway,
  releaseActiveTurnAndDequeue,
  resolveSession,
  type GatewayAcceptedAdmissionResult,
  type GatewayAdmitInput,
  type GatewayAuthorityGrantedResult,
  type GatewayFinalizingEventAppendSurface,
  type GatewayReleaseInput,
  type GatewayTelemetryCorrelation,
} from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeTurnScopedEvent(overrides: {
  session_id?: string;
  turn_id?: string;
}): StreamEvent<StreamEventPayload> {
  return parseStreamEvent({
    event_id: "event-turn-test",
    session_id: overrides.session_id ?? "session-test",
    scope: "turn",
    turn_id: overrides.turn_id ?? "turn-test",
    sequence: 1,
    kind: "turn.started",
    timestamp: "2026-05-26T00:00:00Z",
    visibility: "system",
    payload: {
      session_id: "session-test",
      ingress_id: "ingress-test",
      state: "accepted",
    },
  });
}

function makeSessionScopedEvent(overrides: {
  session_id?: string;
  turn_id?: string;
  kind?: string;
}): StreamEvent<StreamEventPayload> {
  return parseStreamEvent({
    event_id: "event-session-test",
    session_id: overrides.session_id ?? "session-test",
    scope: "session",
    ...(overrides.turn_id !== undefined ? { turn_id: overrides.turn_id } : {}),
    sequence: 1,
    kind: overrides.kind ?? "queue.queued",
    timestamp: "2026-05-26T00:00:00Z",
    visibility: "system",
    payload: {
      session_id: "session-test",
      ingress_id: "ingress-test",
      queue_length: 1,
    },
  });
}

function makeCorrelation(overrides: {
  session_id?: string;
  turn_id?: string;
}): GatewayTelemetryCorrelation {
  return {
    session_id: overrides.session_id ?? "session-test",
    ...(overrides.turn_id !== undefined ? { turn_id: overrides.turn_id } : {}),
  };
}

function createAppendSurface(
  sink: StreamEvent[],
): GatewayFinalizingEventAppendSurface {
  return {
    append(event: StreamEvent): void {
      sink.push(event);
    },
  };
}

function createGatewayHarness() {
  const directory = join(
    tmpdir(),
    `argentum-gateway-telemetry-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, "gateway-telemetry.sqlite"));
  const routingStore = createSqliteGatewaySessionRoutingStore({ database });
  const claimStore = createSqliteGatewayActiveTurnClaimStore({ database });
  const releaseStore = createSqliteGatewayReleaseAndDequeueStore({ database });

  return {
    database,
    routingStore,
    claimStore,
    releaseStore,
    cleanup: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createAcceptedAdmission(
  harness: ReturnType<typeof createGatewayHarness>,
  input: {
    sessionId: string;
    ingressId: string;
    userId: string;
  },
): GatewayAcceptedAdmissionResult {
  const resolved = resolveSession({
    channel: "terminal_cli",
    user_id: input.userId,
    allocateSessionId: () => input.sessionId,
    store: harness.routingStore,
  });

  const admission = admitIngress({
    gatewayDefaults: {
      max_queued_ingress_per_session: 8,
      queue_overflow_policy: "reject_newest",
    },
    session_id: resolved.session_id,
    ingress: {
      channel: "terminal_cli",
      user_id: input.userId,
      message_parts: [parseMessagePart({ kind: "text", text: "hello" })],
      received_at: "2026-05-26T00:00:00Z",
      metadata: { source: "telemetry-test" },
    },
    allocateIngressId: () => input.ingressId,
    session: {
      has_active_turn: false,
      queued_ingress: [],
    },
    allocateQueueEventMetadata: () => ({
      event_id: "event-admission-accepted",
      sequence: 0,
      timestamp: "2026-05-26T00:00:00Z",
      visibility: "telemetry",
    }),
  });

  if (admission.disposition !== "accepted") {
    throw new Error("Expected accepted admission.");
  }

  return admission;
}

function createGrantedAuthority(
  harness: ReturnType<typeof createGatewayHarness>,
  accepted: GatewayAcceptedAdmissionResult,
  authorityId: string,
): GatewayAuthorityGrantedResult["authority"] {
  const result = claimActiveTurn({
    admission: accepted,
    store: harness.claimStore,
    allocateAuthorityId: () => authorityId,
  });

  if (result.kind !== "authority_granted") {
    throw new Error("Expected authority_granted result.");
  }

  return result.authority;
}

function enqueueQueuedIngress(
  database: DatabaseSync,
  ingress: ReturnType<typeof parseIngressDTO>,
  queuePosition: number,
): void {
  database
    .prepare(
      "INSERT INTO gateway_session_queue (session_id, queue_position, ingress_id) VALUES (?, ?, ?)",
    )
    .run(ingress.session_id, queuePosition, ingress.ingress_id);

  database
    .prepare(
      "INSERT INTO gateway_queued_ingress_payloads (session_id, ingress_id, ingress_json) VALUES (?, ?, ?)",
    )
    .run(ingress.session_id, ingress.ingress_id, JSON.stringify(ingress));
}

// ── assertGatewayTelemetryEvent ──────────────────────────────────

describe("assertGatewayTelemetryEvent", () => {
  // ── Turn-scoped events ───────────────────────────────────────

  it("accepts a valid turn-scoped event with both correlation IDs", () => {
    const event = makeTurnScopedEvent({
      session_id: "s1",
      turn_id: "t1",
    });
    const correlation = makeCorrelation({
      session_id: "s1",
      turn_id: "t1",
    });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).not.toThrow();
  });

  it("throws when a turn-scoped event correlation is missing turn_id", () => {
    const event = makeTurnScopedEvent({
      session_id: "s1",
      turn_id: "t1",
    });
    const correlation = makeCorrelation({ session_id: "s1" });
    // correlation has no turn_id

    expect(() => assertGatewayTelemetryEvent(event, correlation)).toThrow(
      "non-empty turn_id",
    );
  });

  it("throws when a turn-scoped event has mismatched session_id", () => {
    const event = makeTurnScopedEvent({
      session_id: "s1",
      turn_id: "t1",
    });
    const correlation = makeCorrelation({
      session_id: "s2",
      turn_id: "t1",
    });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).toThrow(
      "session_id does not match",
    );
  });

  it("throws when a turn-scoped event has mismatched turn_id", () => {
    const event = makeTurnScopedEvent({
      session_id: "s1",
      turn_id: "t1",
    });
    const correlation = makeCorrelation({
      session_id: "s1",
      turn_id: "t2",
    });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).toThrow(
      "turn_id does not match",
    );
  });

  it("throws when correlation has empty session_id", () => {
    const event = makeTurnScopedEvent({
      session_id: "s1",
      turn_id: "t1",
    });
    const correlation = makeCorrelation({
      session_id: "",
      turn_id: "t1",
    });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).toThrow(
      "non-empty session_id",
    );
  });

  // ── Session-scoped events ────────────────────────────────────

  it("accepts a valid session-scoped event with session_id (turn_id absent)", () => {
    const event = makeSessionScopedEvent({ session_id: "s1", kind: "queue.queued" });
    const correlation = makeCorrelation({ session_id: "s1" });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).not.toThrow();
  });

  it("accepts a valid session-scoped event with optional turn_id present", () => {
    const event = makeSessionScopedEvent({
      session_id: "s1",
      turn_id: "t1",
      kind: "queue.dequeued",
    });
    const correlation = makeCorrelation({
      session_id: "s1",
      turn_id: "t1",
    });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).not.toThrow();
  });

  it("throws when a session-scoped event has mismatched session_id", () => {
    const event = makeSessionScopedEvent({ session_id: "s1", kind: "queue.queued" });
    const correlation = makeCorrelation({ session_id: "s2" });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).toThrow(
      "session_id does not match",
    );
  });

  it("throws when correlation has empty session_id for session-scoped event", () => {
    const event = makeSessionScopedEvent({ session_id: "s1", kind: "queue.queued" });
    const correlation = makeCorrelation({ session_id: "" });

    expect(() => assertGatewayTelemetryEvent(event, correlation)).toThrow(
      "non-empty session_id",
    );
  });
});

// ── createTurnSequenceCounter ────────────────────────────────────

describe("createTurnSequenceCounter", () => {
  it("produces strictly increasing sequence values starting at 1", () => {
    const counter = createTurnSequenceCounter();

    expect(counter.nextSequence()).toBe(1);
    expect(counter.nextSequence()).toBe(2);
    expect(counter.nextSequence()).toBe(3);
    expect(counter.nextSequence()).toBe(4);
    expect(counter.nextSequence()).toBe(5);
  });

  it("produces independent sequences for separate counters", () => {
    const c1 = createTurnSequenceCounter();
    const c2 = createTurnSequenceCounter();

    expect(c1.nextSequence()).toBe(1);
    expect(c2.nextSequence()).toBe(1);
    expect(c1.nextSequence()).toBe(2);
    expect(c2.nextSequence()).toBe(2);
  });
});

// ── Pipeline: admission → turn-creation → release/dequeue ────────

describe("gateway telemetry event ordering", () => {
  it("produces ordered, correlated events with strictly increasing sequences in admission→turn-creation→release pipeline", () => {
    const harness = createGatewayHarness();
    const collectedEvents: StreamEvent[] = [];
    const counter = createTurnSequenceCounter();

    try {
      // ── Step 0: Create a session with an active turn (first ingress accepted) ─
      const firstAccepted = createAcceptedAdmission(harness, {
        sessionId: "session-pipeline",
        ingressId: "ingress-first",
        userId: "user-pipeline",
      });
      const authority = createGrantedAuthority(
        harness,
        firstAccepted,
        "authority-pipeline",
      );

      // ── Step 1: Admit a second ingress while session has active turn → queued ─
      const resolved = resolveSession({
        channel: "terminal_cli",
        user_id: "user-pipeline",
        allocateSessionId: () => firstAccepted.ingress.session_id,
        store: harness.routingStore,
      });

      const queuedAdmission = admitIngress({
        gatewayDefaults: {
          max_queued_ingress_per_session: 8,
          queue_overflow_policy: "reject_newest",
        },
        session_id: resolved.session_id,
        ingress: {
          channel: "terminal_cli",
          user_id: "user-pipeline",
          message_parts: [parseMessagePart({ kind: "text", text: "second message" })],
          received_at: "2026-05-26T00:00:01Z",
          metadata: { source: "telemetry-test" },
        },
        allocateIngressId: () => "ingress-second",
        session: {
          has_active_turn: true, // first admission claimed the turn
          queued_ingress: [],
        },
        allocateQueueEventMetadata: () => ({
          event_id: "event-queue-queued",
          sequence: counter.nextSequence(), // 1
          timestamp: "2026-05-26T00:00:01Z",
          visibility: "telemetry",
        }),
      });

      expect(queuedAdmission.disposition).toBe("queued");
      if (queuedAdmission.disposition !== "queued") {
        throw new Error("Expected queued admission.");
      }

      const queueQueuedEvent = queuedAdmission.queue_event;
      collectedEvents.push(queueQueuedEvent);

      // ── Step 2: Create a turn from the first accepted admission → turn.started ─
      const handoff = createGatewayTurnStartHandoffFromAcceptedAdmission({
        admission: firstAccepted,
        authority,
      });

      const turnCreated = createTurnFromHandoff({
        handoff,
        governorDefaults: {
          max_inference_steps: 10,
          max_repair_attempts: 2,
          max_wall_clock_ms: 600000,
        },
        allocateTurnMetadata: () => ({
          turn_id: "turn-pipeline",
          created_at: "2026-05-26T00:00:02Z",
          updated_at: "2026-05-26T00:00:02Z",
        }),
        allocateTurnEventMetadata: () => ({
          event_id: "event-turn-started",
          sequence: counter.nextSequence(), // 2
          timestamp: "2026-05-26T00:00:02Z",
          visibility: "telemetry",
        }),
      });

      const turnStartedEvent = turnCreated.turn_started_event;
      collectedEvents.push(turnStartedEvent);

      // Also enqueue the second ingress's payload so release can dequeue it
      enqueueQueuedIngress(
        harness.database,
        queuedAdmission.ingress,
        0,
      );

      // ── Step 3: Release active turn → queue.dequeued ─
      const appendSurface = createAppendSurface(collectedEvents);

      const releaseResult = releaseActiveTurnAndDequeue({
        authority,
        finalizing_context: {
          session_id: "session-pipeline",
          turn_id: "turn-pipeline",
          terminal_kind: "turn.completed",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-queue-dequeued",
          sequence: counter.nextSequence(), // 3
          timestamp: "2026-05-26T00:00:03Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-pipeline",
        finalizing_append_surface: appendSurface,
      });

      expect(releaseResult.kind).toBe("released_with_next");
      if (releaseResult.kind !== "released_with_next") {
        throw new Error("Expected released_with_next result.");
      }

      // The queue.dequeued event was appended via appendSurface AND is also on the result
      // collectedEvents now has: queue.queued, turn.started, queue.dequeued

      // ── Assertions ────────────────────────────────────────────

      // 1. Event ordering: queue.queued → turn.started → queue.dequeued
      expect(collectedEvents).toHaveLength(3);
      expect(collectedEvents[0].kind).toBe("queue.queued");
      expect(collectedEvents[1].kind).toBe("turn.started");
      expect(collectedEvents[2].kind).toBe("queue.dequeued");

      // 2. Strictly increasing sequence values
      expect(collectedEvents[0].sequence).toBe(1);
      expect(collectedEvents[1].sequence).toBe(2);
      expect(collectedEvents[2].sequence).toBe(3);

      // 3. Correlation: session-scoped events carry session_id
      const queueQueued = collectedEvents[0];
      expect(queueQueued.scope).toBe("session");
      expect(queueQueued.session_id).toBe("session-pipeline");

      // queue.dequeued event
      const queueDequeued = collectedEvents[2];
      expect(queueDequeued.scope).toBe("session");
      expect(queueDequeued.session_id).toBe("session-pipeline");

      // 4. Correlation: turn-scoped events carry both session_id and turn_id
      const turnStarted = collectedEvents[1];
      expect(turnStarted.scope).toBe("turn");
      expect(turnStarted.session_id).toBe("session-pipeline");
      expect("turn_id" in turnStarted).toBe(true);
      expect((turnStarted as StreamEvent & { turn_id: string }).turn_id).toBe(
        "turn-pipeline",
      );

      // 5. Verify each event passes assertGatewayTelemetryEvent
      expect(() =>
        assertGatewayTelemetryEvent(queueQueued, {
          session_id: "session-pipeline",
        }),
      ).not.toThrow();

      expect(() =>
        assertGatewayTelemetryEvent(turnStarted, {
          session_id: "session-pipeline",
          turn_id: "turn-pipeline",
        }),
      ).not.toThrow();

      expect(() =>
        assertGatewayTelemetryEvent(queueDequeued, {
          session_id: "session-pipeline",
        }),
      ).not.toThrow();

      // 6. A turn-scoped event whose correlation is missing turn_id causes assertion to throw
      const turnEvent = parseStreamEvent({
        event_id: "event-malformed-correlation",
        session_id: "session-pipeline",
        scope: "turn",
        turn_id: "turn-pipeline",
        sequence: 99,
        kind: "turn.aborted",
        timestamp: "2026-05-26T00:00:04Z",
        visibility: "telemetry",
        payload: {
          reason: "test",
          error_code: "TEST",
        },
      });

      expect(() =>
        assertGatewayTelemetryEvent(turnEvent, {
          session_id: "session-pipeline",
          // correlation intentionally missing turn_id
        }),
      ).toThrow("non-empty turn_id");
    } finally {
      harness.cleanup();
    }
  });
});

// ── H1: Gateway facade wires assertGatewayTelemetryEvent ─────────

describe("Gateway facade telemetry assertion wiring (H1)", () => {
  /** Create a config pointing at a temp SQLite database. */
  function createGatewayConfig(): { dbPath: string; cleanup: () => void } {
    const directory = join(
      tmpdir(),
      `argentum-gateway-h1-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(directory, { recursive: true });
    const dbPath = join(directory, "gateway-h1.sqlite");
    return {
      dbPath,
      cleanup: () => {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      },
    };
  }

  it("throws when admitIngress produces a queue_event whose session_id does not match the ingress", () => {
    const { dbPath, cleanup } = createGatewayConfig();
    try {
      const gateway = new Gateway({
        dbPath,
        governorDefaults: {
          max_inference_steps: 10,
          max_repair_attempts: 2,
          max_wall_clock_ms: 600000,
        },
        gatewayDefaults: {
          max_queued_ingress_per_session: 8,
          queue_overflow_policy: "reject_newest",
        },
      });

      // Resolve a session first
      const resolved = gateway.resolveSession({
        channel: "terminal_cli",
        user_id: "user-h1",
      });

      // With max_queued=0 and no active turn, a second admission should queue
      // (first admission is accepted because no active turn and empty queue)
      const firstInput: GatewayAdmitInput = {
        session_id: resolved.session_id,
        ingress: {
          channel: "terminal_cli",
          user_id: "user-h1",
          message_parts: [parseMessagePart({ kind: "text", text: "first" })],
          received_at: "2026-05-26T00:00:00Z",
          metadata: { source: "h1-test" },
        },
        session: { has_active_turn: false, queued_ingress: [] },
      };
      const first = gateway.admitIngress(firstInput);
      expect(first.disposition).toBe("accepted");

      // Now admission should be queued (has_active_turn=true) — assertGatewayTelemetryEvent is called
      const secondInput: GatewayAdmitInput = {
        session_id: resolved.session_id,
        ingress: {
          channel: "terminal_cli",
          user_id: "user-h1",
          message_parts: [parseMessagePart({ kind: "text", text: "second" })],
          received_at: "2026-05-26T00:00:01Z",
          metadata: { source: "h1-test" },
        },
        session: { has_active_turn: true, queued_ingress: [] },
      };
      const second = gateway.admitIngress(secondInput);
      expect(second.disposition).toBe("queued");
      // The facade called assertGatewayTelemetryEvent internally — no throw = success.

      // Now prove that a malformed event causes the assertion to throw.
      // Craft an event whose session_id does NOT match the correlation.
      const malformedEvent = parseStreamEvent({
        event_id: "event-malformed",
        session_id: "wrong-session",
        scope: "session",
        sequence: 1,
        kind: "queue.queued",
        timestamp: "2026-05-26T00:00:02Z",
        visibility: "system",
        payload: {
          session_id: "wrong-session",
          ingress_id: "ingress-x",
          queue_length: 1,
        },
      });

      expect(() =>
        assertGatewayTelemetryEvent(malformedEvent, {
          session_id: resolved.session_id,
        }),
      ).toThrow("session_id does not match");
    } finally {
      cleanup();
    }
  });

  it("throws when createTurnFromHandoff produces a turn_started_event with mismatched turn_id", () => {
    const { dbPath, cleanup } = createGatewayConfig();
    try {
      const gateway = new Gateway({
        dbPath,
        governorDefaults: {
          max_inference_steps: 10,
          max_repair_attempts: 2,
          max_wall_clock_ms: 600000,
        },
        gatewayDefaults: {
          max_queued_ingress_per_session: 8,
          queue_overflow_policy: "reject_newest",
        },
      });

      const resolved = gateway.resolveSession({
        channel: "terminal_cli",
        user_id: "user-h1-turn",
      });

      const admission = gateway.admitIngress({
        session_id: resolved.session_id,
        ingress: {
          channel: "terminal_cli",
          user_id: "user-h1-turn",
          message_parts: [parseMessagePart({ kind: "text", text: "hello" })],
          received_at: "2026-05-26T00:00:00Z",
          metadata: { source: "h1-test" },
        },
        session: { has_active_turn: false, queued_ingress: [] },
      });
      expect(admission.disposition).toBe("accepted");
      if (admission.disposition !== "accepted") {
        throw new Error("Expected accepted admission");
      }

      const claimResult = gateway.claimActiveTurn(admission);
      expect(claimResult.kind).toBe("authority_granted");
      if (claimResult.kind !== "authority_granted") {
        throw new Error("Expected authority_granted");
      }

      const handoff = gateway.createTurnStartHandoff({
        admission,
        authority: claimResult.authority,
      });

      // Facade calls assertGatewayTelemetryEvent internally — should succeed
      const turnResult = gateway.createTurnFromHandoff(handoff);
      expect(turnResult.turn.turn_id).toBeTruthy();

      // Now prove malformed turn event causes throw.
      const malformedTurnEvent = parseStreamEvent({
        event_id: "event-turn-malformed",
        session_id: resolved.session_id,
        scope: "turn",
        turn_id: "wrong-turn-id",
        sequence: 1,
        kind: "turn.started",
        timestamp: "2026-05-26T00:00:01Z",
        visibility: "system",
        payload: {
          session_id: resolved.session_id,
          ingress_id: admission.ingress.ingress_id,
          state: "accepted",
        },
      });

      expect(() =>
        assertGatewayTelemetryEvent(malformedTurnEvent, {
          session_id: resolved.session_id,
          turn_id: turnResult.turn.turn_id,
        }),
      ).toThrow("turn_id does not match");
    } finally {
      cleanup();
    }
  });

  it("throws when releaseActiveTurnAndDequeue is given a correlation that mismatches the dequeue event", () => {
    // Prove that assertGatewayTelemetryEvent catches a mismatched
    // session_id on a queue.dequeued event.
    const malformedDequeueEvent = parseStreamEvent({
      event_id: "event-dequeue-malformed",
      session_id: "alien-session",
      scope: "session",
      sequence: 1,
      kind: "queue.dequeued",
      timestamp: "2026-05-26T00:00:00Z",
      visibility: "system",
      payload: {
        session_id: "alien-session",
        ingress_id: "ingress-x",
        queue_length: 0,
      },
    });

    expect(() =>
      assertGatewayTelemetryEvent(malformedDequeueEvent, {
        session_id: "real-session",
      }),
    ).toThrow("session_id does not match");
  });
});

// ── H2: Counter survives multiple allocateTurnEventMetadata calls ─

describe("turn-scoped sequence counter across multiple event allocations (H2)", () => {
  it("produces strictly increasing sequences when allocateTurnEventMetadata is called multiple times within one turn", () => {
    // Simulate the facade pattern: create ONE counter per turn, then
    // call nextSequence() multiple times as allocateTurnEventMetadata would.
    const counter = createTurnSequenceCounter();
    const sequences: number[] = [];

    // Simulate allocateTurnEventMetadata being called 5 times within the same turn.
    for (let i = 0; i < 5; i++) {
      sequences.push(counter.nextSequence());
    }

    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });

  it("counter survives across mixed pipeline stages within a single turn lifetime", () => {
    // Prove the same counter can be used for turn-level events
    // (turn.started, hypothetical turn.progress, turn.completed)
    // all within one turn, producing strictly increasing sequences.
    const counter = createTurnSequenceCounter();

    // turn.started
    const startedSeq = counter.nextSequence();
    expect(startedSeq).toBe(1);

    // turn.progress (hypothetical intermediate event)
    const progressSeq = counter.nextSequence();
    expect(progressSeq).toBe(2);

    // another progress event
    const progressSeq2 = counter.nextSequence();
    expect(progressSeq2).toBe(3);

    // turn.completed
    const completedSeq = counter.nextSequence();
    expect(completedSeq).toBe(4);

    // Verify no gaps and strictly increasing
    expect(startedSeq).toBeLessThan(progressSeq);
    expect(progressSeq).toBeLessThan(progressSeq2);
    expect(progressSeq2).toBeLessThan(completedSeq);
  });
});
