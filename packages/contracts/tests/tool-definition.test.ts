import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "../src/index.js";
import {
  parseToolDefinition,
  ToolDefinitionValidationError,
} from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidToolDefinition(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "search",
    description: "Search the web for information",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
    side_effect_level: "read_only",
    path_scope: "none",
    required_secret_handles: ["API_KEY"],
    network_access: "inherit",
    default_timeout_ms: 30000,
    ...overrides,
  };
}

function getToolDefinitionIssues(value: unknown) {
  try {
    parseToolDefinition(value);
  } catch (error) {
    if (error instanceof ToolDefinitionValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected tool definition parsing to fail.");
}

function expectToolDefinitionIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getToolDefinitionIssues(value);
  const actual = issues.map(({ path, code }) => ({ path, code }));
  expect(actual).toEqual(expected);
}

// ── Tests ───────────────────────────────────────────────────────

describe("parseToolDefinition", () => {
  // ── Valid definitions ──────────────────────────────────────

  it("accepts a full valid ToolDefinition with all 9 fields", () => {
    const td = makeValidToolDefinition({
      defaults: { query: "default search" },
    });
    const parsed = parseToolDefinition(td);

    expect(parsed.name).toBe("search");
    expect(parsed.description).toBe("Search the web for information");
    expect(parsed.input_schema).toEqual({
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    });
    expect(parsed.side_effect_level).toBe("read_only");
    expect(parsed.path_scope).toBe("none");
    expect(parsed.required_secret_handles).toEqual(["API_KEY"]);
    expect(parsed.network_access).toBe("inherit");
    expect(parsed.default_timeout_ms).toBe(30000);
    expect(parsed.defaults).toEqual({ query: "default search" });
  });

  it("accepts a valid ToolDefinition without defaults", () => {
    const td = makeValidToolDefinition();
    const parsed = parseToolDefinition(td);

    expect(parsed.name).toBe("search");
    expect(parsed.defaults).toBeUndefined();
  });

  it("accepts a valid ToolDefinition with empty required_secret_handles", () => {
    const td = makeValidToolDefinition({ required_secret_handles: [] });
    const parsed = parseToolDefinition(td);

    expect(parsed.required_secret_handles).toEqual([]);
  });

  it("accepts a valid ToolDefinition with empty input_schema", () => {
    const td = makeValidToolDefinition({ input_schema: {} });
    const parsed = parseToolDefinition(td);

    expect(parsed.input_schema).toEqual({});
  });

  it("accepts a valid ToolDefinition with empty defaults", () => {
    const td = makeValidToolDefinition({ defaults: {} });
    const parsed = parseToolDefinition(td);

    expect(parsed.defaults).toEqual({});
  });

  it("accepts all four side_effect_level literals", () => {
    const levels = [
      "read_only",
      "workspace_mutation",
      "host_mutation",
      "external_effect",
    ] as const;

    for (const level of levels) {
      const td = makeValidToolDefinition({ side_effect_level: level });
      const parsed = parseToolDefinition(td);
      expect(parsed.side_effect_level).toBe(level);
    }
  });

  it("accepts all three path_scope literals", () => {
    const scopes = ["none", "working", "workspace"] as const;

    for (const scope of scopes) {
      const td = makeValidToolDefinition({ path_scope: scope });
      const parsed = parseToolDefinition(td);
      expect(parsed.path_scope).toBe(scope);
    }
  });

  it("accepts both network_access literals", () => {
    const accessValues = ["deny", "inherit"] as const;

    for (const access of accessValues) {
      const td = makeValidToolDefinition({ network_access: access });
      const parsed = parseToolDefinition(td);
      expect(parsed.network_access).toBe(access);
    }
  });

  it("accepts default_timeout_ms = 1 (minimum positive integer boundary)", () => {
    const td = makeValidToolDefinition({ default_timeout_ms: 1 });
    const parsed = parseToolDefinition(td);

    expect(parsed.default_timeout_ms).toBe(1);
  });

  // ── Defaults: undefined is valid ───────────────────────────

  it("accepts defaults explicitly set to undefined", () => {
    const td = makeValidToolDefinition({ defaults: undefined });
    const parsed = parseToolDefinition(td);

    expect(parsed.defaults).toBeUndefined();
  });

  // ── Required-field missing tests ───────────────────────────

  it("rejects missing name with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.name;

    expectToolDefinitionIssues(td, [
      { path: "name", code: "missing_required" },
    ]);
  });

  it("rejects missing description with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.description;

    expectToolDefinitionIssues(td, [
      { path: "description", code: "missing_required" },
    ]);
  });

  it("rejects missing input_schema with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.input_schema;

    expectToolDefinitionIssues(td, [
      { path: "input_schema", code: "missing_required" },
    ]);
  });

  it("rejects missing side_effect_level with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.side_effect_level;

    expectToolDefinitionIssues(td, [
      { path: "side_effect_level", code: "missing_required" },
    ]);
  });

  it("rejects missing path_scope with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.path_scope;

    expectToolDefinitionIssues(td, [
      { path: "path_scope", code: "missing_required" },
    ]);
  });

  it("rejects missing required_secret_handles with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.required_secret_handles;

    expectToolDefinitionIssues(td, [
      { path: "required_secret_handles", code: "missing_required" },
    ]);
  });

  it("rejects missing network_access with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.network_access;

    expectToolDefinitionIssues(td, [
      { path: "network_access", code: "missing_required" },
    ]);
  });

  it("rejects missing default_timeout_ms with missing_required", () => {
    const td = makeValidToolDefinition();
    delete td.default_timeout_ms;

    expectToolDefinitionIssues(td, [
      { path: "default_timeout_ms", code: "missing_required" },
    ]);
  });

  // ── Invalid literal tests ──────────────────────────────────

  it("rejects unknown side_effect_level with invalid_literal", () => {
    const td = makeValidToolDefinition({ side_effect_level: "dangerous" });

    expectToolDefinitionIssues(td, [
      { path: "side_effect_level", code: "invalid_literal" },
    ]);
  });

  it("rejects unknown path_scope with invalid_literal", () => {
    const td = makeValidToolDefinition({ path_scope: "full_system" });

    expectToolDefinitionIssues(td, [
      { path: "path_scope", code: "invalid_literal" },
    ]);
  });

  it("rejects unknown network_access with invalid_literal", () => {
    const td = makeValidToolDefinition({ network_access: "allow_all" });

    expectToolDefinitionIssues(td, [
      { path: "network_access", code: "invalid_literal" },
    ]);
  });

  // ── Invalid type tests ─────────────────────────────────────

  it("rejects name as number with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ name: 42 }), [
      { path: "name", code: "invalid_type" },
    ]);
  });

  it("rejects name as boolean with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ name: true }), [
      { path: "name", code: "invalid_type" },
    ]);
  });

  it("rejects name as array with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ name: ["search"] }), [
      { path: "name", code: "invalid_type" },
    ]);
  });

  it("rejects name as object with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ name: {} }), [
      { path: "name", code: "invalid_type" },
    ]);
  });

  it("rejects name as empty string with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ name: "" }), [
      { path: "name", code: "invalid_type" },
    ]);
  });

  it("rejects description as number with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ description: 123 }), [
      { path: "description", code: "invalid_type" },
    ]);
  });

  it("rejects description as boolean with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ description: false }),
      [{ path: "description", code: "invalid_type" }],
    );
  });

  it("rejects description as array with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ description: ["desc"] }),
      [{ path: "description", code: "invalid_type" }],
    );
  });

  it("rejects description as object with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ description: {} }), [
      { path: "description", code: "invalid_type" },
    ]);
  });

  it("rejects description as empty string with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ description: "" }), [
      { path: "description", code: "invalid_type" },
    ]);
  });

  it("rejects input_schema as null with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ input_schema: null }),
      [{ path: "input_schema", code: "invalid_type" }],
    );
  });

  it("rejects input_schema as array with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ input_schema: [] }),
      [{ path: "input_schema", code: "invalid_type" }],
    );
  });

  it("rejects input_schema as string with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ input_schema: "schema" }),
      [{ path: "input_schema", code: "invalid_type" }],
    );
  });

  it("rejects input_schema as number with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ input_schema: 42 }),
      [{ path: "input_schema", code: "invalid_type" }],
    );
  });

  it("rejects input_schema as boolean with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ input_schema: true }),
      [{ path: "input_schema", code: "invalid_type" }],
    );
  });

  it("rejects side_effect_level as number with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ side_effect_level: 1 }),
      [{ path: "side_effect_level", code: "invalid_type" }],
    );
  });

  it("rejects path_scope as number with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ path_scope: 42 }), [
      { path: "path_scope", code: "invalid_type" },
    ]);
  });

  it("rejects path_scope as boolean with invalid_type", () => {
    expectToolDefinitionIssues(makeValidToolDefinition({ path_scope: true }), [
      { path: "path_scope", code: "invalid_type" },
    ]);
  });

  it("rejects network_access as number with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ network_access: 0 }),
      [{ path: "network_access", code: "invalid_type" }],
    );
  });

  it("rejects network_access as boolean with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ network_access: false }),
      [{ path: "network_access", code: "invalid_type" }],
    );
  });

  it("rejects required_secret_handles as string with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ required_secret_handles: "API_KEY" }),
      [{ path: "required_secret_handles", code: "invalid_type" }],
    );
  });

  it("rejects required_secret_handles as object with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ required_secret_handles: {} }),
      [{ path: "required_secret_handles", code: "invalid_type" }],
    );
  });

  it("rejects required_secret_handles element as number with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ required_secret_handles: [42] }),
      [{ path: "required_secret_handles[0]", code: "invalid_type" }],
    );
  });

  it("rejects required_secret_handles element as boolean with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ required_secret_handles: [true] }),
      [{ path: "required_secret_handles[0]", code: "invalid_type" }],
    );
  });

  it("rejects required_secret_handles element as empty string with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ required_secret_handles: [""] }),
      [{ path: "required_secret_handles[0]", code: "invalid_type" }],
    );
  });

  it("rejects required_secret_handles element as null with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ required_secret_handles: [null] }),
      [{ path: "required_secret_handles[0]", code: "invalid_type" }],
    );
  });

  it("rejects default_timeout_ms as string with invalid_integer", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ default_timeout_ms: "30000" }),
      [{ path: "default_timeout_ms", code: "invalid_integer" }],
    );
  });

  it("rejects default_timeout_ms as float with invalid_integer", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ default_timeout_ms: 3.14 }),
      [{ path: "default_timeout_ms", code: "invalid_integer" }],
    );
  });

  it("rejects default_timeout_ms as boolean with invalid_integer", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ default_timeout_ms: true }),
      [{ path: "default_timeout_ms", code: "invalid_integer" }],
    );
  });

  it("rejects default_timeout_ms as NaN with invalid_integer", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ default_timeout_ms: NaN }),
      [{ path: "default_timeout_ms", code: "invalid_integer" }],
    );
  });

  it("rejects default_timeout_ms as Infinity with invalid_integer", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ default_timeout_ms: Infinity }),
      [{ path: "default_timeout_ms", code: "invalid_integer" }],
    );
  });

  it("rejects default_timeout_ms = 0 with invalid_value", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ default_timeout_ms: 0 }),
      [{ path: "default_timeout_ms", code: "invalid_value" }],
    );
  });

  it("rejects default_timeout_ms = -1 with invalid_value", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ default_timeout_ms: -1 }),
      [{ path: "default_timeout_ms", code: "invalid_value" }],
    );
  });

  it("rejects defaults as null with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ defaults: null }),
      [{ path: "defaults", code: "invalid_type" }],
    );
  });

  it("rejects defaults as array with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ defaults: [] }),
      [{ path: "defaults", code: "invalid_type" }],
    );
  });

  it("rejects defaults as string with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ defaults: "args" }),
      [{ path: "defaults", code: "invalid_type" }],
    );
  });

  it("rejects defaults as number with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ defaults: 42 }),
      [{ path: "defaults", code: "invalid_type" }],
    );
  });

  it("rejects defaults as boolean with invalid_type", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ defaults: true }),
      [{ path: "defaults", code: "invalid_type" }],
    );
  });

  // ── Non-object top-level test ──────────────────────────────

  it("rejects string as top-level input with invalid_type at $", () => {
    expectToolDefinitionIssues("not-an-object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects number as top-level input with invalid_type at $", () => {
    expectToolDefinitionIssues(42, [{ path: "$", code: "invalid_type" }]);
  });

  it("rejects array as top-level input with invalid_type at $", () => {
    expectToolDefinitionIssues([], [{ path: "$", code: "invalid_type" }]);
  });

  it("rejects null as top-level input with invalid_type at $", () => {
    expectToolDefinitionIssues(null, [{ path: "$", code: "invalid_type" }]);
  });

  // ── Unknown key test ───────────────────────────────────────

  it("rejects extra top-level key with unknown_key", () => {
    expectToolDefinitionIssues(
      makeValidToolDefinition({ extra_field: "should not be here" }),
      [{ path: "extra_field", code: "unknown_key" }],
    );
  });

  // ── Multiple issues ────────────────────────────────────────

  it("accumulates multiple validation issues", () => {
    const issues = getToolDefinitionIssues({
      name: 42,
      description: false,
      input_schema: null,
      side_effect_level: "read_only",
      path_scope: "none",
      required_secret_handles: [],
      network_access: "deny",
      default_timeout_ms: "30000",
    });

    expect(issues).toHaveLength(4); // name, description, input_schema, default_timeout_ms
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("invalid_type");
    expect(codes).toContain("invalid_integer"); // default_timeout_ms as string
  });

  // ── Immutability ───────────────────────────────────────────

  it("returns a frozen object", () => {
    const parsed = parseToolDefinition(makeValidToolDefinition());
    expect(Object.isFrozen(parsed)).toBe(true);
  });
});
