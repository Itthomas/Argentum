import type {
  ContentRef,
  ContextItem,
  ToolDefinition,
  TurnBudget,
} from "@argentum/contracts";
import { parseLLMInferenceRequest } from "@argentum/contracts";
import { describe, expect, it, vi } from "vitest";
import * as toolingModule from "@argentum/tooling";

import {
  PromptCompiler,
  PromptCompilerError,
} from "../src/index.js";
import type { PromptCompilerInput } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeContentRef(overrides: Partial<ContentRef> = {}): ContentRef {
  return {
    ref_id: "ref-001",
    kind: "text",
    storage_area: "working",
    locator: "test-locator",
    retention: "session",
    ...overrides,
  };
}

function makeContextItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    context_id: "ctx-001",
    layer: "system",
    role: "system",
    content_ref: makeContentRef(),
    origin: "test",
    retention: "ephemeral",
    token_estimate: 50,
    ...overrides,
  };
}

function makeToolDefinition(
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a file from the workspace",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
    side_effect_level: "read_only",
    path_scope: "workspace",
    required_secret_handles: [],
    network_access: "deny",
    default_timeout_ms: 5000,
    ...overrides,
  };
}

function makeTurnBudget(
  overrides: Partial<TurnBudget> = {},
): TurnBudget {
  return {
    max_inference_steps: 10,
    max_repair_attempts: 3,
    max_wall_clock_ms: 300_000,
    repair_attempts_used: 0,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<PromptCompilerInput> = {},
): PromptCompilerInput {
  return {
    turnId: "turn-001",
    contextItems: [
      makeContextItem({ context_id: "ctx-1", token_estimate: 50 }),
      makeContextItem({ context_id: "ctx-2", token_estimate: 30 }),
      makeContextItem({ context_id: "ctx-3", token_estimate: 20 }),
    ],
    registeredTools: [makeToolDefinition()],
    ...overrides,
  };
}

function getQuerySchemaType(definition: { input_schema: Record<string, unknown> }): string {
  return ((((definition.input_schema.properties ?? {}) as Record<string, unknown>)
    .path as Record<string, unknown>).type as string);
}

// ── Instantiation ────────────────────────────────────────────────

const compiler = new PromptCompiler({
  defaultToolExposurePolicy: { mode: "all" },
});

// ══════════════════════════════════════════════════════════════════
// Happy path tests
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — happy path", () => {
  it("basic request: correct turn_id, context_items, available_tools, auto-generated request_id", () => {
    const input = makeInput();
    const result = compiler.compile(input);

    expect(result.turn_id).toBe("turn-001");
    expect(result.context_items).toHaveLength(3);
    expect(result.context_items[0]!.context_id).toBe("ctx-1");
    expect(result.context_items[1]!.context_id).toBe("ctx-2");
    expect(result.context_items[2]!.context_id).toBe("ctx-3");
    expect(result.available_tools).toHaveLength(1);
    expect(typeof result.request_id).toBe("string");
    expect(result.request_id.length).toBeGreaterThan(0);
  });

  it("custom requestId is preserved", () => {
    const input = makeInput({ requestId: "custom-req-1" });
    const result = compiler.compile(input);

    expect(result.request_id).toBe("custom-req-1");
  });

  it("empty tools array is valid (no-tool step)", () => {
    const input = makeInput({ registeredTools: [] });
    const result = compiler.compile(input);

    expect(result.available_tools).toHaveLength(0);
  });

  it("inference policy defaults applied when omitted", () => {
    const input = makeInput();
    const result = compiler.compile(input);

    expect(result.inference_policy).toEqual({
      temperature: 0.7,
      max_output_tokens: 4096,
      normalization_mode: "native_tool",
    });
  });

  it("custom inference policy fields are preserved", () => {
    const input = makeInput({
      inferencePolicy: {
        temperature: 0.3,
        max_output_tokens: 2048,
        normalization_mode: "json_mode",
      },
    });
    const result = compiler.compile(input);

    expect(result.inference_policy).toEqual({
      temperature: 0.3,
      max_output_tokens: 2048,
      normalization_mode: "json_mode",
    });
  });

  it("bedrock items are preserved unchanged", () => {
    const bedrockItem = makeContextItem({
      context_id: "bedrock-1",
      layer: "bedrock",
    });
    const input = makeInput({ contextItems: [bedrockItem] });
    const result = compiler.compile(input);

    expect(result.context_items[0]!.layer).toBe("bedrock");
    expect(result.context_items[0]!.context_id).toBe("bedrock-1");
  });

  it("tool summary items with valid content_ref pass validation", () => {
    const toolSummaryItem = makeContextItem({
      context_id: "ts-1",
      layer: "tool_summary",
      content_ref: makeContentRef({
        ref_id: "artifact:tool-abc",
        kind: "text",
      }),
    });
    const input = makeInput({ contextItems: [toolSummaryItem] });
    const result = compiler.compile(input);

    expect(result.context_items[0]!.layer).toBe("tool_summary");
    expect(result.context_items[0]!.content_ref.ref_id).toBe("artifact:tool-abc");
  });

  it("partial inference policy override merges with defaults", () => {
    const input = makeInput({
      inferencePolicy: { temperature: 0.1 },
    });
    const result = compiler.compile(input);

    expect(result.inference_policy).toEqual({
      temperature: 0.1,
      max_output_tokens: 4096,
      normalization_mode: "native_tool",
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// ToolDefinition → AvailableToolEntry stripping (H1)
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — ToolDefinition→AvailableToolEntry stripping (H1)", () => {
  it("strips side_effect_level, path_scope, etc. — only name, description, input_schema remain", () => {
    const tool: ToolDefinition = {
      name: "run_command",
      description: "Execute a shell command",
      input_schema: { type: "object", properties: { cmd: { type: "string" } } },
      side_effect_level: "host_mutation",
      path_scope: "workspace",
      required_secret_handles: ["API_KEY"],
      network_access: "inherit",
      default_timeout_ms: 30000,
      defaults: { cwd: "/tmp" },
    };
    const input = makeInput({ registeredTools: [tool] });
    const result = compiler.compile(input);

    const entry = result.available_tools[0]!;
    expect(entry).toEqual({
      name: "run_command",
      description: "Execute a shell command",
      input_schema: { type: "object", properties: { cmd: { type: "string" } } },
    });
    // Ensure extra fields are absent
    expect("side_effect_level" in entry).toBe(false);
    expect("path_scope" in entry).toBe(false);
    expect("required_secret_handles" in entry).toBe(false);
    expect("network_access" in entry).toBe(false);
    expect("default_timeout_ms" in entry).toBe(false);
    expect("defaults" in entry).toBe(false);
  });

  it("multiple tools are all stripped to AvailableToolEntry shape", () => {
    const tools: ToolDefinition[] = [
      makeToolDefinition({ name: "tool-a" }),
      makeToolDefinition({ name: "tool-b" }),
    ];
    const input = makeInput({ registeredTools: tools });
    const result = compiler.compile(input);

    expect(result.available_tools).toHaveLength(2);
    for (const entry of result.available_tools) {
      expect(Object.keys(entry).sort()).toEqual([
        "description",
        "input_schema",
        "name",
      ]);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// Budget warning (H3) + C1
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — budget warning (H3, C1)", () => {
  it("calls onBudgetWarning when estimated tokens exceed max_tokens_per_step", () => {
    const warnings: Array<{ estimated: number; max: number }> = [];
    const input = makeInput({
      contextItems: [
        makeContextItem({ token_estimate: 60 }),
        makeContextItem({ token_estimate: 60 }),
      ],
      budget: makeTurnBudget({ max_tokens_per_step: 100 }),
      onBudgetWarning: (estimated, max) => {
        warnings.push({ estimated, max });
      },
    });
    const result = compiler.compile(input);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.estimated).toBe(120);
    expect(warnings[0]!.max).toBe(100);
    // Request is still produced — compiler warns, does not reject
    expect(result.request_id.length).toBeGreaterThan(0);
  });

  it("does NOT call onBudgetWarning when estimated <= max_tokens_per_step", () => {
    let called = false;
    const input = makeInput({
      contextItems: [
        makeContextItem({ token_estimate: 30 }),
        makeContextItem({ token_estimate: 30 }),
      ],
      budget: makeTurnBudget({ max_tokens_per_step: 100 }),
      onBudgetWarning: () => {
        called = true;
      },
    });
    compiler.compile(input);

    expect(called).toBe(false);
  });

  it("no error when onBudgetWarning is omitted and budget exceeded", () => {
    const input = makeInput({
      contextItems: [
        makeContextItem({ token_estimate: 200 }),
      ],
      budget: makeTurnBudget({ max_tokens_per_step: 100 }),
      // no onBudgetWarning
    });
    const result = compiler.compile(input);

    expect(result.request_id.length).toBeGreaterThan(0);
  });

  it("no warning when budget is absent entirely", () => {
    let called = false;
    const input = makeInput({
      contextItems: [
        makeContextItem({ token_estimate: 999 }),
      ],
      // no budget
      onBudgetWarning: () => {
        called = true;
      },
    });
    compiler.compile(input);

    expect(called).toBe(false);
  });

  it("no warning when budget present but max_tokens_per_step is undefined", () => {
    let called = false;
    const input = makeInput({
      contextItems: [
        makeContextItem({ token_estimate: 999 }),
      ],
      budget: makeTurnBudget({ max_tokens_per_step: undefined }),
      onBudgetWarning: () => {
        called = true;
      },
    });
    compiler.compile(input);

    expect(called).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// Token estimation
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — token estimation", () => {
  it("estimateTokens sums token_estimate fields", () => {
    const items = [
      makeContextItem({ token_estimate: 10 }),
      makeContextItem({ token_estimate: 25 }),
      makeContextItem({ token_estimate: 15 }),
    ];
    expect(compiler.estimateTokens(items)).toBe(50);
  });

  it("items with undefined token_estimate contribute 0", () => {
    const items = [
      makeContextItem({ token_estimate: 10 }),
      makeContextItem({ token_estimate: undefined }),
      makeContextItem({ token_estimate: 30 }),
    ];
    expect(compiler.estimateTokens(items)).toBe(40);
  });

  it("items with absent token_estimate contribute 0", () => {
    const item = makeContextItem();
    delete (item as Record<string, unknown>).token_estimate;
    expect(compiler.estimateTokens([item])).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// Error cases
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — error cases", () => {
  it("EMPTY_CONTEXT_ITEMS: empty array throws", () => {
    const input = makeInput({ contextItems: [] });
    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("EMPTY_CONTEXT_ITEMS");
    }
  });

  it("MISSING_TURN_ID: empty string throws", () => {
    const input = makeInput({ turnId: "" });
    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("MISSING_TURN_ID");
    }
  });

  it("INVALID_CONTEXT_ITEM: missing context_id", () => {
    const badItem = makeContextItem();
    delete (badItem as Record<string, unknown>).context_id;
    const input = makeInput({ contextItems: [badItem] });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_CONTEXT_ITEM");
      expect((err as Error).message).toContain("context_id");
    }
  });

  it("INVALID_CONTEXT_ITEM: missing content_ref.ref_id", () => {
    const badItem = makeContextItem({
      content_ref: makeContentRef({ ref_id: "" }),
    });
    const input = makeInput({ contextItems: [badItem] });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_CONTEXT_ITEM");
      expect((err as Error).message).toContain("ref_id");
    }
  });

  it("INVALID_CONTEXT_ITEM: missing content_ref.kind", () => {
    const badItem = makeContextItem({
      content_ref: makeContentRef({ kind: "" }),
    });
    const input = makeInput({ contextItems: [badItem] });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_CONTEXT_ITEM");
      expect((err as Error).message).toContain("kind");
    }
  });

  it("INVALID_TOOL_DEFINITION: missing tool name", () => {
    const badTool = makeToolDefinition();
    delete (badTool as Record<string, unknown>).name;
    const input = makeInput({ registeredTools: [badTool] });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_TOOL_DEFINITION");
      expect((err as Error).message).toContain("name");
    }
  });

  it("INVALID_TOOL_DEFINITION: missing input_schema", () => {
    const badTool = makeToolDefinition();
    delete (badTool as Record<string, unknown>).input_schema;
    const input = makeInput({ registeredTools: [badTool] });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_TOOL_DEFINITION");
    }
  });

  it("INVALID_POLICY: temperature out of range (3.0 > 2)", () => {
    const input = makeInput({
      inferencePolicy: { temperature: 3.0 },
    });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_POLICY");
    }
  });

  it("INVALID_POLICY: temperature out of range (-0.1 < 0)", () => {
    const input = makeInput({
      inferencePolicy: { temperature: -0.1 },
    });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_POLICY");
    }
  });

  it("INVALID_POLICY: max_output_tokens = 0", () => {
    const input = makeInput({
      inferencePolicy: { max_output_tokens: 0 },
    });

    expect(() => compiler.compile(input)).toThrow(PromptCompilerError);
    try {
      compiler.compile(input);
      expect.fail("Expected PromptCompilerError");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptCompilerError);
      expect((err as PromptCompilerError).code).toBe("INVALID_POLICY");
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// Immutability
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — immutability", () => {
  it("input contextItems array is not mutated", () => {
    const items = [
      makeContextItem({ context_id: "a" }),
      makeContextItem({ context_id: "b" }),
    ];
    const input = makeInput({ contextItems: items });

    const frozenBefore = [...items];
    compiler.compile(input);

    // Same objects, same order
    expect(items).toEqual(frozenBefore);
    expect(items[0]!.context_id).toBe("a");
    expect(items[1]!.context_id).toBe("b");
  });

  it("output is independent — mutating output does not affect next compile", () => {
    const items = [
      makeContextItem({ context_id: "a" }),
      makeContextItem({ context_id: "b" }),
    ];
    const input = makeInput({ contextItems: items });

    const result1 = compiler.compile(input);
    // Mutate the output
    (result1 as { context_items: unknown[] }).context_items = [];

    const result2 = compiler.compile(input);
    expect(result2.context_items).toHaveLength(2);
    expect(result2.context_items[0]!.context_id).toBe("a");
  });
});

// ══════════════════════════════════════════════════════════════════
// parseLLMInferenceRequest round-trip (H4)
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — parseLLMInferenceRequest round-trip (H4)", () => {
  it("compiler output passes through parseLLMInferenceRequest without error", () => {
    const input = makeInput({
      requestId: "roundtrip-req",
      inferencePolicy: {
        temperature: 0.5,
        max_output_tokens: 1024,
        normalization_mode: "parsed_text",
      },
      registeredTools: [
        makeToolDefinition({ name: "search", description: "Search tool" }),
        makeToolDefinition({ name: "execute", description: "Execute tool" }),
      ],
    });
    const compiled = compiler.compile(input);

    // Must not throw
    const parsed = parseLLMInferenceRequest(compiled);

    expect(parsed.request_id).toBe("roundtrip-req");
    expect(parsed.turn_id).toBe("turn-001");
    expect(parsed.context_items).toHaveLength(3);
    expect(parsed.available_tools).toHaveLength(2);
    expect(parsed.inference_policy).toEqual({
      temperature: 0.5,
      max_output_tokens: 1024,
      normalization_mode: "parsed_text",
    });
  });

  it("compiler output with defaults also round-trips through parseLLMInferenceRequest", () => {
    const input = makeInput();
    const compiled = compiler.compile(input);

    const parsed = parseLLMInferenceRequest(compiled);

    expect(parsed.request_id).toBe(compiled.request_id);
    expect(parsed.inference_policy).toEqual({
      temperature: 0.7,
      max_output_tokens: 4096,
      normalization_mode: "native_tool",
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// Ordering preservation (H2)
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — caller ordering preserved (H2)", () => {
  it("preserves the exact input order of context items", () => {
    const items = [
      makeContextItem({ context_id: "third" }),
      makeContextItem({ context_id: "first" }),
      makeContextItem({ context_id: "second" }),
    ];
    const input = makeInput({ contextItems: items });
    const result = compiler.compile(input);

    expect(result.context_items[0]!.context_id).toBe("third");
    expect(result.context_items[1]!.context_id).toBe("first");
    expect(result.context_items[2]!.context_id).toBe("second");
  });

  it("preserves available_tools input order", () => {
    const tools = [
      makeToolDefinition({ name: "z-tool" }),
      makeToolDefinition({ name: "a-tool" }),
      makeToolDefinition({ name: "m-tool" }),
    ];
    const input = makeInput({ registeredTools: tools });
    const result = compiler.compile(input);

    expect(result.available_tools[0]!.name).toBe("z-tool");
    expect(result.available_tools[1]!.name).toBe("a-tool");
    expect(result.available_tools[2]!.name).toBe("m-tool");
  });

  it("constructs the current-step exposure request in the prompt-compiler path and attaches exposed available_tools", () => {
    const planToolExposureSpy = vi.spyOn(toolingModule, "planToolExposure");
    const input = makeInput({
      registeredTools: [
        makeToolDefinition({ name: "tool-z" }),
        makeToolDefinition({ name: "tool-a" }),
      ],
    });

    const result = compiler.compile(input);

    expect(planToolExposureSpy).toHaveBeenCalledOnce();
    const [snapshot, request] = planToolExposureSpy.mock.calls[0] ?? [];
    expect(snapshot).toEqual(input.registeredTools);
    expect(request).toEqual({ mode: "all" });
    expect(result.available_tools).toEqual([
      {
        name: "tool-z",
        description: "Read a file from the workspace",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
      },
      {
        name: "tool-a",
        description: "Read a file from the workspace",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);

    planToolExposureSpy.mockRestore();
  });

  it("forwards an explicit exposure request and narrows available_tools to the requested subset order", () => {
    const explicitPolicyCompiler = new PromptCompiler({
      defaultToolExposurePolicy: {
        mode: "explicit",
        toolNames: ["tool-a", "tool-z"],
      },
    });
    const planToolExposureSpy = vi.spyOn(toolingModule, "planToolExposure");
    const input = makeInput({
      registeredTools: [
        makeToolDefinition({ name: "tool-z" }),
        makeToolDefinition({ name: "tool-a" }),
        makeToolDefinition({ name: "tool-m" }),
      ],
    });

    const result = explicitPolicyCompiler.compile(input);

    expect(planToolExposureSpy).toHaveBeenCalledOnce();
    const [snapshot, request] = planToolExposureSpy.mock.calls[0] ?? [];
    expect(snapshot).toEqual(input.registeredTools);
    expect(request).toEqual({
      mode: "explicit",
      toolNames: ["tool-a", "tool-z"],
    });
    expect(result.available_tools).toEqual([
      {
        name: "tool-a",
        description: "Read a file from the workspace",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
      },
      {
        name: "tool-z",
        description: "Read a file from the workspace",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);

    planToolExposureSpy.mockRestore();
  });

  it("prevents nested available_tools schema mutation from leaking back into registry-owned definitions", () => {
    const registry = new toolingModule.ToolRegistry();
    registry.register(makeToolDefinition(), async (call) => ({
      call_id: call.call_id,
      status: "success",
      human_summary: "ok",
      duration_ms: 1,
      truncated: false,
      retryable: false,
    }));
    const input = makeInput({ registeredTools: registry.snapshotDefinitions() });

    const result = compiler.compile(input);

    expect(() => {
      ((((result.available_tools[0]!.input_schema.properties ?? {}) as Record<string, unknown>)
        .path as Record<string, unknown>).type) = "number";
    }).toThrow(TypeError);

    const freshSnapshot = registry.snapshotDefinitions();

    expect(getQuerySchemaType(freshSnapshot[0]!)).toBe("string");
    expect(getQuerySchemaType(registry.getDefinition("read_file")!)).toBe("string");
  });
});

// ══════════════════════════════════════════════════════════════════
// Error type discrimination
// ══════════════════════════════════════════════════════════════════

describe("PromptCompiler — error type discrimination", () => {
  it("PromptCompilerError is instance of Error", () => {
    const err = new PromptCompilerError("EMPTY_CONTEXT_ITEMS", "test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PromptCompilerError);
  });

  it("PromptCompilerError.name is 'PromptCompilerError'", () => {
    const err = new PromptCompilerError("MISSING_TURN_ID", "test");
    expect(err.name).toBe("PromptCompilerError");
  });
});
