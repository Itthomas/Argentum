import { describe, expect, it } from "vitest";

import { validateAgainstSchema } from "../src/schema-validator.js";

// ── Tests ───────────────────────────────────────────────────────

describe("validateAgainstSchema", () => {
  it("empty schema passes any arguments", () => {
    const result = validateAgainstSchema({ anything: "goes" }, {});
    expect(result.valid).toBe(true);
  });

  it("rejects missing required properties", () => {
    const result = validateAgainstSchema(
      { foo: "bar" },
      {
        type: "object",
        properties: {
          foo: { type: "string" },
          baz: { type: "string" },
        },
        required: ["foo", "baz"],
      },
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("baz"))).toBe(true);
    }
  });

  it("rejects wrong-type property values", () => {
    const result = validateAgainstSchema(
      { age: "not a number" },
      {
        type: "object",
        properties: {
          age: { type: "number" },
        },
      },
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("age"))).toBe(true);
    }
  });

  it("rejects unknown properties when additionalProperties is false", () => {
    const result = validateAgainstSchema(
      { known: "ok", surprise: "bad" },
      {
        type: "object",
        properties: {
          known: { type: "string" },
        },
        additionalProperties: false,
      },
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("surprise"))).toBe(true);
    }
  });

  it("validates nested properties recursively", () => {
    const result = validateAgainstSchema(
      {
        outer: {
          inner: 42, // should be string
        },
      },
      {
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: {
              inner: { type: "string" },
            },
          },
        },
      },
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.includes("outer") && e.includes("inner")),
      ).toBe(true);
    }
  });

  it("returns structured error messages with property paths", () => {
    const result = validateAgainstSchema(
      { x: 1 },
      {
        type: "object",
        properties: {
          x: { type: "string" },
        },
      },
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      // Error messages should reference the property name
      expect(result.errors.some((e) => e.includes("x"))).toBe(true);
      expect(result.errors.some((e) => e.includes("type"))).toBe(true);
    }
  });

  it("accepts valid arguments matching schema", () => {
    const result = validateAgainstSchema(
      { query: "hello", limit: 10 },
      {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    );

    expect(result.valid).toBe(true);
  });

  it("allows optional properties not in required", () => {
    const result = validateAgainstSchema(
      { query: "hello" },
      {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    );

    expect(result.valid).toBe(true);
  });

  it("accepts boolean properties correctly", () => {
    const result = validateAgainstSchema(
      { verbose: true },
      {
        type: "object",
        properties: {
          verbose: { type: "boolean" },
        },
      },
    );

    expect(result.valid).toBe(true);
  });

  it("accepts array properties correctly", () => {
    const result = validateAgainstSchema(
      { tags: ["a", "b"] },
      {
        type: "object",
        properties: {
          tags: { type: "array" },
        },
      },
    );

    expect(result.valid).toBe(true);
  });

  it("rejects array when object expected", () => {
    const result = validateAgainstSchema(
      { obj: [1, 2, 3] },
      {
        type: "object",
        properties: {
          obj: { type: "object" },
        },
      },
    );

    expect(result.valid).toBe(false);
  });

  it("rejects null when object expected", () => {
    const result = validateAgainstSchema(
      { obj: null },
      {
        type: "object",
        properties: {
          obj: { type: "object" },
        },
      },
    );

    expect(result.valid).toBe(false);
  });

  it("returns validation failure when required is present but not an array (string case)", () => {
    const result = validateAgainstSchema(
      { foo: "bar" },
      { type: "object", properties: { foo: { type: "string" } }, required: "foo" },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("required"))).toBe(true);
    }
  });

  it("returns validation failure when required is present but not an array (number case)", () => {
    const result = validateAgainstSchema(
      { foo: "bar" },
      { type: "object", properties: { foo: { type: "string" } }, required: 42 },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("required"))).toBe(true);
    }
  });

  it("rejects null args when schema has properties but no type: object", () => {
    const result = validateAgainstSchema(null, {
      properties: { x: { type: "number" } },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("must be an object"))).toBe(true);
    }
  });
});
