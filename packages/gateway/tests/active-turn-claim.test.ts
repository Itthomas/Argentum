import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import { parseMessagePart } from "@argentum/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	admitIngress,
	claimActiveTurn,
	createSqliteGatewayActiveTurnClaimStore,
	createSqliteGatewaySessionRoutingStore,
	isGatewayExclusiveTurnCreationAuthority,
	resolveSession,
	type GatewayAcceptedAdmissionResult,
} from "../src/index.js";

describe("claimActiveTurn", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("accepts only the accepted admission branch and does not claim from queued outcomes", () => {
		const allocateAuthorityId = vi.fn(() => "authority-unused");
		const store = vi.fn(() => {
			throw new Error("Claim store should not run for non-accepted inputs.");
		});
		const queuedAdmission = admitIngress({
			gatewayDefaults: makeGatewayDefaults(),
			session_id: "session-invalid-queued",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-invalid-queued",
			session: Object.freeze({
				has_active_turn: true,
				queued_ingress: Object.freeze([{ ingress_id: "ingress-earlier" }]),
			}),
			allocateQueueEventMetadata: () => makeQueueEventMetadata(),
		});

		const result = claimActiveTurn({
			admission: queuedAdmission as unknown as GatewayAcceptedAdmissionResult,
			store,
			allocateAuthorityId,
		});

		expect(result).toEqual({ kind: "no_authority", reason: "invalid_request" });
		expect(store).not.toHaveBeenCalled();
		expect(allocateAuthorityId).not.toHaveBeenCalled();
	});

	it("rejects caller-forged accepted admissions that did not originate from admitIngress", () => {
		const allocateAuthorityId = vi.fn(() => "authority-forged");
		const store = vi.fn(() => {
			throw new Error("Claim store should not run for forged admissions.");
		});
		const forgedAcceptedAdmission = {
			disposition: "accepted",
			ingress: createIngressValue({
				session_id: "session-forged",
				ingress_id: "ingress-forged",
				channel: "terminal_cli",
				user_id: "user-forged",
			}),
			post_queue_length: 0,
			queue_mutation: { kind: "none" },
		} as unknown as GatewayAcceptedAdmissionResult;

		const result = claimActiveTurn({
			admission: forgedAcceptedAdmission,
			store,
			allocateAuthorityId,
		});

		expect(result).toEqual({ kind: "no_authority", reason: "invalid_request" });
		expect(store).not.toHaveBeenCalled();
		expect(allocateAuthorityId).not.toHaveBeenCalled();
	});

	it("grants one exclusive authority bound to the accepted ingress session and identity", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-claim-success",
				ingressId: "ingress-claim-success",
				channel: "terminal_cli",
				userId: "user-claim-success",
			});

			const result = claimActiveTurn({
				admission: acceptedAdmission,
				store: harness.claimStore,
				allocateAuthorityId: () => "authority-claim-success",
			});

			expect(result).toEqual({
				kind: "authority_granted",
				authority: {
					authority_id: "authority-claim-success",
					session_id: "session-claim-success",
					ingress_id: "ingress-claim-success",
				},
			});
			expect(Object.isFrozen(result.authority)).toBe(true);
			expect(isGatewayExclusiveTurnCreationAuthority(result.authority)).toBe(true);
			expect(
				isGatewayExclusiveTurnCreationAuthority({
					authority_id: "authority-claim-success",
					session_id: "session-claim-success",
					ingress_id: "ingress-claim-success",
				}),
			).toBe(false);
			expect(result).not.toHaveProperty("turn_envelope");
			expect(result).not.toHaveProperty("queue_event");

			const persistedSession = harness.database
				.prepare(
					[
						"SELECT has_active_turn, active_turn_ingress_id, active_turn_claim_id",
						"FROM gateway_sessions WHERE session_id = ?",
					].join(" "),
				)
				.get("session-claim-success") as {
					has_active_turn: number;
					active_turn_ingress_id: string | null;
					active_turn_claim_id: string | null;
				};

			expect(persistedSession).toEqual({
				has_active_turn: 1,
				active_turn_ingress_id: "ingress-claim-success",
				active_turn_claim_id: "authority-claim-success",
			});

			const resolved = resolveSession({
				channel: "terminal_cli",
				user_id: "user-claim-success",
				allocateSessionId: () => "session-unused",
				store: harness.routingStore,
			});
			expect(resolved.session.has_active_turn).toBe(true);
		} finally {
			harness.cleanup();
		}
	});

	it("returns a preservation handoff when a different accepted ingress loses the same-session claim race", () => {
		const harness = createGatewayHarness();

		try {
			const firstAcceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-preserve",
				ingressId: "ingress-winner",
				channel: "terminal_cli",
				userId: "user-preserve",
			});
			const secondAcceptedAdmission = createGatewayAcceptedAdmission({
				sessionId: "session-preserve",
				ingressId: "ingress-loser",
				channel: "terminal_cli",
				userId: "user-preserve",
			});

			const firstResult = claimActiveTurn({
				admission: firstAcceptedAdmission,
				store: harness.claimStore,
				allocateAuthorityId: () => "authority-winner",
			});
			expect(firstResult.kind).toBe("authority_granted");

			const secondResult = claimActiveTurn({
				admission: secondAcceptedAdmission,
				store: harness.claimStore,
				allocateAuthorityId: () => "authority-loser",
			});

			expect(secondResult).toEqual({
				kind: "preserve_ingress",
				handoff: {
					ingress: secondAcceptedAdmission.ingress,
					session_id: "session-preserve",
					ingress_id: "ingress-loser",
					reason: "active_turn_conflict",
				},
			});
			expect(Object.isFrozen(secondResult.handoff)).toBe(true);
			expect(secondResult).not.toHaveProperty("queue_mutation");
			expect(secondResult).not.toHaveProperty("turn_event");
		} finally {
			harness.cleanup();
		}
	});

	it("returns no authority for duplicate claims on the same accepted ingress", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-duplicate",
				ingressId: "ingress-duplicate",
				channel: "terminal_cli",
				userId: "user-duplicate",
			});

			const firstResult = claimActiveTurn({
				admission: acceptedAdmission,
				store: harness.claimStore,
				allocateAuthorityId: () => "authority-first",
			});
			expect(firstResult.kind).toBe("authority_granted");

			const secondResult = claimActiveTurn({
				admission: acceptedAdmission,
				store: harness.claimStore,
				allocateAuthorityId: () => "authority-second",
			});

			expect(secondResult).toEqual({
				kind: "no_authority",
				reason: "duplicate_claim",
			});
		} finally {
			harness.cleanup();
		}
	});

	it("rejects stale replay after a later slice clears the active-turn row", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-stale-replay",
				ingressId: "ingress-stale-replay",
				channel: "terminal_cli",
				userId: "user-stale-replay",
			});

			const firstResult = claimActiveTurn({
				admission: acceptedAdmission,
				store: harness.claimStore,
				allocateAuthorityId: () => "authority-stale-first",
			});
			expect(firstResult.kind).toBe("authority_granted");

			harness.database
				.prepare(
					[
						"UPDATE gateway_sessions",
						"SET has_active_turn = 0, active_turn_ingress_id = NULL, active_turn_claim_id = NULL",
						"WHERE session_id = ?",
					].join(" "),
				)
				.run("session-stale-replay");

			const replayResult = claimActiveTurn({
				admission: acceptedAdmission,
				store: harness.claimStore,
				allocateAuthorityId: () => "authority-stale-second",
			});

			expect(replayResult).toEqual({
				kind: "no_authority",
				reason: "duplicate_claim",
			});
		} finally {
			harness.cleanup();
		}
	});

	it("converges on one authority under same-session concurrent claim attempts across SQLite connections", async () => {
		const directory = createTempDirectory();
		const databasePath = join(directory, "gateway-active-turn-claim.sqlite");
		const database = new DatabaseSync(databasePath);
		const routingStore = createSqliteGatewaySessionRoutingStore({ database });
		const claimStore = createSqliteGatewayActiveTurnClaimStore({ database });
		const resolved = resolveSession({
			channel: "terminal_cli",
			user_id: "user-concurrent-claim",
			allocateSessionId: () => "session-concurrent-claim",
			store: routingStore,
		});
		const worker = new Worker(
			new URL("./active-turn-claim-concurrency-worker.mjs", import.meta.url),
			{
				execArgv: ["--experimental-strip-types"],
				workerData: {
					databasePath,
					sessionId: resolved.session_id,
					ingressId: "ingress-worker",
					authorityId: "authority-worker",
				},
			},
		);

		try {
			await waitForWorkerMessage(worker, "ready");
			worker.postMessage({ kind: "start" });

			const mainResult = claimActiveTurn({
				admission: createGatewayAcceptedAdmission({
					sessionId: resolved.session_id,
					ingressId: "ingress-main",
					channel: "terminal_cli",
					userId: "user-concurrent-claim",
				}),
				store: claimStore,
				allocateAuthorityId: () => "authority-main",
			});
			const workerResult = await waitForWorkerResult(worker);

			await waitForWorkerExit(worker);

			const claimedCount =
				(mainResult.kind === "authority_granted" ? 1 : 0) +
				(workerResult.kind === "authority_granted" ? 1 : 0);
			expect(claimedCount).toBe(1);

			if (workerResult.kind === "authority_granted") {
				expect(mainResult).toEqual({
					kind: "preserve_ingress",
					handoff: {
						ingress: createGatewayAcceptedAdmission({
							sessionId: resolved.session_id,
							ingressId: "ingress-main",
							channel: "terminal_cli",
							userId: "user-concurrent-claim",
						}).ingress,
						session_id: resolved.session_id,
						ingress_id: "ingress-main",
						reason: "active_turn_conflict",
					},
				});
			} else {
				expect(workerResult).toEqual({
					kind: "preserve_ingress",
					handoff: {
						ingress: createGatewayAcceptedAdmission({
							sessionId: resolved.session_id,
							ingressId: "ingress-worker",
							channel: "terminal_cli",
							userId: "user-concurrent-claim",
						}).ingress,
						session_id: resolved.session_id,
						ingress_id: "ingress-worker",
						reason: "active_turn_conflict",
					},
				});
				expect(mainResult.kind).toBe("authority_granted");
			}

			const persistedSession = database
				.prepare(
					[
						"SELECT has_active_turn, active_turn_ingress_id, active_turn_claim_id",
						"FROM gateway_sessions WHERE session_id = ?",
					].join(" "),
				)
				.get(resolved.session_id) as {
					has_active_turn: number;
					active_turn_ingress_id: string | null;
					active_turn_claim_id: string | null;
				};

			expect(persistedSession.has_active_turn).toBe(1);
			expect(["ingress-main", "ingress-worker"]).toContain(
				persistedSession.active_turn_ingress_id,
			);
			expect(["authority-main", "authority-worker"]).toContain(
				persistedSession.active_turn_claim_id,
			);
		} finally {
			await terminateWorker(worker);
			database.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("rolls back partial state when SQLite claim persistence fails during the update", () => {
		const harness = createGatewayHarness();

		try {
			const acceptedAdmission = createAcceptedAdmission(harness, {
				sessionId: "session-failure",
				ingressId: "ingress-failure",
				channel: "terminal_cli",
				userId: "user-failure",
			});

			harness.database.exec(`
				CREATE TRIGGER fail_active_turn_claim
				BEFORE UPDATE OF has_active_turn, active_turn_ingress_id, active_turn_claim_id
				ON gateway_sessions
				WHEN NEW.has_active_turn = 1
				BEGIN
					SELECT RAISE(ABORT, 'forced claim failure');
				END;
			`);

			expect(() =>
				claimActiveTurn({
					admission: acceptedAdmission,
					store: harness.claimStore,
					allocateAuthorityId: () => "authority-failure",
				}),
			).toThrow("forced claim failure");

			const persistedSession = harness.database
				.prepare(
					[
						"SELECT has_active_turn, active_turn_ingress_id, active_turn_claim_id",
						"FROM gateway_sessions WHERE session_id = ?",
					].join(" "),
				)
				.get("session-failure") as {
					has_active_turn: number;
					active_turn_ingress_id: string | null;
					active_turn_claim_id: string | null;
				};

			expect(persistedSession).toEqual({
				has_active_turn: 0,
				active_turn_ingress_id: null,
				active_turn_claim_id: null,
			});
		} finally {
			harness.cleanup();
		}
	});
});

function createGatewayHarness() {
	const directory = createTempDirectory();
	const database = new DatabaseSync(join(directory, "gateway.sqlite"));
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

	return createGatewayAcceptedAdmission({
		sessionId: resolved.session_id,
		ingressId: input.ingressId,
		channel: input.channel,
		userId: input.userId,
	});
}

function createGatewayAcceptedAdmission(input: {
	sessionId: string;
	ingressId: string;
	channel: string;
	userId: string;
}): GatewayAcceptedAdmissionResult {
	const admission = admitIngress({
		gatewayDefaults: makeGatewayDefaults(),
		session_id: input.sessionId,
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

function createIngressValue(input: {
	session_id: string;
	ingress_id: string;
	channel: string;
	user_id: string;
}) {
	const admission = createGatewayAcceptedAdmission({
		sessionId: input.session_id,
		ingressId: input.ingress_id,
		channel: input.channel,
		userId: input.user_id,
	});

	return admission.ingress;
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
		received_at: "2026-05-22T10:30:00Z",
		metadata: { transport: "terminal" },
	} as const;
}

function makeGatewayDefaults() {
	return {
		max_queued_ingress_per_session: 8,
		queue_overflow_policy: "reject_newest" as const,
	};
}

function makeQueueEventMetadata() {
	return {
		event_id: "event-claim-test",
		sequence: 1,
		timestamp: "2026-05-22T12:00:01Z",
		visibility: "telemetry" as const,
	};
}

function createTempDirectory(): string {
	const directory = join(
		tmpdir(),
		`argentum-gateway-claim-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(directory, { recursive: true });
	return directory;
}

function waitForWorkerMessage(
	worker: Worker,
	expectedKind: "ready",
): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			worker.off("message", onMessage);
			worker.off("error", onError);
		};

		const onMessage = (message: { kind: string; message?: string }) => {
			if (message.kind === expectedKind) {
				cleanup();
				resolve();
				return;
			}

			if (message.kind === "error") {
				cleanup();
				reject(new Error(message.message ?? "Worker reported an unknown error."));
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		worker.on("message", onMessage);
		worker.on("error", onError);
	});
}

function waitForWorkerResult(
	worker: Worker,
): Promise<GatewayAcceptedWorkerClaimResult> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			worker.off("message", onMessage);
			worker.off("error", onError);
		};

		const onMessage = (message: {
			kind: string;
			message?: string;
			result?: GatewayAcceptedWorkerClaimResult;
		}) => {
			if (message.kind === "result" && message.result) {
				cleanup();
				resolve(message.result);
				return;
			}

			if (message.kind === "error") {
				cleanup();
				reject(new Error(message.message ?? "Worker reported an unknown error."));
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		worker.on("message", onMessage);
		worker.on("error", onError);
	});
}

function waitForWorkerExit(worker: Worker): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			worker.off("exit", onExit);
			worker.off("error", onError);
		};

		const onExit = (code: number) => {
			cleanup();
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`Worker exited with code ${code}.`));
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		worker.on("exit", onExit);
		worker.on("error", onError);
	});
}

async function terminateWorker(worker: Worker): Promise<void> {
	if (worker.threadId === -1) {
		return;
	}

	await worker.terminate();
}

type GatewayAcceptedWorkerClaimResult =
	| {
			readonly kind: "authority_granted";
			readonly authority: {
				readonly authority_id: string;
				readonly session_id: string;
				readonly ingress_id: string;
			};
	  }
	| {
			readonly kind: "preserve_ingress";
			readonly handoff: {
				readonly ingress: GatewayAcceptedAdmissionResult["ingress"];
				readonly session_id: string;
				readonly ingress_id: string;
				readonly reason: "active_turn_conflict";
			};
	  }
	| {
			readonly kind: "no_authority";
			readonly reason: "duplicate_claim" | "invalid_request";
	  };