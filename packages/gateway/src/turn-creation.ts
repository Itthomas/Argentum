import {
	type GatewayAcceptedAdmissionResult,
	isGatewayAcceptedAdmissionResult,
} from "./ingress-admission.js";
import {
	isGatewayExclusiveTurnCreationAuthority,
	type GatewayExclusiveTurnCreationAuthority,
} from "./active-turn-claim.js";
import {
	type IngressDTO,
	type StreamEventPayload,
	type StreamEventVisibility,
	type TurnBudget,
	type TurnEnvelope,
	type TurnStreamEvent,
	parseIngressDTO,
	parseStreamEvent,
	parseTurnEnvelope,
} from "@argentum/contracts";

const gatewayTurnStartHandoffBrand = Symbol("gateway.turn-start-handoff");
const consumedTurnStartHandoffs = new WeakSet<object>();
const consumedTurnCreationAuthorities = new WeakSet<object>();

export type GatewayTurnGovernorDefaults = Readonly<
	Pick<
		TurnBudget,
		"max_inference_steps" | "max_repair_attempts" | "max_wall_clock_ms"
	>
>;

export interface GatewayTurnStartHandoff {
	readonly ingress: IngressDTO;
	readonly authority: GatewayExclusiveTurnCreationAuthority;
	readonly session_id: string;
	readonly ingress_id: string;
}

export interface CreateGatewayTurnStartHandoffInput {
	readonly ingress: IngressDTO;
	readonly authority: GatewayExclusiveTurnCreationAuthority;
}

export interface CreateGatewayTurnStartHandoffFromAcceptedAdmissionInput {
	readonly admission: GatewayAcceptedAdmissionResult;
	readonly authority: GatewayExclusiveTurnCreationAuthority;
}

export interface GatewayTurnMetadata {
	readonly turn_id: string;
	readonly created_at: string;
	readonly updated_at: string;
}

export type GatewayTurnMetadataAllocator = () => GatewayTurnMetadata;

export interface GatewayTurnEventMetadata {
	readonly event_id: string;
	readonly sequence: number;
	readonly timestamp: string;
	readonly visibility: StreamEventVisibility;
}

export type GatewayTurnEventMetadataAllocator = () => GatewayTurnEventMetadata;

export interface GatewayTurnStartedEventPayload extends StreamEventPayload {
	readonly session_id: string;
	readonly ingress_id: string;
	readonly state: "accepted";
}

export interface GatewayTurnStartedStreamEvent
	extends TurnStreamEvent<GatewayTurnStartedEventPayload> {
	readonly kind: "turn.started";
	readonly scope: "turn";
}

export interface CreateTurnFromHandoffInput {
	readonly handoff: GatewayTurnStartHandoff;
	readonly governorDefaults: GatewayTurnGovernorDefaults;
	readonly allocateTurnMetadata: GatewayTurnMetadataAllocator;
	readonly allocateTurnEventMetadata: GatewayTurnEventMetadataAllocator;
}

export interface GatewayTurnCreatedResult {
	readonly turn: TurnEnvelope;
	readonly turn_started_event: GatewayTurnStartedStreamEvent;
}

export function createGatewayTurnStartHandoff(
	input: CreateGatewayTurnStartHandoffInput,
): GatewayTurnStartHandoff {
	const ingress = parseIngressDTO(input.ingress);

	if (!isGatewayExclusiveTurnCreationAuthority(input.authority)) {
		throw new Error(
			"Gateway turn-start handoff requires branded exclusive turn-creation authority.",
		);
	}

	if (input.authority.session_id !== ingress.session_id) {
		throw new Error(
			"Gateway turn-start handoff authority must match the ingress session_id.",
		);
	}

	if (input.authority.ingress_id !== ingress.ingress_id) {
		throw new Error(
			"Gateway turn-start handoff authority must match the ingress ingress_id.",
		);
	}

	const handoff = {
		ingress,
		authority: input.authority,
		session_id: ingress.session_id,
		ingress_id: ingress.ingress_id,
	} satisfies GatewayTurnStartHandoff;

	Object.defineProperty(handoff, gatewayTurnStartHandoffBrand, {
		value: true,
	});

	return Object.freeze(handoff);
}

export function createGatewayTurnStartHandoffFromAcceptedAdmission(
	input: CreateGatewayTurnStartHandoffFromAcceptedAdmissionInput,
): GatewayTurnStartHandoff {
	if (!isGatewayAcceptedAdmissionResult(input.admission)) {
		throw new Error(
			"Gateway turn-start handoff requires the accepted admission branch.",
		);
	}

	return createGatewayTurnStartHandoff({
		ingress: input.admission.ingress,
		authority: input.authority,
	});
}

export function isGatewayTurnStartHandoff(
	value: unknown,
): value is GatewayTurnStartHandoff {
	if (value === null || typeof value !== "object") {
		return false;
	}

	const candidate = value as GatewayTurnStartHandoff & {
		readonly [gatewayTurnStartHandoffBrand]?: boolean;
	};

	return (
		candidate[gatewayTurnStartHandoffBrand] === true &&
		isGatewayExclusiveTurnCreationAuthority(candidate.authority) &&
		typeof candidate.session_id === "string" &&
		typeof candidate.ingress_id === "string" &&
		typeof candidate.ingress?.session_id === "string" &&
		typeof candidate.ingress?.ingress_id === "string" &&
		candidate.ingress.session_id === candidate.session_id &&
		candidate.ingress.ingress_id === candidate.ingress_id &&
		candidate.authority.session_id === candidate.session_id &&
		candidate.authority.ingress_id === candidate.ingress_id
	);
}

export function createTurnFromHandoff(
	input: CreateTurnFromHandoffInput,
): GatewayTurnCreatedResult {
	if (!isGatewayTurnStartHandoff(input.handoff)) {
		throw new Error(
			"Turn creation requires a gateway turn-start handoff created by the gateway.",
		);
	}

	assertGatewayTurnGovernorDefaults(input.governorDefaults);

	if (
		consumedTurnStartHandoffs.has(input.handoff) ||
		consumedTurnCreationAuthorities.has(input.handoff.authority)
	) {
		throw new Error(
			"Turn creation authority is stale or no longer current for the active session turn.",
		);
	}

	const turnMetadata = input.allocateTurnMetadata();
	const turn = parseTurnEnvelope({
		turn_id: turnMetadata.turn_id,
		session_id: input.handoff.session_id,
		ingress_id: input.handoff.ingress_id,
		state: "accepted",
		step_count: 0,
		budget: {
			max_inference_steps: input.governorDefaults.max_inference_steps,
			max_repair_attempts: input.governorDefaults.max_repair_attempts,
			max_wall_clock_ms: input.governorDefaults.max_wall_clock_ms,
			repair_attempts_used: 0,
		},
		context_refs: [],
		compaction_revision: 0,
		created_at: turnMetadata.created_at,
		updated_at: turnMetadata.updated_at,
	});

	const eventMetadata = input.allocateTurnEventMetadata();
	const parsedEvent = parseStreamEvent({
		event_id: eventMetadata.event_id,
		session_id: turn.session_id,
		scope: "turn",
		turn_id: turn.turn_id,
		sequence: eventMetadata.sequence,
		kind: "turn.started",
		timestamp: eventMetadata.timestamp,
		visibility: eventMetadata.visibility,
		payload: {
			session_id: turn.session_id,
			ingress_id: turn.ingress_id,
			state: turn.state,
		},
	});

	if (parsedEvent.scope !== "turn" || parsedEvent.kind !== "turn.started") {
		throw new Error("Expected turn creation to emit one canonical turn.started event.");
	}

	const turnStartedEvent = Object.freeze({
		...parsedEvent,
		payload: Object.freeze({
			session_id: turn.session_id,
			ingress_id: turn.ingress_id,
			state: "accepted" as const,
		}),
	}) as GatewayTurnStartedStreamEvent;

	consumedTurnStartHandoffs.add(input.handoff);
	consumedTurnCreationAuthorities.add(input.handoff.authority);

	return Object.freeze({
		turn,
		turn_started_event: turnStartedEvent,
	});
}

function assertGatewayTurnGovernorDefaults(
	defaults: GatewayTurnGovernorDefaults,
): void {
	assertNonNegativeInteger(
		defaults.max_inference_steps,
		"governorDefaults.max_inference_steps",
	);
	assertNonNegativeInteger(
		defaults.max_repair_attempts,
		"governorDefaults.max_repair_attempts",
	);
	assertNonNegativeInteger(
		defaults.max_wall_clock_ms,
		"governorDefaults.max_wall_clock_ms",
	);
	}

function assertNonNegativeInteger(value: number, fieldName: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(
			`Expected ${fieldName} to be a non-negative integer for turn creation.`,
		);
	}
	}