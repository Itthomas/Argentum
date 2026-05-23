import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

import {
	createSqliteGatewaySessionRoutingStore,
	resolveSession,
} from "../src/session-router.ts";

const database = new DatabaseSync(workerData.databasePath);

try {
	const store = createSqliteGatewaySessionRoutingStore({ database });
	let allocateCount = 0;

	parentPort?.postMessage({ kind: "ready" });
	parentPort?.once("message", (message) => {
		if (message?.kind !== "start") {
			parentPort?.postMessage({
				kind: "error",
				message: "Worker received an unexpected message.",
			});
			database.close();
			return;
		}

		try {
			const result = resolveSession({
				channel: workerData.channel,
				user_id: workerData.userId,
				allocateSessionId: () => {
					allocateCount += 1;
					return workerData.sessionId;
				},
				store,
			});

			parentPort?.postMessage({
				kind: "resolved",
				result,
				allocateCount,
			});
		} catch (error) {
			parentPort?.postMessage({
				kind: "error",
				message:
					error instanceof Error ? error.message : "Unknown worker resolution failure.",
			});
		} finally {
			database.close();
		}
	});
} catch (error) {
	parentPort?.postMessage({
		kind: "error",
		message:
			error instanceof Error ? error.message : "Unknown worker startup failure.",
	});
	database.close();
}