import { describe, expect, it, vi } from "vitest";

import {
	IngressValidationError,
	parseIngressDTO,
	parseMessagePart,
	parseStreamEvent,
	type StreamEventVisibility,
} from "@argentum/contracts";

import { admitIngress, type GatewayAdmissionSnapshot } from "../src/index.js";

describe("admitIngress", () => {
	it("accepts an unlocked session with no backlog, creates canonical ingress first, and emits no queue event", () => {
		const allocateIngressId = vi.fn(() => "ingress-accepted");
		const allocateQueueEventMetadata = vi.fn(() => makeQueueEventMetadata());
		const snapshot = freezeSnapshot({
			has_active_turn: false,
			queued_ingress: [],
		});

		const result = admitIngress({
			gatewayDefaults: makeGatewayDefaults(),
			session_id: "session-accepted",
			ingress: makeIngressInput(),
			allocateIngressId,
			session: snapshot,
			allocateQueueEventMetadata,
		});

		expect(result).toEqual({
			disposition: "accepted",
			ingress: parseIngressDTO({
				ingress_id: "ingress-accepted",
				session_id: "session-accepted",
				...makeIngressInput(),
			}),
			post_queue_length: 0,
			queue_mutation: { kind: "none" },
		});
		expect(Object.isFrozen(result.ingress)).toBe(true);
		expect(allocateIngressId).toHaveBeenCalledTimes(1);
		expect(allocateQueueEventMetadata).not.toHaveBeenCalled();
		expect(result).not.toHaveProperty("queue_event");
		expect(result).not.toHaveProperty("turn_envelope");
		expect(result).not.toHaveProperty("turn_event");
		expect(snapshot).toEqual({ has_active_turn: false, queued_ingress: [] });
	});

	it("queues ingress behind existing backlog even without an active turn so FIFO backlog is preserved", () => {
		const snapshot = freezeSnapshot({
			has_active_turn: false,
			queued_ingress: [{ ingress_id: "ingress-older" }],
		});

		const result = admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 3 }),
			session_id: "session-fifo",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-new",
			session: snapshot,
			allocateQueueEventMetadata: () =>
				makeQueueEventMetadata({
					event_id: "event-fifo",
					sequence: 4,
					timestamp: "2026-05-22T10:30:04Z",
				}),
		});

		expect(result.disposition).toBe("queued");
		expect(result.post_queue_length).toBe(2);
		expect(result.queue_mutation).toEqual({
			kind: "append_newest",
			ingress_id: "ingress-new",
		});
		if (result.disposition !== "queued") {
			throw new Error("Expected queued result.");
		}
		expect(result.queue_event.kind).toBe("queue.queued");
		expect(result.queue_event.scope).toBe("session");
		expect(result.queue_event.payload).toEqual({
			session_id: "session-fifo",
			ingress_id: "ingress-new",
			queue_length: 2,
		});
		expect(parseStreamEvent(result.queue_event)).toEqual(result.queue_event);
		expect(snapshot.queued_ingress).toEqual([{ ingress_id: "ingress-older" }]);
	});

	it("queues ingress during an active turn below the configured cap and preserves allocator metadata", () => {
		const metadata = makeQueueEventMetadata({
			event_id: "event-queued",
			sequence: 12,
			timestamp: "2026-05-22T10:30:12Z",
			visibility: "system",
		});

		const result = admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 2 }),
			session_id: "session-locked",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-queued",
			session: freezeSnapshot({
				has_active_turn: true,
				queued_ingress: [{ ingress_id: "ingress-earlier" }],
			}),
			allocateQueueEventMetadata: () => metadata,
		});

		if (result.disposition !== "queued") {
			throw new Error("Expected queued result.");
		}

		expect(result.queue_event.event_id).toBe(metadata.event_id);
		expect(result.queue_event.sequence).toBe(metadata.sequence);
		expect(result.queue_event.timestamp).toBe(metadata.timestamp);
		expect(result.queue_event.visibility).toBe(metadata.visibility);
		expect(result.post_queue_length).toBe(2);
	});

	it("rejects the newest ingress at the configured cap during an active turn without mutating queued backlog", () => {
		const snapshot = freezeSnapshot({
			has_active_turn: true,
			queued_ingress: [{ ingress_id: "ingress-1" }],
		});

		const result = admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 1 }),
			session_id: "session-full",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-rejected",
			session: snapshot,
			allocateQueueEventMetadata: () =>
				makeQueueEventMetadata({
					event_id: "event-rejected",
					sequence: 20,
					timestamp: "2026-05-22T10:30:20Z",
				}),
		});

		if (result.disposition !== "rejected") {
			throw new Error("Expected rejected result.");
		}

		expect(result.ingress.ingress_id).toBe("ingress-rejected");
		expect(result.post_queue_length).toBe(1);
		expect(result.queue_mutation).toEqual({ kind: "none" });
		expect(result.queue_event.kind).toBe("queue.rejected");
		expect(result.queue_event.event_id).toBe("event-rejected");
		expect(result.queue_event.sequence).toBe(20);
		expect(result.queue_event.timestamp).toBe("2026-05-22T10:30:20Z");
		expect(result.queue_event.visibility).toBe("telemetry");
		expect(result.queue_event.payload).toEqual({
			session_id: "session-full",
			ingress_id: "ingress-rejected",
			queue_length: 1,
			reason: "reject_newest",
		});
		expect(parseStreamEvent(result.queue_event)).toEqual(result.queue_event);
		expect(snapshot.queued_ingress).toEqual([{ ingress_id: "ingress-1" }]);
	});

	it("rejects backlog growth at the configured cap even when no active turn exists", () => {
		const result = admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 1 }),
			session_id: "session-backlog-cap",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-cap",
			session: freezeSnapshot({
				has_active_turn: false,
				queued_ingress: [{ ingress_id: "ingress-backlog" }],
			}),
			allocateQueueEventMetadata: () =>
				makeQueueEventMetadata({
					event_id: "event-cap",
					sequence: 21,
					timestamp: "2026-05-22T10:30:21Z",
				}),
		});

		expect(result.disposition).toBe("rejected");
		if (result.disposition !== "rejected") {
			throw new Error("Expected rejected result.");
		}
		expect(result.post_queue_length).toBe(1);
		expect(result.queue_event.payload.reason).toBe("reject_newest");
	});

	it("validates and constructs ingress before returning a rejected disposition", () => {
		const invalidIngress = {
			...makeIngressInput(),
			received_at: "not-a-utc-timestamp",
		};

		expect(() =>
			admitIngress({
				gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 1 }),
				session_id: "session-invalid-rejected",
				ingress: invalidIngress,
				allocateIngressId: () => "ingress-invalid",
				session: freezeSnapshot({
					has_active_turn: true,
					queued_ingress: [{ ingress_id: "ingress-at-cap" }],
				}),
				allocateQueueEventMetadata: () => makeQueueEventMetadata(),
			}),
		).toThrow(IngressValidationError);
	});

	it("leaves caller snapshots unchanged across accepted, queued, and rejected outcomes", () => {
		const acceptedSnapshot = freezeSnapshot({ has_active_turn: false, queued_ingress: [] });
		const queuedSnapshot = freezeSnapshot({
			has_active_turn: true,
			queued_ingress: [{ ingress_id: "ingress-queued-1" }],
		});
		const rejectedSnapshot = freezeSnapshot({
			has_active_turn: true,
			queued_ingress: [{ ingress_id: "ingress-rejected-1" }],
		});

		admitIngress({
			gatewayDefaults: makeGatewayDefaults(),
			session_id: "session-a",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-a",
			session: acceptedSnapshot,
			allocateQueueEventMetadata: () => makeQueueEventMetadata(),
		});
		admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 2 }),
			session_id: "session-b",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-b",
			session: queuedSnapshot,
			allocateQueueEventMetadata: () => makeQueueEventMetadata(),
		});
		admitIngress({
			gatewayDefaults: makeGatewayDefaults({ max_queued_ingress_per_session: 1 }),
			session_id: "session-c",
			ingress: makeIngressInput(),
			allocateIngressId: () => "ingress-c",
			session: rejectedSnapshot,
			allocateQueueEventMetadata: () => makeQueueEventMetadata(),
		});

		expect(acceptedSnapshot).toEqual({ has_active_turn: false, queued_ingress: [] });
		expect(queuedSnapshot).toEqual({
			has_active_turn: true,
			queued_ingress: [{ ingress_id: "ingress-queued-1" }],
		});
		expect(rejectedSnapshot).toEqual({
			has_active_turn: true,
			queued_ingress: [{ ingress_id: "ingress-rejected-1" }],
		});
	});
});

function makeIngressInput() {
	return {
		channel: "terminal_cli",
		user_id: "user-123",
		message_parts: [parseMessagePart({ kind: "text", text: "hello" })],
		received_at: "2026-05-22T10:30:00Z",
		metadata: { transport: "terminal" },
	} as const;
}

function makeGatewayDefaults(overrides: Partial<ReturnType<typeof makeGatewayDefaultsBase>> = {}) {
	return {
		...makeGatewayDefaultsBase(),
		...overrides,
	};
}

function makeGatewayDefaultsBase() {
	return {
		max_queued_ingress_per_session: 8,
		queue_overflow_policy: "reject_newest" as const,
	};
}

function makeQueueEventMetadata(overrides: Partial<ReturnType<typeof makeQueueEventMetadataBase>> = {}) {
	return {
		...makeQueueEventMetadataBase(),
		...overrides,
	};
}

function makeQueueEventMetadataBase(): {
	event_id: string;
	sequence: number;
	timestamp: string;
	visibility: StreamEventVisibility;
} {
	return {
		event_id: "event-123",
		sequence: 3,
		timestamp: "2026-05-22T10:30:03Z",
		visibility: "telemetry",
	};
}

function freezeSnapshot(snapshot: GatewayAdmissionSnapshot): GatewayAdmissionSnapshot {
	return Object.freeze({
		has_active_turn: snapshot.has_active_turn,
		queued_ingress: Object.freeze(
			snapshot.queued_ingress.map((queuedIngress) => Object.freeze({ ...queuedIngress })),
		),
	});
}