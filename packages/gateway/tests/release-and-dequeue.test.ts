import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  parseIngressDTO,
  parseMessagePart,
  parseStreamEvent,
  type StreamEvent,
} from "@argentum/contracts";
import { describe, expect, it } from "vitest";

import {
  admitIngress,
  claimActiveTurn,
  createSqliteGatewayActiveTurnClaimStore,
  createSqliteGatewayReleaseAndDequeueStore,
  createSqliteGatewaySessionRoutingStore,
  createTurnFromHandoff,
  releaseActiveTurnAndDequeue,
  resolveSession,
  type GatewayAcceptedAdmissionResult,
  type GatewayAuthorityGrantedResult,
  type GatewayFinalizingEventAppendSurface,
} from "../src/index.js";

describe("releaseActiveTurnAndDequeue", () => {
  it("releases active turn with no queued ingress and emits no queue event", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-empty",
        ingressId: "ingress-active-empty",
        userId: "user-release-empty",
      });
      const authority = createGrantedAuthority(
        harness,
        accepted,
        "authority-release-empty",
      );
      const appendedEvents: StreamEvent[] = [];
      const appendSurface = createAppendSurface(appendedEvents);

      const result = releaseActiveTurnAndDequeue({
        authority,
        finalizing_context: {
          session_id: "session-release-empty",
          turn_id: "turn-release-empty",
          terminal_kind: "turn.completed",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-unused",
          sequence: 11,
          timestamp: "2026-05-23T15:00:01Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-unused",
        finalizing_append_surface: appendSurface,
      });

      expect(result).toEqual({
        kind: "released_without_next",
        finalizing_append_surface: appendSurface,
      });
      expect(appendedEvents).toEqual([]);

      const repeated = releaseActiveTurnAndDequeue({
        authority,
        finalizing_context: {
          session_id: "session-release-empty",
          turn_id: "turn-release-empty",
          terminal_kind: "turn.completed",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-unused-repeat",
          sequence: 12,
          timestamp: "2026-05-23T15:00:02Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-unused-repeat",
        finalizing_append_surface: appendSurface,
      });
      expect(repeated).toEqual({ kind: "no_release", reason: "stale_authority" });
      expect(readSessionClaimState(harness.database, "session-release-empty")).toEqual({
        has_active_turn: 0,
        active_turn_ingress_id: null,
        active_turn_claim_id: null,
      });
    } finally {
      harness.cleanup();
    }
  });

  it("dequeues oldest queued ingress, appends queue.dequeued first, and returns a directly consumable handoff", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-queued",
        ingressId: "ingress-active-queued",
        userId: "user-release-queued",
      });
      const authority = createGrantedAuthority(
        harness,
        accepted,
        "authority-release-queued",
      );

      const oldestQueued = parseIngressDTO({
        ingress_id: "ingress-queued-oldest",
        session_id: "session-release-queued",
        channel: "terminal_cli",
        user_id: "user-release-queued",
        message_parts: [parseMessagePart({ kind: "text", text: "first queued" })],
        received_at: "2026-05-23T15:00:02Z",
        metadata: { source: "test" },
      });
      const newerQueued = parseIngressDTO({
        ingress_id: "ingress-queued-newer",
        session_id: "session-release-queued",
        channel: "terminal_cli",
        user_id: "user-release-queued",
        message_parts: [parseMessagePart({ kind: "text", text: "second queued" })],
        received_at: "2026-05-23T15:00:03Z",
        metadata: { source: "test" },
      });

      enqueueQueuedIngress(harness.database, oldestQueued, 0);
      enqueueQueuedIngress(harness.database, newerQueued, 1);

      const appendedEvents: StreamEvent[] = [];
      const appendSurface = createAppendSurface(appendedEvents);

      const result = releaseActiveTurnAndDequeue({
        authority,
        finalizing_context: {
          session_id: "session-release-queued",
          turn_id: "turn-release-queued",
          terminal_kind: "turn.completed",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-queue-dequeued",
          sequence: 21,
          timestamp: "2026-05-23T15:00:04Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-queued",
        finalizing_append_surface: appendSurface,
      });

      expect(result.kind).toBe("released_with_next");
      if (result.kind !== "released_with_next") {
        throw new Error("Expected released_with_next result.");
      }

      expect(result.queue_dequeued_event.kind).toBe("queue.dequeued");
      expect(result.queue_dequeued_event.event_id).toBe("event-queue-dequeued");
      expect(result.queue_dequeued_event.sequence).toBe(21);
      expect(result.queue_dequeued_event.timestamp).toBe("2026-05-23T15:00:04Z");
      expect(result.queue_dequeued_event.visibility).toBe("telemetry");
      expect(result.queue_dequeued_event.payload).toEqual({
        session_id: "session-release-queued",
        ingress_id: "ingress-queued-oldest",
        queue_length: 1,
      });
      expect(result.handoff.ingress.ingress_id).toBe("ingress-queued-oldest");
      expect(result.handoff.authority.authority_id).toBe("authority-next-queued");
      expect(result.finalizing_append_surface).toBe(appendSurface);
      expect(appendedEvents).toHaveLength(1);
      expect(appendedEvents[0]).toEqual(result.queue_dequeued_event);

      const terminalEvent = parseStreamEvent({
        event_id: "event-terminal-completed",
        session_id: "session-release-queued",
        scope: "turn",
        turn_id: "turn-release-queued",
        sequence: 22,
        kind: "turn.completed",
        timestamp: "2026-05-23T15:00:05Z",
        visibility: "telemetry",
        payload: {
          final_outcome: "responded",
          step_count: 1,
        },
      });
      result.finalizing_append_surface.append(terminalEvent);

      expect(appendedEvents.map((event) => event.kind)).toEqual([
        "queue.dequeued",
        "turn.completed",
      ]);

      expect(readQueueOrder(harness.database, "session-release-queued")).toEqual([
        "ingress-queued-newer",
      ]);
      expect(readSessionClaimState(harness.database, "session-release-queued")).toEqual({
        has_active_turn: 1,
        active_turn_ingress_id: "ingress-queued-oldest",
        active_turn_claim_id: "authority-next-queued",
      });

      const turnCreated = createTurnFromHandoff({
        handoff: result.handoff,
        governorDefaults: {
          max_inference_steps: 10,
          max_repair_attempts: 2,
          max_wall_clock_ms: 600000,
        },
        allocateTurnMetadata: () => ({
          turn_id: "turn-from-dequeue",
          created_at: "2026-05-23T15:00:06Z",
          updated_at: "2026-05-23T15:00:06Z",
        }),
        allocateTurnEventMetadata: () => ({
          event_id: "event-turn-started-from-dequeue",
          sequence: 1,
          timestamp: "2026-05-23T15:00:07Z",
          visibility: "telemetry",
        }),
      });

      expect(turnCreated.turn.session_id).toBe("session-release-queued");
      expect(turnCreated.turn.ingress_id).toBe("ingress-queued-oldest");
    } finally {
      harness.cleanup();
    }
  });

  it("rejects bypassed authority inputs and leaves state unchanged", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-bypass",
        ingressId: "ingress-active-bypass",
        userId: "user-release-bypass",
      });
      createGrantedAuthority(harness, accepted, "authority-release-bypass");

      const queued = parseIngressDTO({
        ingress_id: "ingress-queued-bypass",
        session_id: "session-release-bypass",
        channel: "terminal_cli",
        user_id: "user-release-bypass",
        message_parts: [parseMessagePart({ kind: "text", text: "queued" })],
        received_at: "2026-05-23T15:05:01Z",
      });
      enqueueQueuedIngress(harness.database, queued, 0);

      const beforeSession = readSessionClaimState(
        harness.database,
        "session-release-bypass",
      );
      const beforeQueue = readQueueOrder(harness.database, "session-release-bypass");
      const appendedEvents: StreamEvent[] = [];

      const result = releaseActiveTurnAndDequeue({
        authority: {
          authority_id: "authority-release-bypass",
          session_id: "session-release-bypass",
          ingress_id: "ingress-active-bypass",
        } as unknown as GatewayAuthorityGrantedResult["authority"],
        finalizing_context: {
          session_id: "session-release-bypass",
          turn_id: "turn-release-bypass",
          terminal_kind: "turn.aborted",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-unused-bypass",
          sequence: 1,
          timestamp: "2026-05-23T15:05:02Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-bypass",
        finalizing_append_surface: createAppendSurface(appendedEvents),
      });

      expect(result).toEqual({ kind: "no_release", reason: "invalid_request" });
      expect(readSessionClaimState(harness.database, "session-release-bypass")).toEqual(
        beforeSession,
      );
      expect(readQueueOrder(harness.database, "session-release-bypass")).toEqual(
        beforeQueue,
      );
      expect(appendedEvents).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  it("rolls back dequeue mutation when queue event metadata allocation fails", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-failure",
        ingressId: "ingress-active-failure",
        userId: "user-release-failure",
      });
      const authority = createGrantedAuthority(
        harness,
        accepted,
        "authority-release-failure",
      );

      const queued = parseIngressDTO({
        ingress_id: "ingress-queued-failure",
        session_id: "session-release-failure",
        channel: "terminal_cli",
        user_id: "user-release-failure",
        message_parts: [parseMessagePart({ kind: "text", text: "queued" })],
        received_at: "2026-05-23T15:10:01Z",
      });
      enqueueQueuedIngress(harness.database, queued, 0);

      const appendedEvents: StreamEvent[] = [];

      expect(() =>
        releaseActiveTurnAndDequeue({
          authority,
          finalizing_context: {
            session_id: "session-release-failure",
            turn_id: "turn-release-failure",
            terminal_kind: "turn.aborted",
          },
          store: harness.releaseStore,
          allocateQueueEventMetadata: () => {
            throw new Error("forced metadata allocation failure");
          },
          allocateNextAuthorityId: () => "authority-next-failure",
          finalizing_append_surface: createAppendSurface(appendedEvents),
        }),
      ).toThrow("forced metadata allocation failure");

      expect(readQueueOrder(harness.database, "session-release-failure")).toEqual([
        "ingress-queued-failure",
      ]);
      expect(readQueuedPayloadCount(harness.database, "session-release-failure")).toBe(1);
      expect(readSessionClaimState(harness.database, "session-release-failure")).toEqual({
        has_active_turn: 1,
        active_turn_ingress_id: "ingress-active-failure",
        active_turn_claim_id: "authority-release-failure",
      });
      expect(appendedEvents).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  it("recovers on retry after transient metadata failure without stranding lock state", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-retry",
        ingressId: "ingress-active-retry",
        userId: "user-release-retry",
      });
      const authority = createGrantedAuthority(
        harness,
        accepted,
        "authority-release-retry",
      );

      const queued = parseIngressDTO({
        ingress_id: "ingress-queued-retry",
        session_id: "session-release-retry",
        channel: "terminal_cli",
        user_id: "user-release-retry",
        message_parts: [parseMessagePart({ kind: "text", text: "queued" })],
        received_at: "2026-05-23T15:12:01Z",
      });
      enqueueQueuedIngress(harness.database, queued, 0);

      expect(() =>
        releaseActiveTurnAndDequeue({
          authority,
          finalizing_context: {
            session_id: "session-release-retry",
            turn_id: "turn-release-retry",
            terminal_kind: "turn.completed",
          },
          store: harness.releaseStore,
          allocateQueueEventMetadata: () => {
            throw new Error("forced retryable metadata failure");
          },
          allocateNextAuthorityId: () => "authority-next-retry-failed",
          finalizing_append_surface: createAppendSurface([]),
        }),
      ).toThrow("forced retryable metadata failure");

      const retried = releaseActiveTurnAndDequeue({
        authority,
        finalizing_context: {
          session_id: "session-release-retry",
          turn_id: "turn-release-retry",
          terminal_kind: "turn.completed",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-retry-success",
          sequence: 31,
          timestamp: "2026-05-23T15:12:02Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-retry-success",
        finalizing_append_surface: createAppendSurface([]),
      });

      expect(retried.kind).toBe("released_with_next");
    } finally {
      harness.cleanup();
    }
  });

  it("rolls back dequeue mutation when append surface fails inside the transaction", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-append-failure",
        ingressId: "ingress-active-append-failure",
        userId: "user-release-append-failure",
      });
      const authority = createGrantedAuthority(
        harness,
        accepted,
        "authority-release-append-failure",
      );

      const queued = parseIngressDTO({
        ingress_id: "ingress-queued-append-failure",
        session_id: "session-release-append-failure",
        channel: "terminal_cli",
        user_id: "user-release-append-failure",
        message_parts: [parseMessagePart({ kind: "text", text: "queued" })],
        received_at: "2026-05-23T15:15:01Z",
      });
      enqueueQueuedIngress(harness.database, queued, 0);

      expect(() =>
        releaseActiveTurnAndDequeue({
          authority,
          finalizing_context: {
            session_id: "session-release-append-failure",
            turn_id: "turn-release-append-failure",
            terminal_kind: "turn.completed",
          },
          store: harness.releaseStore,
          allocateQueueEventMetadata: () => ({
            event_id: "event-append-failure",
            sequence: 1,
            timestamp: "2026-05-23T15:15:02Z",
            visibility: "telemetry",
          }),
          allocateNextAuthorityId: () => "authority-next-append-failure",
          finalizing_append_surface: {
            append() {
              throw new Error("forced append failure");
            },
          },
        }),
      ).toThrow("forced append failure");

      // Append failure triggers rollback: queue must be preserved.
      expect(readQueueOrder(harness.database, "session-release-append-failure")).toEqual([
        "ingress-queued-append-failure",
      ]);
      expect(readQueuedPayloadCount(harness.database, "session-release-append-failure")).toBe(1);
      expect(
        readSessionClaimState(harness.database, "session-release-append-failure"),
      ).toEqual({
        has_active_turn: 1,
        active_turn_ingress_id: "ingress-active-append-failure",
        active_turn_claim_id: "authority-release-append-failure",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("rolls back queue mutations when claiming the dequeued next turn fails after dequeue steps", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-claim-failure",
        ingressId: "ingress-active-claim-failure",
        userId: "user-release-claim-failure",
      });
      const authority = createGrantedAuthority(
        harness,
        accepted,
        "authority-release-claim-failure",
      );

      const queued = parseIngressDTO({
        ingress_id: "ingress-queued-claim-failure",
        session_id: "session-release-claim-failure",
        channel: "terminal_cli",
        user_id: "user-release-claim-failure",
        message_parts: [parseMessagePart({ kind: "text", text: "queued" })],
        received_at: "2026-05-23T15:20:01Z",
      });
      enqueueQueuedIngress(harness.database, queued, 0);

      harness.database.exec(`
        CREATE TRIGGER force_claim_next_noop
        BEFORE UPDATE OF active_turn_ingress_id, active_turn_claim_id
        ON gateway_sessions
        WHEN NEW.active_turn_claim_id = 'authority-next-claim-failure'
        BEGIN
          SELECT RAISE(IGNORE);
        END;
      `);

      const result = releaseActiveTurnAndDequeue({
        authority,
        finalizing_context: {
          session_id: "session-release-claim-failure",
          turn_id: "turn-release-claim-failure",
          terminal_kind: "turn.completed",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-claim-failure",
          sequence: 1,
          timestamp: "2026-05-23T15:20:02Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-claim-failure",
        finalizing_append_surface: createAppendSurface([]),
      });

      expect(result).toEqual({ kind: "no_release", reason: "stale_authority" });
      expect(readQueueOrder(harness.database, "session-release-claim-failure")).toEqual([
        "ingress-queued-claim-failure",
      ]);
      expect(readQueuedPayloadCount(harness.database, "session-release-claim-failure")).toBe(1);
      expect(readSessionClaimState(harness.database, "session-release-claim-failure")).toEqual({
        has_active_turn: 1,
        active_turn_ingress_id: "ingress-active-claim-failure",
        active_turn_claim_id: "authority-release-claim-failure",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("preserves durable replay order for queue.dequeued then terminal event through one append seam", () => {
    const harness = createGatewayHarness();

    try {
      const accepted = createAcceptedAdmission(harness, {
        sessionId: "session-release-replay",
        ingressId: "ingress-active-replay",
        userId: "user-release-replay",
      });
      const authority = createGrantedAuthority(
        harness,
        accepted,
        "authority-release-replay",
      );

      const queued = parseIngressDTO({
        ingress_id: "ingress-queued-replay",
        session_id: "session-release-replay",
        channel: "terminal_cli",
        user_id: "user-release-replay",
        message_parts: [parseMessagePart({ kind: "text", text: "queued" })],
        received_at: "2026-05-23T15:25:01Z",
      });
      enqueueQueuedIngress(harness.database, queued, 0);

      const appendSurface = createSqliteReplayAppendSurface(
        harness.database,
        "session-release-replay",
      );

      const result = releaseActiveTurnAndDequeue({
        authority,
        finalizing_context: {
          session_id: "session-release-replay",
          turn_id: "turn-release-replay",
          terminal_kind: "turn.completed",
        },
        store: harness.releaseStore,
        allocateQueueEventMetadata: () => ({
          event_id: "event-queue-replay",
          sequence: 51,
          timestamp: "2026-05-23T15:25:02Z",
          visibility: "telemetry",
        }),
        allocateNextAuthorityId: () => "authority-next-replay",
        finalizing_append_surface: appendSurface,
      });

      expect(result.kind).toBe("released_with_next");

      const terminalEvent = parseStreamEvent({
        event_id: "event-terminal-replay",
        session_id: "session-release-replay",
        scope: "turn",
        turn_id: "turn-release-replay",
        sequence: 52,
        kind: "turn.completed",
        timestamp: "2026-05-23T15:25:03Z",
        visibility: "telemetry",
        payload: {
          final_outcome: "responded",
          step_count: 2,
        },
      });
      appendSurface.append(terminalEvent);

      const replayKinds = readReplayKinds(harness.database, "session-release-replay");
      const firstTerminalIndex = replayKinds.indexOf("turn.completed");
      expect(firstTerminalIndex).toBeGreaterThan(0);
      expect(replayKinds[firstTerminalIndex - 1]).toBe("queue.dequeued");
      expect(replayKinds.filter((k) => k === "queue.dequeued")).toHaveLength(1);
    } finally {
      harness.cleanup();
    }
  });
});

function createGatewayHarness() {
  const directory = createTempDirectory();
  const database = new DatabaseSync(join(directory, "gateway-release-dequeue.sqlite"));
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

function createTempDirectory(): string {
  const directory = join(
    tmpdir(),
    `argentum-gateway-release-dequeue-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(directory, { recursive: true });
  return directory;
}

function createAcceptedAdmission(
  harness: {
    routingStore: ReturnType<typeof createSqliteGatewaySessionRoutingStore>;
  },
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
      received_at: "2026-05-23T15:00:00Z",
      metadata: { source: "test" },
    },
    allocateIngressId: () => input.ingressId,
    session: {
      has_active_turn: false,
      queued_ingress: [],
    },
    allocateQueueEventMetadata: () => ({
      event_id: "event-admission",
      sequence: 1,
      timestamp: "2026-05-23T15:00:00Z",
      visibility: "telemetry",
    }),
  });

  if (admission.disposition !== "accepted") {
    throw new Error("Expected accepted admission.");
  }

  return admission;
}

function createGrantedAuthority(
  harness: {
    claimStore: ReturnType<typeof createSqliteGatewayActiveTurnClaimStore>;
  },
  accepted: GatewayAcceptedAdmissionResult,
  authorityId: string,
): GatewayAuthorityGrantedResult["authority"] {
  const result = claimActiveTurn({
    admission: accepted,
    store: harness.claimStore,
    allocateAuthorityId: () => authorityId,
  });

  if (result.kind !== "authority_granted") {
    throw new Error("Expected one authority_granted result.");
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
      [
        "INSERT INTO gateway_session_queue (session_id, queue_position, ingress_id)",
        "VALUES (?, ?, ?)",
      ].join(" "),
    )
    .run(ingress.session_id, queuePosition, ingress.ingress_id);

  database
    .prepare(
      [
        "INSERT INTO gateway_queued_ingress_payloads (session_id, ingress_id, ingress_json)",
        "VALUES (?, ?, ?)",
      ].join(" "),
    )
    .run(ingress.session_id, ingress.ingress_id, JSON.stringify(ingress));
}

function readSessionClaimState(database: DatabaseSync, sessionId: string) {
  return database
    .prepare(
      [
        "SELECT has_active_turn, active_turn_ingress_id, active_turn_claim_id",
        "FROM gateway_sessions",
        "WHERE session_id = ?",
      ].join(" "),
    )
    .get(sessionId) as {
    has_active_turn: number;
    active_turn_ingress_id: string | null;
    active_turn_claim_id: string | null;
  };
}

function readQueueOrder(database: DatabaseSync, sessionId: string): string[] {
  const rows = database
    .prepare(
      [
        "SELECT ingress_id",
        "FROM gateway_session_queue",
        "WHERE session_id = ?",
        "ORDER BY queue_position ASC",
      ].join(" "),
    )
    .all(sessionId) as { ingress_id: string }[];

  return rows.map((row) => row.ingress_id);
}

function readQueuedPayloadCount(database: DatabaseSync, sessionId: string): number {
  const row = database
    .prepare(
      [
        "SELECT COUNT(*) AS payload_count",
        "FROM gateway_queued_ingress_payloads",
        "WHERE session_id = ?",
      ].join(" "),
    )
    .get(sessionId) as { payload_count: number };

  return row.payload_count;
}

function createAppendSurface(events: StreamEvent[]): GatewayFinalizingEventAppendSurface {
  return {
    append(event) {
      events.push(parseStreamEvent(event));
    },
  };
}

function createSqliteReplayAppendSurface(
  database: DatabaseSync,
  sessionId: string,
): GatewayFinalizingEventAppendSurface {
  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_finalizing_event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      kind TEXT NOT NULL
    );
  `);

  return {
    append(event) {
      const parsed = parseStreamEvent(event);
      database
        .prepare(
          [
            "INSERT INTO gateway_finalizing_event_log (session_id, event_json, kind)",
            "VALUES (?, ?, ?)",
          ].join(" "),
        )
        .run(sessionId, JSON.stringify(parsed), parsed.kind);
    },
  };
}

function readReplayKinds(database: DatabaseSync, sessionId: string): string[] {
  const rows = database
    .prepare(
      [
        "SELECT event_json",
        "FROM gateway_finalizing_event_log",
        "WHERE session_id = ?",
        "ORDER BY id ASC",
      ].join(" "),
    )
    .all(sessionId) as { event_json: string }[];

  return rows.map((row) =>
    (JSON.parse(row.event_json) as { kind: string }).kind,
  );
}
