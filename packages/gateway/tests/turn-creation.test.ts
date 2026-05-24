import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
	parseIngressDTO,
	parseMessagePart,
	parseStreamEvent,
	parseTurnEnvelope,
} from "@argentum/contracts";
import { describe, expect, it, vi } from "vitest";

import {
	admitIngress,
	claimActiveTurn,
	createGatewayTurnStartHandoff,
	createGatewayTurnStartHandoffFromAcceptedAdmission,
	createSqliteGatewayActiveTurnClaimStore,
	createSqliteGatewaySessionRoutingStore,
	createTurnFromHandoff,
	resolveSession,
	type GatewayAcceptedAdmissionResult,
	type GatewayAuthorityGrantedResult,
} from "../src/index.js";

describe("createTurnFromHandoff", () => {
	it("creates one canonical turn envelope and one turn.started event from an accepted-admission handoff", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-turn-started",
				ingressId: "ingress-turn-started",
				channel: "terminal_cli",
				userId: "user-turn-started",
			});
			const authority = createGrantedAuthority(harness, acceptedAdmission, "authority-turn-started");
			const handoff = createGatewayTurnStartHandoffFromAcceptedAdmission({
				admission: acceptedAdmission,
				authority,
			});

			const result = createTurnFromHandoff({
				handoff,
				governorDefaults: makeGovernorDefaults({
					max_inference_steps: 17,
					max_repair_attempts: 4,
					max_wall_clock_ms: 610000,
				}),
				allocateTurnMetadata: () => ({
					turn_id: "turn-started-1",
					created_at: "2026-05-23T10:00:01Z",
					updated_at: "2026-05-23T10:00:01Z",
				}),
				allocateTurnEventMetadata: () => ({
					event_id: "event-turn-started-1",
					sequence: 1,
					timestamp: "2026-05-23T10:00:02Z",
					visibility: "telemetry",
				}),
			});

			expect(result.turn).toEqual(
				parseTurnEnvelope({
					turn_id: "turn-started-1",
					session_id: "session-turn-started",
					ingress_id: "ingress-turn-started",
					state: "accepted",
					step_count: 0,
					budget: {
						max_inference_steps: 17,
						max_repair_attempts: 4,
						max_wall_clock_ms: 610000,
						repair_attempts_used: 0,
					},
					context_refs: [],
					compaction_revision: 0,
					created_at: "2026-05-23T10:00:01Z",
					updated_at: "2026-05-23T10:00:01Z",
				}),
			);
			expect(parseStreamEvent(result.turn_started_event)).toEqual(result.turn_started_event);
			expect(result.turn_started_event).toEqual({
				event_id: "event-turn-started-1",
				session_id: "session-turn-started",
				scope: "turn",
				turn_id: "turn-started-1",
				sequence: 1,
				kind: "turn.started",
				timestamp: "2026-05-23T10:00:02Z",
				visibility: "telemetry",
				payload: {
					session_id: "session-turn-started",
					ingress_id: "ingress-turn-started",
					state: "accepted",
				},
			});
			expect(Object.isFrozen(result)).toBe(true);
			expect(Object.isFrozen(result.turn)).toBe(true);
			expect(Object.isFrozen(result.turn_started_event)).toBe(true);
			expect(Object.isFrozen(result.turn_started_event.payload)).toBe(true);
			expect(result).not.toHaveProperty("queue_event");
			expect(result).not.toHaveProperty("queue_mutation");
		} finally {
			harness.cleanup();
		}
	});

	it("rejects forged turn-start handoffs so bare ingress and detached authority cannot create a turn", () => {
		const allocateTurnMetadata = vi.fn(() => ({
			turn_id: "turn-forged",
			created_at: "2026-05-23T10:10:01Z",
			updated_at: "2026-05-23T10:10:01Z",
		}));
		const allocateTurnEventMetadata = vi.fn(() => ({
			event_id: "event-forged",
			sequence: 2,
			timestamp: "2026-05-23T10:10:02Z",
			visibility: "telemetry" as const,
		}));

		expect(() =>
			createTurnFromHandoff({
				handoff: {
					ingress: parseIngressDTO({
						ingress_id: "ingress-forged",
						session_id: "session-forged",
						...makeIngressInput(),
					}),
					authority: {
						authority_id: "authority-forged",
						session_id: "session-forged",
						ingress_id: "ingress-forged",
					},
					session_id: "session-forged",
					ingress_id: "ingress-forged",
				} as unknown as Parameters<typeof createTurnFromHandoff>[0]["handoff"],
				governorDefaults: makeGovernorDefaults(),
				allocateTurnMetadata,
				allocateTurnEventMetadata,
			}),
		).toThrow("Turn creation requires a gateway turn-start handoff created by the gateway.");
		expect(allocateTurnMetadata).not.toHaveBeenCalled();
		expect(allocateTurnEventMetadata).not.toHaveBeenCalled();
	});

	it("rejects queued and rejected admission outcomes when building a turn-start handoff from admission", () => {
		const consumeAuthority = vi.fn(() => ({ kind: "authority_consumed" as const }));
		const queuedAdmission = admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 2 }),
			session_id: "session-queued-outcome",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-queued-outcome",
			session: Object.freeze({
				has_active_turn: true,
				queued_ingress: Object.freeze([{ ingress_id: "ingress-earlier" }]),
			}),
			allocateQueueEventMetadata: () => makeQueueEventMetadata(),
		});
		const rejectedAdmission = admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 0 }),
			session_id: "session-rejected-outcome",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-rejected-outcome",
			session: Object.freeze({
				has_active_turn: true,
				queued_ingress: Object.freeze([]),
			}),
			allocateQueueEventMetadata: () => makeQueueEventMetadata(),
		});

		expect(() =>
			createGatewayTurnStartHandoffFromAcceptedAdmission({
				admission: queuedAdmission as unknown as GatewayAcceptedAdmissionResult,
				authority: buildForgedAuthority(),
			}),
		).toThrow("Gateway turn-start handoff requires the accepted admission branch.");
		expect(() =>
			createGatewayTurnStartHandoffFromAcceptedAdmission({
				admission: rejectedAdmission as unknown as GatewayAcceptedAdmissionResult,
				authority: buildForgedAuthority(),
			}),
		).toThrow("Gateway turn-start handoff requires the accepted admission branch.");
		expect(consumeAuthority).not.toHaveBeenCalled();
	});

	it("rejects missing or unbranded authority when building the shared turn-start handoff", () => {
		const canonicalIngress = parseIngressDTO({
			ingress_id: "ingress-missing-authority",
			session_id: "session-missing-authority",
			...makeIngressInput(),
		});

		expect(() =>
			createGatewayTurnStartHandoff({
				ingress: canonicalIngress,
				authority: buildForgedAuthority(),
			}),
		).toThrow(
			"Gateway turn-start handoff requires branded exclusive turn-creation authority.",
		);
	});

	it("rejects mismatched exclusive authority when building the shared turn-start handoff", () => {
		const harness = createGatewayHarness();

		try {
			const sessionOneAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-match-a",
				ingressId: "ingress-match-a",
				channel: "terminal_cli",
				userId: "user-match-a",
			});
			const sessionTwoAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-match-b",
				ingressId: "ingress-match-b",
				channel: "terminal_cli",
				userId: "user-match-b",
			});
			const otherAuthority = createGrantedAuthority(
				harness,
				sessionTwoAdmission,
				"authority-match-b",
			);

			expect(() =>
				createGatewayTurnStartHandoffFromAcceptedAdmission({
					admission: sessionOneAdmission,
					authority: otherAuthority,
				}),
			).toThrow("Gateway turn-start handoff authority must match the ingress session_id.");
		} finally {
			harness.cleanup();
		}
	});

	it("reuses the same shared handoff contract for a promoted canonical ingress without requiring an admission object", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-promoted",
				ingressId: "ingress-promoted",
				channel: "terminal_cli",
				userId: "user-promoted",
			});
			const authority = createGrantedAuthority(harness, acceptedAdmission, "authority-promoted");
			const promotedIngress = parseIngressDTO({
				ingress_id: acceptedAdmission.ingress.ingress_id,
				session_id: acceptedAdmission.ingress.session_id,
				channel: acceptedAdmission.ingress.channel,
				user_id: acceptedAdmission.ingress.user_id,
				message_parts: acceptedAdmission.ingress.message_parts,
				received_at: acceptedAdmission.ingress.received_at,
				metadata: acceptedAdmission.ingress.metadata,
			});
			const handoff = createGatewayTurnStartHandoff({
				ingress: promotedIngress,
				authority,
			});

			const result = createTurnFromHandoff({
				handoff,
				governorDefaults: makeGovernorDefaults(),
				allocateTurnMetadata: () => ({
					turn_id: "turn-promoted",
					created_at: "2026-05-23T10:20:01Z",
					updated_at: "2026-05-23T10:20:01Z",
				}),
				allocateTurnEventMetadata: () => ({
					event_id: "event-promoted",
					sequence: 4,
					timestamp: "2026-05-23T10:20:02Z",
					visibility: "system",
				}),
			});

			expect(result.turn.session_id).toBe("session-promoted");
			expect(result.turn.ingress_id).toBe("ingress-promoted");
			expect(result.turn.state).toBe("accepted");
			expect(result.turn_started_event.payload).toEqual({
				session_id: "session-promoted",
				ingress_id: "ingress-promoted",
				state: "accepted",
			});
		} finally {
			harness.cleanup();
		}
	});

	it("rejects duplicate authority reuse so one turn-start handoff cannot create overlapping turns", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-duplicate-turn",
				ingressId: "ingress-duplicate-turn",
				channel: "terminal_cli",
				userId: "user-duplicate-turn",
			});
			const authority = createGrantedAuthority(
				harness,
				acceptedAdmission,
				"authority-duplicate-turn",
			);
			const handoff = createGatewayTurnStartHandoffFromAcceptedAdmission({
				admission: acceptedAdmission,
				authority,
			});
			const allocateTurnMetadata = vi
				.fn()
				.mockReturnValueOnce({
					turn_id: "turn-duplicate-first",
					created_at: "2026-05-23T10:30:01Z",
					updated_at: "2026-05-23T10:30:01Z",
				})
				.mockReturnValueOnce({
					turn_id: "turn-duplicate-second",
					created_at: "2026-05-23T10:30:03Z",
					updated_at: "2026-05-23T10:30:03Z",
				});
			const allocateTurnEventMetadata = vi
				.fn()
				.mockReturnValueOnce({
					event_id: "event-duplicate-first",
					sequence: 9,
					timestamp: "2026-05-23T10:30:02Z",
					visibility: "telemetry",
				})
				.mockReturnValueOnce({
					event_id: "event-duplicate-second",
					sequence: 10,
					timestamp: "2026-05-23T10:30:04Z",
					visibility: "telemetry",
				});

			createTurnFromHandoff({
				handoff,
				governorDefaults: makeGovernorDefaults(),
				allocateTurnMetadata,
				allocateTurnEventMetadata,
			});

			expect(() =>
				createTurnFromHandoff({
					handoff,
					governorDefaults: makeGovernorDefaults(),
					allocateTurnMetadata,
					allocateTurnEventMetadata,
				}),
			).toThrow(
				"Turn creation authority is stale or no longer current for the active session turn.",
			);
			expect(allocateTurnMetadata).toHaveBeenCalledTimes(1);
			expect(allocateTurnEventMetadata).toHaveBeenCalledTimes(1);
		} finally {
			harness.cleanup();
		}
	});

	it("does not mutate active-turn lock state while creating turn artifacts", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-lock-state",
				ingressId: "ingress-lock-state",
				channel: "terminal_cli",
				userId: "user-lock-state",
			});
			const authority = createGrantedAuthority(harness, acceptedAdmission, "authority-lock-state");
			const handoff = createGatewayTurnStartHandoffFromAcceptedAdmission({
				admission: acceptedAdmission,
				authority,
			});
			const before = readSessionClaimState(harness.database, "session-lock-state");

			createTurnFromHandoff({
				handoff,
				governorDefaults: makeGovernorDefaults(),
				allocateTurnMetadata: () => ({
					turn_id: "turn-lock-state",
					created_at: "2026-05-23T10:40:01Z",
					updated_at: "2026-05-23T10:40:01Z",
				}),
				allocateTurnEventMetadata: () => ({
					event_id: "event-lock-state",
					sequence: 12,
					timestamp: "2026-05-23T10:40:02Z",
					visibility: "telemetry",
				}),
			});

			const after = readSessionClaimState(harness.database, "session-lock-state");
			expect(after).toEqual(before);
		} finally {
			harness.cleanup();
		}
	});
});

function createGatewayHarness() {
	const directory = createTempDirectory();
	const database = new DatabaseSync(join(directory, "gateway-turn-creation.sqlite"));
	const routingStore = createSqliteGatewaySessionRoutingStore({ database });
	const claimStore = createSqliteGatewayActiveTurnClaimStore({ database });

	return {
		database,
		routingStore,
		claimStore,
		cleanup: () => {
			database.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

function createAcceptedAdmission(
	harness: {
		routingStore: ReturnType<typeof createSqliteGatewaySessionRoutingStore>;
	},
	input: {
		sessionId: string;
		ingressId: string;
		channel: string;
		userId: string;
	},
): GatewayAcceptedAdmissionResult {
	const resolved = resolveSession({
		channel: input.channel,
		user_id: input.userId,
		allocateSessionId: () => input.sessionId,
		store: harness.routingStore,
	});

	const admission = admitIngress({
		gatewayDefaults: makeGatewayDefaults(),
		session_id: resolved.session_id,
		ingress: makeIngressInput({
			channel: input.channel,
			user_id: input.userId,
		}),
		allocateIngressId: () => input.ingressId,
		session: Object.freeze({
			has_active_turn: false,
			queued_ingress: Object.freeze([]),
		}),
		allocateQueueEventMetadata: () => makeQueueEventMetadata(),
	});

	if (admission.disposition !== "accepted") {
		throw new Error("Expected a gateway-branded accepted admission.");
	}

	return admission;
}

function createGrantedAuthority(
	harness: {
		claimStore: ReturnType<typeof createSqliteGatewayActiveTurnClaimStore>;
	},
	acceptedAdmission: GatewayAcceptedAdmissionResult,
	authorityId: string,
) {
	const result = claimActiveTurn({
		admission: acceptedAdmission,
		store: harness.claimStore,
		allocateAuthorityId: () => authorityId,
	});

	if (result.kind !== "authority_granted") {
		throw new Error("Expected exclusive turn-creation authority.");
	}

	return (result as GatewayAuthorityGrantedResult).authority;
}

function makeIngressInput(
	overrides: Partial<{
		channel: string;
		user_id: string;
	}> = {},
) {
	return {
		channel: overrides.channel ?? "terminal_cli",
		user_id: overrides.user_id ?? "user-123",
		message_parts: [parseMessagePart({ kind: "text", text: "hello" })],
		received_at: "2026-05-23T10:00:00Z",
		metadata: { transport: "terminal" },
	} as const;
}

function makeGatewayDefaults(
	overrides: Partial<{
		max_queued_ingress_per_session: number;
		queue_overflow_policy: "reject_newest";
	}> = {},
) {
	return {
		max_queued_ingress_per_session:
			overrides.max_queued_ingress_per_session ?? 8,
		queue_overflow_policy: overrides.queue_overflow_policy ?? ("reject_newest" as const),
	};
}

function makeGovernorDefaults(
	overrides: Partial<{
		max_inference_steps: number;
		max_repair_attempts: number;
		max_wall_clock_ms: number;
	}> = {},
) {
	return {
		max_inference_steps: overrides.max_inference_steps ?? 12,
		max_repair_attempts: overrides.max_repair_attempts ?? 3,
		max_wall_clock_ms: overrides.max_wall_clock_ms ?? 600000,
	};
}

function makeQueueEventMetadata() {
	return {
		event_id: "event-turn-creation-queue",
		sequence: 1,
		timestamp: "2026-05-23T09:59:59Z",
		visibility: "telemetry" as const,
	};
}

function createTempDirectory(): string {
	const directory = join(
		tmpdir(),
		`argentum-gateway-turn-creation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(directory, { recursive: true });
	return directory;
}

function buildForgedAuthority() {
	return {
		authority_id: "authority-forged",
		session_id: "session-forged",
		ingress_id: "ingress-forged",
	} as const;
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