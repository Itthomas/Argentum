import type {
  ActionDecision,
  ContentRef,
  ContextItem,
  TurnBudget,
  TurnEnvelope,
  TurnState,
} from "@argentum/contracts";
import { ActionDecisionValidationError } from "@argentum/contracts";
import { describe, expect, it } from "vitest";

import { EpisodicMemory, validateAndRepair } from "../src/index.js";
import type { ValidationOutcome } from "../src/index.js";

// ── Factory helpers ──────────────────────────────────────────────

function makeTurnBudget(
  overrides: Partial<TurnBudget> = {},
): TurnBudget {
  return {
    max_inference_steps: 10,
    max_repair_attempts: 3,
    max_wall_clock_ms: 120_000,
    repair_attempts_used: 0,
    ...overrides,
  };
}

function makeTurnEnvelope(
  overrides: Partial<TurnEnvelope> = {},
): TurnEnvelope {
  return {
    turn_id: "turn-001",
    session_id: "session-001",
    ingress_id: "ingress-001",
    state: "validating" as TurnState,
    step_count: 1,
    budget: makeTurnBudget(),
    context_refs: [],
    compaction_revision: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeValidRespondDecision(
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-001",
    kind: "respond",
    message: "Hello, how can I help?",
    ...overrides,
  };
}

function makeValidToolCallsDecision(
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-002",
    kind: "tool_calls",
    tool_calls: [{ tool_name: "read_file", arguments: { path: "/x" } }],
    ...overrides,
  };
}

function makeValidClarifyDecision(
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-003",
    kind: "clarify",
    message: "Which file do you want to read?",
    ...overrides,
  };
}

function makeValidAbortDecision(
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-004",
    kind: "abort",
    message: "Cannot proceed due to policy restriction.",
    ...overrides,
  };
}

// ── Valid decision paths ─────────────────────────────────────────

describe("validateAndRepair — valid decisions", () => {
  const memory = new EpisodicMemory("session-valid");
  const envelope = makeTurnEnvelope();

  it("returns valid for a respond decision", () => {
    const decision = makeValidRespondDecision();
    const result = validateAndRepair(decision, envelope, memory);
    expect(result.outcome).toBe("valid");
    if (result.outcome === "valid") {
      expect(result.decision.decision_id).toBe(decision.decision_id);
      expect(result.decision.kind).toBe("respond");
    }
  });

  it("returns valid for a tool_calls decision", () => {
    const decision = makeValidToolCallsDecision();
    const result = validateAndRepair(decision, envelope, memory);
    expect(result.outcome).toBe("valid");
    if (result.outcome === "valid") {
      expect(result.decision.kind).toBe("tool_calls");
    }
  });

  it("returns valid for a clarify decision", () => {
    const decision = makeValidClarifyDecision();
    const result = validateAndRepair(decision, envelope, memory);
    expect(result.outcome).toBe("valid");
    if (result.outcome === "valid") {
      expect(result.decision.kind).toBe("clarify");
    }
  });

  it("returns valid for an abort decision", () => {
    const decision = makeValidAbortDecision();
    const result = validateAndRepair(decision, envelope, memory);
    expect(result.outcome).toBe("valid");
    if (result.outcome === "valid") {
      expect(result.decision.kind).toBe("abort");
    }
  });
});

// ── Schema failure — missing fields ─────────────────────────────

describe("validateAndRepair — schema failures", () => {
  it("returns repair for a decision missing decision_id", () => {
    const memory = new EpisodicMemory("session-missing-id");
    const envelope = makeTurnEnvelope();
    const invalidDecision = { kind: "respond", message: "Hi" } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");
  });

  it("returns repair for a decision with invalid kind", () => {
    const memory = new EpisodicMemory("session-bad-kind");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-bad",
      kind: "invalid_kind",
      message: "Hi",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");
  });

  it("returns repair for respond kind missing message", () => {
    const memory = new EpisodicMemory("session-no-msg");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-no-msg",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    // parseActionDecision catches missing message for respond
    expect(result.outcome).toBe("repair");
  });

  it("returns repair for tool_calls kind missing tool_calls array", () => {
    const memory = new EpisodicMemory("session-no-tc");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-no-tc",
      kind: "tool_calls",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    // parseActionDecision catches missing tool_calls for tool_calls kind
    expect(result.outcome).toBe("repair");
  });

  it("returns repair for tool_calls kind with empty tool_calls array", () => {
    const memory = new EpisodicMemory("session-empty-tc");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-empty-tc",
      kind: "tool_calls",
      tool_calls: [],
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    // parseActionDecision catches empty tool_calls array
    expect(result.outcome).toBe("repair");
  });
});

// ── Repair feedback stored in memory ────────────────────────────

describe("validateAndRepair — repair feedback", () => {
  it("stores repair feedback in episodic memory", () => {
    const memory = new EpisodicMemory("session-feedback");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-fb",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");

    // Feedback should be in memory
    const recent = memory.getRecent(1);
    expect(recent).toHaveLength(1);
    const entry = recent[0]!;
    expect(entry.layer).toBe("system");
    expect(entry.context_id).toBe("repair:dec-fb");
    expect(entry.origin).toBe("repair");
    expect(entry.role).toBe("system");
    expect(entry.retention).toBe("rolling");
  });

  it("returns backing text for repair feedback persistence", () => {
    const memory = new EpisodicMemory("session-feedback-text");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-feedback-text",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");

    if (result.outcome === "repair") {
      expect(result.feedbackText).toContain(
        "Validation failed for decision dec-feedback-text:",
      );
      expect(result.feedbackText).toContain(
        "Please re-generate with corrected structure.",
      );
      expect(result.feedback.context_id).toBe("repair:dec-feedback-text");
    }
  });

  it("repair feedback has correct content_ref shape", () => {
    const memory = new EpisodicMemory("session-cref");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-cref",
      kind: "tool_calls",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");

    const entry = memory.getRecent(1)[0]!;
    expect(entry.content_ref.kind).toBe("text");
    expect(entry.content_ref.storage_area).toBe("working");
    expect(entry.content_ref.retention).toBe("session");
    expect(entry.content_ref.ref_id).toBe("repair:dec-cref");
    expect(entry.content_ref.locator).toBe("repair:dec-cref");
  });

  it("repair feedback token_estimate is derived from feedback text", () => {
    const memory = new EpisodicMemory("session-tokens");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-tokens",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");

    const entry = memory.getRecent(1)[0]!;
    expect(entry.token_estimate).toBeGreaterThan(0);
    // token_estimate should be roughly bytes/4
    expect(typeof entry.token_estimate).toBe("number");
  });

  it("repair feedback context_id is deterministic", () => {
    const memory1 = new EpisodicMemory("session-det-1");
    const memory2 = new EpisodicMemory("session-det-2");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-det",
      kind: "respond",
    } as unknown as ActionDecision;

    validateAndRepair(invalidDecision, envelope, memory1);
    validateAndRepair(invalidDecision, envelope, memory2);

    const entry1 = memory1.getRecent(1)[0]!;
    const entry2 = memory2.getRecent(1)[0]!;
    expect(entry1.context_id).toBe("repair:dec-det");
    expect(entry2.context_id).toBe("repair:dec-det");
    expect(entry1.context_id).toBe(entry2.context_id);
  });

  it("repair feedback uses canonical 'system' layer", () => {
    const memory = new EpisodicMemory("session-layer");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-layer",
      kind: "respond",
    } as unknown as ActionDecision;

    validateAndRepair(invalidDecision, envelope, memory);
    const entry = memory.getRecent(1)[0]!;
    // Per CRITICAL C1 resolution: uses existing canonical "system" layer
    expect(entry.layer).toBe("system");
  });
});

// ── Repair attempt counter ──────────────────────────────────────

describe("validateAndRepair — repair_attempts_used", () => {
  it("increments repair_attempts_used on repair outcome", () => {
    const memory = new EpisodicMemory("session-incr");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 0, max_repair_attempts: 3 }),
    });
    const invalidDecision = {
      decision_id: "dec-incr",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");
    if (result.outcome === "repair") {
      expect(result.updatedEnvelope.budget.repair_attempts_used).toBe(1);
    }
  });

  it("does NOT increment repair_attempts_used on valid outcome", () => {
    const memory = new EpisodicMemory("session-valid-noincr");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 2, max_repair_attempts: 3 }),
    });
    const decision = makeValidRespondDecision();

    const result = validateAndRepair(decision, envelope, memory);
    expect(result.outcome).toBe("valid");
    // Input envelope should be unchanged
    expect(envelope.budget.repair_attempts_used).toBe(2);
  });

  it("does NOT increment repair_attempts_used on abort due to exhaustion", () => {
    const memory = new EpisodicMemory("session-abort-noincr");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 3, max_repair_attempts: 3 }),
    });
    const invalidDecision = {
      decision_id: "dec-abort",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("abort");
    if (result.outcome === "abort") {
      // repair_attempts_used must NOT be incremented on abort
      expect(result.updatedEnvelope.budget.repair_attempts_used).toBe(3);
    }
    // Input envelope should be unchanged
    expect(envelope.budget.repair_attempts_used).toBe(3);
  });
});

// ── Repair exhaustion → abort ───────────────────────────────────

describe("validateAndRepair — repair exhaustion", () => {
  it("returns abort when repair_attempts_used equals max_repair_attempts", () => {
    const memory = new EpisodicMemory("session-exhaust");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 3, max_repair_attempts: 3 }),
    });
    const invalidDecision = {
      decision_id: "dec-exhaust",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("abort");
    if (result.outcome === "abort") {
      expect(result.reason).toBe("repair_attempts_exhausted");
    }
  });

  it("returns repair when one attempt remains below limit", () => {
    const memory = new EpisodicMemory("session-one-left");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 2, max_repair_attempts: 3 }),
    });
    const invalidDecision = {
      decision_id: "dec-one-left",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");
    if (result.outcome === "repair") {
      expect(result.updatedEnvelope.budget.repair_attempts_used).toBe(3);
    }
  });

  it("returns abort when repair_attempts_used exceeds max_repair_attempts", () => {
    const memory = new EpisodicMemory("session-over");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 5, max_repair_attempts: 3 }),
    });
    const invalidDecision = {
      decision_id: "dec-over",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("abort");
  });

  it("allows 3 sequential repairs then aborts on the 4th", () => {
    const memory = new EpisodicMemory("session-seq");

    // Repair 1: 0→1
    const env0 = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 0, max_repair_attempts: 3 }),
    });
    const invalid1 = {
      decision_id: "dec-seq-1",
      kind: "respond",
    } as unknown as ActionDecision;
    const r1 = validateAndRepair(invalid1, env0, memory);
    expect(r1.outcome).toBe("repair");
    if (r1.outcome === "repair") {
      expect(r1.updatedEnvelope.budget.repair_attempts_used).toBe(1);
    }

    // Repair 2: 1→2
    const env1 = r1.outcome === "repair" ? r1.updatedEnvelope : env0;
    const invalid2 = {
      decision_id: "dec-seq-2",
      kind: "respond",
    } as unknown as ActionDecision;
    const r2 = validateAndRepair(invalid2, env1, memory);
    expect(r2.outcome).toBe("repair");
    if (r2.outcome === "repair") {
      expect(r2.updatedEnvelope.budget.repair_attempts_used).toBe(2);
    }

    // Repair 3: 2→3
    const env2 = r2.outcome === "repair" ? r2.updatedEnvelope : env1;
    const invalid3 = {
      decision_id: "dec-seq-3",
      kind: "respond",
    } as unknown as ActionDecision;
    const r3 = validateAndRepair(invalid3, env2, memory);
    expect(r3.outcome).toBe("repair");
    if (r3.outcome === "repair") {
      expect(r3.updatedEnvelope.budget.repair_attempts_used).toBe(3);
    }

    // Attempt 4: 3/3 → abort
    const env3 = r3.outcome === "repair" ? r3.updatedEnvelope : env2;
    const invalid4 = {
      decision_id: "dec-seq-4",
      kind: "respond",
    } as unknown as ActionDecision;
    const r4 = validateAndRepair(invalid4, env3, memory);
    expect(r4.outcome).toBe("abort");
    if (r4.outcome === "abort") {
      expect(r4.reason).toBe("repair_attempts_exhausted");
      expect(r4.updatedEnvelope.budget.repair_attempts_used).toBe(3);
    }
  });
});

// ── Immutability ────────────────────────────────────────────────

describe("validateAndRepair — immutability", () => {
  it("does not mutate the input envelope on repair", () => {
    const memory = new EpisodicMemory("session-immut-env");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 0, max_repair_attempts: 3 }),
    });
    const originalRepairUsed = envelope.budget.repair_attempts_used;
    const invalidDecision = {
      decision_id: "dec-immut",
      kind: "respond",
    } as unknown as ActionDecision;

    validateAndRepair(invalidDecision, envelope, memory);
    expect(envelope.budget.repair_attempts_used).toBe(originalRepairUsed);
  });

  it("does not mutate the input decision on repair", () => {
    const memory = new EpisodicMemory("session-immut-dec");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-immut-dec",
      kind: "respond",
    } as unknown as ActionDecision;
    const originalKeys = Object.keys(invalidDecision);

    validateAndRepair(invalidDecision, envelope, memory);
    // The input object should still have its original keys
    expect(Object.keys(invalidDecision)).toEqual(originalKeys);
    expect((invalidDecision as Record<string, unknown>).decision_id).toBe(
      "dec-immut-dec",
    );
  });

  it("does not mutate the input envelope on valid", () => {
    const memory = new EpisodicMemory("session-immut-valid");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 1, max_repair_attempts: 3 }),
    });
    const decision = makeValidRespondDecision();
    const originalRepairUsed = envelope.budget.repair_attempts_used;

    validateAndRepair(decision, envelope, memory);
    expect(envelope.budget.repair_attempts_used).toBe(originalRepairUsed);
  });

  it("does not mutate the input envelope on abort", () => {
    const memory = new EpisodicMemory("session-immut-abort");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 3, max_repair_attempts: 3 }),
    });
    const invalidDecision = {
      decision_id: "dec-immut-abort",
      kind: "respond",
    } as unknown as ActionDecision;
    const originalRepairUsed = envelope.budget.repair_attempts_used;

    validateAndRepair(invalidDecision, envelope, memory);
    expect(envelope.budget.repair_attempts_used).toBe(originalRepairUsed);
  });
});

// ── Edge cases ──────────────────────────────────────────────────

describe("validateAndRepair — edge cases", () => {
  it("handles max_repair_attempts of 0 (immediate abort)", () => {
    const memory = new EpisodicMemory("session-zero-max");
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({ repair_attempts_used: 0, max_repair_attempts: 0 }),
    });
    const invalidDecision = {
      decision_id: "dec-zero",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("abort");
    if (result.outcome === "abort") {
      expect(result.reason).toBe("repair_attempts_exhausted");
    }
  });

  it("handles a decision with tool_calls on a non-tool_calls kind", () => {
    const memory = new EpisodicMemory("session-wrong-tc");
    const envelope = makeTurnEnvelope();
    const invalidDecision = {
      decision_id: "dec-wrong-tc",
      kind: "respond",
      message: "Hi",
      tool_calls: [{ tool_name: "read", arguments: {} }],
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    // parseActionDecision should reject tool_calls on respond
    expect(result.outcome).toBe("repair");
  });

  it("handles a non-object decision gracefully", () => {
    const memory = new EpisodicMemory("session-nonobj");
    const envelope = makeTurnEnvelope();
    const invalidDecision = "not an object" as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    // parseActionDecision should throw for non-objects → repair path
    expect(result.outcome).toBe("repair");
  });

  it("preserves all envelope fields on repair", () => {
    const memory = new EpisodicMemory("session-preserve");
    const envelope = makeTurnEnvelope({
      turn_id: "turn-preserve",
      session_id: "session-preserve-env",
      ingress_id: "ingress-preserve",
      state: "validating" as TurnState,
      step_count: 5,
      compaction_revision: 2,
    });
    const invalidDecision = {
      decision_id: "dec-preserve",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("repair");
    if (result.outcome === "repair") {
      const ue = result.updatedEnvelope;
      expect(ue.turn_id).toBe("turn-preserve");
      expect(ue.session_id).toBe("session-preserve-env");
      expect(ue.ingress_id).toBe("ingress-preserve");
      expect(ue.state).toBe("validating");
      expect(ue.step_count).toBe(5);
      expect(ue.compaction_revision).toBe(2);
    }
  });

  it("preserves all envelope fields on abort", () => {
    const memory = new EpisodicMemory("session-preserve-abort");
    const envelope = makeTurnEnvelope({
      turn_id: "turn-preserve-abort",
      budget: makeTurnBudget({ repair_attempts_used: 3, max_repair_attempts: 3 }),
    });
    const invalidDecision = {
      decision_id: "dec-preserve-abort",
      kind: "respond",
    } as unknown as ActionDecision;

    const result = validateAndRepair(invalidDecision, envelope, memory);
    expect(result.outcome).toBe("abort");
    if (result.outcome === "abort") {
      expect(result.updatedEnvelope.turn_id).toBe("turn-preserve-abort");
    }
  });
});

// ── Exports verification ────────────────────────────────────────

describe("validation-repair module exports", () => {
  it("exports validateAndRepair as a function", () => {
    expect(typeof validateAndRepair).toBe("function");
  });

  it("validateAndRepair returns a properly shaped outcome", () => {
    const memory = new EpisodicMemory("session-export");
    const envelope = makeTurnEnvelope();
    const decision = makeValidRespondDecision();

    const result: ValidationOutcome = validateAndRepair(
      decision,
      envelope,
      memory,
    );
    expect(result).toHaveProperty("outcome");
    expect(["valid", "repair", "abort"]).toContain(result.outcome);
  });
});
