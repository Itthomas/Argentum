import { DatabaseSync } from "node:sqlite";

import type { IngressDTO } from "@argentum/contracts";

import {
	isGatewayAcceptedAdmissionResult,
	type GatewayAcceptedAdmissionResult,
} from "./ingress-admission.js";

const gatewayExclusiveTurnCreationAuthorityBrand = Symbol(
	"gateway.exclusive-turn-creation-authority",
);
const gatewayTurnCreationAuthorityConsumerBrand = Symbol(
	"gateway.turn-creation-authority-consumer",
);

export interface GatewayExclusiveTurnCreationAuthority {
	readonly authority_id: string;
	readonly session_id: string;
	readonly ingress_id: string;
}

export interface GatewayClaimPreservationHandoff {
	readonly ingress: IngressDTO;
	readonly session_id: string;
	readonly ingress_id: string;
	readonly reason: "active_turn_conflict";
}

export interface GatewayAuthorityGrantedResult {
	readonly kind: "authority_granted";
	readonly authority: GatewayExclusiveTurnCreationAuthority;
}

export interface GatewayPreserveIngressResult {
	readonly kind: "preserve_ingress";
	readonly handoff: GatewayClaimPreservationHandoff;
}

export interface GatewayNoAuthorityResult {
	readonly kind: "no_authority";
	readonly reason: "duplicate_claim" | "invalid_request";
}

export type GatewayActiveTurnClaimResult =
	| GatewayAuthorityGrantedResult
	| GatewayPreserveIngressResult
	| GatewayNoAuthorityResult;

export type GatewayTurnClaimAuthorityIdAllocator = () => string;

export interface GatewayAuthorityConsumedResult {
	readonly kind: "authority_consumed";
}

export interface GatewayStaleAuthorityResult {
	readonly kind: "no_authority";
	readonly reason: "stale_authority" | "invalid_request";
}

export type GatewayTurnCreationAuthorityConsumptionResult =
	| GatewayAuthorityConsumedResult
	| GatewayStaleAuthorityResult;

export type GatewayTurnCreationAuthorityConsumer = (
	authority: GatewayExclusiveTurnCreationAuthority,
) => GatewayTurnCreationAuthorityConsumptionResult;

export interface GatewayClaimActiveTurnStoreInput {
	readonly session_id: string;
	readonly ingress_id: string;
	readonly allocateAuthorityId: GatewayTurnClaimAuthorityIdAllocator;
}

interface GatewayClaimedAuthorityStoreResult {
	readonly kind: "claimed";
	readonly authority_id: string;
	readonly consume_authority: GatewayTurnCreationAuthorityConsumer;
}

interface GatewayPreserveIngressStoreResult {
	readonly kind: "preserve";
}

interface GatewayNoAuthorityStoreResult {
	readonly kind: "no_authority";
	readonly reason: GatewayNoAuthorityResult["reason"];
}

type GatewayActiveTurnClaimStoreResult =
	| GatewayClaimedAuthorityStoreResult
	| GatewayPreserveIngressStoreResult
	| GatewayNoAuthorityStoreResult;

export type GatewayActiveTurnClaimStore = (
	input: GatewayClaimActiveTurnStoreInput,
) => GatewayActiveTurnClaimStoreResult;

export interface ClaimActiveTurnInput {
	readonly admission: GatewayAcceptedAdmissionResult;
	readonly store: GatewayActiveTurnClaimStore;
	readonly allocateAuthorityId: GatewayTurnClaimAuthorityIdAllocator;
}

export interface CreateSqliteGatewayActiveTurnClaimStoreInput {
	readonly database: DatabaseSync;
}

interface GatewayActiveTurnSessionRow {
	readonly has_active_turn: number;
	readonly active_turn_ingress_id: string | null;
	readonly active_turn_claim_id: string | null;
}

export function claimActiveTurn(
	input: ClaimActiveTurnInput,
): GatewayActiveTurnClaimResult {
	if (!isGatewayAcceptedAdmissionResult(input.admission)) {
		return Object.freeze({
			kind: "no_authority",
			reason: "invalid_request",
		});
	}

	const storeResult = input.store({
		session_id: input.admission.ingress.session_id,
		ingress_id: input.admission.ingress.ingress_id,
		allocateAuthorityId: input.allocateAuthorityId,
	});

	if (storeResult.kind === "claimed") {
		const authority = createGatewayExclusiveTurnCreationAuthority({
			authority_id: storeResult.authority_id,
			session_id: input.admission.ingress.session_id,
			ingress_id: input.admission.ingress.ingress_id,
			consume_authority: storeResult.consume_authority,
		});

		return Object.freeze({
			kind: "authority_granted",
			authority: Object.freeze(authority),
		});
	}

	if (storeResult.kind === "preserve") {
		return Object.freeze({
			kind: "preserve_ingress",
			handoff: Object.freeze({
				ingress: input.admission.ingress,
				session_id: input.admission.ingress.session_id,
				ingress_id: input.admission.ingress.ingress_id,
				reason: "active_turn_conflict",
			}),
		});
	}

	return Object.freeze({
		kind: "no_authority",
		reason: storeResult.reason,
	});
}

export function createSqliteGatewayActiveTurnClaimStore(
	input: CreateSqliteGatewayActiveTurnClaimStoreInput,
): GatewayActiveTurnClaimStore {
	const consumeAuthority = createSqliteGatewayTurnCreationAuthorityConsumer(input);

	return Object.freeze((claimInput: GatewayClaimActiveTurnStoreInput) =>
		claimActiveTurnInSqlite(input.database, claimInput, consumeAuthority),
	);
}

export interface CreateSqliteGatewayTurnCreationAuthorityConsumerInput {
	readonly database: DatabaseSync;
}

export function createSqliteGatewayTurnCreationAuthorityConsumer(
	input: CreateSqliteGatewayTurnCreationAuthorityConsumerInput,
): GatewayTurnCreationAuthorityConsumer {
	initializeSqliteSchema(input.database);
	return Object.freeze((authority: GatewayExclusiveTurnCreationAuthority) =>
		consumeTurnCreationAuthorityInSqlite(input.database, authority),
	);
}

export interface CreateGatewayExclusiveTurnCreationAuthorityInput {
	readonly authority_id: string;
	readonly session_id: string;
	readonly ingress_id: string;
	readonly consume_authority: GatewayTurnCreationAuthorityConsumer;
}

export function createGatewayExclusiveTurnCreationAuthority(
	input: CreateGatewayExclusiveTurnCreationAuthorityInput,
): GatewayExclusiveTurnCreationAuthority {
	const authority = {
		authority_id: input.authority_id,
		session_id: input.session_id,
		ingress_id: input.ingress_id,
	} satisfies GatewayExclusiveTurnCreationAuthority;

	Object.defineProperty(authority, gatewayExclusiveTurnCreationAuthorityBrand, {
		value: true,
	});
	Object.defineProperty(authority, gatewayTurnCreationAuthorityConsumerBrand, {
		value: input.consume_authority,
	});

	return Object.freeze(authority);
}

export function toConsumedGatewayTurnClaimId(authorityId: string): string {
	return createConsumedClaimId(authorityId);
}

export function isGatewayExclusiveTurnCreationAuthority(
	value: unknown,
): value is GatewayExclusiveTurnCreationAuthority {
	if (value === null || typeof value !== "object") {
		return false;
	}

	const candidate = value as GatewayExclusiveTurnCreationAuthority & {
		readonly [gatewayExclusiveTurnCreationAuthorityBrand]?: boolean;
	};

	return (
		candidate[gatewayExclusiveTurnCreationAuthorityBrand] === true &&
		typeof candidate.authority_id === "string" &&
		typeof candidate.session_id === "string" &&
		typeof candidate.ingress_id === "string"
	);
}

export function canConsumeGatewayTurnCreationAuthority(
	value: unknown,
): value is GatewayExclusiveTurnCreationAuthority {
	if (!isGatewayExclusiveTurnCreationAuthority(value)) {
		return false;
	}

	const candidate = value as GatewayExclusiveTurnCreationAuthority & {
		readonly [gatewayTurnCreationAuthorityConsumerBrand]?: GatewayTurnCreationAuthorityConsumer;
	};

	return typeof candidate[gatewayTurnCreationAuthorityConsumerBrand] === "function";
}

export function consumeGatewayTurnCreationAuthority(
	authority: GatewayExclusiveTurnCreationAuthority,
): GatewayTurnCreationAuthorityConsumptionResult {
	if (!canConsumeGatewayTurnCreationAuthority(authority)) {
		return Object.freeze({ kind: "no_authority", reason: "invalid_request" });
	}

	const candidate = authority as GatewayExclusiveTurnCreationAuthority & {
		readonly [gatewayTurnCreationAuthorityConsumerBrand]: GatewayTurnCreationAuthorityConsumer;
	};

	return candidate[gatewayTurnCreationAuthorityConsumerBrand](authority);
}

export interface ConsumeGatewayTurnCreationAuthorityInCurrentTransactionInput {
	readonly database: DatabaseSync;
	readonly authority: GatewayExclusiveTurnCreationAuthority;
}

export function consumeGatewayTurnCreationAuthorityInCurrentTransaction(
	input: ConsumeGatewayTurnCreationAuthorityInCurrentTransactionInput,
): GatewayTurnCreationAuthorityConsumptionResult {
	if (!isGatewayExclusiveTurnCreationAuthority(input.authority)) {
		return Object.freeze({ kind: "no_authority", reason: "invalid_request" });
	}

	const sessionRow = selectSessionRow(input.database, input.authority.session_id);
	assertSessionClaimState(input.authority.session_id, sessionRow);

	if (
		sessionRow.has_active_turn !== 1 ||
		sessionRow.active_turn_ingress_id !== input.authority.ingress_id
	) {
		return Object.freeze({ kind: "no_authority", reason: "stale_authority" });
	}

	const consumedClaimId = createConsumedClaimId(input.authority.authority_id);

	if (sessionRow.active_turn_claim_id === consumedClaimId) {
		// Idempotent success for retry-safe release paths within the same active turn.
		return Object.freeze({ kind: "authority_consumed" });
	}

	if (sessionRow.active_turn_claim_id !== input.authority.authority_id) {
		return Object.freeze({ kind: "no_authority", reason: "stale_authority" });
	}

	const updateResult = input.database
		.prepare(
			[
				"UPDATE gateway_sessions",
				"SET active_turn_claim_id = ?",
				"WHERE session_id = ?",
				"AND has_active_turn = 1",
				"AND active_turn_ingress_id = ?",
				"AND active_turn_claim_id = ?",
			].join(" "),
		)
		.run(
			consumedClaimId,
			input.authority.session_id,
			input.authority.ingress_id,
			input.authority.authority_id,
		);

	if (updateResult.changes !== 1) {
		return Object.freeze({ kind: "no_authority", reason: "stale_authority" });
	}

	return Object.freeze({ kind: "authority_consumed" });
}

function claimActiveTurnInSqlite(
	database: DatabaseSync,
	input: GatewayClaimActiveTurnStoreInput,
 	consumeAuthority: GatewayTurnCreationAuthorityConsumer,
): GatewayActiveTurnClaimStoreResult {
	database.exec("BEGIN IMMEDIATE");

	try {
		if (hasClaimedIngress(database, input.ingress_id, input.session_id)) {
			database.exec("COMMIT");
			return Object.freeze({ kind: "no_authority", reason: "duplicate_claim" });
		}

		const initialRow = selectSessionRow(database, input.session_id);
		assertSessionClaimState(input.session_id, initialRow);

		if (initialRow.has_active_turn === 0) {
			const authorityId = input.allocateAuthorityId();
			const claimResult = database
				.prepare(
					[
						"UPDATE gateway_sessions",
						"SET has_active_turn = 1, active_turn_ingress_id = ?, active_turn_claim_id = ?",
						"WHERE session_id = ?",
						"AND has_active_turn = 0",
						"AND active_turn_ingress_id IS NULL",
						"AND active_turn_claim_id IS NULL",
					].join(" "),
				)
				.run(input.ingress_id, authorityId, input.session_id);

			if (claimResult.changes === 1) {
				recordClaimedIngress(database, input.ingress_id, input.session_id);
				database.exec("COMMIT");
				return Object.freeze({
					kind: "claimed",
					authority_id: authorityId,
					consume_authority: consumeAuthority,
				});
			}
		}

		const settledRow = selectSessionRow(database, input.session_id);
		assertSessionClaimState(input.session_id, settledRow);
		const conflictResult = deriveConflictResult(settledRow, input.ingress_id);
		database.exec("COMMIT");
		return conflictResult;
	} catch (error) {
		rollbackTransaction(database);
		throw error;
	}
}

function selectSessionRow(
	database: DatabaseSync,
	sessionId: string,
): GatewayActiveTurnSessionRow {
	const row = database
		.prepare(
			[
				"SELECT has_active_turn, active_turn_ingress_id, active_turn_claim_id",
				"FROM gateway_sessions",
				"WHERE session_id = ?",
			].join(" "),
		)
		.get(sessionId) as GatewayActiveTurnSessionRow | undefined;

	if (!row) {
		throw new Error(`Missing gateway session metadata for session "${sessionId}".`);
	}

	return row;
	}

function assertSessionClaimState(
	sessionId: string,
	row: GatewayActiveTurnSessionRow,
): void {
	if (
		row.has_active_turn === 0 &&
		(row.active_turn_ingress_id !== null || row.active_turn_claim_id !== null)
	) {
		throw new Error(
			`Inactive gateway session "${sessionId}" cannot retain active-turn claim fields.`,
		);
	}

	if (
		row.has_active_turn === 1 &&
		(
			typeof row.active_turn_ingress_id !== "string" ||
			typeof row.active_turn_claim_id !== "string"
		)
	) {
		throw new Error(
			`Active gateway session "${sessionId}" must retain one ingress id and claim id.`,
		);
	}
	}

function deriveConflictResult(
	row: GatewayActiveTurnSessionRow,
	ingressId: string,
): GatewayActiveTurnClaimStoreResult {
	if (row.has_active_turn !== 1) {
		return Object.freeze({ kind: "no_authority", reason: "invalid_request" });
	}

	if (row.active_turn_ingress_id === ingressId) {
		return Object.freeze({ kind: "no_authority", reason: "duplicate_claim" });
	}

	return Object.freeze({ kind: "preserve" });
}

function rollbackTransaction(database: DatabaseSync): void {
	try {
		database.exec("ROLLBACK");
	} catch {
		// Ignore rollback failures when SQLite has already aborted the transaction.
	}
}

function consumeTurnCreationAuthorityInSqlite(
	database: DatabaseSync,
	authority: GatewayExclusiveTurnCreationAuthority,
): GatewayTurnCreationAuthorityConsumptionResult {
	database.exec("BEGIN IMMEDIATE");

	try {
		const result = consumeGatewayTurnCreationAuthorityInCurrentTransaction({
			database,
			authority,
		});

		database.exec("COMMIT");
		return result;
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

		CREATE TABLE IF NOT EXISTS gateway_claimed_ingress (
			ingress_id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			FOREIGN KEY (session_id) REFERENCES gateway_sessions(session_id) ON DELETE CASCADE
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

function hasClaimedIngress(
	database: DatabaseSync,
	ingressId: string,
	sessionId: string,
): boolean {
	const row = database
		.prepare(
			[
				"SELECT session_id FROM gateway_claimed_ingress",
				"WHERE ingress_id = ?",
			].join(" "),
		)
		.get(ingressId) as { session_id: string } | undefined;

	if (!row) {
		return false;
	}

	if (row.session_id !== sessionId) {
		throw new Error(
			`Claimed ingress \"${ingressId}\" is bound to a different session than \"${sessionId}\".`,
		);
	}

	return true;
}

function recordClaimedIngress(
	database: DatabaseSync,
	ingressId: string,
	sessionId: string,
): void {
	database
		.prepare(
			[
				"INSERT INTO gateway_claimed_ingress (ingress_id, session_id)",
				"VALUES (?, ?)",
			].join(" "),
		)
		.run(ingressId, sessionId);
}

function createConsumedClaimId(authorityId: string): string {
	return `consumed:${authorityId}`;
}