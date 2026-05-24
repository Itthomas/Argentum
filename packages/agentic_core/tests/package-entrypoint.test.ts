import { describe, expect, it } from "vitest";

import {
  ALLOWED_TRANSITIONS,
  STEP_INCREMENT_TRANSITIONS,
  TransitionError,
  executeTransition,
  isTerminal,
  isValidTransition,
} from "../src/index.js";

describe("@argentum/agentic-core package entrypoint", () => {
  it("exports ALLOWED_TRANSITIONS as a ReadonlyMap", () => {
    expect(ALLOWED_TRANSITIONS).toBeInstanceOf(Map);
    expect(ALLOWED_TRANSITIONS.has("accepted")).toBe(true);
  });

  it("exports STEP_INCREMENT_TRANSITIONS as a ReadonlySet", () => {
    expect(STEP_INCREMENT_TRANSITIONS).toBeInstanceOf(Set);
    expect(STEP_INCREMENT_TRANSITIONS.has("compacting->building_context")).toBe(true);
  });

  it("exports TransitionError as a class", () => {
    expect(typeof TransitionError).toBe("function");
    const err = new TransitionError("accepted", "completed", "turn-001");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TransitionError);
  });

  it("exports isValidTransition as a function", () => {
    expect(typeof isValidTransition).toBe("function");
    expect(isValidTransition("accepted", "building_context")).toBe(true);
    expect(isValidTransition("accepted", "completed")).toBe(false);
  });

  it("exports isTerminal as a function", () => {
    expect(typeof isTerminal).toBe("function");
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("aborted")).toBe(true);
    expect(isTerminal("accepted")).toBe(false);
  });

  it("exports executeTransition as a function", () => {
    expect(typeof executeTransition).toBe("function");
  });
});
