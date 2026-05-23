import {
	type IngressDTO,
	type RuntimeConfigGatewayDTO,
	type SessionStreamEvent,
	type StreamEventPayload,
	type StreamEventVisibility,
	parseIngressDTO,
	parseStreamEvent,
} from "@argentum/contracts";

const gatewayAcceptedAdmissionBrand = Symbol("gateway.accepted-admission");

export type GatewayDefaults = Readonly<
	Pick<
		RuntimeConfigGatewayDTO,
		"max_queued_ingress_per_session" | "queue_overflow_policy"
	>
>;

export type GatewayIngressInput = Readonly<
	Omit<IngressDTO, "ingress_id" | "session_id">
>;

export interface GatewayQueuedIngressRecord {
	readonly ingress_id: string;
}

export interface GatewayAdmissionSnapshot {
	readonly has_active_turn: boolean;
	readonly queued_ingress: readonly GatewayQueuedIngressRecord[];
}

export interface GatewayQueueEventMetadata {
	readonly event_id: string;
	readonly sequence: number;
	readonly timestamp: string;
	readonly visibility: StreamEventVisibility;
}

export type GatewayIngressIdAllocator = () => string;

export type GatewayQueueEventMetadataAllocator = () => GatewayQueueEventMetadata;

export interface GatewayAppendNewestQueueMutation {
	readonly kind: "append_newest";
	readonly ingress_id: string;
}

export interface GatewayNoQueueMutation {
	readonly kind: "none";
}

export type GatewayQueueMutation =
	| GatewayAppendNewestQueueMutation
	| GatewayNoQueueMutation;

export interface GatewayQueuedEventPayload extends StreamEventPayload {
	readonly session_id: string;
	readonly ingress_id: string;
	readonly queue_length: number;
}

export interface GatewayRejectedEventPayload extends GatewayQueuedEventPayload {
	readonly reason: RuntimeConfigGatewayDTO["queue_overflow_policy"];
}

export interface GatewayQueuedStreamEvent
	extends SessionStreamEvent<GatewayQueuedEventPayload> {
	readonly kind: "queue.queued";
	readonly scope: "session";
}

export interface GatewayRejectedStreamEvent
	extends SessionStreamEvent<GatewayRejectedEventPayload> {
	readonly kind: "queue.rejected";
	readonly scope: "session";
}

interface GatewayAdmissionResultBase {
	readonly ingress: IngressDTO;
	readonly post_queue_length: number;
	readonly queue_mutation: GatewayQueueMutation;
}

export interface GatewayAcceptedAdmissionResult
	extends GatewayAdmissionResultBase {
	readonly disposition: "accepted";
	readonly queue_mutation: GatewayNoQueueMutation;
}

export interface GatewayQueuedAdmissionResult extends GatewayAdmissionResultBase {
	readonly disposition: "queued";
	readonly queue_mutation: GatewayAppendNewestQueueMutation;
	readonly queue_event: GatewayQueuedStreamEvent;
}

export interface GatewayRejectedAdmissionResult
	extends GatewayAdmissionResultBase {
	readonly disposition: "rejected";
	readonly queue_mutation: GatewayNoQueueMutation;
	readonly queue_event: GatewayRejectedStreamEvent;
}

export type GatewayAdmissionResult =
	| GatewayAcceptedAdmissionResult
	| GatewayQueuedAdmissionResult
	| GatewayRejectedAdmissionResult;

export interface AdmitIngressInput {
	readonly gatewayDefaults: GatewayDefaults;
	readonly session_id: string;
	readonly ingress: GatewayIngressInput;
	readonly allocateIngressId: GatewayIngressIdAllocator;
	readonly session: GatewayAdmissionSnapshot;
	readonly allocateQueueEventMetadata: GatewayQueueEventMetadataAllocator;
}

export function admitIngress(input: AdmitIngressInput): GatewayAdmissionResult {
	const ingress = createIngress(input);
	const queuedIngressCount = input.session.queued_ingress.length;

	if (!input.session.has_active_turn && queuedIngressCount === 0) {
		const acceptedAdmission = {
			disposition: "accepted",
			ingress,
			post_queue_length: queuedIngressCount,
			queue_mutation: Object.freeze({ kind: "none" }),
		} satisfies GatewayAcceptedAdmissionResult;

		Object.defineProperty(acceptedAdmission, gatewayAcceptedAdmissionBrand, {
			value: true,
		});

		return Object.freeze(acceptedAdmission);
	}

	if (
		queuedIngressCount < input.gatewayDefaults.max_queued_ingress_per_session
	) {
		const postQueueLength = queuedIngressCount + 1;
		return Object.freeze({
			disposition: "queued",
			ingress,
			post_queue_length: postQueueLength,
			queue_mutation: Object.freeze({
				kind: "append_newest",
				ingress_id: ingress.ingress_id,
			}),
			queue_event: createQueuedEvent(input, ingress, postQueueLength),
		});
	}

	return Object.freeze({
		disposition: "rejected",
		ingress,
		post_queue_length: queuedIngressCount,
		queue_mutation: Object.freeze({ kind: "none" }),
		queue_event: createRejectedEvent(input, ingress, queuedIngressCount),
	});
}

function createIngress(input: AdmitIngressInput): IngressDTO {
	return parseIngressDTO({
		ingress_id: input.allocateIngressId(),
		session_id: input.session_id,
		channel: input.ingress.channel,
		user_id: input.ingress.user_id,
		message_parts: input.ingress.message_parts,
		...(input.ingress.attachments !== undefined
			? { attachments: input.ingress.attachments }
			: {}),
		received_at: input.ingress.received_at,
		...(input.ingress.metadata !== undefined
			? { metadata: input.ingress.metadata }
			: {}),
	});
}

function createQueuedEvent(
	input: AdmitIngressInput,
	ingress: IngressDTO,
	queueLength: number,
): GatewayQueuedStreamEvent {
	return createQueueEvent(
		input,
		ingress,
		"queue.queued",
		{
			session_id: input.session_id,
			ingress_id: ingress.ingress_id,
			queue_length: queueLength,
		},
	) as GatewayQueuedStreamEvent;
}

function createRejectedEvent(
	input: AdmitIngressInput,
	ingress: IngressDTO,
	queueLength: number,
): GatewayRejectedStreamEvent {
	return createQueueEvent(
		input,
		ingress,
		"queue.rejected",
		{
			session_id: input.session_id,
			ingress_id: ingress.ingress_id,
			queue_length: queueLength,
			reason: input.gatewayDefaults.queue_overflow_policy,
		},
	) as GatewayRejectedStreamEvent;
}

function createQueueEvent<TPayload extends GatewayQueuedEventPayload>(
	input: AdmitIngressInput,
	ingress: IngressDTO,
	kind: GatewayQueuedStreamEvent["kind"] | GatewayRejectedStreamEvent["kind"],
	payload: TPayload,
): SessionStreamEvent<TPayload> {
	const metadata = input.allocateQueueEventMetadata();
	const parsed = parseStreamEvent({
		event_id: metadata.event_id,
		session_id: input.session_id,
		scope: "session",
		sequence: metadata.sequence,
		kind,
		timestamp: metadata.timestamp,
		visibility: metadata.visibility,
		payload: {
			...payload,
			session_id: input.session_id,
			ingress_id: ingress.ingress_id,
		},
	});

	if (parsed.scope !== "session") {
		throw new Error("Expected queue events to remain session-scoped.");
	}

	return parsed as unknown as SessionStreamEvent<TPayload>;
}

export function isGatewayAcceptedAdmissionResult(
	value: unknown,
): value is GatewayAcceptedAdmissionResult {
	if (value === null || typeof value !== "object") {
		return false;
	}

	const candidate = value as GatewayAcceptedAdmissionResult & {
		readonly [gatewayAcceptedAdmissionBrand]?: boolean;
	};

	return (
		candidate[gatewayAcceptedAdmissionBrand] === true &&
		candidate.disposition === "accepted" &&
		candidate.queue_mutation.kind === "none" &&
		typeof candidate.ingress?.session_id === "string" &&
		typeof candidate.ingress?.ingress_id === "string"
	);
}