import { describe, expect, it } from "vitest";

import { validateToolSchemaModel } from "../src/tool-schema-model.js";

import type { ToolSchemaValidationResult } from "../src/tool-schema-model.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidToolDef(overrides: Record<string, unknown> = {}) {
  return {
    name: "test_tool",
    description: "A test tool for schema validation",
    input_schema: { type: "object", properties: {} },
    side_effect_level: "read_only",
    path_scope: "none",
    required_secret_handles: [],
    network_access: "deny",
    default_timeout_ms: 30000,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("validateToolSchemaModel", () => {
  // ── Valid input ──────────────────────────────────────────────

  it("returns valid for a complete, well-formed tool definition", () => {
    const raw = makeValidToolDef();
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.definition.name).toBe("test_tool");
      expect(result.definition.side_effect_level).toBe("read_only");
      expect(result.definition.path_scope).toBe("none");
      expect(result.definition.network_access).toBe("deny");
      expect(result.definition.default_timeout_ms).toBe(30000);
    }
  });

  // ── Missing field ────────────────────────────────────────────

  it("returns invalid with errors when a required field is missing", () => {
    // Omit `side_effect_level`
    const { side_effect_level: _, ...withoutField } = makeValidToolDef();
    const result = validateToolSchemaModel(withoutField);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((e) => e.includes("side_effect_level")),
      ).toBe(true);
    }
  });

  // ── side_effect_level ─────────────────────────────────────────

  it("returns invalid for an unknown side_effect_level value", () => {
    const raw = makeValidToolDef({ side_effect_level: "destructive" });
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) =>
            e.includes("side_effect_level") &&
            (e.includes("read_only") || e.includes("workspace_mutation")),
        ),
      ).toBe(true);
    }
  });

  // ── path_scope ────────────────────────────────────────────────

  it("returns invalid for an unknown path_scope value", () => {
    const raw = makeValidToolDef({ path_scope: "global" });
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) =>
            e.includes("path_scope") &&
            (e.includes("none") || e.includes("working")),
        ),
      ).toBe(true);
    }
  });

  // ── network_access ────────────────────────────────────────────

  it("returns invalid for an unknown network_access value", () => {
    const raw = makeValidToolDef({ network_access: "allow_all" });
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) =>
            e.includes("network_access") &&
            (e.includes("deny") || e.includes("inherit")),
        ),
      ).toBe(true);
    }
  });

  // ── required_secret_handles ───────────────────────────────────

  it("returns invalid when required_secret_handles is not a string array", () => {
    const raw = makeValidToolDef({ required_secret_handles: "not_an_array" });
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.includes("required_secret_handles")),
      ).toBe(true);
    }
  });

  // ── default_timeout_ms ────────────────────────────────────────

  it("returns invalid when default_timeout_ms is zero", () => {
    const raw = makeValidToolDef({ default_timeout_ms: 0 });
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.includes("default_timeout_ms")),
      ).toBe(true);
    }
  });

  it("returns invalid when default_timeout_ms is negative", () => {
    const raw = makeValidToolDef({ default_timeout_ms: -5 });
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.includes("default_timeout_ms")),
      ).toBe(true);
    }
  });

  it("returns invalid when default_timeout_ms is not an integer", () => {
    const raw = makeValidToolDef({ default_timeout_ms: 3.14 });
    const result = validateToolSchemaModel(raw);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.includes("default_timeout_ms")),
      ).toBe(true);
    }
  });

  // ── Non-throwing contract ─────────────────────────────────────

  it("never throws for completely invalid input", () => {
    // null, primitive, array — none should throw
    expect(() => validateToolSchemaModel(null)).not.toThrow();
    expect(() => validateToolSchemaModel(42)).not.toThrow();
    expect(() => validateToolSchemaModel("garbage")).not.toThrow();
    expect(() => validateToolSchemaModel([])).not.toThrow();
    expect(() => validateToolSchemaModel({})).not.toThrow();
  });

  it("returns invalid for non-object input", () => {
    const result = validateToolSchemaModel(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  // ── TypeScript discriminated union narrowing ──────────────────

  it("narrows to ToolDefinition on valid result", () => {
    const raw = makeValidToolDef({ name: "narrow_test" });
    const result: ToolSchemaValidationResult =
      validateToolSchemaModel(raw);

    if (result.valid) {
      // TypeScript should know `definition` exists here
      const def = result.definition;
      expect(def.name).toBe("narrow_test");
      expect(typeof def.default_timeout_ms).toBe("number");
    } else {
      // Should not reach here for valid input
      expect.fail("expected valid result");
    }
  });

  it("narrows to errors array on invalid result", () => {
    const result: ToolSchemaValidationResult =
      validateToolSchemaModel({});

    if (!result.valid) {
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
      for (const err of result.errors) {
        expect(typeof err).toBe("string");
      }
    } else {
      expect.fail("expected invalid result for empty object");
    }
  });
});
