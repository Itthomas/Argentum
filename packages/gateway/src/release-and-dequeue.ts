import { DatabaseSync } from "node:sqlite";

import {
  type IngressDTO,
  type SessionStreamEvent,
  type StreamEvent,
  type StreamEventPayload,
  parseIngressDTO,
  parseStreamEvent,
} from "@argentum/contracts";

import {
  consumeGatewayTurnCreationAuthorityInCurrentTransaction,
  createGatewayExclusiveTurnCreationAuthority,
  createSqliteGatewayTurnCreationAuthorityConsumer,
  type GatewayExclusiveTurnCreationAuthority,
  type GatewayTurnCreationAuthorityConsumer,
  isGatewayExclusiveTurnCreationAuthority,
} from "./active-turn-claim.js";
import type {
  GatewayQueueEventMetadata,
  GatewayQueueEventMetadataAllocator,
} from "./ingress-admission.js";
import {
  createGatewayTurnStartHandoff,
  type GatewayTurnStartHandoff,
} from "./turn-creation.js";

export interface GatewayFinalizingReleaseContext {
  readonly session_id: string;
  readonly turn_id: string;
  readonly terminal_kind: "turn.completed" | "turn.aborted";
}

export interface GatewayDequeuedEventPayload extends StreamEventPayload {
  readonly session_id: string;
  readonly ingress_id: string;
  readonly queue_length: number;
}

export interface GatewayDequeuedStreamEvent
  extends SessionStreamEvent<GatewayDequeuedEventPayload> {
  readonly kind: "queue.dequeued";
  readonly scope: "session";
}

export interface GatewayFinalizingEventAppendSurface {
  /**
   * Appends a finalizing event to the durable event log.
   *
   * **Throws** on append failure (e.g., I/O error, constraint violation).
   * Callers must handle the thrown error; this method does not return a
   * result discriminated union.
   */
  append(event: StreamEvent<StreamEventPayload>): void;
}

export interface GatewayReleasedWithoutNextResult {
  readonly kind: "released_without_next";
  readonly finalizing_append_surface: GatewayFinalizingEventAppendSurface;
}

export interface GatewayReleasedWithNextResult {
  readonly kind: "released_with_next";
  readonly handoff: GatewayTurnStartHandoff;
  readonly queue_dequeued_event: GatewayDequeuedStreamEvent;
  readonly finalizing_append_surface: GatewayFinalizingEventAppendSurface;
}

export interface GatewayNoReleaseResult {
  readonly kind: "no_release";
  readonly reason: "stale_authority" | "invalid_request";
}

export type GatewayReleaseAndDequeueResult =
  | GatewayReleasedWithoutNextResult
  | GatewayReleasedWithNextResult
  | GatewayNoReleaseResult;

export interface GatewayReleaseAndDequeueStoreInput {
  readonly authority: GatewayExclusiveTurnCreationAuthority;
  readonly finalizing_context: GatewayFinalizingReleaseContext;
  readonly allocateNextAuthorityId: () => string;
  readonly finalizing_append_surface: GatewayFinalizingEventAppendSurface;
  readonly appendQueueDequeuedEvent: (input: {
    readonly session_id: string;
    readonly ingress_id: string;
    readonly queue_length: number;
  }) => GatewayDequeuedStreamEvent;
}

export interface GatewayReleasedWithoutNextStoreResult {
  readonly kind: "released_without_next";
}

export interface GatewayReleasedWithNextStoreResult {
  readonly kind: "released_with_next";
  readonly dequeued_ingress: IngressDTO;
  readonly queue_dequeued_event: GatewayDequeuedStreamEvent;
  readonly next_authority_id: string;
  readonly consume_authority: GatewayTurnCreationAuthorityConsumer;
}

export interface GatewayNoReleaseStoreResult {
  readonly kind: "no_release";
  readonly reason: "stale_authority" | "invalid_request";
}

export type GatewayReleaseAndDequeueStoreResult =
  | GatewayReleasedWithoutNextStoreResult
  | GatewayReleasedWithNextStoreResult
  | GatewayNoReleaseStoreResult;

export type GatewayReleaseAndDequeueStore = (
  input: GatewayReleaseAndDequeueStoreInput,
) => GatewayReleaseAndDequeueStoreResult;

export interface ReleaseActiveTurnAndDequeueInput {
  readonly authority: GatewayExclusiveTurnCreationAuthority;
  readonly finalizing_context: GatewayFinalizingReleaseContext;
  readonly store: GatewayReleaseAndDequeueStore;
  readonly allocateQueueEventMetadata: GatewayQueueEventMetadataAllocator;
  readonly allocateNextAuthorityId: () => string;
  readonly finalizing_append_surface: GatewayFinalizingEventAppendSurface;
}

export interface CreateSqliteGatewayReleaseAndDequeueStoreInput {
  readonly database: DatabaseSync;
}

export function releaseActiveTurnAndDequeue(
  input: ReleaseActiveTurnAndDequeueInput,
): GatewayReleaseAndDequeueResult {
  if (
    typeof input.finalizing_context.turn_id !== "string" ||
    input.finalizing_context.turn_id.length === 0 ||
    (input.finalizing_context.terminal_kind !== "turn.completed" &&
      input.finalizing_context.terminal_kind !== "turn.aborted")
  ) {
    return Object.freeze({ kind: "no_release", reason: "invalid_request" });
  }

  if (input.authority.session_id !== input.finalizing_context.session_id) {
    return Object.freeze({ kind: "no_release", reason: "invalid_request" });
  }

  if (!isGatewayExclusiveTurnCreationAuthority(input.authority)) {
    return Object.freeze({ kind: "no_release", reason: "invalid_request" });
  }

  const storeResult = input.store({
    authority: input.authority,
    finalizing_context: input.finalizing_context,
    allocateNextAuthorityId: input.allocateNextAuthorityId,
    finalizing_append_surface: input.finalizing_append_surface,
    appendQueueDequeuedEvent: (queueInput) =>
      createQueueDequeuedEvent({
        metadata: input.allocateQueueEventMetadata(),
        session_id: queueInput.session_id,
        ingress_id: queueInput.ingress_id,
        queue_length: queueInput.queue_length,
      }),
  });

  if (storeResult.kind === "no_release") {
    return Object.freeze(storeResult);
  }

  if (storeResult.kind === "released_without_next") {
    return Object.freeze({
      kind: "released_without_next",
      finalizing_append_surface: input.finalizing_append_surface,
    });
  }

  const authority = createGatewayExclusiveTurnCreationAuthority({
    authority_id: storeResult.next_authority_id,
    session_id: storeResult.dequeued_ingress.session_id,
    ingress_id: storeResult.dequeued_ingress.ingress_id,
    consume_authority: storeResult.consume_authority,
  });

  return Object.freeze({
    kind: "released_with_next",
    handoff: createGatewayTurnStartHandoff({
      ingress: storeResult.dequeued_ingress,
      authority,
    }),
    queue_dequeued_event: storeResult.queue_dequeued_event,
    finalizing_append_surface: input.finalizing_append_surface,
  });
}

export function createSqliteGatewayReleaseAndDequeueStore(
  input: CreateSqliteGatewayReleaseAndDequeueStoreInput,
): GatewayReleaseAndDequeueStore {
  initializeSqliteSchema(input.database);
  const consumeAuthority = createSqliteGatewayTurnCreationAuthorityConsumer(input);

  return Object.freeze((storeInput: GatewayReleaseAndDequeueStoreInput) =>
    releaseAndDequeueInSqlite(input.database, storeInput, consumeAuthority),
  );
}

function releaseAndDequeueInSqlite(
  database: DatabaseSync,
  input: GatewayReleaseAndDequeueStoreInput,
  consumeAuthority: GatewayTurnCreationAuthorityConsumer,
): GatewayReleaseAndDequeueStoreResult {
  database.exec("BEGIN IMMEDIATE");

  try {
    const consumed = consumeGatewayTurnCreationAuthorityInCurrentTransaction({
      database,
      authority: input.authority,
    });

    if (consumed.kind !== "authority_consumed") {
      database.exec("COMMIT");
      return Object.freeze({ kind: "no_release", reason: consumed.reason });
    }

    const consumedClaimId = `consumed:${input.authority.authority_id}`;

    const head = selectQueuedIngressHead(database, input.finalizing_context.session_id);
    if (!head) {
      const cleared = database
        .prepare(
          [
            "UPDATE gateway_sessions",
            "SET has_active_turn = 0, active_turn_ingress_id = NULL, active_turn_claim_id = NULL",
            "WHERE session_id = ?",
            "AND has_active_turn = 1",
            "AND active_turn_ingress_id = ?",
            "AND active_turn_claim_id = ?",
          ].join(" "),
        )
        .run(
          input.finalizing_context.session_id,
          input.authority.ingress_id,
          consumedClaimId,
        );

      if (cleared.changes !== 1) {
        database.exec("COMMIT");
        return Object.freeze({ kind: "no_release", reason: "stale_authority" });
      }

      database.exec("COMMIT");
      return Object.freeze({ kind: "released_without_next" });
    }

    const dequeuedIngress = readQueuedIngressPayload(
      database,
      input.finalizing_context.session_id,
      head.ingress_id,
    );

    const nextAuthorityId = input.allocateNextAuthorityId();

    database
      .prepare(
        [
          "DELETE FROM gateway_session_queue",
          "WHERE session_id = ? AND queue_position = ? AND ingress_id = ?",
        ].join(" "),
      )
      .run(input.finalizing_context.session_id, head.queue_position, head.ingress_id);

    database
      .prepare(
        [
          "DELETE FROM gateway_queued_ingress_payloads",
          "WHERE session_id = ? AND ingress_id = ?",
        ].join(" "),
      )
      .run(input.finalizing_context.session_id, head.ingress_id);

    database
      .prepare(
        [
          "UPDATE gateway_session_queue",
          "SET queue_position = queue_position - 1",
          "WHERE session_id = ? AND queue_position > ?",
        ].join(" "),
      )
      .run(input.finalizing_context.session_id, head.queue_position);

    const claimedNext = database
      .prepare(
        [
          "UPDATE gateway_sessions",
          "SET has_active_turn = 1, active_turn_ingress_id = ?, active_turn_claim_id = ?",
          "WHERE session_id = ?",
          "AND has_active_turn = 1",
          "AND active_turn_ingress_id = ?",
          "AND active_turn_claim_id = ?",
        ].join(" "),
      )
      .run(
        dequeuedIngress.ingress_id,
        nextAuthorityId,
        input.finalizing_context.session_id,
        input.authority.ingress_id,
        consumedClaimId,
      );

    if (claimedNext.changes !== 1) {
      rollbackTransaction(database);
      return Object.freeze({ kind: "no_release", reason: "stale_authority" });
    }

    const queueLength = selectQueueLength(
      database,
      input.finalizing_context.session_id,
    );

    const queueEvent = input.appendQueueDequeuedEvent({
      session_id: input.finalizing_context.session_id,
      ingress_id: dequeuedIngress.ingress_id,
      queue_length: queueLength,
    });

    input.finalizing_append_surface.append(queueEvent);

    database.exec("COMMIT");
    return Object.freeze({
      kind: "released_with_next",
      dequeued_ingress: dequeuedIngress,
      queue_dequeued_event: queueEvent,
      next_authority_id: nextAuthorityId,
      consume_authority: consumeAuthority,
    });
  } catch (error) {
    rollbackTransaction(database);
    throw error;
  }
}

function initializeSqliteSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS gateway_sessions (
      session_id TEXT PRIMARY KEY,
      has_active_turn INTEGER NOT NULL CHECK (has_active_turn IN (0, 1)),
      active_turn_ingress_id TEXT,
      active_turn_claim_id TEXT
    );

    CREATE TABLE IF NOT EXISTS gateway_session_routes (
      routing_key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      FOREIGN KEY (session_id) REFERENCES gateway_sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gateway_session_queue (
      session_id TEXT NOT NULL,
      queue_position INTEGER NOT NULL CHECK (queue_position >= 0),
      ingress_id TEXT NOT NULL,
      PRIMARY KEY (session_id, queue_position),
      UNIQUE (session_id, ingress_id),
      FOREIGN KEY (session_id) REFERENCES gateway_sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gateway_queued_ingress_payloads (
      session_id TEXT NOT NULL,
      ingress_id TEXT NOT NULL,
      ingress_json TEXT NOT NULL,
      PRIMARY KEY (session_id, ingress_id),
      FOREIGN KEY (session_id) REFERENCES gateway_sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gateway_finalizing_event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      kind TEXT NOT NULL
    );
  `);

  ensureGatewaySessionColumn(
    database,
    "active_turn_ingress_id",
    "ALTER TABLE gateway_sessions ADD COLUMN active_turn_ingress_id TEXT",
  );
  ensureGatewaySessionColumn(
    database,
    "active_turn_claim_id",
    "ALTER TABLE gateway_sessions ADD COLUMN active_turn_claim_id TEXT",
  );
}

function ensureGatewaySessionColumn(
  database: DatabaseSync,
  columnName: string,
  alterStatement: string,
): void {
  const columns = database.prepare("PRAGMA table_info(gateway_sessions)").all() as {
    name: string;
  }[];

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(alterStatement);
}

function createQueueDequeuedEvent(input: {
  readonly metadata: GatewayQueueEventMetadata;
  readonly session_id: string;
  readonly ingress_id: string;
  readonly queue_length: number;
}): GatewayDequeuedStreamEvent {
  const parsed = parseStreamEvent({
    event_id: input.metadata.event_id,
    session_id: input.session_id,
    scope: "session",
    sequence: input.metadata.sequence,
    kind: "queue.dequeued",
    timestamp: input.metadata.timestamp,
    visibility: input.metadata.visibility,
    payload: {
      session_id: input.session_id,
      ingress_id: input.ingress_id,
      queue_length: input.queue_length,
    },
  });

  if (parsed.scope !== "session" || parsed.kind !== "queue.dequeued") {
    throw new Error("Expected one canonical session-scoped queue.dequeued event.");
  }

  return parsed as GatewayDequeuedStreamEvent;
}

function selectQueuedIngressHead(
  database: DatabaseSync,
  sessionId: string,
): { queue_position: number; ingress_id: string } | undefined {
  return database
    .prepare(
      [
        "SELECT queue_position, ingress_id",
        "FROM gateway_session_queue",
        "WHERE session_id = ?",
        "ORDER BY queue_position ASC",
        "LIMIT 1",
      ].join(" "),
    )
    .get(sessionId) as { queue_position: number; ingress_id: string } | undefined;
}

function selectQueueLength(database: DatabaseSync, sessionId: string): number {
  const row = database
    .prepare(
      [
        "SELECT COUNT(*) AS queue_length",
        "FROM gateway_session_queue",
        "WHERE session_id = ?",
      ].join(" "),
    )
    .get(sessionId) as { queue_length: number };

  return row.queue_length;
}

function readQueuedIngressPayload(
  database: DatabaseSync,
  sessionId: string,
  ingressId: string,
): IngressDTO {
  const row = database
    .prepare(
      [
        "SELECT ingress_json",
        "FROM gateway_queued_ingress_payloads",
        "WHERE session_id = ? AND ingress_id = ?",
      ].join(" "),
    )
    .get(sessionId, ingressId) as { ingress_json: string } | undefined;

  if (!row) {
    throw new Error(
      `Missing queued ingress payload for session \"${sessionId}\" and ingress \"${ingressId}\".`,
    );
  }

  const parsedIngress = parseIngressDTO(JSON.parse(row.ingress_json) as IngressDTO);
  if (parsedIngress.session_id !== sessionId || parsedIngress.ingress_id !== ingressId) {
    throw new Error(
      `Queued ingress payload identity mismatch for session \"${sessionId}\" and ingress \"${ingressId}\".`,
    );
  }

  return parsedIngress;
}

function rollbackTransaction(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Ignore rollback failures when SQLite has already aborted the transaction.
  }
}
