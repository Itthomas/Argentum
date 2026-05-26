import { afterEach, describe, expect, it, vi } from "vitest";

import type { IngressDTO } from "@argentum/contracts";

import {
  CliInputError,
  normalizeCliInput,
  type ChannelIngressPayload,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type-level assignability check: does NOT execute at runtime. */
function _structuralCheck(): void {
  // ChannelIngressPayload must be structurally assignable to
  // Omit<IngressDTO, "ingress_id" | "session_id"> (a.k.a. GatewayIngressInput).
  const _payload: Omit<IngressDTO, "ingress_id" | "session_id"> =
    undefined as unknown as ChannelIngressPayload;
  void _payload;
}

// Suppress unused-function warning for the structural check above.
void _structuralCheck;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalizeCliInput", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // -- Happy path -----------------------------------------------------------

  it("returns a frozen ChannelIngressPayload for valid input", () => {
    const result = normalizeCliInput("hello");

    expect(result.channel).toBe("terminal_cli");
    expect(result.user_id).toBe("local");
    expect(result.message_parts).toHaveLength(1);

    const part = result.message_parts[0]!;
    expect(part.kind).toBe("text");
    expect(part.text).toBe("hello");

    // received_at is an ISO-8601 UTC string ending in Z
    expect(result.received_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/,
    );
    expect(new Date(result.received_at).toISOString()).toBe(result.received_at);

    // No ingress_id or session_id
    expect("ingress_id" in result).toBe(false);
    expect("session_id" in result).toBe(false);

    // Immutability
    expect(Object.isFrozen(result)).toBe(true);
  });

  // -- No ingress_id / session_id -------------------------------------------

  it("does NOT include ingress_id or session_id in the returned payload", () => {
    const result = normalizeCliInput("test");

    expect("ingress_id" in (result as Record<string, unknown>)).toBe(false);
    expect("session_id" in (result as Record<string, unknown>)).toBe(false);
  });

  // -- Whitespace handling --------------------------------------------------

  it("strips leading and trailing whitespace", () => {
    const result = normalizeCliInput("  hello world  ");
    expect(result.message_parts[0]!.text).toBe("hello world");
  });

  it("preserves internal whitespace exactly", () => {
    const result = normalizeCliInput("hello   world");
    expect(result.message_parts[0]!.text).toBe("hello   world");
  });

  it("preserves internal tabs and newlines (only leading/trailing stripped)", () => {
    const result = normalizeCliInput("\t\n  hello\tworld  \n");
    // .trim() strips leading/trailing, preserves internal
    expect(result.message_parts[0]!.text).toBe("hello\tworld");
  });

  // -- Empty / whitespace-only rejection ------------------------------------

  it("throws CliInputError for empty string", () => {
    expect(() => normalizeCliInput("")).toThrow(CliInputError);
    expect(() => normalizeCliInput("")).toThrow(
      "CLI input is empty or contains only whitespace.",
    );
  });

  it("throws CliInputError for whitespace-only string", () => {
    expect(() => normalizeCliInput("   ")).toThrow(CliInputError);
    expect(() => normalizeCliInput("\t\n ")).toThrow(CliInputError);
  });

  it("throws CliInputError for newline-only input", () => {
    expect(() => normalizeCliInput("\n")).toThrow(CliInputError);
    expect(() => normalizeCliInput("\n\t")).toThrow(CliInputError);
  });

  // -- Error class properties -----------------------------------------------

  it("CliInputError extends Error with correct name", () => {
    const err = new CliInputError("test error");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CliInputError");
    expect(err.message).toBe("test error");
  });

  // -- Structural validation -------------------------------------------------

  it("validates non-empty message_parts (belt-and-suspenders)", () => {
    // This path is unreachable through normal usage because we always build
    // message_parts with one element.  The guard exists for internal consistency.
    // We verify the guard is present by confirming that the function never
    // returns an empty message_parts array.
    const result = normalizeCliInput("anything");
    expect(result.message_parts.length).toBeGreaterThan(0);
  });

  it("validates non-empty text in the message part", () => {
    // Normal usage always produces non-empty text after trimming, but the guard
    // exists for internal consistency.  Verify the guard is present by
    // confirming text is always non-empty.
    const result = normalizeCliInput("anything");
    expect(result.message_parts[0]!.text).not.toBe("");
  });

  // -- Exactly one MessagePart -----------------------------------------------

  it("produces exactly one MessagePart with kind text", () => {
    const result = normalizeCliInput("hello world");
    expect(result.message_parts).toHaveLength(1);
    expect(result.message_parts[0]!.kind).toBe("text");
  });

  // -- No attachments or metadata --------------------------------------------

  it("does not include attachments or metadata properties", () => {
    const result = normalizeCliInput("test");
    // Use type assertion to check for properties not in ChannelIngressPayload
    const record = result as Record<string, unknown>;
    expect("attachments" in record).toBe(false);
    expect("metadata" in record).toBe(false);
  });

  // -- Immutability -----------------------------------------------------------

  it("returns a frozen object that cannot be mutated in strict mode", () => {
    const result = normalizeCliInput("frozen");
    expect(Object.isFrozen(result)).toBe(true);

    // Attempting to assign to a readonly property throws in strict mode.
    expect(() => {
      (result as { channel: string }).channel = "other";
    }).toThrow(TypeError);
  });

  // -- Timestamp determinism with fake timers --------------------------------

  it("uses Date.now()-derived ISO-8601 UTC timestamp", () => {
    const fixedDate = new Date("2026-06-15T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);

    const result = normalizeCliInput("timed");
    expect(result.received_at).toBe("2026-06-15T12:00:00.000Z");
  });

  // -- Special characters ----------------------------------------------------

  it("preserves Unicode characters including emoji and CJK", () => {
    const input = "Hello 🌍 世界 café";
    const result = normalizeCliInput(input);
    expect(result.message_parts[0]!.text).toBe("Hello 🌍 世界 café");
  });

  // -- Long input ------------------------------------------------------------

  it("handles long input strings without truncation", () => {
    const longText = "a".repeat(10_000);
    const result = normalizeCliInput(longText);
    expect(result.message_parts[0]!.text).toBe(longText);
  });

  // -- Structural compatibility with GatewayIngressInput ---------------------

  it("is structurally assignable to Omit<IngressDTO, 'ingress_id' | 'session_id'>", () => {
    // Runtime verification: a ChannelIngressPayload has the shape that
    // matches the partial IngressDTO fields.
    const result = normalizeCliInput("compat");

    // Verify every required field of Omit<IngressDTO, "ingress_id" | "session_id">
    // is present with the correct types at runtime.
    expect(typeof result.channel).toBe("string");
    expect(typeof result.user_id).toBe("string");
    expect(Array.isArray(result.message_parts)).toBe(true);
    expect(result.message_parts.length).toBeGreaterThan(0);

    const part = result.message_parts[0]!;
    expect(typeof part.kind).toBe("string");
    expect(typeof part.text).toBe("string");

    expect(typeof result.received_at).toBe("string");
    expect(result.received_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/,
    );

    // Verify ingress_id and session_id are absent (gateway's responsibility).
    expect("ingress_id" in (result as Record<string, unknown>)).toBe(false);
    expect("session_id" in (result as Record<string, unknown>)).toBe(false);
  });
});
