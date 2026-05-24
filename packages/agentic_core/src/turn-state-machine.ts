import type { DecisionKind, TurnEnvelope, TurnState } from "@argentum/contracts";

// ── Transition Metadata ──────────────────────────────────────────

export interface TransitionMetadata {
  readonly decisionKind?: DecisionKind;
  readonly reason?: string;
}

// ── Turn Event Emitter ───────────────────────────────────────────

export interface TurnEventEmitter {
  emit(eventName: string, envelope: TurnEnvelope, metadata?: TransitionMetadata): void;
}

// ── Transition Error ─────────────────────────────────────────────

export class TransitionError extends Error {
  public readonly from: TurnState;
  public readonly to: TurnState;
  public readonly turnId: string;

  constructor(from: TurnState, to: TurnState, turnId: string) {
    super(`Invalid turn state transition: ${from} -> ${to} (turn_id: ${turnId})`);
    this.name = "TransitionError";
    this.from = from;
    this.to = to;
    this.turnId = turnId;
  }
}

// ── Allowed Transitions ──────────────────────────────────────────
//
// Encodes the 12 directed transition edges from the core-loop state
// machine spec (docs/spec/30-core-loop/core-loop-state-machine.md).
// Terminal states (completed, aborted) have empty target sets.

const ALL_TRANSITIONS: ReadonlyMap<TurnState, ReadonlySet<TurnState>> = new Map([
  ["accepted", new Set<TurnState>(["building_context"])],
  ["building_context", new Set<TurnState>(["inferring"])],
  ["inferring", new Set<TurnState>(["validating"])],
  [
    "validating",
    new Set<TurnState>([
      "building_context",
      "executing_tools",
      "responding",
      "aborted",
    ]),
  ],
  ["executing_tools", new Set<TurnState>(["compacting"])],
  ["compacting", new Set<TurnState>(["building_context"])],
  ["responding", new Set<TurnState>(["finalizing"])],
  ["finalizing", new Set<TurnState>(["completed", "aborted"])],
  ["completed", new Set<TurnState>()],
  ["aborted", new Set<TurnState>()],
]);

export const ALLOWED_TRANSITIONS: ReadonlyMap<
  TurnState,
  ReadonlySet<TurnState>
> = ALL_TRANSITIONS;

// ── Step Increment Transitions ───────────────────────────────────
//
// step_count measures completed inference decision cycles.
// It increments only on these transition edges (see spec step-semantics):
//
//   compacting -> building_context   (tool_calls decision completed compaction)
//   validating -> aborted            (abort decision completed terminal branch)
//   finalizing -> completed          (respond/clarify decision completed terminal branch)
//
// finalizing -> aborted is a system interrupt, not a decision completion,
// so it does NOT increment step_count.
//
// Keys use "from->to" string format for stable Set<string> membership.
// This is fragile to state-name typos but self-documenting and trivial
// to inspect in test output.

export const STEP_INCREMENT_TRANSITIONS: ReadonlySet<string> = new Set([
  "compacting->building_context",
  "validating->aborted",
  "finalizing->completed",
]);

// ── Validation Functions ─────────────────────────────────────────

export function isValidTransition(from: TurnState, to: TurnState): boolean {
  const targets = ALLOWED_TRANSITIONS.get(from);
  return targets !== undefined && targets.has(to);
}

export function isTerminal(state: TurnState): boolean {
  return state === "completed" || state === "aborted";
}

// ── Transition Execution ─────────────────────────────────────────

export function executeTransition(
  envelope: TurnEnvelope,
  to: TurnState,
  metadata?: TransitionMetadata,
  eventEmitter?: TurnEventEmitter,
): TurnEnvelope {
  const from = envelope.state;

  if (!isValidTransition(from, to)) {
    throw new TransitionError(from, to, envelope.turn_id);
  }

  const transitionKey = `${from}->${to}`;
  const stepIncrement = STEP_INCREMENT_TRANSITIONS.has(transitionKey) ? 1 : 0;

  // Spread the original envelope so optional properties are handled
  // correctly under exactOptionalPropertyTypes, then override the
  // fields that change.
  const newEnvelope: TurnEnvelope = {
    ...envelope,
    state: to,
    step_count: envelope.step_count + stepIncrement,
    updated_at: new Date().toISOString(),
  };

  eventEmitter?.emit(`turn.${to}`, newEnvelope, metadata);

  return newEnvelope;
}
