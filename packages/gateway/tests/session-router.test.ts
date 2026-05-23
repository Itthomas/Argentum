import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createSqliteGatewaySessionRoutingStore,
	resolveSession,
} from "../src/index.js";

describe("resolveSession", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reuses the same persisted session id for the same routing key and only allocates on first use", () => {
		const harness = createDatabaseHarness();
		const firstAllocator = vi.fn(() => "session-repeat");
		const secondAllocator = vi.fn(() => "session-should-not-be-used");

		try {
			const first = resolveSession({
				channel: "terminal_cli",
				user_id: "user-repeat",
				allocateSessionId: firstAllocator,
				store: harness.store,
			});
			const second = resolveSession({
				channel: "terminal_cli",
				user_id: "user-repeat",
				allocateSessionId: secondAllocator,
				store: harness.store,
			});

			expect(first).toEqual({
				session_id: "session-repeat",
				session: {
					has_active_turn: false,
					queued_ingress_count: 0,
					queued_ingress: [],
				},
			});
			expect(second).toEqual(first);
			expect(firstAllocator).toHaveBeenCalledTimes(1);
			expect(secondAllocator).not.toHaveBeenCalled();
			expect(Object.isFrozen(first)).toBe(true);
			expect(Object.isFrozen(first.session)).toBe(true);
			expect(Object.isFrozen(first.session.queued_ingress)).toBe(true);
			expect(first).not.toHaveProperty("ingress");
			expect(first).not.toHaveProperty("queue_event");
			expect(first).not.toHaveProperty("turn_envelope");
		} finally {
			harness.cleanup();
		}
	});

	it("does not alias distinct routing keys to the same session id", () => {
		const harness = createDatabaseHarness();

		try {
			const first = resolveSession({
				channel: "terminal_cli",
				user_id: "user-a",
				allocateSessionId: () => "session-a",
				store: harness.store,
			});
			const second = resolveSession({
				channel: "terminal_cli",
				user_id: "user-b",
				allocateSessionId: () => "session-b",
				store: harness.store,
			});

			expect(first.session_id).toBe("session-a");
			expect(second.session_id).toBe("session-b");
			expect(second.session_id).not.toBe(first.session_id);
		} finally {
			harness.cleanup();
		}
	});

	it("includes channel identity in the routing key so the same user on different channels resolves to different sessions", () => {
		const harness = createDatabaseHarness();

		try {
			const terminalSession = resolveSession({
				channel: "terminal_cli",
				user_id: "shared-user",
				allocateSessionId: () => "session-terminal",
				store: harness.store,
			});
			const webSession = resolveSession({
				channel: "web_chat",
				user_id: "shared-user",
				allocateSessionId: () => "session-web",
				store: harness.store,
			});

			expect(terminalSession.session_id).toBe("session-terminal");
			expect(webSession.session_id).toBe("session-web");
			expect(webSession.session_id).not.toBe(terminalSession.session_id);
		} finally {
			harness.cleanup();
		}
	});

	it("loads existing persisted active-turn and queued-ingress state in FIFO order", () => {
		const harness = createDatabaseHarness();

		try {
			seedPersistedSessionState(harness.database, {
				routingKey: JSON.stringify(["terminal_cli", "user-existing"]),
				sessionId: "session-existing",
				hasActiveTurn: true,
				queuedIngress: [
					{ queuePosition: 20, ingressId: "ingress-later" },
					{ queuePosition: 10, ingressId: "ingress-earlier" },
				],
			});

			const allocateSessionId = vi.fn(() => "session-unused");
			const resolved = resolveSession({
				channel: "terminal_cli",
				user_id: "user-existing",
				allocateSessionId,
				store: harness.store,
			});

			expect(allocateSessionId).not.toHaveBeenCalled();
			expect(resolved).toEqual({
				session_id: "session-existing",
				session: {
					has_active_turn: true,
					queued_ingress_count: 2,
					queued_ingress: [
						{ ingress_id: "ingress-earlier" },
						{ ingress_id: "ingress-later" },
					],
				},
			});
			expect(Object.isFrozen(resolved.session.queued_ingress[0])).toBe(true);
		} finally {
			harness.cleanup();
		}
	});

	it("persists routing across separate SQLite connections to the same database file", () => {
		const databaseDirectory = createTempDirectory();
		const databasePath = join(databaseDirectory, "gateway-session-router.sqlite");
		const firstDatabase = new DatabaseSync(databasePath);
		const secondDatabase = new DatabaseSync(databasePath);

		try {
			const firstStore = createSqliteGatewaySessionRoutingStore({
				database: firstDatabase,
			});
			const secondStore = createSqliteGatewaySessionRoutingStore({
				database: secondDatabase,
			});

			const first = resolveSession({
				channel: "terminal_cli",
				user_id: "user-shared-db",
				allocateSessionId: () => "session-shared",
				store: firstStore,
			});
			const secondAllocator = vi.fn(() => "session-not-used");
			const second = resolveSession({
				channel: "terminal_cli",
				user_id: "user-shared-db",
				allocateSessionId: secondAllocator,
				store: secondStore,
			});

			expect(first.session_id).toBe("session-shared");
			expect(second.session_id).toBe("session-shared");
			expect(secondAllocator).not.toHaveBeenCalled();
		} finally {
			firstDatabase.close();
			secondDatabase.close();
			rmSync(databaseDirectory, { recursive: true, force: true });
		}
	});

	it("converges on one persisted session id during same-key concurrent first use across SQLite connections", async () => {
		const databaseDirectory = createTempDirectory();
		const databasePath = join(databaseDirectory, "gateway-session-router-concurrent.sqlite");
		const database = new DatabaseSync(databasePath);
		const store = createSqliteGatewaySessionRoutingStore({ database });
		const worker = new Worker(
			new URL("./session-router-concurrency-worker.mjs", import.meta.url),
			{
				execArgv: ["--experimental-strip-types"],
				workerData: {
					databasePath,
					channel: "terminal_cli",
					userId: "user-concurrent",
					sessionId: "session-from-worker",
				},
			},
		);

		try {
			await waitForWorkerMessage(worker, "ready");
			worker.postMessage({ kind: "start" });

			const allocateSessionId = vi.fn(() => "session-from-main");
			const mainResolved = resolveSession({
				channel: "terminal_cli",
				user_id: "user-concurrent",
				allocateSessionId,
				store,
			});
			const workerResolved = await waitForWorkerResolved(worker);

			await waitForWorkerExit(worker);

			const persistedRoutes = database
				.prepare(
					"SELECT COUNT(*) AS route_count FROM gateway_session_routes WHERE routing_key = ?",
				)
				.get(JSON.stringify(["terminal_cli", "user-concurrent"])) as {
					route_count: number;
				};
			const persistedSessions = database
				.prepare("SELECT COUNT(*) AS session_count FROM gateway_sessions")
				.get() as { session_count: number };

			expect(mainResolved.session_id).toBe(workerResolved.result.session_id);
			expect(mainResolved.session).toEqual(workerResolved.result.session);
			expect(allocateSessionId.mock.calls.length + workerResolved.allocateCount).toBe(1);
			expect(mainResolved.session).toEqual({
				has_active_turn: false,
				queued_ingress_count: 0,
				queued_ingress: [],
			});
			expect(persistedRoutes.route_count).toBe(1);
			expect(persistedSessions.session_count).toBe(1);
		} finally {
			await terminateWorker(worker);
			database.close();
			rmSync(databaseDirectory, { recursive: true, force: true });
		}
	});

	it("rolls back failed first-use initialization so a routing key does not resolve until minimal metadata exists", () => {
		const harness = createDatabaseHarness();

		try {
			harness.database
				.prepare(
					"INSERT INTO gateway_sessions (session_id, has_active_turn) VALUES (?, 0)",
				)
				.run("session-collision");

			expect(() =>
				resolveSession({
					channel: "terminal_cli",
					user_id: "user-collision",
					allocateSessionId: () => "session-collision",
					store: harness.store,
				}),
			).toThrow();

			const leakedRoute = harness.database
				.prepare(
					"SELECT session_id FROM gateway_session_routes WHERE routing_key = ?",
				)
				.get(JSON.stringify(["terminal_cli", "user-collision"]));
			expect(leakedRoute).toBeUndefined();

			const recovered = resolveSession({
				channel: "terminal_cli",
				user_id: "user-collision",
				allocateSessionId: () => "session-recovered",
				store: harness.store,
			});

			expect(recovered.session_id).toBe("session-recovered");
			expect(recovered.session.queued_ingress_count).toBe(0);
		} finally {
			harness.cleanup();
		}
	});
});

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

function waitForWorkerResolved(
	worker: Worker,
): Promise<{
	result: {
		session_id: string;
		session: {
			has_active_turn: boolean;
			queued_ingress_count: number;
			queued_ingress: readonly { ingress_id: string }[];
		};
	};
	allocateCount: number;
}> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			worker.off("message", onMessage);
			worker.off("error", onError);
		};

		const onMessage = (message: {
			kind: string;
			message?: string;
			result?: {
				session_id: string;
				session: {
					has_active_turn: boolean;
					queued_ingress_count: number;
					queued_ingress: readonly { ingress_id: string }[];
				};
			};
			allocateCount?: number;
		}) => {
			if (message.kind === "resolved" && message.result && message.allocateCount !== undefined) {
				cleanup();
				resolve({
					result: message.result,
					allocateCount: message.allocateCount,
				});
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

function createDatabaseHarness() {
	const directory = createTempDirectory();
	const database = new DatabaseSync(join(directory, "gateway.sqlite"));
	const store = createSqliteGatewaySessionRoutingStore({ database });

	return {
		database,
		store,
		cleanup: () => {
			database.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

function createTempDirectory(): string {
	const directory = join(
		tmpdir(),
		`argentum-gateway-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(directory, { recursive: true });
	return directory;
}

function seedPersistedSessionState(
	database: DatabaseSync,
	input: {
		routingKey: string;
		sessionId: string;
		hasActiveTurn: boolean;
		queuedIngress: readonly {
			queuePosition: number;
			ingressId: string;
		}[];
	},
): void {
	database
		.prepare(
			"INSERT INTO gateway_sessions (session_id, has_active_turn) VALUES (?, ?)",
		)
		.run(input.sessionId, input.hasActiveTurn ? 1 : 0);
	database
		.prepare(
			"INSERT INTO gateway_session_routes (routing_key, session_id) VALUES (?, ?)",
		)
		.run(input.routingKey, input.sessionId);

	for (const queuedIngress of input.queuedIngress) {
		database
			.prepare(
				[
					"INSERT INTO gateway_session_queue",
					"(session_id, queue_position, ingress_id)",
					"VALUES (?, ?, ?)",
				].join(" "),
			)
			.run(
				input.sessionId,
				queuedIngress.queuePosition,
				queuedIngress.ingressId,
			);
	}
}