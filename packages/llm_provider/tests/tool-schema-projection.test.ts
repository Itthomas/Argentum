import { describe, expect, it } from "vitest";

import type { AvailableToolEntry } from "@argentum/contracts";
import { projectToolSchemas } from "../src/index.js";
import type { DeepSeekToolSchema } from "../src/index.js";

// ── Test builders ────────────────────────────────────────────────

function makeTool(overrides: Partial<AvailableToolEntry> = {}): AvailableToolEntry {
  return {
    name: "test_tool",
    description: "A test tool for unit tests",
    input_schema: {
      type: "object",
      properties: {
        param1: { type: "string" },
      },
      required: ["param1"],
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("projectToolSchemas", () => {
  // ── Single tool projection ──────────────────────────────────

  it("projects a single AvailableToolEntry into a DeepSeekToolSchema", () => {
    const tool = makeTool();
    const result = projectToolSchemas([tool]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("function");
    expect(result[0].function.name).toBe(tool.name);
    expect(result[0].function.description).toBe(tool.description);
    expect(result[0].function.parameters).toEqual(tool.input_schema);
  });

  // ── Empty array ─────────────────────────────────────────────

  it("returns an empty array for empty input", () => {
    const result = projectToolSchemas([]);
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  // ── Multiple tools — ordering preserved ─────────────────────

  it("preserves input ordering for multiple tools", () => {
    const toolA = makeTool({ name: "alpha" });
    const toolB = makeTool({ name: "beta" });
    const toolC = makeTool({ name: "gamma" });

    const result = projectToolSchemas([toolA, toolB, toolC]);

    expect(result).toHaveLength(3);
    expect(result[0].function.name).toBe("alpha");
    expect(result[1].function.name).toBe("beta");
    expect(result[2].function.name).toBe("gamma");
  });

  // ── Output shape correctness ────────────────────────────────

  it("produces objects with exactly the expected top-level and nested keys", () => {
    const tool = makeTool();
    const result = projectToolSchemas([tool]);

    // Top-level keys: only `type` and `function`
    expect(Object.keys(result[0]).sort()).toEqual(["function", "type"]);
    // Nested keys: only `name`, `description`, `parameters`
    expect(Object.keys(result[0].function).sort()).toEqual([
      "description",
      "name",
      "parameters",
    ]);
  });

  // ── Edge case — empty input_schema ──────────────────────────

  it("passes through an empty input_schema unchanged", () => {
    const tool = makeTool({ input_schema: {} });
    const result = projectToolSchemas([tool]);

    expect(result[0].function.parameters).toEqual({});
  });

  // ── No side effects ─────────────────────────────────────────

  it("does not mutate the input array or its elements", () => {
    const tool = makeTool();
    const input: AvailableToolEntry[] = [tool];
    const inputCopy = structuredClone(input);

    projectToolSchemas(input);

    // Verify input array and elements are unchanged
    expect(input).toEqual(inputCopy);
    expect(input[0]).toBe(tool); // same reference — no replacement
  });

  // ── Package entrypoint smoke test ───────────────────────────

  it("is exported as a function from the package barrel", () => {
    expect(typeof projectToolSchemas).toBe("function");
  });

  // ── TypeScript compilation test (runtime proxy) ─────────────

  it("returns an array assignable to DeepSeekToolSchema[] (runtime type check)", () => {
    const tool = makeTool();
    const result: DeepSeekToolSchema[] = projectToolSchemas([tool]);

    expect(result[0].type).toBe("function");
    // If this test compiles, the type assignment is valid.
    // The runtime assertion verifies the data shape matches.
  });

  // ── No provider SDK import test (static verification) ───────
  //
  // This is verified via a string search in the source file.
  // The test reads tool-schema-projection.ts and asserts it
  // does not import from any third-party API SDK.

  it("does not import any provider SDK", async () => {
    // Dynamic import for the fs module (only in Node test environment)
    const fs = await import("node:fs");
    const path = await import("node:path");

    const srcDir = path.resolve(import.meta.dirname, "..", "src");
    const filePath = path.resolve(srcDir, "tool-schema-projection.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    // Check for forbidden SDK imports
    const forbiddenPatterns = [
      /from\s+["']openai["']/i,
      /from\s+["']@anthropic-ai\/sdk["']/i,
      /from\s+["']deepseek/i,
      /require\s*\(\s*["']openai["']\s*\)/i,
      /require\s*\(\s*["']@anthropic-ai\/sdk["']\s*\)/i,
      /require\s*\(\s*["'].*deepseek/i,
    ];

    for (const pattern of forbiddenPatterns) {
      expect(content).not.toMatch(pattern);
    }
  });
});
