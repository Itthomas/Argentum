import { describe, expect, it } from "vitest";

import type { ActionDecision, DecisionKind } from "../src/index.js";
import {
  ActionDecisionValidationError,
  parseActionDecision,
} from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidContentRef() {
  return {
    ref_id: "ref-123",
    kind: "file" as const,
    storage_area: "artifacts" as const,
    locator: "turns/turn-123/trace.json",
    retention: "persistent" as const,
  };
}

function makeValidActionDecision(overrides: Record<string, unknown> = {}) {
  return {
    decision_id: "dec-001",
    kind: "respond" as DecisionKind,
    message: "Hello, world!",
    ...overrides,
  };
}

function getActionDecisionIssues(value: unknown) {
  try {
    parseActionDecision(value);
  } catch (error) {
    if (error instanceof ActionDecisionValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected action decision parsing to fail.");
}

function expectActionDecisionIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getActionDecisionIssues(value);

  expect(issues).toEqual(
    expect.arrayContaining(
      expected.map((issue) => expect.objectContaining(issue)),
    ),
  );
}

// ── Tests ───────────────────────────────────────────────────────

describe("parseActionDecision", () => {
  // ── Valid decisions across all four decision kinds ─────────

  it("accepts a valid respond decision", () => {
    const decision = makeValidActionDecision({
      kind: "respond",
      message: "Here is your answer.",
    });
    const parsed = parseActionDecision(decision);

    expect(parsed.decision_id).toBe("dec-001");
    expect(parsed.kind).toBe("respond");
    expect(parsed.message).toBe("Here is your answer.");
  });

  it("accepts a valid clarify decision", () => {
    const decision = makeValidActionDecision({
      kind: "clarify",
      message: "Could you clarify which file you meant?",
    });
    const parsed = parseActionDecision(decision);

    expect(parsed.kind).toBe("clarify");
    expect(parsed.message).toBe("Could you clarify which file you meant?");
  });

  it("accepts a valid abort decision with a message", () => {
    const decision = makeValidActionDecision({
      kind: "abort",
      message: "Aborting due to budget exhaustion.",
    });
    const parsed = parseActionDecision(decision);

    expect(parsed.kind).toBe("abort");
    expect(parsed.message).toBe("Aborting due to budget exhaustion.");
  });

  it("accepts a valid abort decision without a message (message is optional for abort)", () => {
    const decision = {
      decision_id: "dec-abort",
      kind: "abort",
    };
    const parsed = parseActionDecision(decision);

    expect(parsed.kind).toBe("abort");
    expect(parsed.message).toBeUndefined();
  });

  it("accepts a valid tool_calls decision with a single tool call entry", () => {
    const decision = {
      decision_id: "dec-tc",
      kind: "tool_calls",
      tool_calls: [
        {
          tool_name: "read_file",
          arguments: { filePath: "/tmp/test.ts", startLine: 1, endLine: 10 },
        },
      ],
    };
    const parsed = parseActionDecision(decision);

    expect(parsed.kind).toBe("tool_calls");
    expect(parsed.tool_calls).toHaveLength(1);
    expect(parsed.tool_calls![0].tool_name).toBe("read_file");
    expect(parsed.tool_calls![0].arguments).toEqual({
      filePath: "/tmp/test.ts",
      startLine: 1,
      endLine: 10,
    });
  });

  it("accepts a valid tool_calls decision with multiple tool call entries", () => {
    const decision = {
      decision_id: "dec-multi",
      kind: "tool_calls",
      tool_calls: [
        {
          tool_name: "read_file",
          arguments: { filePath: "/tmp/a.ts" },
        },
        {
          tool_name: "write_file",
          arguments: { filePath: "/tmp/b.ts", content: "hello" },
        },
      ],
    };
    const parsed = parseActionDecision(decision);

    expect(parsed.tool_calls).toHaveLength(2);
    expect(parsed.tool_calls![0].tool_name).toBe("read_file");
    expect(parsed.tool_calls![1].tool_name).toBe("write_file");
  });

  // ── Optional fields ────────────────────────────────────────

  it("accepts optional decision_summary when present as a non-empty string", () => {
    const decision = makeValidActionDecision({
      decision_summary: "User asked for file contents, responding with read result.",
    });
    const parsed = parseActionDecision(decision);

    expect(parsed.decision_summary).toBe(
      "User asked for file contents, responding with read result.",
    );
  });

  it("accepts optional provider_trace_ref as a canonical ContentRef", () => {
    const decision = makeValidActionDecision({
      provider_trace_ref: makeValidContentRef(),
    });
    const parsed = parseActionDecision(decision);

    expect(parsed.provider_trace_ref).toEqual(makeValidContentRef());
  });

  it("accepts optional provider_call_ref on tool call entries", () => {
    const decision = {
      decision_id: "dec-tc-ref",
      kind: "tool_calls",
      tool_calls: [
        {
          tool_name: "read_file",
          arguments: { filePath: "/tmp/test.ts" },
          provider_call_ref: "call-abc-123",
        },
      ],
    };
    const parsed = parseActionDecision(decision);

    expect(parsed.tool_calls![0].provider_call_ref).toBe("call-abc-123");
  });

  it("accepts a tool_calls decision where arguments is an empty object (parameterless tool call)", () => {
    const decision = {
      decision_id: "dec-empty-args",
      kind: "tool_calls",
      tool_calls: [
        {
          tool_name: "ping",
          arguments: {},
        },
      ],
    };
    const parsed = parseActionDecision(decision);

    expect(parsed.tool_calls![0].arguments).toEqual({});
  });

  // ── Conditional field enforcement: message ─────────────────

  it("rejects respond with missing message", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "respond" },
      [{ path: "message", code: "missing_required" }],
    );
  });

  it("rejects clarify with missing message", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "clarify" },
      [{ path: "message", code: "missing_required" }],
    );
  });

  it("rejects tool_calls with message present (unexpected_field)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        message: "should not be here",
        tool_calls: [
          { tool_name: "read_file", arguments: { path: "/f" } },
        ],
      },
      [{ path: "message", code: "unexpected_field" }],
    );
  });

  it("rejects respond with empty message string", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "respond", message: "" },
      [{ path: "message", code: "invalid_value" }],
    );
  });

  it("rejects clarify with empty message string", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "clarify", message: "" },
      [{ path: "message", code: "invalid_value" }],
    );
  });

  it("rejects abort with empty message string when message is present", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "abort", message: "" },
      [{ path: "message", code: "invalid_value" }],
    );
  });

  // ── Conditional field enforcement: tool_calls ──────────────

  it("rejects tool_calls kind with missing tool_calls array", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "tool_calls" },
      [{ path: "tool_calls", code: "missing_required" }],
    );
  });

  it("rejects respond with tool_calls present (unexpected_field)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "respond",
        message: "hello",
        tool_calls: [
          { tool_name: "read_file", arguments: { path: "/f" } },
        ],
      },
      [{ path: "tool_calls", code: "unexpected_field" }],
    );
  });

  it("rejects clarify with tool_calls present (unexpected_field)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "clarify",
        message: "clarify what?",
        tool_calls: [
          { tool_name: "read_file", arguments: { path: "/f" } },
        ],
      },
      [{ path: "tool_calls", code: "unexpected_field" }],
    );
  });

  it("rejects abort with tool_calls present (unexpected_field)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "abort",
        tool_calls: [
          { tool_name: "read_file", arguments: { path: "/f" } },
        ],
      },
      [{ path: "tool_calls", code: "unexpected_field" }],
    );
  });

  it("rejects tool_calls kind with empty tool_calls array", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "tool_calls", tool_calls: [] },
      [{ path: "tool_calls", code: "empty_array" }],
    );
  });

  // ── decision_id non-coercion ───────────────────────────────

  it("rejects decision_id as a number", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_id: 12345 }),
      [{ path: "decision_id", code: "invalid_type" }],
    );
  });

  it("rejects decision_id as a boolean", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_id: true }),
      [{ path: "decision_id", code: "invalid_type" }],
    );
  });

  it("rejects decision_id as an array", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_id: ["id1"] }),
      [{ path: "decision_id", code: "invalid_type" }],
    );
  });

  it("rejects decision_id as an object", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_id: { id: "nested" } }),
      [{ path: "decision_id", code: "invalid_type" }],
    );
  });

  it("rejects decision_id as an empty string", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_id: "" }),
      [{ path: "decision_id", code: "invalid_value" }],
    );
  });

  // ── decision_summary non-coercion ──────────────────────────

  it("rejects decision_summary as a number", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_summary: 42 }),
      [{ path: "decision_summary", code: "invalid_type" }],
    );
  });

  it("rejects decision_summary as a boolean", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_summary: false }),
      [{ path: "decision_summary", code: "invalid_type" }],
    );
  });

  it("rejects decision_summary as an array", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_summary: ["summary"] }),
      [{ path: "decision_summary", code: "invalid_type" }],
    );
  });

  it("rejects decision_summary as an object", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_summary: { text: "bad" } }),
      [{ path: "decision_summary", code: "invalid_type" }],
    );
  });

  it("rejects decision_summary as an empty string", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ decision_summary: "" }),
      [{ path: "decision_summary", code: "invalid_value" }],
    );
  });

  // ── Invalid kind ───────────────────────────────────────────

  it("rejects an unknown kind string", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: "unknown_kind", message: "hello" },
      [{ path: "kind", code: "invalid_literal" }],
    );
  });

  it("rejects kind as a non-string type", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", kind: 42, message: "hello" },
      [{ path: "kind", code: "invalid_type" }],
    );
  });

  it("rejects missing kind field", () => {
    expectActionDecisionIssues(
      { decision_id: "dec-001", message: "hello" },
      [{ path: "kind", code: "missing_required" }],
    );
  });

  // ── Invalid tool call entries ──────────────────────────────

  it("rejects tool_calls entry that is a non-object (string)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: ["not an object"],
      },
      [{ path: "tool_calls[0]", code: "invalid_type" }],
    );
  });

  it("rejects tool_calls entry that is a non-object (number)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [42],
      },
      [{ path: "tool_calls[0]", code: "invalid_type" }],
    );
  });

  it("rejects tool_calls entry that is a non-object (null)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [null],
      },
      [{ path: "tool_calls[0]", code: "invalid_type" }],
    );
  });

  it("rejects tool_calls entry that is a non-object (array)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [["nested"]],
      },
      [{ path: "tool_calls[0]", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry with missing tool_name", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ arguments: { path: "/f" } }],
      },
      [{ path: "tool_calls[0].tool_name", code: "missing_required" }],
    );
  });

  it("rejects tool call entry with non-string tool_name", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: 42, arguments: { path: "/f" } }],
      },
      [{ path: "tool_calls[0].tool_name", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry with empty string tool_name", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "", arguments: { path: "/f" } }],
      },
      [{ path: "tool_calls[0].tool_name", code: "invalid_value" }],
    );
  });

  it("rejects tool call entry with missing arguments", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "read_file" }],
      },
      [{ path: "tool_calls[0].arguments", code: "missing_required" }],
    );
  });

  it("rejects tool call entry where arguments is null", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "read_file", arguments: null }],
      },
      [{ path: "tool_calls[0].arguments", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry where arguments is an array", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "read_file", arguments: ["a", "b"] }],
      },
      [{ path: "tool_calls[0].arguments", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry where arguments is a primitive string", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "read_file", arguments: "bad" }],
      },
      [{ path: "tool_calls[0].arguments", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry where arguments is a number", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "read_file", arguments: 42 }],
      },
      [{ path: "tool_calls[0].arguments", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry where arguments is a class instance (Date)", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "read_file", arguments: new Date() }],
      },
      [{ path: "tool_calls[0].arguments", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry where arguments is a Map instance", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [{ tool_name: "read_file", arguments: new Map() }],
      },
      [{ path: "tool_calls[0].arguments", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry with non-string provider_call_ref", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [
          {
            tool_name: "read_file",
            arguments: { path: "/f" },
            provider_call_ref: 123,
          },
        ],
      },
      [{ path: "tool_calls[0].provider_call_ref", code: "invalid_type" }],
    );
  });

  it("rejects tool call entry with empty provider_call_ref", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [
          {
            tool_name: "read_file",
            arguments: { path: "/f" },
            provider_call_ref: "",
          },
        ],
      },
      [{ path: "tool_calls[0].provider_call_ref", code: "invalid_value" }],
    );
  });

  it("rejects tool call entry with unknown keys", () => {
    expectActionDecisionIssues(
      {
        decision_id: "dec-001",
        kind: "tool_calls",
        tool_calls: [
          {
            tool_name: "read_file",
            arguments: { path: "/f" },
            extra_field: "not allowed",
          },
        ],
      },
      [{ path: "tool_calls[0].extra_field", code: "unknown_key" }],
    );
  });

  // ── Nested provider_trace_ref composition ──────────────────

  it("accepts optional provider_trace_ref as a valid ContentRef", () => {
    const decision = makeValidActionDecision({
      provider_trace_ref: makeValidContentRef(),
    });
    const parsed = parseActionDecision(decision);

    expect(parsed.provider_trace_ref).toBeDefined();
    expect(parsed.provider_trace_ref!.ref_id).toBe("ref-123");
  });

  it("rejects provider_trace_ref with non-canonical ContentRef shape", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({
        provider_trace_ref: {
          ref_id: "ok-ref",
          kind: "invalid_kind",
          storage_area: "artifacts",
          locator: "x",
          retention: "persistent",
        },
      }),
      [{ path: "provider_trace_ref.kind", code: "invalid_literal" }],
    );
  });

  // ── Unknown top-level keys ─────────────────────────────────

  it("rejects unknown top-level keys", () => {
    expectActionDecisionIssues(
      makeValidActionDecision({ extra_field: "not allowed" }),
      [{ path: "extra_field", code: "unknown_key" }],
    );
  });

  // ── Bulk missing required fields ───────────────────────────

  it("reports bulk missing required fields when all are absent", () => {
    const issues = getActionDecisionIssues({});
    const codes = issues.map((i) => i.code);

    expect(codes).toContain("missing_required");
    expect(issues.length).toBeGreaterThanOrEqual(2); // decision_id + kind
  });

  // ── Wrong top-level type ───────────────────────────────────

  it("rejects non-object input", () => {
    expectActionDecisionIssues("not an object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects null input", () => {
    expectActionDecisionIssues(null, [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects array input", () => {
    expectActionDecisionIssues([1, 2, 3], [
      { path: "$", code: "invalid_type" },
    ]);
  });

  // ── ValidationError class tests ────────────────────────────

  it("ActionDecisionValidationError is catchable and exposes issues", () => {
    let caught: ActionDecisionValidationError | undefined;

    try {
      parseActionDecision({});
    } catch (error) {
      caught = error as ActionDecisionValidationError;
    }

    expect(caught).toBeDefined();
    expect(caught!.name).toBe("ActionDecisionValidationError");
    expect(caught!.issues.length).toBeGreaterThan(0);
    expect(caught!.message).toContain("Invalid action decision");
  });

  it("ActionDecisionValidationError with single issue uses singular form", () => {
    let caught: ActionDecisionValidationError | undefined;

    try {
      parseActionDecision("not an object");
    } catch (error) {
      caught = error as ActionDecisionValidationError;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain("1 validation issue");
  });

  // ── Frozen return value ────────────────────────────────────

  it("returns a frozen object", () => {
    const parsed = parseActionDecision(makeValidActionDecision());
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("returns deeply frozen tool_calls entries", () => {
    const parsed = parseActionDecision({
      decision_id: "dec-tc",
      kind: "tool_calls",
      tool_calls: [
        {
          tool_name: "read_file",
          arguments: { filePath: "/tmp/test.ts", startLine: 1, endLine: 10 },
        },
      ],
    });
    expect(Object.isFrozen(parsed.tool_calls!)).toBe(true);
    expect(Object.isFrozen(parsed.tool_calls![0])).toBe(true);
    expect(Object.isFrozen(parsed.tool_calls![0].arguments)).toBe(true);
  });
});