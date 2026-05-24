import { describe, expect, it } from "vitest";

import type {
  LLMInferenceRequest,
  LLMInferenceResult,
} from "../src/index.js";
import {
  ActionDecisionValidationError,
  ContextItemValidationError,
  LLMRequestValidationError,
  LLMResultValidationError,
  parseLLMInferenceRequest,
  parseLLMInferenceResult,
} from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidContentRef() {
  return {
    ref_id: "ref-123",
    kind: "file" as const,
    storage_area: "artifacts" as const,
    locator: "turns/turn-123/output.md",
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

function makeValidToolEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "search",
    description: "Search the web for information.",
    input_schema: { type: "object", properties: {} },
    ...overrides,
  };
}

function makeValidActionDecision(overrides: Record<string, unknown> = {}) {
  return {
    decision_id: "dec-001",
    kind: "respond",
    message: "Hello, world!",
    ...overrides,
  };
}

function getRequestIssues(value: unknown) {
  try {
    parseLLMInferenceRequest(value);
  } catch (error) {
    if (error instanceof LLMRequestValidationError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error("Expected LLM inference request parsing to fail.");
}

function expectRequestIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getRequestIssues(value);
  const actual = issues.map(({ path, code }) => ({ path, code }));
  expect(actual).toEqual(expected);
}

function getResultIssues(value: unknown) {
  try {
    parseLLMInferenceResult(value);
  } catch (error) {
    if (error instanceof LLMResultValidationError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error("Expected LLM inference result parsing to fail.");
}

function expectResultIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getResultIssues(value);
  const actual = issues.map(({ path, code }) => ({ path, code }));
  expect(actual).toEqual(expected);
}

function makeRawRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    request_id: "req-001",
    turn_id: "turn-001",
    context_items: [makeValidContextItem()],
    available_tools: [makeValidToolEntry()],
    inference_policy: {},
    ...overrides,
  };
}

function makeValidRequest(
  overrides: Record<string, unknown> = {},
): LLMInferenceRequest {
  return parseLLMInferenceRequest(makeRawRequest(overrides));
}

function makeRawResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    request_id: "req-001",
    decision: makeValidActionDecision(),
    normalization_status: "native_tool",
    ...overrides,
  };
}

function makeValidResult(
  overrides: Record<string, unknown> = {},
): LLMInferenceResult {
  return parseLLMInferenceResult(makeRawResult(overrides));
}

// ── Tests: LLMInferenceRequest ──────────────────────────────────

describe("parseLLMInferenceRequest", () => {
  // ── Valid requests ─────────────────────────────────────────

  it("accepts a full valid request with all required fields", () => {
    const request = makeValidRequest();
    expect(request.request_id).toBe("req-001");
    expect(request.turn_id).toBe("turn-001");
    expect(request.context_items).toHaveLength(1);
    expect(request.available_tools).toHaveLength(1);
    expect(request.inference_policy).toEqual({});
  });

  it("accepts a request with a single context item and single tool", () => {
    const request = makeValidRequest({
      context_items: [makeValidContextItem()],
      available_tools: [makeValidToolEntry()],
    });
    expect(request.context_items).toHaveLength(1);
    expect(request.available_tools).toHaveLength(1);
  });

  it("accepts a request with inference_policy as empty object {}", () => {
    const request = makeValidRequest({ inference_policy: {} });
    expect(request.inference_policy).toEqual({});
  });

  it("accepts a request with inference_policy containing arbitrary keys", () => {
    const request = makeValidRequest({
      inference_policy: { temperature: 0.7, max_tokens: 1000 },
    });
    expect(request.inference_policy).toEqual({
      temperature: 0.7,
      max_tokens: 1000,
    });
  });

  it("accepts a request with empty context_items array", () => {
    const request = makeValidRequest({ context_items: [] });
    expect(request.context_items).toHaveLength(0);
  });

  it("accepts a request with empty available_tools array", () => {
    const request = makeValidRequest({ available_tools: [] });
    expect(request.available_tools).toHaveLength(0);
  });

  // ── Non-coercion: request_id ───────────────────────────────

  it("rejects request_id as number", () => {
    expectRequestIssues(makeRawRequest({ request_id: 42 }), [
      { path: "request_id", code: "invalid_type" },
    ]);
  });

  it("rejects request_id as boolean", () => {
    expectRequestIssues(makeRawRequest({ request_id: true }), [
      { path: "request_id", code: "invalid_type" },
    ]);
  });

  it("rejects request_id as array", () => {
    expectRequestIssues(makeRawRequest({ request_id: [] }), [
      { path: "request_id", code: "invalid_type" },
    ]);
  });

  it("rejects request_id as object", () => {
    expectRequestIssues(makeRawRequest({ request_id: {} }), [
      { path: "request_id", code: "invalid_type" },
    ]);
  });

  it("rejects request_id as empty string", () => {
    expectRequestIssues(makeRawRequest({ request_id: "" }), [
      { path: "request_id", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: turn_id ─────────────────────────────────

  it("rejects turn_id as number", () => {
    expectRequestIssues(makeRawRequest({ turn_id: 99 }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as boolean", () => {
    expectRequestIssues(makeRawRequest({ turn_id: false }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as array", () => {
    expectRequestIssues(makeRawRequest({ turn_id: ["x"] }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as object", () => {
    expectRequestIssues(makeRawRequest({ turn_id: { x: 1 } }), [
      { path: "turn_id", code: "invalid_type" },
    ]);
  });

  it("rejects turn_id as empty string", () => {
    expectRequestIssues(makeRawRequest({ turn_id: "" }), [
      { path: "turn_id", code: "invalid_value" },
    ]);
  });

  // ── Non-coercion: context_items ───────────────────────────

  it("rejects context_items as object", () => {
    expectRequestIssues(makeRawRequest({ context_items: {} }), [
      { path: "context_items", code: "invalid_type" },
    ]);
  });

  it("rejects context_items as string", () => {
    expectRequestIssues(makeRawRequest({ context_items: "not-array" }), [
      { path: "context_items", code: "invalid_type" },
    ]);
  });

  it("rejects context_items as number", () => {
    expectRequestIssues(makeRawRequest({ context_items: 42 }), [
      { path: "context_items", code: "invalid_type" },
    ]);
  });

  it("rejects context_items as null", () => {
    expectRequestIssues(makeRawRequest({ context_items: null }), [
      { path: "context_items", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: available_tools ─────────────────────────

  it("rejects available_tools as object", () => {
    expectRequestIssues(makeRawRequest({ available_tools: {} }), [
      { path: "available_tools", code: "invalid_type" },
    ]);
  });

  it("rejects available_tools as string", () => {
    expectRequestIssues(makeRawRequest({ available_tools: "x" }), [
      { path: "available_tools", code: "invalid_type" },
    ]);
  });

  it("rejects available_tools as number", () => {
    expectRequestIssues(makeRawRequest({ available_tools: 1 }), [
      { path: "available_tools", code: "invalid_type" },
    ]);
  });

  it("rejects available_tools as null", () => {
    expectRequestIssues(makeRawRequest({ available_tools: null }), [
      { path: "available_tools", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: inference_policy ────────────────────────

  it("rejects inference_policy as null", () => {
    expectRequestIssues(makeRawRequest({ inference_policy: null }), [
      { path: "inference_policy", code: "invalid_type" },
    ]);
  });

  it("rejects inference_policy as array", () => {
    expectRequestIssues(makeRawRequest({ inference_policy: [] }), [
      { path: "inference_policy", code: "invalid_type" },
    ]);
  });

  it("rejects inference_policy as string", () => {
    expectRequestIssues(makeRawRequest({ inference_policy: "policy" }), [
      { path: "inference_policy", code: "invalid_type" },
    ]);
  });

  it("rejects inference_policy as number", () => {
    expectRequestIssues(makeRawRequest({ inference_policy: 42 }), [
      { path: "inference_policy", code: "invalid_type" },
    ]);
  });

  // ── Required-field missing ────────────────────────────────

  it("rejects missing request_id", () => {
    const { request_id: _, ...rest } = makeRawRequest();
    expectRequestIssues(rest, [
      { path: "request_id", code: "missing_required" },
    ]);
  });

  it("rejects missing turn_id", () => {
    const { turn_id: _, ...rest } = makeRawRequest();
    expectRequestIssues(rest, [
      { path: "turn_id", code: "missing_required" },
    ]);
  });

  it("rejects missing context_items", () => {
    const { context_items: _, ...rest } = makeRawRequest();
    expectRequestIssues(rest, [
      { path: "context_items", code: "missing_required" },
    ]);
  });

  it("rejects missing available_tools", () => {
    const { available_tools: _, ...rest } = makeRawRequest();
    expectRequestIssues(rest, [
      { path: "available_tools", code: "missing_required" },
    ]);
  });

  it("rejects missing inference_policy", () => {
    const { inference_policy: _, ...rest } = makeRawRequest();
    expectRequestIssues(rest, [
      { path: "inference_policy", code: "missing_required" },
    ]);
  });

  it("rejects bulk missing all fields on request", () => {
    expectRequestIssues({}, [
      { path: "request_id", code: "missing_required" },
      { path: "turn_id", code: "missing_required" },
      { path: "context_items", code: "missing_required" },
      { path: "available_tools", code: "missing_required" },
      { path: "inference_policy", code: "missing_required" },
    ]);
  });

  // ── Unknown keys ──────────────────────────────────────────

  it("rejects unknown key on LLMInferenceRequest", () => {
    expectRequestIssues(
      { ...makeValidRequest(), extra_field: "should-be-rejected" },
      [{ path: "extra_field", code: "unknown_key" }],
    );
  });

  // ── Wrong top-level type ──────────────────────────────────

  it("rejects string input", () => {
    expectRequestIssues("not-an-object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects number input", () => {
    expectRequestIssues(42, [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects array input", () => {
    expectRequestIssues([], [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects null input", () => {
    expectRequestIssues(null, [
      { path: "$", code: "invalid_type" },
    ]);
  });

  // ── Composition: context_items delegate ───────────────────

  it("re-emits ContextItemValidationError issues with context_items. prefix", () => {
    const issues = getRequestIssues({
      ...makeValidRequest(),
      context_items: [{ context_id: "bad", layer: "invalid" }],
    });
    // Should have at least one issue from the invalid context item,
    // prefixed with context_items.
    const prefixedIssues = issues.filter((i) =>
      i.path.startsWith("context_items."),
    );
    expect(prefixedIssues.length).toBeGreaterThan(0);
  });

  // ── Available-tool entry validation ───────────────────────

  it("accepts a valid AvailableToolEntry", () => {
    const request = makeValidRequest({
      available_tools: [makeValidToolEntry()],
    });
    expect(request.available_tools[0]).toMatchObject({
      name: "search",
      description: "Search the web for information.",
      input_schema: { type: "object", properties: {} },
    });
  });

  it("rejects missing name on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ description: "desc", input_schema: {} }],
      },
      [{ path: "available_tools[0].name", code: "missing_required" }],
    );
  });

  it("rejects missing description on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", input_schema: {} }],
      },
      [{ path: "available_tools[0].description", code: "missing_required" }],
    );
  });

  it("rejects missing input_schema on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: "desc" }],
      },
      [{ path: "available_tools[0].input_schema", code: "missing_required" }],
    );
  });

  it("rejects name as number on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: 42, description: "desc", input_schema: {} }],
      },
      [{ path: "available_tools[0].name", code: "invalid_type" }],
    );
  });

  it("rejects name as boolean on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: true, description: "desc", input_schema: {} }],
      },
      [{ path: "available_tools[0].name", code: "invalid_type" }],
    );
  });

  it("rejects name as empty string on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "", description: "desc", input_schema: {} }],
      },
      [{ path: "available_tools[0].name", code: "invalid_value" }],
    );
  });

  it("rejects name as array on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: [], description: "desc", input_schema: {} }],
      },
      [{ path: "available_tools[0].name", code: "invalid_type" }],
    );
  });

  it("rejects name as object on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: {}, description: "desc", input_schema: {} }],
      },
      [{ path: "available_tools[0].name", code: "invalid_type" }],
    );
  });

  it("rejects description as number on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: 42, input_schema: {} }],
      },
      [{ path: "available_tools[0].description", code: "invalid_type" }],
    );
  });

  it("rejects description as boolean on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: false, input_schema: {} }],
      },
      [{ path: "available_tools[0].description", code: "invalid_type" }],
    );
  });

  it("rejects description as empty string on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: "", input_schema: {} }],
      },
      [{ path: "available_tools[0].description", code: "invalid_value" }],
    );
  });

  it("rejects input_schema as null on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: "desc", input_schema: null }],
      },
      [{ path: "available_tools[0].input_schema", code: "invalid_type" }],
    );
  });

  it("rejects input_schema as array on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: "desc", input_schema: [] }],
      },
      [{ path: "available_tools[0].input_schema", code: "invalid_type" }],
    );
  });

  it("rejects input_schema as string on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: "desc", input_schema: "schema" }],
      },
      [{ path: "available_tools[0].input_schema", code: "invalid_type" }],
    );
  });

  it("rejects input_schema as number on tool entry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: "desc", input_schema: 42 }],
      },
      [{ path: "available_tools[0].input_schema", code: "invalid_type" }],
    );
  });

  it("rejects unknown keys on AvailableToolEntry", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: [{ name: "search", description: "desc", input_schema: {}, extra: "no" }],
      },
      [{ path: "available_tools[0].extra", code: "unknown_key" }],
    );
  });

  it("rejects a non-object entry in available_tools", () => {
    expectRequestIssues(
      {
        ...makeValidRequest(),
        available_tools: ["not-an-object"],
      },
      [{ path: "available_tools[0]", code: "invalid_type" }],
    );
  });
});

// ── Tests: LLMInferenceResult ───────────────────────────────────

describe("parseLLMInferenceResult", () => {
  // ── Valid results ─────────────────────────────────────────

  it("accepts a full valid result with respond decision", () => {
    const result = makeValidResult();
    expect(result.request_id).toBe("req-001");
    expect(result.decision.kind).toBe("respond");
    expect(result.normalization_status).toBe("native_tool");
  });

  it("accepts normalization_status = json_mode", () => {
    const result = makeValidResult({ normalization_status: "json_mode" });
    expect(result.normalization_status).toBe("json_mode");
  });

  it("accepts normalization_status = parsed_text", () => {
    const result = makeValidResult({ normalization_status: "parsed_text" });
    expect(result.normalization_status).toBe("parsed_text");
  });

  it("accepts optional usage object present", () => {
    const result = makeValidResult({ usage: { total_tokens: 100 } });
    expect(result.usage).toEqual({ total_tokens: 100 });
  });

  it("accepts optional raw_trace_ref present", () => {
    const result = makeValidResult({
      raw_trace_ref: {
        ref_id: "trace-001",
        kind: "trace",
        storage_area: "logs",
        locator: "traces/turn-001.json",
        retention: "session",
      },
    });
    expect(result.raw_trace_ref).toMatchObject({
      ref_id: "trace-001",
      kind: "trace",
      storage_area: "logs",
      locator: "traces/turn-001.json",
      retention: "session",
    });
  });

  it("accepts result with both usage and raw_trace_ref absent", () => {
    const result = makeValidResult();
    expect(result.usage).toBeUndefined();
    expect(result.raw_trace_ref).toBeUndefined();
  });

  it("accepts result with both usage and raw_trace_ref present", () => {
    const result = makeValidResult({
      usage: { total_tokens: 50 },
      raw_trace_ref: {
        ref_id: "trace-002",
        kind: "trace",
        storage_area: "logs",
        locator: "traces/turn-002.json",
        retention: "session",
      },
    });
    expect(result.usage).toEqual({ total_tokens: 50 });
    expect(result.raw_trace_ref).toBeDefined();
  });

  // ── Non-coercion: request_id ──────────────────────────────

  it("rejects request_id as number", () => {
    expectResultIssues(
      { ...makeValidResult(), request_id: 42 },
      [{ path: "request_id", code: "invalid_type" }],
    );
  });

  it("rejects request_id as boolean", () => {
    expectResultIssues(
      { ...makeValidResult(), request_id: true },
      [{ path: "request_id", code: "invalid_type" }],
    );
  });

  it("rejects request_id as array", () => {
    expectResultIssues(
      { ...makeValidResult(), request_id: [] },
      [{ path: "request_id", code: "invalid_type" }],
    );
  });

  it("rejects request_id as object", () => {
    expectResultIssues(
      { ...makeValidResult(), request_id: {} },
      [{ path: "request_id", code: "invalid_type" }],
    );
  });

  it("rejects request_id as empty string", () => {
    expectResultIssues(
      { ...makeValidResult(), request_id: "" },
      [{ path: "request_id", code: "invalid_value" }],
    );
  });

  // ── Non-coercion: decision ────────────────────────────────

  it("rejects decision as null", () => {
    expectResultIssues(
      { ...makeValidResult(), decision: null },
      [{ path: "decision", code: "invalid_type" }],
    );
  });

  it("rejects decision as array", () => {
    expectResultIssues(
      { ...makeValidResult(), decision: [] },
      [{ path: "decision", code: "invalid_type" }],
    );
  });

  it("rejects decision as string", () => {
    expectResultIssues(
      { ...makeValidResult(), decision: "not-an-object" },
      [{ path: "decision", code: "invalid_type" }],
    );
  });

  it("rejects decision as number", () => {
    expectResultIssues(
      { ...makeValidResult(), decision: 42 },
      [{ path: "decision", code: "invalid_type" }],
    );
  });

  // ── Non-coercion: normalization_status ────────────────────

  it("rejects normalization_status as unknown string", () => {
    expectResultIssues(
      { ...makeValidResult(), normalization_status: "unknown_mode" },
      [{ path: "normalization_status", code: "invalid_literal" }],
    );
  });

  it("rejects normalization_status as number", () => {
    expectResultIssues(
      { ...makeValidResult(), normalization_status: 42 },
      [{ path: "normalization_status", code: "invalid_type" }],
    );
  });

  it("rejects normalization_status as boolean", () => {
    expectResultIssues(
      { ...makeValidResult(), normalization_status: true },
      [{ path: "normalization_status", code: "invalid_type" }],
    );
  });

  // ── Non-coercion: usage ───────────────────────────────────

  it("rejects usage as string", () => {
    expectResultIssues(
      { ...makeValidResult(), usage: "tokens" },
      [{ path: "usage", code: "invalid_type" }],
    );
  });

  it("rejects usage as number", () => {
    expectResultIssues(
      { ...makeValidResult(), usage: 100 },
      [{ path: "usage", code: "invalid_type" }],
    );
  });

  it("rejects usage as array", () => {
    expectResultIssues(
      { ...makeValidResult(), usage: [] },
      [{ path: "usage", code: "invalid_type" }],
    );
  });

  it("rejects usage as null", () => {
    expectResultIssues(
      { ...makeValidResult(), usage: null },
      [{ path: "usage", code: "invalid_type" }],
    );
  });

  // ── Non-coercion: raw_trace_ref ───────────────────────────

  it("rejects raw_trace_ref as string", () => {
    expectResultIssues(
      { ...makeValidResult(), raw_trace_ref: "not-an-object" },
      [{ path: "raw_trace_ref", code: "invalid_type" }],
    );
  });

  it("rejects raw_trace_ref as number", () => {
    expectResultIssues(
      { ...makeValidResult(), raw_trace_ref: 42 },
      [{ path: "raw_trace_ref", code: "invalid_type" }],
    );
  });

  it("rejects raw_trace_ref as array", () => {
    expectResultIssues(
      { ...makeValidResult(), raw_trace_ref: [] },
      [{ path: "raw_trace_ref", code: "invalid_type" }],
    );
  });

  // ── Required-field missing ────────────────────────────────

  it("rejects missing request_id", () => {
    const { request_id: _, ...rest } = makeValidResult();
    expectResultIssues(rest, [
      { path: "request_id", code: "missing_required" },
    ]);
  });

  it("rejects missing decision", () => {
    const { decision: _, ...rest } = makeValidResult();
    expectResultIssues(rest, [
      { path: "decision", code: "missing_required" },
    ]);
  });

  it("rejects missing normalization_status", () => {
    const { normalization_status: _, ...rest } = makeValidResult();
    expectResultIssues(rest, [
      { path: "normalization_status", code: "missing_required" },
    ]);
  });

  it("rejects bulk missing all fields on result", () => {
    expectResultIssues({}, [
      { path: "request_id", code: "missing_required" },
      { path: "decision", code: "missing_required" },
      { path: "normalization_status", code: "missing_required" },
    ]);
  });

  // ── Unknown keys ──────────────────────────────────────────

  it("rejects unknown key on LLMInferenceResult", () => {
    expectResultIssues(
      { ...makeValidResult(), extra_field: "should-be-rejected" },
      [{ path: "extra_field", code: "unknown_key" }],
    );
  });

  // ── Wrong top-level type ──────────────────────────────────

  it("rejects string input", () => {
    expectResultIssues("not-an-object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects number input", () => {
    expectResultIssues(42, [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects array input", () => {
    expectResultIssues([], [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects null input", () => {
    expectResultIssues(null, [
      { path: "$", code: "invalid_type" },
    ]);
  });

  // ── Composition: decision delegate ────────────────────────

  it("re-emits ActionDecisionValidationError issues with decision. prefix", () => {
    const issues = getResultIssues({
      ...makeValidResult(),
      decision: { kind: "invalid_kind" },
    });
    // At least one issue should be prefixed with "decision."
    const prefixedIssues = issues.filter((i) =>
      i.path.startsWith("decision."),
    );
    expect(prefixedIssues.length).toBeGreaterThan(0);
  });

  // ── Composition: raw_trace_ref delegate ───────────────────

  it("rejects invalid raw_trace_ref via ContentRef validation", () => {
    const issues = getResultIssues({
      ...makeValidResult(),
      raw_trace_ref: { ref_id: "x" },
    });
    // Should have issues from ContentRef validation, prefixed with raw_trace_ref.
    const refIssues = issues.filter((i) =>
      i.path.startsWith("raw_trace_ref."),
    );
    expect(refIssues.length).toBeGreaterThan(0);
  });

  // ── Validation error classes ──────────────────────────────

  it("throws LLMRequestValidationError with issues array", () => {
    expect(() => parseLLMInferenceRequest("bad")).toThrow(
      LLMRequestValidationError,
    );
    try {
      parseLLMInferenceRequest("bad");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMRequestValidationError);
      if (error instanceof LLMRequestValidationError) {
        expect(error.issues).toBeInstanceOf(Array);
        expect(error.issues.length).toBeGreaterThan(0);
      }
    }
  });

  it("throws LLMResultValidationError with issues array", () => {
    expect(() => parseLLMInferenceResult("bad")).toThrow(
      LLMResultValidationError,
    );
    try {
      parseLLMInferenceResult("bad");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMResultValidationError);
      if (error instanceof LLMResultValidationError) {
        expect(error.issues).toBeInstanceOf(Array);
        expect(error.issues.length).toBeGreaterThan(0);
      }
    }
  });

  it("LLMRequestValidationError has correct name", () => {
    try {
      parseLLMInferenceRequest("bad");
    } catch (error) {
      expect((error as Error).name).toBe("LLMRequestValidationError");
    }
  });

  it("LLMResultValidationError has correct name", () => {
    try {
      parseLLMInferenceResult("bad");
    } catch (error) {
      expect((error as Error).name).toBe("LLMResultValidationError");
    }
  });
});
