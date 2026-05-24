import type { TurnEnvelope, TurnState } from "@argentum/contracts";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_TRANSITIONS,
  STEP_INCREMENT_TRANSITIONS,
  TransitionError,
  executeTransition,
  isTerminal,
  isValidTransition,
} from "../src/index.js";
import type { TurnEventEmitter } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────

const ALL_STATES: readonly TurnState[] = [
  "accepted",
  "building_context",
  "inferring",
  "validating",
  "executing_tools",
  "compacting",
  "responding",
  "finalizing",
  "completed",
  "aborted",
];

function makeEnvelope(overrides: Partial<TurnEnvelope> = {}): TurnEnvelope {
  return {
    turn_id: "turn-001",
    session_id: "session-001",
    ingress_id: "ingress-001",
    state: "accepted",
    step_count: 0,
    budget: {
      max_inference_steps: 10,
      max_repair_attempts: 3,
      max_wall_clock_ms: 300_000,
      repair_attempts_used: 0,
    },
    context_refs: [],
    compaction_revision: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Allowed Transitions Map ──────────────────────────────────────

describe("ALLOWED_TRANSITIONS", () => {
  it("contains exactly 10 source states (all TurnState values)", () => {
    const keys = [...ALLOWED_TRANSITIONS.keys()].sort();
    expect(keys).toEqual([...ALL_STATES].sort());
  });

  it("encodes exactly 12 directed transition edges", () => {
    let edgeCount = 0;
    for (const targets of ALLOWED_TRANSITIONS.values()) {
      edgeCount += targets.size;
    }
    expect(edgeCount).toBe(12);
  });

  const expectedEdges: Array<[TurnState, TurnState]> = [
    ["accepted", "building_context"],
    ["building_context", "inferring"],
    ["inferring", "validating"],
    ["validating", "building_context"],
    ["validating", "executing_tools"],
    ["validating", "responding"],
    ["validating", "aborted"],
    ["executing_tools", "compacting"],
    ["compacting", "building_context"],
    ["responding", "finalizing"],
    ["finalizing", "completed"],
    ["finalizing", "aborted"],
  ];

  it.each(expectedEdges)("%s -> %s is allowed", (from, to) => {
    const targets = ALLOWED_TRANSITIONS.get(from);
    expect(targets?.has(to)).toBe(true);
  });
});

// ── STEP_INCREMENT_TRANSITIONS ───────────────────────────────────

describe("STEP_INCREMENT_TRANSITIONS", () => {
  it("contains exactly 3 transitions", () => {
    expect(STEP_INCREMENT_TRANSITIONS.size).toBe(3);
  });

  it("includes compacting->building_context", () => {
    expect(STEP_INCREMENT_TRANSITIONS.has("compacting->building_context")).toBe(true);
  });

  it("includes validating->aborted", () => {
    expect(STEP_INCREMENT_TRANSITIONS.has("validating->aborted")).toBe(true);
  });

  it("includes finalizing->completed", () => {
    expect(STEP_INCREMENT_TRANSITIONS.has("finalizing->completed")).toBe(true);
  });

  it("does NOT include finalizing->aborted (system interrupt, not decision completion)", () => {
    expect(STEP_INCREMENT_TRANSITIONS.has("finalizing->aborted")).toBe(false);
  });
});

// ── isValidTransition ────────────────────────────────────────────

describe("isValidTransition", () => {
  it("returns true for all 12 allowed transitions", () => {
    const allowed: Array<[TurnState, TurnState]> = [
      ["accepted", "building_context"],
      ["building_context", "inferring"],
      ["inferring", "validating"],
      ["validating", "building_context"],
      ["validating", "executing_tools"],
      ["validating", "responding"],
      ["validating", "aborted"],
      ["executing_tools", "compacting"],
      ["compacting", "building_context"],
      ["responding", "finalizing"],
      ["finalizing", "completed"],
      ["finalizing", "aborted"],
    ];
    for (const [from, to] of allowed) {
      expect(isValidTransition(from, to)).toBe(true);
    }
  });

  it("returns false for self-transitions", () => {
    for (const state of ALL_STATES) {
      expect(isValidTransition(state, state)).toBe(false);
    }
  });

  it("returns false for known-invalid pairs", () => {
    const invalid: Array<[TurnState, TurnState]> = [
      ["accepted", "completed"],
      ["accepted", "inferring"],
      ["building_context", "executing_tools"],
      ["inferring", "responding"],
      ["executing_tools", "completed"],
      ["compacting", "completed"],
      ["responding", "building_context"],
      ["finalizing", "accepted"],
    ];
    for (const [from, to] of invalid) {
      expect(isValidTransition(from, to)).toBe(false);
    }
  });
});

// ── isTerminal ───────────────────────────────────────────────────

describe("isTerminal", () => {
  it("returns true for completed", () => {
    expect(isTerminal("completed")).toBe(true);
  });

  it("returns true for aborted", () => {
    expect(isTerminal("aborted")).toBe(true);
  });

  it.each(
    ALL_STATES.filter((s) => s !== "completed" && s !== "aborted"),
  )("returns false for non-terminal state %s", (state) => {
    expect(isTerminal(state)).toBe(false);
  });
});

// ── Terminal state guard ─────────────────────────────────────────

describe("terminal state guard", () => {
  it("isValidTransition returns false for any transition from completed", () => {
    for (const to of ALL_STATES) {
      expect(isValidTransition("completed", to)).toBe(false);
    }
  });

  it("isValidTransition returns false for any transition from aborted", () => {
    for (const to of ALL_STATES) {
      expect(isValidTransition("aborted", to)).toBe(false);
    }
  });

  it("executeTransition throws TransitionError when from=completed", () => {
    const env = makeEnvelope({ state: "completed" });
    expect(() => executeTransition(env, "building_context")).toThrow(TransitionError);
  });

  it("executeTransition throws TransitionError when from=aborted", () => {
    const env = makeEnvelope({ state: "aborted" });
    expect(() => executeTransition(env, "building_context")).toThrow(TransitionError);
  });
});

// ── executeTransition: valid transitions ─────────────────────────

describe("executeTransition: valid transitions", () => {
  it("updates state to the target state", () => {
    const env = makeEnvelope({ state: "accepted" });
    const result = executeTransition(env, "building_context");
    expect(result.state).toBe("building_context");
  });

  it("updates updated_at to a current timestamp", () => {
    const before = new Date().toISOString();
    const env = makeEnvelope({ state: "accepted" });
    const result = executeTransition(env, "building_context");
    expect(result.updated_at >= before).toBe(true);
    expect(result.updated_at).not.toBe(env.updated_at);
  });

  it("preserves identity fields (turn_id, session_id, ingress_id, created_at)", () => {
    const env = makeEnvelope({ state: "accepted" });
    const result = executeTransition(env, "building_context");
    expect(result.turn_id).toBe(env.turn_id);
    expect(result.session_id).toBe(env.session_id);
    expect(result.ingress_id).toBe(env.ingress_id);
    expect(result.created_at).toBe(env.created_at);
  });

  it("preserves budget, context_refs, compaction_revision unchanged", () => {
    const env = makeEnvelope({ state: "accepted" });
    const result = executeTransition(env, "building_context");
    expect(result.budget).toBe(env.budget);
    expect(result.context_refs).toBe(env.context_refs);
    expect(result.compaction_revision).toBe(env.compaction_revision);
  });
});

// ── executeTransition: step_count increments ─────────────────────

describe("executeTransition: step_count increments", () => {
  it("compacting -> building_context increments step_count", () => {
    const env = makeEnvelope({ state: "compacting", step_count: 3 });
    const result = executeTransition(env, "building_context");
    expect(result.step_count).toBe(4);
  });

  it("validating -> aborted increments step_count", () => {
    const env = makeEnvelope({ state: "validating", step_count: 5 });
    const result = executeTransition(env, "aborted");
    expect(result.step_count).toBe(6);
  });

  it("finalizing -> completed increments step_count", () => {
    const env = makeEnvelope({ state: "finalizing", step_count: 1 });
    const result = executeTransition(env, "completed");
    expect(result.step_count).toBe(2);
  });
});

// ── executeTransition: step_count does NOT increment ─────────────

describe("executeTransition: step_count does NOT increment", () => {
  const nonIncrementTransitions: Array<[TurnState, TurnState]> = [
    ["accepted", "building_context"],
    ["building_context", "inferring"],
    ["inferring", "validating"],
    ["validating", "building_context"],
    ["validating", "executing_tools"],
    ["validating", "responding"],
    ["executing_tools", "compacting"],
    ["responding", "finalizing"],
    ["finalizing", "aborted"],
  ];

  it.each(nonIncrementTransitions)(
    "%s -> %s preserves step_count",
    (from, to) => {
      const env = makeEnvelope({ state: from, step_count: 7 });
      const result = executeTransition(env, to);
      expect(result.step_count).toBe(7);
    },
  );
});

// ── executeTransition: invalid transitions throw ─────────────────

describe("executeTransition: invalid transitions", () => {
  it("throws TransitionError for invalid from->to", () => {
    const env = makeEnvelope({ state: "accepted" });
    expect(() => executeTransition(env, "completed")).toThrow(TransitionError);
  });

  it("throws TransitionError for self-transition", () => {
    const env = makeEnvelope({ state: "building_context" });
    expect(() => executeTransition(env, "building_context")).toThrow(TransitionError);
  });
});

// ── TransitionError shape ────────────────────────────────────────

describe("TransitionError", () => {
  it("is an instance of Error", () => {
    const err = new TransitionError("accepted", "completed", "turn-001");
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name", () => {
    const err = new TransitionError("accepted", "completed", "turn-001");
    expect(err.name).toBe("TransitionError");
  });

  it("message includes from, to, and turn_id", () => {
    const err = new TransitionError("inferring", "responding", "turn-xyz");
    expect(err.message).toContain("inferring");
    expect(err.message).toContain("responding");
    expect(err.message).toContain("turn-xyz");
  });

  it("exposes from, to, and turnId as public properties", () => {
    const err = new TransitionError("validating", "completed", "turn-abc");
    expect(err.from).toBe("validating");
    expect(err.to).toBe("completed");
    expect(err.turnId).toBe("turn-abc");
  });
});

// ── executeTransition: error thrown includes correct details ─────

describe("executeTransition: thrown error details", () => {
  it("thrown TransitionError includes from, to, turn_id", () => {
    const env = makeEnvelope({ state: "accepted", turn_id: "turn-bad" });
    let caught: TransitionError | null = null;
    try {
      executeTransition(env, "completed");
    } catch (e) {
      caught = e as TransitionError;
    }
    expect(caught).toBeInstanceOf(TransitionError);
    expect(caught!.from).toBe("accepted");
    expect(caught!.to).toBe("completed");
    expect(caught!.turnId).toBe("turn-bad");
    expect(caught!.message).toContain("accepted");
    expect(caught!.message).toContain("completed");
    expect(caught!.message).toContain("turn-bad");
  });
});

// ── Multi-step sequence: single tool_calls cycle ─────────────────

describe("multi-step sequence", () => {
  it("tool_calls cycle: accepted->...->compacting->building_context yields step_count=1", () => {
    let env = makeEnvelope({ state: "accepted", step_count: 0 });

    env = executeTransition(env, "building_context"); // step 0
    expect(env.state).toBe("building_context");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "inferring");
    expect(env.state).toBe("inferring");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "validating");
    expect(env.state).toBe("validating");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "executing_tools");
    expect(env.state).toBe("executing_tools");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "compacting");
    expect(env.state).toBe("compacting");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "building_context"); // step increment
    expect(env.state).toBe("building_context");
    expect(env.step_count).toBe(1);
  });
});

// ── Multi-cycle sequence: two tool_calls cycles ──────────────────

describe("multi-cycle sequence", () => {
  function runToolCallsCycle(env: TurnEnvelope): TurnEnvelope {
    // Assumes env is in building_context (or accepted).
    // If in accepted, transition to building_context first.
    let e = env.state === "accepted"
      ? executeTransition(env, "building_context")
      : env;

    e = executeTransition(e, "inferring");
    e = executeTransition(e, "validating");
    e = executeTransition(e, "executing_tools");
    e = executeTransition(e, "compacting");
    e = executeTransition(e, "building_context"); // step_count +1
    return e;
  }

  it("two tool_calls cycles: step_count goes 0 -> 1 -> 2", () => {
    let env = makeEnvelope({ state: "accepted", step_count: 0 });

    // Cycle 1
    env = runToolCallsCycle(env);
    expect(env.state).toBe("building_context");
    expect(env.step_count).toBe(1);

    // Cycle 2
    env = runToolCallsCycle(env);
    expect(env.state).toBe("building_context");
    expect(env.step_count).toBe(2);
  });
});

// ── Event emitter contract ───────────────────────────────────────

describe("TurnEventEmitter", () => {
  it("is called with correct event name and envelope on valid transition", () => {
    const calls: Array<{ eventName: string; envelope: TurnEnvelope }> = [];
    const emitter: TurnEventEmitter = {
      emit(eventName, envelope) {
        calls.push({ eventName, envelope });
      },
    };

    const env = makeEnvelope({ state: "accepted" });
    const result = executeTransition(env, "building_context", undefined, emitter);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventName).toBe("turn.building_context");
    expect(calls[0]!.envelope).toBe(result);
  });

  it("passes metadata to emitter when provided", () => {
    const calls: Array<{
      eventName: string;
      envelope: TurnEnvelope;
      metadata?: object;
    }> = [];
    const emitter: TurnEventEmitter = {
      emit(eventName, envelope, metadata) {
        calls.push({ eventName, envelope, metadata });
      },
    };

    const env = makeEnvelope({ state: "responding" });
    const meta = { decisionKind: "respond" as const, reason: "final response" };
    const result = executeTransition(env, "finalizing", meta, emitter);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.eventName).toBe("turn.finalizing");
    expect(calls[0]!.envelope).toBe(result);
    expect(calls[0]!.metadata).toEqual(meta);
  });

  it("no error when emitter is omitted", () => {
    const env = makeEnvelope({ state: "accepted" });
    expect(() => executeTransition(env, "building_context")).not.toThrow();
  });

  it("no error when emitter is undefined", () => {
    const env = makeEnvelope({ state: "accepted" });
    expect(() =>
      executeTransition(env, "building_context", undefined, undefined),
    ).not.toThrow();
  });

  it("emitter is NOT called when transition is invalid", () => {
    const calls: unknown[] = [];
    const emitter: TurnEventEmitter = {
      emit() {
        calls.push(null);
      },
    };

    const env = makeEnvelope({ state: "accepted" });
    expect(() =>
      executeTransition(env, "completed", undefined, emitter),
    ).toThrow(TransitionError);
    expect(calls).toHaveLength(0);
  });
});

// ── Immutability ─────────────────────────────────────────────────

describe("executeTransition: immutability", () => {
  it("returns a new object and does not mutate the input envelope", () => {
    const env = makeEnvelope({ state: "accepted", step_count: 0 });
    const originalState = env.state;
    const originalStepCount = env.step_count;
    const originalUpdatedAt = env.updated_at;

    const result = executeTransition(env, "building_context");

    // Input unchanged
    expect(env.state).toBe(originalState);
    expect(env.step_count).toBe(originalStepCount);
    expect(env.updated_at).toBe(originalUpdatedAt);

    // Result is different object
    expect(result).not.toBe(env);
    expect(result.state).toBe("building_context");
  });
});

// ── Full happy-path: respond path ────────────────────────────────

describe("full happy-path: respond", () => {
  it("accepted -> building_context -> inferring -> validating -> responding -> finalizing -> completed", () => {
    let env = makeEnvelope({ state: "accepted", step_count: 0 });

    env = executeTransition(env, "building_context");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "inferring");
    env = executeTransition(env, "validating");
    env = executeTransition(env, "responding");
    env = executeTransition(env, "finalizing");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "completed");
    expect(env.state).toBe("completed");
    expect(env.step_count).toBe(1);
    expect(isTerminal(env.state)).toBe(true);
  });
});

// ── Abort path: decision-driven abort ────────────────────────────

describe("abort path: decision-driven", () => {
  it("accepted -> building_context -> inferring -> validating -> aborted increments step_count", () => {
    let env = makeEnvelope({ state: "accepted", step_count: 0 });

    env = executeTransition(env, "building_context");
    env = executeTransition(env, "inferring");
    env = executeTransition(env, "validating");
    expect(env.step_count).toBe(0);

    env = executeTransition(env, "aborted");
    expect(env.state).toBe("aborted");
    expect(env.step_count).toBe(1);
    expect(isTerminal(env.state)).toBe(true);
  });
});

// ── Finalizing -> aborted (system interrupt, no step increment) ──

describe("finalizing -> aborted (system interrupt)", () => {
  it("does NOT increment step_count", () => {
    const env = makeEnvelope({ state: "finalizing", step_count: 3 });
    const result = executeTransition(env, "aborted");
    expect(result.state).toBe("aborted");
    expect(result.step_count).toBe(3);
    expect(isTerminal(result.state)).toBe(true);
  });
});

// ── Repair re-entry: validating -> building_context ──────────────

describe("repair re-entry", () => {
  it("validating -> building_context preserves step_count", () => {
    const env = makeEnvelope({ state: "validating", step_count: 2 });
    const result = executeTransition(env, "building_context");
    expect(result.state).toBe("building_context");
    expect(result.step_count).toBe(2);
  });
});
