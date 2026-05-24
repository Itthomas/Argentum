import { describe, expect, it } from "vitest";

import type { ToolCallDTO, ToolResultDTO } from "../src/index.js";
import {
  parseToolCallDTO,
  parseToolResultDTO,
  ToolCallDTOValidationError,
  ToolResultValidationError,
} from "../src/index.js";

// ── Shared helpers for ToolCallDTO ──────────────────────────────

function makeValidGrant(overrides: Record<string, unknown> = {}) {
  return {
    grant_id: "grant-001",
    cwd: "/workspace",
    path_permissions: [
      {
        root: "bedrock",
        path: "/workspace/bedrock",
        capabilities: ["read"],
      },
    ],
    env_secret_handles: ["API_KEY"],
    network_policy: "inherit",
    approval_mode: "auto_allow",
    max_runtime_ms: 30000,
    ...overrides,
  };
}

function makeValidToolCall(overrides: Record<string, unknown> = {}) {
  return {
    call_id: "call-001",
    turn_id: "turn-001",
    tool_name: "search",
    arguments: { query: "hello" },
    grant: makeValidGrant(),
    timeout_ms: 30000,
    idempotency_key: "idem-turn-001-0-search",
    ...overrides,
  };
}

function getToolCallIssues(value: unknown) {
  try {
    parseToolCallDTO(value);
  } catch (error) {
    if (error instanceof ToolCallDTOValidationError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error("Expected tool call parsing to fail.");
}

function expectToolCallIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getToolCallIssues(value);
  expect(issues).toHaveLength(expected.length);
  expect(issues).toEqual(
    expect.arrayContaining(
      expected.map((issue) => expect.objectContaining(issue)),
    ),
  );
}

// ── Shared helpers for ToolResultDTO ────────────────────────────

function makeValidContentRef(overrides: Record<string, unknown> = {}) {
  return {
    ref_id: "ref-001",
    kind: "file",
    storage_area: "artifacts",
    locator: "turns/turn-001/output.md",
    retention: "persistent",
    ...overrides,
  };
}

function makeValidToolResult(overrides: Record<string, unknown> = {}) {
  return {
    call_id: "call-001",
    status: "success",
    human_summary: "Search completed successfully.",
    duration_ms: 1500,
    truncated: false,
    retryable: false,
    ...overrides,
  };
}

function getToolResultIssues(value: unknown) {
  try {
    parseToolResultDTO(value);
  } catch (error) {
    if (error instanceof ToolResultValidationError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error("Expected tool result parsing to fail.");
}

function expectToolResultIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getToolResultIssues(value);
  expect(issues).toHaveLength(expected.length);
  expect(issues).toEqual(
    expect.arrayContaining(
      expected.map((issue) => expect.objectContaining(issue)),
    ),
  );
}

// ── ToolCallDTO tests ───────────────────────────────────────────

describe("parseToolCallDTO", () => {
  // ── Valid tool calls ──────────────────────────────────────

  it("accepts a full valid ToolCallDTO with all required fields", () => {
    const call = makeValidToolCall();
    const parsed = parseToolCallDTO(call);

    expect(parsed.call_id).toBe("call-001");
    expect(parsed.turn_id).toBe("turn-001");
    expect(parsed.tool_name).toBe("search");
    expect(parsed.arguments).toEqual({ query: "hello" });
    expect(parsed.grant.grant_id).toBe("grant-001");
    expect(parsed.timeout_ms).toBe(30000);
    expect(parsed.idempotency_key).toBe("idem-turn-001-0-search");
  });

  it("accepts timeout_ms === grant.max_runtime_ms", () => {
    const call = makeValidToolCall({
      timeout_ms: 30000,
      grant: makeValidGrant({ max_runtime_ms: 30000 }),
    });
    const parsed = parseToolCallDTO(call);

    expect(parsed.timeout_ms).toBe(30000);
    expect(parsed.grant.max_runtime_ms).toBe(30000);
  });

  it("accepts arguments as empty object {}", () => {
    const call = makeValidToolCall({ arguments: {} });
    const parsed = parseToolCallDTO(call);

    expect(parsed.arguments).toEqual({});
  });

  it("accepts min positive timeout_ms = 1", () => {
    const call = makeValidToolCall({
      timeout_ms: 1,
      grant: makeValidGrant({ max_runtime_ms: 1 }),
    });
    const parsed = parseToolCallDTO(call);

    expect(parsed.timeout_ms).toBe(1);
    expect(parsed.grant.max_runtime_ms).toBe(1);
  });

  // ── Non-coercion: call_id ─────────────────────────────────

  it("rejects call_id as number", () => {
    expectToolCallIssues(makeValidToolCall({ call_id: 42 }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as boolean", () => {
    expectToolCallIssues(makeValidToolCall({ call_id: true }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as array", () => {
    expectToolCallIssues(makeValidToolCall({ call_id: ["a"] }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as object", () => {
    expectToolCallIssues(makeValidToolCall({ call_id: { x: 1 } }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as empty string", () => {
    expectToolCallIssues(makeValidToolCall({ call_id: "" }), [
      { path: "call_id", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: turn_id ─────────────────────────────────

  it("rejects turn_id as number", () => {
    expectToolCallIssues(makeValidToolCall({ turn_id: 42 }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as boolean", () => {
    expectToolCallIssues(makeValidToolCall({ turn_id: false }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as array", () => {
    expectToolCallIssues(makeValidToolCall({ turn_id: ["a"] }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as object", () => {
    expectToolCallIssues(makeValidToolCall({ turn_id: {} }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as empty string", () => {
    expectToolCallIssues(makeValidToolCall({ turn_id: "" }), [
      { path: "turn_id", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: tool_name ───────────────────────────────

  it("rejects tool_name as number", () => {
    expectToolCallIssues(makeValidToolCall({ tool_name: 99 }), [
      { path: "tool_name", code: "invalid_type" },
    ]);
  });

  it("rejects tool_name as boolean", () => {
    expectToolCallIssues(makeValidToolCall({ tool_name: true }), [
      { path: "tool_name", code: "invalid_type" },
    ]);
  });

  it("rejects tool_name as array", () => {
    expectToolCallIssues(makeValidToolCall({ tool_name: ["search"] }), [
      { path: "tool_name", code: "invalid_type" },
    ]);
  });

  it("rejects tool_name as object", () => {
    expectToolCallIssues(makeValidToolCall({ tool_name: { name: "x" } }), [
      { path: "tool_name", code: "invalid_type" },
    ]);
  });

  it("rejects tool_name as empty string", () => {
    expectToolCallIssues(makeValidToolCall({ tool_name: "" }), [
      { path: "tool_name", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: arguments ───────────────────────────────

  it("rejects arguments as null", () => {
    expectToolCallIssues(makeValidToolCall({ arguments: null }), [
      { path: "arguments", code: "invalid_type" },
    ]);
  });

  it("rejects arguments as array", () => {
    expectToolCallIssues(makeValidToolCall({ arguments: ["a"] }), [
      { path: "arguments", code: "invalid_type" },
    ]);
  });

  it("rejects arguments as string", () => {
    expectToolCallIssues(makeValidToolCall({ arguments: "{}" }), [
      { path: "arguments", code: "invalid_type" },
    ]);
  });

  it("rejects arguments as number", () => {
    expectToolCallIssues(makeValidToolCall({ arguments: 42 }), [
      { path: "arguments", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: grant ───────────────────────────────────

  it("rejects grant as null", () => {
    expectToolCallIssues(makeValidToolCall({ grant: null }), [
      { path: "grant", code: "invalid_type" },
    ]);
  });

  it("rejects grant as array", () => {
    expectToolCallIssues(makeValidToolCall({ grant: [] }), [
      { path: "grant", code: "invalid_type" },
    ]);
  });

  it("rejects grant as string", () => {
    expectToolCallIssues(makeValidToolCall({ grant: "grant-001" }), [
      { path: "grant", code: "invalid_type" },
    ]);
  });

  it("rejects grant as number", () => {
    expectToolCallIssues(makeValidToolCall({ grant: 42 }), [
      { path: "grant", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: timeout_ms ──────────────────────────────

  it("rejects timeout_ms as string", () => {
    expectToolCallIssues(makeValidToolCall({ timeout_ms: "30000" }), [
      { path: "timeout_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects timeout_ms as boolean", () => {
    expectToolCallIssues(makeValidToolCall({ timeout_ms: true }), [
      { path: "timeout_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects timeout_ms as float (1.5)", () => {
    expectToolCallIssues(makeValidToolCall({
      timeout_ms: 1.5,
      grant: makeValidGrant({ max_runtime_ms: 1 }),
    }), [
      { path: "timeout_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects timeout_ms as NaN", () => {
    expectToolCallIssues(makeValidToolCall({ timeout_ms: NaN }), [
      { path: "timeout_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects timeout_ms as Infinity", () => {
    expectToolCallIssues(makeValidToolCall({ timeout_ms: Infinity }), [
      { path: "timeout_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects timeout_ms = 0", () => {
    expectToolCallIssues(makeValidToolCall({ timeout_ms: 0 }), [
      { path: "timeout_ms", code: "invalid_value" },
    ]);
  });

  it("rejects negative timeout_ms", () => {
    expectToolCallIssues(makeValidToolCall({ timeout_ms: -1 }), [
      { path: "timeout_ms", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: idempotency_key ─────────────────────────

  it("rejects idempotency_key as number", () => {
    expectToolCallIssues(makeValidToolCall({ idempotency_key: 123 }), [
      { path: "idempotency_key", code: "invalid_type" },
    ]);
  });

  it("rejects idempotency_key as boolean", () => {
    expectToolCallIssues(makeValidToolCall({ idempotency_key: true }), [
      { path: "idempotency_key", code: "invalid_type" },
    ]);
  });

  it("rejects idempotency_key as array", () => {
    expectToolCallIssues(makeValidToolCall({ idempotency_key: ["k"] }), [
      { path: "idempotency_key", code: "invalid_type" },
    ]);
  });

  it("rejects idempotency_key as object", () => {
    expectToolCallIssues(makeValidToolCall({ idempotency_key: {} }), [
      { path: "idempotency_key", code: "invalid_type" },
    ]);
  });

  it("rejects idempotency_key as empty string", () => {
    expectToolCallIssues(makeValidToolCall({ idempotency_key: "" }), [
      { path: "idempotency_key", code: "invalid_value" },
    ]);
  });

  // ── Cross-field timeout_ms vs grant.max_runtime_ms ────────

  it("rejects timeout_ms !== grant.max_runtime_ms", () => {
    expectToolCallIssues(
      makeValidToolCall({
        timeout_ms: 5000,
        grant: makeValidGrant({ max_runtime_ms: 30000 }),
      }),
      [{ path: "timeout_ms", code: "invalid_value" }],
    );
  });

  it("skips cross-field check when grant itself fails parsing", () => {
    // grant is missing required fields, so grant parsing should fail
    // first; timeout_ms should NOT get a cross-field mismatch issue
    const issues = getToolCallIssues(
      makeValidToolCall({
        timeout_ms: 5000,
        grant: { not_a_grant: true },
      }),
    );

    const timeoutIssues = issues.filter(
      (i) => i.path === "timeout_ms" && i.code === "invalid_value",
    );
    expect(timeoutIssues).toHaveLength(0);
  });

  // ── Missing required fields ───────────────────────────────

  it("rejects missing call_id", () => {
    const { call_id: _, ...rest } = makeValidToolCall();
    expectToolCallIssues(rest, [
      { path: "call_id", code: "missing_required" },
    ]);
  });

  it("rejects missing turn_id", () => {
    const { turn_id: _, ...rest } = makeValidToolCall();
    expectToolCallIssues(rest, [
      { path: "turn_id", code: "missing_required" },
    ]);
  });

  it("rejects missing tool_name", () => {
    const { tool_name: _, ...rest } = makeValidToolCall();
    expectToolCallIssues(rest, [
      { path: "tool_name", code: "missing_required" },
    ]);
  });

  it("rejects missing arguments", () => {
    const { arguments: _, ...rest } = makeValidToolCall();
    expectToolCallIssues(rest, [
      { path: "arguments", code: "missing_required" },
    ]);
  });

  it("rejects missing grant", () => {
    const { grant: _, ...rest } = makeValidToolCall();
    expectToolCallIssues(rest, [
      { path: "grant", code: "missing_required" },
    ]);
  });

  it("rejects missing timeout_ms", () => {
    const { timeout_ms: _, ...rest } = makeValidToolCall();
    expectToolCallIssues(rest, [
      { path: "timeout_ms", code: "missing_required" },
    ]);
  });

  it("rejects missing idempotency_key", () => {
    const { idempotency_key: _, ...rest } = makeValidToolCall();
    expectToolCallIssues(rest, [
      { path: "idempotency_key", code: "missing_required" },
    ]);
  });

  // ── Unknown keys ──────────────────────────────────────────

  it("rejects a single unknown key", () => {
    expectToolCallIssues(
      makeValidToolCall({ extra_field: "nope" }),
      [{ path: "extra_field", code: "unknown_key" }],
    );
  });

  it("rejects multiple unknown keys", () => {
    expectToolCallIssues(
      makeValidToolCall({ extra_1: "a", extra_2: "b" }),
      [
        { path: "extra_1", code: "unknown_key" },
        { path: "extra_2", code: "unknown_key" },
      ],
    );
  });

  // ── Wrong top-level type ──────────────────────────────────

  it("rejects non-object input (string)", () => {
    expectToolCallIssues("not-an-object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects non-object input (array)", () => {
    expectToolCallIssues([], [{ path: "$", code: "invalid_type" }]);
  });

  it("rejects non-object input (null)", () => {
    expectToolCallIssues(null, [{ path: "$", code: "invalid_type" }]);
  });
});

// ── ToolResultDTO tests ─────────────────────────────────────────

describe("parseToolResultDTO", () => {
  // ── Valid tool results ────────────────────────────────────

  it("accepts status = success with all required fields", () => {
    const result = makeValidToolResult({ status: "success" });
    const parsed = parseToolResultDTO(result);

    expect(parsed.call_id).toBe("call-001");
    expect(parsed.status).toBe("success");
    expect(parsed.human_summary).toBe("Search completed successfully.");
    expect(parsed.duration_ms).toBe(1500);
    expect(parsed.truncated).toBe(false);
    expect(parsed.retryable).toBe(false);
  });

  it("accepts status = error with all required fields", () => {
    const result = makeValidToolResult({
      status: "error",
      human_summary: "Search failed.",
    });
    const parsed = parseToolResultDTO(result);

    expect(parsed.status).toBe("error");
    expect(parsed.human_summary).toBe("Search failed.");
  });

  it("accepts status = blocked with all required fields", () => {
    const result = makeValidToolResult({
      status: "blocked",
      human_summary: "Search blocked by policy.",
    });
    const parsed = parseToolResultDTO(result);

    expect(parsed.status).toBe("blocked");
  });

  it("accepts optional artifact_refs with single ContentRef", () => {
    const result = makeValidToolResult({
      artifact_refs: [makeValidContentRef()],
    });
    const parsed = parseToolResultDTO(result);

    expect(parsed.artifact_refs).toHaveLength(1);
    expect(parsed.artifact_refs![0].ref_id).toBe("ref-001");
  });

  it("accepts optional artifact_refs with multiple ContentRef entries", () => {
    const result = makeValidToolResult({
      artifact_refs: [
        makeValidContentRef({ ref_id: "ref-001" }),
        makeValidContentRef({ ref_id: "ref-002", locator: "turns/turn-001/log.txt" }),
      ],
    });
    const parsed = parseToolResultDTO(result);

    expect(parsed.artifact_refs).toHaveLength(2);
    expect(parsed.artifact_refs![0].ref_id).toBe("ref-001");
    expect(parsed.artifact_refs![1].ref_id).toBe("ref-002");
  });

  it("accepts optional structured_payload_ref", () => {
    const result = makeValidToolResult({
      structured_payload_ref: makeValidContentRef({
        ref_id: "ref-payload",
        kind: "json",
      }),
    });
    const parsed = parseToolResultDTO(result);

    expect(parsed.structured_payload_ref).toBeDefined();
    expect(parsed.structured_payload_ref!.ref_id).toBe("ref-payload");
    expect(parsed.structured_payload_ref!.kind).toBe("json");
  });

  it("accepts optional error_code", () => {
    const result = makeValidToolResult({
      status: "error",
      error_code: "TIMEOUT",
    });
    const parsed = parseToolResultDTO(result);

    expect(parsed.error_code).toBe("TIMEOUT");
  });

  it("accepts empty artifact_refs array", () => {
    const result = makeValidToolResult({ artifact_refs: [] });
    const parsed = parseToolResultDTO(result);

    expect(parsed.artifact_refs).toEqual([]);
  });

  it("accepts duration_ms = 0", () => {
    const result = makeValidToolResult({ duration_ms: 0 });
    const parsed = parseToolResultDTO(result);

    expect(parsed.duration_ms).toBe(0);
  });

  it("accepts truncated and retryable both true", () => {
    const result = makeValidToolResult({ truncated: true, retryable: true });
    const parsed = parseToolResultDTO(result);

    expect(parsed.truncated).toBe(true);
    expect(parsed.retryable).toBe(true);
  });

  // ── Non-coercion: call_id ─────────────────────────────────

  it("rejects call_id as number", () => {
    expectToolResultIssues(makeValidToolResult({ call_id: 42 }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as boolean", () => {
    expectToolResultIssues(makeValidToolResult({ call_id: true }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as array", () => {
    expectToolResultIssues(makeValidToolResult({ call_id: ["a"] }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as object", () => {
    expectToolResultIssues(makeValidToolResult({ call_id: {} }), [
      { path: "call_id", code: "invalid_type" },
    ]);
  });

  it("rejects call_id as empty string", () => {
    expectToolResultIssues(makeValidToolResult({ call_id: "" }), [
      { path: "call_id", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: status ──────────────────────────────────

  it("rejects unknown status literal", () => {
    expectToolResultIssues(makeValidToolResult({ status: "unknown" }), [
      { path: "status", code: "invalid_literal" },
    ]);
  });

  it("rejects status as number", () => {
    expectToolResultIssues(makeValidToolResult({ status: 1 }), [
      { path: "status", code: "invalid_type" },
    ]);
  });

  it("rejects status as boolean", () => {
    expectToolResultIssues(makeValidToolResult({ status: true }), [
      { path: "status", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: human_summary ───────────────────────────

  it("rejects human_summary as number", () => {
    expectToolResultIssues(makeValidToolResult({ human_summary: 123 }), [
      { path: "human_summary", code: "invalid_type" },
    ]);
  });

  it("rejects human_summary as boolean", () => {
    expectToolResultIssues(makeValidToolResult({ human_summary: false }), [
      { path: "human_summary", code: "invalid_type" },
    ]);
  });

  it("rejects human_summary as array", () => {
    expectToolResultIssues(makeValidToolResult({ human_summary: ["ok"] }), [
      { path: "human_summary", code: "invalid_type" },
    ]);
  });

  it("rejects human_summary as object", () => {
    expectToolResultIssues(makeValidToolResult({ human_summary: {} }), [
      { path: "human_summary", code: "invalid_type" },
    ]);
  });

  it("rejects human_summary as empty string", () => {
    expectToolResultIssues(makeValidToolResult({ human_summary: "" }), [
      { path: "human_summary", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: duration_ms ─────────────────────────────

  it("rejects duration_ms as string number", () => {
    expectToolResultIssues(makeValidToolResult({ duration_ms: "1500" }), [
      { path: "duration_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects duration_ms as boolean", () => {
    expectToolResultIssues(makeValidToolResult({ duration_ms: true }), [
      { path: "duration_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects duration_ms as float (non-integer)", () => {
    expectToolResultIssues(makeValidToolResult({ duration_ms: 1.5 }), [
      { path: "duration_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects duration_ms as negative", () => {
    expectToolResultIssues(makeValidToolResult({ duration_ms: -1 }), [
      { path: "duration_ms", code: "invalid_value" },
    ]);
  });

  it("rejects duration_ms as NaN", () => {
    expectToolResultIssues(makeValidToolResult({ duration_ms: NaN }), [
      { path: "duration_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects duration_ms as Infinity", () => {
    expectToolResultIssues(makeValidToolResult({ duration_ms: Infinity }), [
      { path: "duration_ms", code: "invalid_integer" },
    ]);
  });

  // ── Non-coercion: truncated ───────────────────────────────

  it("rejects truncated as string 'true'", () => {
    expectToolResultIssues(makeValidToolResult({ truncated: "true" }), [
      { path: "truncated", code: "invalid_type" },
    ]);
  });

  it("rejects truncated as number 1", () => {
    expectToolResultIssues(makeValidToolResult({ truncated: 1 }), [
      { path: "truncated", code: "invalid_type" },
    ]);
  });

  it("rejects truncated as null", () => {
    expectToolResultIssues(makeValidToolResult({ truncated: null }), [
      { path: "truncated", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: retryable ───────────────────────────────

  it("rejects retryable as string 'false'", () => {
    expectToolResultIssues(makeValidToolResult({ retryable: "false" }), [
      { path: "retryable", code: "invalid_type" },
    ]);
  });

  it("rejects retryable as number 0", () => {
    expectToolResultIssues(makeValidToolResult({ retryable: 0 }), [
      { path: "retryable", code: "invalid_type" },
    ]);
  });

  it("rejects retryable as null", () => {
    expectToolResultIssues(makeValidToolResult({ retryable: null }), [
      { path: "retryable", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: error_code ──────────────────────────────

  it("rejects error_code as number", () => {
    expectToolResultIssues(
      makeValidToolResult({ error_code: 500 }),
      [{ path: "error_code", code: "invalid_type" }],
    );
  });

  it("rejects error_code as boolean", () => {
    expectToolResultIssues(
      makeValidToolResult({ error_code: true }),
      [{ path: "error_code", code: "invalid_type" }],
    );
  });

  it("rejects error_code as array", () => {
    expectToolResultIssues(
      makeValidToolResult({ error_code: ["TIMEOUT"] }),
      [{ path: "error_code", code: "invalid_type" }],
    );
  });

  it("rejects error_code as object", () => {
    expectToolResultIssues(
      makeValidToolResult({ error_code: { code: "X" } }),
      [{ path: "error_code", code: "invalid_type" }],
    );
  });

  it("rejects error_code as empty string", () => {
    expectToolResultIssues(
      makeValidToolResult({ error_code: "" }),
      [{ path: "error_code", code: "invalid_value" }],
    );
  });

  // ── Invalid artifact_refs ─────────────────────────────────

  it("rejects artifact_refs as non-array (string)", () => {
    expectToolResultIssues(
      makeValidToolResult({ artifact_refs: "not-an-array" }),
      [{ path: "artifact_refs", code: "invalid_type" }],
    );
  });

  it("rejects artifact_refs containing non-canonical ContentRef", () => {
    const issues = getToolResultIssues(
      makeValidToolResult({
        artifact_refs: [{ not_a_ref: true }],
      }),
    );

    expect(issues.some((i) => i.path.startsWith("artifact_refs[0]"))).toBe(true);
  });

  // ── Invalid structured_payload_ref ────────────────────────

  it("rejects structured_payload_ref as non-object (string)", () => {
    expectToolResultIssues(
      makeValidToolResult({ structured_payload_ref: "not-an-object" }),
      [{ path: "structured_payload_ref", code: "invalid_type" }],
    );
  });

  it("rejects structured_payload_ref as non-canonical ContentRef", () => {
    const issues = getToolResultIssues(
      makeValidToolResult({
        structured_payload_ref: { not_a_ref: true },
      }),
    );

    expect(
      issues.some((i) => i.path.startsWith("structured_payload_ref")),
    ).toBe(true);
  });

  // ── Missing required fields ───────────────────────────────

  it("rejects missing call_id", () => {
    const { call_id: _, ...rest } = makeValidToolResult();
    expectToolResultIssues(rest, [
      { path: "call_id", code: "missing_required" },
    ]);
  });

  it("rejects missing status", () => {
    const { status: _, ...rest } = makeValidToolResult();
    expectToolResultIssues(rest, [
      { path: "status", code: "missing_required" },
    ]);
  });

  it("rejects missing human_summary", () => {
    const { human_summary: _, ...rest } = makeValidToolResult();
    expectToolResultIssues(rest, [
      { path: "human_summary", code: "missing_required" },
    ]);
  });

  it("rejects missing duration_ms", () => {
    const { duration_ms: _, ...rest } = makeValidToolResult();
    expectToolResultIssues(rest, [
      { path: "duration_ms", code: "missing_required" },
    ]);
  });

  it("rejects missing truncated", () => {
    const { truncated: _, ...rest } = makeValidToolResult();
    expectToolResultIssues(rest, [
      { path: "truncated", code: "missing_required" },
    ]);
  });

  it("rejects missing retryable", () => {
    const { retryable: _, ...rest } = makeValidToolResult();
    expectToolResultIssues(rest, [
      { path: "retryable", code: "missing_required" },
    ]);
  });

  // ── Unknown keys ──────────────────────────────────────────

  it("rejects unknown key on ToolResultDTO", () => {
    expectToolResultIssues(
      makeValidToolResult({ extra: "nope" }),
      [{ path: "extra", code: "unknown_key" }],
    );
  });

  // ── Wrong top-level type ──────────────────────────────────

  it("rejects non-object input (string)", () => {
    expectToolResultIssues("not-an-object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects non-object input (null)", () => {
    expectToolResultIssues(null, [{ path: "$", code: "invalid_type" }]);
  });
});
