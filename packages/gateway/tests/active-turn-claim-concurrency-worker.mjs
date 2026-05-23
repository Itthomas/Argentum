import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

import { parseMessagePart } from "@argentum/contracts";

import {
	claimActiveTurn,
	createSqliteGatewayActiveTurnClaimStore,
} from "../src/active-turn-claim.ts";
import { admitIngress } from "../src/ingress-admission.ts";

const database = new DatabaseSync(workerData.databasePath);
database.exec("PRAGMA busy_timeout = 5000");
const claimStore = createSqliteGatewayActiveTurnClaimStore({ database });

parentPort.postMessage({ kind: "ready" });

parentPort.once("message", (message) => {
	if (message.kind !== "start") {
		parentPort.postMessage({
			kind: "error",
			message: "Worker received an unexpected message.",
		});
		database.close();
		return;
	}

	try {
		const admission = admitIngress({
			gatewayDefaults: {
				max_queued_ingress_per_session: 8,
				queue_overflow_policy: "reject_newest",
			},
			session_id: workerData.sessionId,
			ingress: {
				channel: "terminal_cli",
				user_id: "user-concurrent-claim",
				message_parts: [parseMessagePart({ kind: "text", text: "hello" })],
				received_at: "2026-05-22T10:30:00Z",
				metadata: { transport: "terminal" },
			},
			allocateIngressId: () => workerData.ingressId,
			session: Object.freeze({
				has_active_turn: false,
				queued_ingress: Object.freeze([]),
			}),
			allocateQueueEventMetadata: () => ({
				event_id: "event-worker-claim",
				sequence: 1,
				timestamp: "2026-05-22T12:00:03Z",
				visibility: "telemetry",
			}),
		});

		const result = claimActiveTurn({
			admission,
			store: claimStore,
			allocateAuthorityId: () => workerData.authorityId,
		});

		parentPort.postMessage({ kind: "result", result });
		database.close();
	} catch (error) {
		parentPort.postMessage({
			kind: "error",
			message: error instanceof Error ? error.message : String(error),
		});
		database.close();
	}
});