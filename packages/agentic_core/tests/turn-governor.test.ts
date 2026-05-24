import type { TurnEnvelope } from "@argentum/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateGovernor } from "../src/index.js";
import type { GovernorDecision } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<TurnEnvelope> = {}): TurnEnvelope {
  return {
    turn_id: "turn-001",
    session_id: "session-001",
    ingress_id: "ingress-001",
    state: "inferring",
    step_count: 3,
    budget: {
      max_inference_steps: 12,
      max_repair_attempts: 3,
      max_wall_clock_ms: 600_000,
      repair_attempts_used: 0,
    },
    context_refs: [],
    compaction_revision: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function deepMergeBudget(
  envelope: TurnEnvelope,
  budgetOverrides: Partial<TurnEnvelope["budget"]>,
): TurnEnvelope {
  return {
    ...envelope,
    budget: { ...envelope.budget, ...budgetOverrides },
  };
}

// ── Fixed startedAt for deterministic tests ──────────────────────
const STARTED_AT = 1_700_000_000_000; // arbitrary fixed epoch ms

// ── Within limits → continue ─────────────────────────────────────

describe("evaluateGovernor — continue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000); // 1s elapsed, well under 600s budget
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("all budgets within limits → continue", () => {
    const envelope = makeEnvelope();
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({ action: "continue" });
  });

  it("step_count well under max → continue", () => {
    const envelope = makeEnvelope({
      step_count: 5,
      budget: {
        max_inference_steps: 12,
        max_repair_attempts: 3,
        max_wall_clock_ms: 600_000,
        repair_attempts_used: 0,
      },
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({ action: "continue" });
  });

  it("repair_attempts_used under max → continue", () => {
    const envelope = deepMergeBudget(makeEnvelope(), {
      repair_attempts_used: 1,
      max_repair_attempts: 3,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({ action: "continue" });
  });

  it("wall clock under limit → continue", () => {
    const envelope = makeEnvelope();
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({ action: "continue" });
  });
});

// ── Step limit exceeded ──────────────────────────────────────────

describe("evaluateGovernor — step_limit_exceeded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("step_count equals max → abort (step_limit_exceeded)", () => {
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 12 }), {
      max_inference_steps: 12,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "step_limit_exceeded",
    });
  });

  it("step_count exceeds max → abort (step_limit_exceeded)", () => {
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 13 }), {
      max_inference_steps: 10,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "step_limit_exceeded",
    });
  });

  it("step_count one under max → continue", () => {
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 11 }), {
      max_inference_steps: 12,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({ action: "continue" });
  });
});

// ── Repair limit exceeded ────────────────────────────────────────

describe("evaluateGovernor — repair_limit_exceeded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("repair_attempts_used equals max → abort (repair_limit_exceeded)", () => {
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 0 }), {
      max_repair_attempts: 3,
      repair_attempts_used: 3,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "repair_limit_exceeded",
    });
  });

  it("repair_attempts_used exceeds max → abort (repair_limit_exceeded)", () => {
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 0 }), {
      max_repair_attempts: 3,
      repair_attempts_used: 5,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "repair_limit_exceeded",
    });
  });
});

// ── Wall clock exceeded ──────────────────────────────────────────

describe("evaluateGovernor — wall_clock_exceeded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 600_001); // 1ms over a 600s budget
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("wall clock exceeded → abort (wall_clock_exceeded)", () => {
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 0 }), {
      max_wall_clock_ms: 600_000,
      max_repair_attempts: 3,
      repair_attempts_used: 0,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "wall_clock_exceeded",
    });
  });

  it("wall clock exactly at limit → abort (wall_clock_exceeded)", () => {
    vi.setSystemTime(STARTED_AT + 600_000); // exactly at limit
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 0 }), {
      max_wall_clock_ms: 600_000,
      max_repair_attempts: 3,
      repair_attempts_used: 0,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "wall_clock_exceeded",
    });
  });
});

// ── Priority ordering (first checked wins) ───────────────────────

describe("evaluateGovernor — priority ordering", () => {
  it("step and repair both exhausted → step wins (checked first)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 12 }), {
      max_inference_steps: 12,
      max_repair_attempts: 3,
      repair_attempts_used: 3,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    vi.useRealTimers();
    expect(decision).toEqual({
      action: "abort",
      reason: "step_limit_exceeded",
    });
  });

  it("repair and wall clock both exhausted → repair wins (checked second)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 600_001);
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 0 }), {
      max_inference_steps: 12,
      max_repair_attempts: 3,
      max_wall_clock_ms: 600_000,
      repair_attempts_used: 3,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "repair_limit_exceeded",
    });
    vi.useRealTimers();
  });

  it("all three exhausted → step wins (checked first)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 600_001);
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 12 }), {
      max_inference_steps: 12,
      max_repair_attempts: 3,
      max_wall_clock_ms: 600_000,
      repair_attempts_used: 3,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "step_limit_exceeded",
    });
    vi.useRealTimers();
  });
});

// ── Budget values are not hardcoded ──────────────────────────────

describe("evaluateGovernor — budget-driven (no hardcoded defaults)", () => {
  it("respects non-MVP max_inference_steps (5 instead of 12)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
    // step_count 5 with max 5 → abort; with MVP default 12 would continue
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 5 }), {
      max_inference_steps: 5,
      max_repair_attempts: 3,
      max_wall_clock_ms: 600_000,
      repair_attempts_used: 0,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    vi.useRealTimers();
    expect(decision).toEqual({
      action: "abort",
      reason: "step_limit_exceeded",
    });
  });

  it("respects non-MVP max_repair_attempts (1 instead of 3)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 0 }), {
      max_inference_steps: 12,
      max_repair_attempts: 1,
      max_wall_clock_ms: 600_000,
      repair_attempts_used: 1,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    vi.useRealTimers();
    expect(decision).toEqual({
      action: "abort",
      reason: "repair_limit_exceeded",
    });
  });

  it("respects non-MVP max_wall_clock_ms (1000 instead of 600000)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 0 }), {
      max_inference_steps: 12,
      max_repair_attempts: 3,
      max_wall_clock_ms: 1000,
      repair_attempts_used: 0,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    expect(decision).toEqual({
      action: "abort",
      reason: "wall_clock_exceeded",
    });
    vi.useRealTimers();
  });

  it("MVP defaults from the spec are NOT hardcoded in the governor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
    // If 12/3/600000 were hardcoded, this would not abort
    // but with a budget of 1/1/1 it should abort at step 1
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 1 }), {
      max_inference_steps: 1,
      max_repair_attempts: 1,
      max_wall_clock_ms: 1,
      repair_attempts_used: 0,
    });
    const decision = evaluateGovernor(envelope, STARTED_AT);
    vi.useRealTimers();
    // If the governor used hardcoded 12/3/600000, step_count=1 would continue
    expect(decision.action).toBe("abort");
    expect(decision).toEqual({
      action: "abort",
      reason: "step_limit_exceeded",
    });
  });
});

// ── Determinism ──────────────────────────────────────────────────

describe("evaluateGovernor — determinism", () => {
  it("same inputs → same decision (deterministic)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
    const envelope = makeEnvelope({
      step_count: 3,
      budget: {
        max_inference_steps: 12,
        max_repair_attempts: 3,
        max_wall_clock_ms: 600_000,
        repair_attempts_used: 0,
      },
    });

    const results: GovernorDecision[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(evaluateGovernor(envelope, STARTED_AT));
    }
    vi.useRealTimers();

    const first = results[0];
    for (const r of results) {
      expect(r).toEqual(first);
    }
  });

  it("determinism with abort scenario — step limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(STARTED_AT + 1000);
    const envelope = deepMergeBudget(makeEnvelope({ step_count: 12 }), {
      max_inference_steps: 12,
    });

    const results: GovernorDecision[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(evaluateGovernor(envelope, STARTED_AT));
    }
    vi.useRealTimers();

    const first = results[0];
    expect(first).toEqual({ action: "abort", reason: "step_limit_exceeded" });
    for (const r of results) {
      expect(r).toEqual(first);
    }
  });
});
