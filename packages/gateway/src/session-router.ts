import { DatabaseSync } from "node:sqlite";

export interface GatewaySessionRoutingInput {
	readonly channel: string;
	readonly user_id: string;
}

export interface GatewayQueuedIngressReference {
	readonly ingress_id: string;
}

export interface GatewayResolvedSessionSnapshot {
	readonly has_active_turn: boolean;
	readonly queued_ingress_count: number;
	readonly queued_ingress: readonly GatewayQueuedIngressReference[];
}

export interface GatewayResolvedSession {
	readonly session_id: string;
	readonly session: GatewayResolvedSessionSnapshot;
}

export type GatewaySessionIdAllocator = () => string;

interface GatewayResolveByRoutingKeyInput {
	readonly routingKey: string;
	readonly allocateSessionId: GatewaySessionIdAllocator;
}

export type GatewaySessionResolver = (
	input: GatewayResolvePersistedSessionInput,
) => GatewayResolvedSession;

interface GatewayResolvePersistedSessionInput extends GatewaySessionRoutingInput {
	readonly allocateSessionId: GatewaySessionIdAllocator;
}

export interface ResolveSessionInput extends GatewayResolvePersistedSessionInput {
	readonly store: GatewaySessionResolver;
}

export interface CreateSqliteGatewaySessionRoutingStoreInput {
	readonly database: DatabaseSync;
}

export function resolveSession(input: ResolveSessionInput): GatewayResolvedSession {
	const resolved = input.store({
		channel: input.channel,
		user_id: input.user_id,
		allocateSessionId: input.allocateSessionId,
	});

	return detachResolvedSession(resolved);
}

export function createSqliteGatewaySessionRoutingStore(
	input: CreateSqliteGatewaySessionRoutingStoreInput,
): GatewaySessionResolver {
	initializeSqliteSchema(input.database);

	return Object.freeze(
		(resolveInput: GatewayResolvePersistedSessionInput) =>
			resolveSessionFromSqlite(input.database, {
				routingKey: deriveRoutingKey(resolveInput),
				allocateSessionId: resolveInput.allocateSessionId,
			}),
	);
}

function deriveRoutingKey(input: GatewaySessionRoutingInput): string {
	return JSON.stringify([input.channel, input.user_id]);
}

function detachResolvedSession(
	resolved: GatewayResolvedSession,
): GatewayResolvedSession {
	if (resolved.session.queued_ingress_count !== resolved.session.queued_ingress.length) {
		throw new Error(
			"Queued ingress count must match the number of queued ingress references.",
		);
	}

	const queuedIngress = Object.freeze(
		resolved.session.queued_ingress.map((queuedIngressRecord) =>
			Object.freeze({ ingress_id: queuedIngressRecord.ingress_id }),
		),
	) as readonly GatewayQueuedIngressReference[];

	return Object.freeze({
		session_id: resolved.session_id,
		session: Object.freeze({
			has_active_turn: resolved.session.has_active_turn,
			queued_ingress_count: queuedIngress.length,
			queued_ingress: queuedIngress,
		}),
	});
}

function initializeSqliteSchema(database: DatabaseSync): void {
	database.exec(`
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;

		CREATE TABLE IF NOT EXISTS gateway_sessions (
			session_id TEXT PRIMARY KEY,
			has_active_turn INTEGER NOT NULL CHECK (has_active_turn IN (0, 1))
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
	`);
}

function resolveSessionFromSqlite(
	database: DatabaseSync,
	input: GatewayResolveByRoutingKeyInput,
): GatewayResolvedSession {
	database.exec("BEGIN IMMEDIATE");

	try {
		const existingSessionId = selectSessionIdByRoutingKey(
			database,
			input.routingKey,
		);

		if (existingSessionId) {
			const resolved = readResolvedSession(database, existingSessionId);
			database.exec("COMMIT");
			return resolved;
		}

		const sessionId = input.allocateSessionId();
		insertSession(database, sessionId);
		insertRoutingKey(database, input.routingKey, sessionId);

		const resolved = readResolvedSession(database, sessionId);
		database.exec("COMMIT");
		return resolved;
	} catch (error) {
		rollbackTransaction(database);
		throw error;
	}
}

function selectSessionIdByRoutingKey(
	database: DatabaseSync,
	routingKey: string,
): string | undefined {
	const row = database
		.prepare(
			"SELECT session_id FROM gateway_session_routes WHERE routing_key = ?",
		)
		.get(routingKey) as { session_id: string } | undefined;

	return row?.session_id;
}

function insertSession(database: DatabaseSync, sessionId: string): void {
	database
		.prepare(
			"INSERT INTO gateway_sessions (session_id, has_active_turn) VALUES (?, 0)",
		)
		.run(sessionId);
}

function insertRoutingKey(
	database: DatabaseSync,
	routingKey: string,
	sessionId: string,
): void {
	database
		.prepare(
			"INSERT INTO gateway_session_routes (routing_key, session_id) VALUES (?, ?)",
		)
		.run(routingKey, sessionId);
}

function readResolvedSession(
	database: DatabaseSync,
	sessionId: string,
): GatewayResolvedSession {
	const sessionRow = database
		.prepare(
			"SELECT has_active_turn FROM gateway_sessions WHERE session_id = ?",
		)
		.get(sessionId) as { has_active_turn: number } | undefined;

	if (!sessionRow) {
		throw new Error(`Missing gateway session metadata for session "${sessionId}".`);
	}

	const queueRows = database
		.prepare(
			[
				"SELECT ingress_id",
				"FROM gateway_session_queue",
				"WHERE session_id = ?",
				"ORDER BY queue_position ASC",
			].join(" "),
		)
		.all(sessionId) as { ingress_id: string }[];

	const queuedIngress = Object.freeze(
		queueRows.map((row) => Object.freeze({ ingress_id: row.ingress_id })),
	) as readonly GatewayQueuedIngressReference[];

	return Object.freeze({
		session_id: sessionId,
		session: Object.freeze({
			has_active_turn: sessionRow.has_active_turn === 1,
			queued_ingress_count: queuedIngress.length,
			queued_ingress: queuedIngress,
		}),
	});
}

function rollbackTransaction(database: DatabaseSync): void {
	try {
		database.exec("ROLLBACK");
	} catch {
		// Ignore rollback failures when SQLite has already aborted the transaction.
	}
}