import { describe, expect, it } from "vitest";

import type { ContextItem } from "../src/index.js";
import {
  ContextItemValidationError,
  parseContextItem,
  parseContextItemArray,
} from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidContentRef() {
  return {
    ref_id: "ref-123",
    kind: "file" as const,
    storage_area: "artifacts" as const,
    locator: "turns/turn-123/output.md",
    media_type: "text/markdown",
    retention: "persistent" as const,
  };
}

function makeValidContextItem(overrides: Record<string, unknown> = {}) {
  return {
    context_id: "ctx-001",
    layer: "bedrock",
    role: "system",
    content_ref: makeValidContentRef(),
    origin: "environment",
    retention: "sticky",
    ...overrides,
  };
}

function getContextItemIssues(value: unknown) {
  try {
    parseContextItem(value);
  } catch (error) {
    if (error instanceof ContextItemValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected context item parsing to fail.");
}

function getContextItemArrayIssues(value: unknown) {
  try {
    parseContextItemArray(value);
  } catch (error) {
    if (error instanceof ContextItemValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected context item array parsing to fail.");
}

function expectContextItemIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getContextItemIssues(value);
  const actual = issues.map(({ path, code }) => ({ path, code }));
  expect(actual).toEqual(expected);
}

function expectContextItemArrayIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getContextItemArrayIssues(value);
  const actual = issues.map(({ path, code }) => ({ path, code }));
  expect(actual).toEqual(expected);
}

// ── Tests ───────────────────────────────────────────────────────

describe("parseContextItem", () => {
  // ── Valid items across all canonical literals ──────────────

  it("accepts valid context items across all canonical layer and retention literals", () => {
    const validLayers = [
      "bedrock",
      "environment",
      "episodic",
      "tool_summary",
      "system",
    ] as const;
    const validRetentions = ["sticky", "rolling", "ephemeral"] as const;

    for (const layer of validLayers) {
      for (const retention of validRetentions) {
        const item = makeValidContextItem({ layer, retention });
        const parsed = parseContextItem(item);

        expect(parsed.context_id).toBe("ctx-001");
        expect(parsed.layer).toBe(layer);
        expect(parsed.role).toBe("system");
        expect(parsed.content_ref).toEqual(makeValidContentRef());
        expect(parsed.origin).toBe("environment");
        expect(parsed.retention).toBe(retention);
      }
    }
  });

  it("accepts optional version when present as a non-empty string", () => {
    const item = makeValidContextItem({ version: "v1.0.0" });
    const parsed = parseContextItem(item);

    expect(parsed.version).toBe("v1.0.0");
  });

  it("accepts optional token_estimate when present as an integer", () => {
    const item = makeValidContextItem({ token_estimate: 1500 });
    const parsed = parseContextItem(item);

    expect(parsed.token_estimate).toBe(1500);
  });

  it("accepts token_estimate of 0 as a valid integer", () => {
    const item = makeValidContextItem({ token_estimate: 0 });
    const parsed = parseContextItem(item);

    expect(parsed.token_estimate).toBe(0);
  });

  it("accepts token_estimate of a large integer", () => {
    const item = makeValidContextItem({ token_estimate: Number.MAX_SAFE_INTEGER });
    const parsed = parseContextItem(item);

    expect(parsed.token_estimate).toBe(Number.MAX_SAFE_INTEGER);
  });

  // ── Nested content_ref composition ─────────────────────────

  it("validates nested content_ref through the public ContentRef validator", () => {
    expectContextItemIssues(
      makeValidContextItem({
        content_ref: {
          ref_id: "ref-bad",
          kind: "invalid_kind",
          storage_area: "working",
          locator: "ctx/item",
          retention: "session",
        },
      }),
      [{ path: "content_ref.kind", code: "invalid_literal" }],
    );
  });

  it("validates content_ref missing required fields", () => {
    expectContextItemIssues(
      makeValidContextItem({
        content_ref: {
          kind: "file",
          storage_area: "artifacts",
          locator: "ctx/item",
          retention: "persistent",
        },
      }),
      [{ path: "content_ref.ref_id", code: "missing_required" }],
    );
  });

  // ── Non-coercion: context_id, role, origin ─────────────────

  it("rejects context_id when it is a number instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ context_id: 123 }), [
      { path: "context_id", code: "invalid_type" },
    ]);
  });

  it("rejects context_id when it is a boolean instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ context_id: true }), [
      { path: "context_id", code: "invalid_type" },
    ]);
  });

  it("rejects context_id when it is an array instead of a string", () => {
    expectContextItemIssues(
      makeValidContextItem({ context_id: ["not", "a", "string"] }),
      [{ path: "context_id", code: "invalid_type" }],
    );
  });

  it("rejects context_id when it is an object instead of a string", () => {
    expectContextItemIssues(
      makeValidContextItem({ context_id: { nested: "value" } }),
      [{ path: "context_id", code: "invalid_type" }],
    );
  });

  it("rejects context_id when it is an empty string", () => {
    expectContextItemIssues(makeValidContextItem({ context_id: "" }), [
      { path: "context_id", code: "invalid_value" },
    ]);
  });

  it("rejects role when it is a number instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ role: 42 }), [
      { path: "role", code: "invalid_type" },
    ]);
  });

  it("rejects role when it is a boolean instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ role: false }), [
      { path: "role", code: "invalid_type" },
    ]);
  });

  it("rejects role when it is an array instead of a string", () => {
    expectContextItemIssues(
      makeValidContextItem({ role: ["assistant"] }),
      [{ path: "role", code: "invalid_type" }],
    );
  });

  it("rejects role when it is an object instead of a string", () => {
    expectContextItemIssues(
      makeValidContextItem({ role: { name: "assistant" } }),
      [{ path: "role", code: "invalid_type" }],
    );
  });

  it("rejects role when it is an empty string", () => {
    expectContextItemIssues(makeValidContextItem({ role: "" }), [
      { path: "role", code: "invalid_value" },
    ]);
  });

  it("rejects origin when it is a number instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ origin: 7 }), [
      { path: "origin", code: "invalid_type" },
    ]);
  });

  it("rejects origin when it is a boolean instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ origin: true }), [
      { path: "origin", code: "invalid_type" },
    ]);
  });

  it("rejects origin when it is an array instead of a string", () => {
    expectContextItemIssues(
      makeValidContextItem({ origin: ["env"] }),
      [{ path: "origin", code: "invalid_type" }],
    );
  });

  it("rejects origin when it is an object instead of a string", () => {
    expectContextItemIssues(
      makeValidContextItem({ origin: { module: "env" } }),
      [{ path: "origin", code: "invalid_type" }],
    );
  });

  it("rejects origin when it is an empty string", () => {
    expectContextItemIssues(makeValidContextItem({ origin: "" }), [
      { path: "origin", code: "invalid_value" },
    ]);
  });

  // ── Optional version tests ─────────────────────────────────

  it("accepts version as an optional non-empty string", () => {
    const parsed = parseContextItem(makeValidContextItem({ version: "digest-abc123" }));
    expect(parsed.version).toBe("digest-abc123");
  });

  it("omits version from the output when it is not provided", () => {
    const parsed = parseContextItem(makeValidContextItem());
    expect(parsed).not.toHaveProperty("version");
  });

  it("rejects version when it is a number instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ version: 2 }), [
      { path: "version", code: "invalid_type" },
    ]);
  });

  it("rejects version when it is a boolean instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ version: false }), [
      { path: "version", code: "invalid_type" },
    ]);
  });

  it("rejects version when it is an array instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ version: ["v1", "v2"] }), [
      { path: "version", code: "invalid_type" },
    ]);
  });

  it("rejects version when it is an object instead of a string", () => {
    expectContextItemIssues(makeValidContextItem({ version: { tag: "v1.0" } }), [
      { path: "version", code: "invalid_type" },
    ]);
  });

  it("rejects version when it is an empty string", () => {
    expectContextItemIssues(makeValidContextItem({ version: "" }), [
      { path: "version", code: "invalid_value" },
    ]);
  });

  // ── Optional token_estimate tests ──────────────────────────

  it("omits token_estimate from the output when it is not provided", () => {
    const parsed = parseContextItem(makeValidContextItem());
    expect(parsed).not.toHaveProperty("token_estimate");
  });

  it("rejects token_estimate when it is a string instead of an integer", () => {
    expectContextItemIssues(makeValidContextItem({ token_estimate: "1500" }), [
      { path: "token_estimate", code: "invalid_type" },
    ]);
  });

  it("rejects token_estimate when it is a float instead of an integer", () => {
    expectContextItemIssues(makeValidContextItem({ token_estimate: 1500.5 }), [
      { path: "token_estimate", code: "invalid_integer" },
    ]);
  });

  it("rejects token_estimate when it is NaN", () => {
    expectContextItemIssues(makeValidContextItem({ token_estimate: NaN }), [
      { path: "token_estimate", code: "invalid_integer" },
    ]);
  });

  it("rejects token_estimate when it is Infinity", () => {
    expectContextItemIssues(
      makeValidContextItem({ token_estimate: Infinity }),
      [{ path: "token_estimate", code: "invalid_integer" }],
    );
  });

  it("rejects token_estimate when it is -Infinity", () => {
    expectContextItemIssues(
      makeValidContextItem({ token_estimate: -Infinity }),
      [{ path: "token_estimate", code: "invalid_integer" }],
    );
  });

  it("accepts negative token_estimate as a valid integer per spec (non-negativity not required)", () => {
    const parsed = parseContextItem(makeValidContextItem({ token_estimate: -1 }));

    expect(parsed.token_estimate).toBe(-1);
  });

  // ── Missing required fields ────────────────────────────────

  it("rejects missing required fields", () => {
    const item = makeValidContextItem() as Record<string, unknown>;
    delete item.context_id;
    delete item.layer;
    delete item.role;
    delete item.content_ref;
    delete item.origin;
    delete item.retention;

    expectContextItemIssues(item, [
      { path: "context_id", code: "missing_required" },
      { path: "layer", code: "missing_required" },
      { path: "role", code: "missing_required" },
      { path: "content_ref", code: "missing_required" },
      { path: "origin", code: "missing_required" },
      { path: "retention", code: "missing_required" },
    ]);
  });

  // ── Invalid literals ───────────────────────────────────────

  it("rejects invalid layer literals", () => {
    expectContextItemIssues(makeValidContextItem({ layer: "transient" }), [
      { path: "layer", code: "invalid_literal" },
    ]);
  });

  it("rejects invalid retention literals", () => {
    expectContextItemIssues(makeValidContextItem({ retention: "forever" }), [
      { path: "retention", code: "invalid_literal" },
    ]);
  });

  // ── Wrong primitive types ──────────────────────────────────

  it("rejects wrong primitive types for required fields", () => {
    expectContextItemIssues(
      makeValidContextItem({
        layer: 42,
        role: true,
        origin: ["array"],
      }),
      [
        { path: "layer", code: "invalid_type" },
        { path: "role", code: "invalid_type" },
        { path: "origin", code: "invalid_type" },
      ],
    );
  });

  // ── Unknown keys ───────────────────────────────────────────

  it("rejects unknown keys", () => {
    expectContextItemIssues(
      makeValidContextItem({ extra_field: true, debug: "secret" }),
      [
        { path: "extra_field", code: "unknown_key" },
        { path: "debug", code: "unknown_key" },
      ],
    );
  });

  // ── Non-object root ────────────────────────────────────────

  it("rejects a non-object root value", () => {
    expectContextItemIssues("not-an-object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects null root value", () => {
    expectContextItemIssues(null, [{ path: "$", code: "invalid_type" }]);
  });

  it("rejects an array as root value", () => {
    expectContextItemIssues([], [{ path: "$", code: "invalid_type" }]);
  });

  // ── Edge: content_ref as wrong type ────────────────────────

  it("rejects content_ref when it is not an object", () => {
    expectContextItemIssues(
      makeValidContextItem({ content_ref: "not-an-object" }),
      [{ path: "content_ref", code: "invalid_type" }],
    );
  });

  // ── Immutability ───────────────────────────────────────────

  it("returns a frozen object that cannot be mutated", () => {
    const parsed = parseContextItem(makeValidContextItem());

    expect(() => {
      (parsed as Record<string, unknown>).context_id = "hacked";
    }).toThrow();
  });
});

describe("parseContextItemArray", () => {
  it("accepts a valid ordered array of context items", () => {
    const items = [
      makeValidContextItem({ context_id: "ctx-001" }),
      makeValidContextItem({
        context_id: "ctx-002",
        layer: "episodic",
        retention: "rolling",
      }),
      makeValidContextItem({
        context_id: "ctx-003",
        layer: "tool_summary",
        retention: "ephemeral",
      }),
    ];

    const parsed = parseContextItemArray(items);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].context_id).toBe("ctx-001");
    expect(parsed[1].context_id).toBe("ctx-002");
    expect(parsed[2].context_id).toBe("ctx-003");
  });

  it("preserves caller input order and does not reorder", () => {
    const items = [
      makeValidContextItem({ context_id: "c" }),
      makeValidContextItem({ context_id: "a" }),
      makeValidContextItem({ context_id: "b" }),
    ];

    const parsed = parseContextItemArray(items);

    expect(parsed[0].context_id).toBe("c");
    expect(parsed[1].context_id).toBe("a");
    expect(parsed[2].context_id).toBe("b");
  });

  it("preserves order even with duplicate context_ids", () => {
    const items = [
      makeValidContextItem({ context_id: "dup", role: "role-a" }),
      makeValidContextItem({ context_id: "dup", role: "role-b" }),
    ];

    const parsed = parseContextItemArray(items);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe("role-a");
    expect(parsed[1].role).toBe("role-b");
  });

  it("rejects a non-array root", () => {
    expectContextItemArrayIssues("not-an-array", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("reports validation issues for invalid items within the array", () => {
    const items = [
      makeValidContextItem({ context_id: "ctx-001" }),
      makeValidContextItem({ context_id: 123 }), // type error
      makeValidContextItem({ layer: "invalid_layer" }), // literal error
    ];

    expectContextItemArrayIssues(items, [
      { path: "[1].context_id", code: "invalid_type" },
      { path: "[2].layer", code: "invalid_literal" },
    ]);
  });

  it("accepts an empty array as a valid ordered context-item array", () => {
    const parsed = parseContextItemArray([]);

    expect(parsed).toHaveLength(0);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("rejects an array where every item is invalid", () => {
    expectContextItemArrayIssues(
      [
        { not: "valid" },
        { also: "invalid" },
      ],
      [
        { path: "[0].not", code: "unknown_key" },
        { path: "[0].context_id", code: "missing_required" },
        { path: "[0].layer", code: "missing_required" },
        { path: "[0].role", code: "missing_required" },
        { path: "[0].content_ref", code: "missing_required" },
        { path: "[0].origin", code: "missing_required" },
        { path: "[0].retention", code: "missing_required" },
        { path: "[1].also", code: "unknown_key" },
        { path: "[1].context_id", code: "missing_required" },
        { path: "[1].layer", code: "missing_required" },
        { path: "[1].role", code: "missing_required" },
        { path: "[1].content_ref", code: "missing_required" },
        { path: "[1].origin", code: "missing_required" },
        { path: "[1].retention", code: "missing_required" },
      ],
    );
  });

  it("returns a frozen array that cannot be mutated", () => {
    const parsed = parseContextItemArray([
      makeValidContextItem({ context_id: "ctx-001" }),
    ]);

    expect(() => {
      (parsed as ContextItem[]).push(makeValidContextItem() as ContextItem);
    }).toThrow();
  });
});

describe("ContextItemValidationError", () => {
  it("constructs with a summary message", () => {
    const error = new ContextItemValidationError([
      { path: "context_id", code: "missing_required", message: "test" },
    ]);

    expect(error.name).toBe("ContextItemValidationError");
    expect(error.message).toContain("1 validation issue");
    expect(error.issues).toHaveLength(1);
  });

  it("pluralizes the summary for multiple issues", () => {
    const error = new ContextItemValidationError([
      { path: "a", code: "missing_required", message: "test" },
      { path: "b", code: "missing_required", message: "test" },
    ]);

    expect(error.message).toContain("2 validation issues");
    expect(error.issues).toHaveLength(2);
  });

  it("is an instance of Error", () => {
    const error = new ContextItemValidationError([]);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ContextItemValidationError);
  });
});
