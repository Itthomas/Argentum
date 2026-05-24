import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import * as gateway from "../src/index.js";

describe("@argentum/gateway source entrypoint", () => {
	it("re-exports the focused session-router surface without leaking internal routing helpers", () => {
		expect(typeof gateway.createSqliteGatewayActiveTurnClaimStore).toBe("function");
		expect(typeof gateway.claimActiveTurn).toBe("function");
		expect(typeof gateway.createGatewayTurnStartHandoff).toBe("function");
		expect(typeof gateway.createGatewayTurnStartHandoffFromAcceptedAdmission).toBe(
			"function",
		);
		expect(typeof gateway.createTurnFromHandoff).toBe("function");
		expect(typeof gateway.createSqliteGatewaySessionRoutingStore).toBe("function");
		expect(typeof gateway.resolveSession).toBe("function");
		expect(gateway).not.toHaveProperty("deriveRoutingKey");
		expect(gateway).not.toHaveProperty("claimActiveTurnInSqlite");
		expect(gateway).not.toHaveProperty("consumeGatewayTurnCreationAuthority");
	});

	it("resolves a session through the gateway source entrypoint exports", () => {
		const database = new DatabaseSync(":memory:");

		try {
			const store = gateway.createSqliteGatewaySessionRoutingStore({ database });
			const resolved = gateway.resolveSession({
				channel: "terminal_cli",
				user_id: "user-entrypoint",
				allocateSessionId: () => "session-entrypoint",
				store,
			});

			expect(resolved).toEqual({
				session_id: "session-entrypoint",
				session: {
					has_active_turn: false,
					queued_ingress_count: 0,
					queued_ingress: [],
				},
			});
		} finally {
			database.close();
		}
	});
});