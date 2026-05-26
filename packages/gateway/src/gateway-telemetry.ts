import type { StreamEvent, StreamEventPayload } from "@argentum/contracts";

// ── GatewayTelemetryCorrelation ─────────────────────────────────

/**
 * Correlation identifiers required at the gateway boundary before
 * a {@link StreamEvent} is handed off to telemetry persistence.
 *
 * Turn-scoped events require both `session_id` and `turn_id`.
 * Session-scoped events require `session_id`; `turn_id` is optional.
 */
export interface GatewayTelemetryCorrelation {
  readonly session_id: string;
  readonly turn_id?: string;
}

// ── assertGatewayTelemetryEvent ─────────────────────────────────

/**
 * Validates that a gateway-emitted {@link StreamEvent} carries the
 * required correlation identifiers for its declared scope.
 *
 * Throws if a turn-scoped event is missing `turn_id` or `session_id`,
 * or if a session-scoped event is missing `session_id`.
 */
export function assertGatewayTelemetryEvent(
  event: StreamEvent<StreamEventPayload>,
  correlation: GatewayTelemetryCorrelation,
): void {
  if (!correlation.session_id || typeof correlation.session_id !== "string") {
    throw new Error(
      "Gateway telemetry event requires a non-empty session_id in its correlation.",
    );
  }

  if (event.scope === "turn") {
    if (!correlation.turn_id || typeof correlation.turn_id !== "string") {
      throw new Error(
        "Turn-scoped gateway telemetry event requires a non-empty turn_id in its correlation.",
      );
    }

    if (event.session_id !== correlation.session_id) {
      throw new Error(
        "Turn-scoped gateway telemetry event session_id does not match correlation.",
      );
    }

    if (!("turn_id" in event) || typeof event.turn_id !== "string") {
      throw new Error(
        "Turn-scoped gateway telemetry event must carry a turn_id field.",
      );
    }

    if (event.turn_id !== correlation.turn_id) {
      throw new Error(
        "Turn-scoped gateway telemetry event turn_id does not match correlation.",
      );
    }

    return;
  }

  // session-scoped
  if (event.session_id !== correlation.session_id) {
    throw new Error(
      "Session-scoped gateway telemetry event session_id does not match correlation.",
    );
  }
}

// ── TurnSequenceCounter ─────────────────────────────────────────

/**
 * Produces strictly increasing sequence values for events emitted
 * within a single turn's lifetime.
 *
 * The first call to {@link nextSequence} returns `1`.
 */
export interface TurnSequenceCounter {
  nextSequence(): number;
}

/**
 * Creates a {@link TurnSequenceCounter} starting at 0 so the first
 * emitted event receives sequence `1`.
 */
export function createTurnSequenceCounter(): TurnSequenceCounter {
  let current = 0;

  return Object.freeze({
    nextSequence(): number {
      current += 1;
      return current;
    },
  });
}
