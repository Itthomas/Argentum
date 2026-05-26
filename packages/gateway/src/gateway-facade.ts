import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
	claimActiveTurn,
	createSqliteGatewayActiveTurnClaimStore,
	type GatewayActiveTurnClaimStore,
	type GatewayActiveTurnClaimResult,
} from "./active-turn-claim.js";
import {
	admitIngress,
	type GatewayAdmissionResult,
	type GatewayAcceptedAdmissionResult,
	type GatewayAdmissionSnapshot,
	type GatewayDefaults,
	type GatewayIngressInput,
} from "./ingress-admission.js";
import {
	createSqliteGatewayReleaseAndDequeueStore,
	releaseActiveTurnAndDequeue,
	type GatewayFinalizingEventAppendSurface,
	type GatewayFinalizingReleaseContext,
	type GatewayReleaseAndDequeueResult,
	type GatewayReleaseAndDequeueStore,
} from "./release-and-dequeue.js";
import {
	createSqliteGatewaySessionRoutingStore,
	resolveSession,
	type GatewaySessionResolver,
	type GatewayResolvedSession,
	type GatewaySessionRoutingInput,
} from "./session-router.js";
import {
	createGatewayTurnStartHandoffFromAcceptedAdmission,
	createTurnFromHandoff,
	type GatewayTurnCreatedResult,
	type GatewayTurnGovernorDefaults,
	type GatewayTurnStartHandoff,
} from "./turn-creation.js";
import {
	assertGatewayTelemetryEvent,
	createTurnSequenceCounter,
} from "./gateway-telemetry.js";

// ── GatewayConfig ───────────────────────────────────────────────

export interface GatewayConfig {
	/** Path to the SQLite database file for gateway state. */
	readonly dbPath: string;
	/** Governor defaults for turn creation budgets. */
	readonly governorDefaults: GatewayTurnGovernorDefaults;
	/** Gateway admission defaults (queue limits, overflow policy). */
	readonly gatewayDefaults: GatewayDefaults;
}

// ── Admit ingress simplified input ──────────────────────────────

export interface GatewayAdmitInput {
	readonly session_id: string;
	readonly ingress: GatewayIngressInput;
	readonly session: GatewayAdmissionSnapshot;
}

// ── Release simplified input ────────────────────────────────────

export interface GatewayReleaseInput {
	readonly authority: GatewayTurnStartHandoff["authority"];
	readonly finalizing_context: GatewayFinalizingReleaseContext;
}

// ── Gateway facade class ────────────────────────────────────────

/**
 * Facade over the gateway's standalone functions.
 *
 * Wraps SQLite store creation, ID allocators, and the full
 * session → admission → claim → handoff → turn → release pipeline
 * into a single injectable class.
 *
 * The composition root instantiates `new Gateway(config)` instead
 * of calling 5+ standalone functions directly.
 */
export class Gateway {
	readonly #database: DatabaseSync;
	readonly #sessionStore: GatewaySessionResolver;
	readonly #claimStore: GatewayActiveTurnClaimStore;
	readonly #releaseStore: GatewayReleaseAndDequeueStore;
	readonly #governorDefaults: GatewayTurnGovernorDefaults;
	readonly #gatewayDefaults: GatewayDefaults;

	constructor(config: GatewayConfig) {
		this.#database = new DatabaseSync(config.dbPath);
		this.#sessionStore = createSqliteGatewaySessionRoutingStore({
			database: this.#database,
		});
		this.#claimStore = createSqliteGatewayActiveTurnClaimStore({
			database: this.#database,
		});
		this.#releaseStore = createSqliteGatewayReleaseAndDequeueStore({
			database: this.#database,
		});
		this.#governorDefaults = config.governorDefaults;
		this.#gatewayDefaults = config.gatewayDefaults;
	}

	// ── Session resolution ─────────────────────────────────────

	/**
	 * Resolve (or create) a session for the given channel + user pair.
	 *
	 * Delegates to {@link resolveSession}, wiring the internal
	 * session-routing store and a crypto-random session ID allocator.
	 */
	resolveSession(
		input: GatewaySessionRoutingInput,
	): GatewayResolvedSession {
		return resolveSession({
			channel: input.channel,
			user_id: input.user_id,
			store: this.#sessionStore,
			allocateSessionId: () => randomUUID(),
		});
	}

	// ── Ingress admission ─────────────────────────────────────

	/**
	 * Admit an ingress payload against a resolved session snapshot.
	 *
	 * Delegates to {@link admitIngress}, wiring internal gateway
	 * defaults, a crypto-random ingress ID allocator, and a
	 * crypto-random queue-event-metadata allocator.
	 */
	admitIngress(input: GatewayAdmitInput): GatewayAdmissionResult {
		const result = admitIngress({
			gatewayDefaults: this.#gatewayDefaults,
			session_id: input.session_id,
			ingress: input.ingress,
			session: input.session,
			allocateIngressId: () => randomUUID(),
			allocateQueueEventMetadata: () => ({
				event_id: randomUUID(),
				sequence: 0,
				timestamp: new Date().toISOString(),
				visibility: "system" as const,
			}),
		});

		if (result.disposition === "queued" || result.disposition === "rejected") {
			assertGatewayTelemetryEvent(result.queue_event, {
				session_id: result.ingress.session_id,
			});
		}

		return result;
	}

	// ── Active turn claim ─────────────────────────────────────

	/**
	 * Claim the active-turn slot for an accepted admission.
	 *
	 * Delegates to {@link claimActiveTurn}, wiring the internal
	 * active-turn claim store and a crypto-random authority ID
	 * allocator.
	 */
	claimActiveTurn(
		admission: GatewayAcceptedAdmissionResult,
	): GatewayActiveTurnClaimResult {
		return claimActiveTurn({
			admission,
			store: this.#claimStore,
			allocateAuthorityId: () => randomUUID(),
		});
	}

	// ── Turn start handoff ────────────────────────────────────

	/**
	 * Create a turn-start handoff from an accepted admission +
	 * exclusive turn-creation authority.
	 *
	 * Pure delegation to
	 * {@link createGatewayTurnStartHandoffFromAcceptedAdmission}.
	 */
	createTurnStartHandoff(input: {
		readonly admission: GatewayAcceptedAdmissionResult;
		readonly authority: GatewayTurnStartHandoff["authority"];
	}): GatewayTurnStartHandoff {
		return createGatewayTurnStartHandoffFromAcceptedAdmission({
			admission: input.admission,
			authority: input.authority,
		});
	}

	// ── Turn creation ─────────────────────────────────────────

	/**
	 * Create a `TurnEnvelope` from a turn-start handoff.
	 *
	 * Delegates to {@link createTurnFromHandoff}, wiring internal
	 * governor defaults, a turn-scoped sequence counter, and
	 * crypto-random metadata allocators.
	 */
	createTurnFromHandoff(
		handoff: GatewayTurnStartHandoff,
	): GatewayTurnCreatedResult {
		const counter = createTurnSequenceCounter();

		const result = createTurnFromHandoff({
			handoff,
			governorDefaults: this.#governorDefaults,
			allocateTurnMetadata: () => ({
				turn_id: randomUUID(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			}),
			allocateTurnEventMetadata: () => ({
				event_id: randomUUID(),
				sequence: counter.nextSequence(),
				timestamp: new Date().toISOString(),
				visibility: "system" as const,
			}),
		});

		assertGatewayTelemetryEvent(result.turn_started_event, {
			session_id: handoff.session_id,
			turn_id: result.turn.turn_id,
		});

		return result;
	}

	// ── Release & dequeue ─────────────────────────────────────

	/**
	 * Release the active turn and dequeue the next ingress (if any).
	 *
	 * Delegates to {@link releaseActiveTurnAndDequeue}, wiring the
	 * internal release-and-dequeue store, crypto-random allocators,
	 * and a no-op finalizing append surface.
	 */
	releaseActiveTurnAndDequeue(
		input: GatewayReleaseInput,
	): GatewayReleaseAndDequeueResult {
		const finalizingAppendSurface: GatewayFinalizingEventAppendSurface = {
			append: () => {
				// MVP: no-op durable-event-log append.
			},
		};

		const result = releaseActiveTurnAndDequeue({
			authority: input.authority,
			finalizing_context: input.finalizing_context,
			store: this.#releaseStore,
			allocateQueueEventMetadata: () => ({
				event_id: randomUUID(),
				sequence: 0,
				timestamp: new Date().toISOString(),
				visibility: "system" as const,
			}),
			allocateNextAuthorityId: () => randomUUID(),
			finalizing_append_surface: finalizingAppendSurface,
		});

		if (result.kind === "released_with_next") {
			assertGatewayTelemetryEvent(result.queue_dequeued_event, {
				session_id: input.finalizing_context.session_id,
			});
		}

		return result;
	}

	/**
	 * Close the underlying SQLite database connection.
	 *
	 * Call during shutdown to release OS resources.
	 */
	close(): void {
		this.#database.close();
	}
}
