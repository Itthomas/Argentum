import { describe, expect, it, vi } from "vitest";

import type {
  ActionDecision,
  AvailableToolEntry,
  ContentRef,
  ContextItem,
  LLMInferenceRequest,
  LLMInferenceResult,
} from "@argentum/contracts";
import {
  parseActionDecision,
  parseLLMInferenceResult,
} from "@argentum/contracts";

import type { LLMProvider } from "../src/index.js";
import {
  DeepSeekAdapter,
  LLMProviderError,
} from "../src/index.js";
import type {
  DeepSeekAdapterConfig,
  ContentResolver,
  TraceWriter,
} from "../src/index.js";

// ── Test builders ────────────────────────────────────────────────

function makeContentRef(overrides: Partial<ContentRef> = {}): ContentRef {
  return {
    ref_id: "ref-001",
    kind: "text",
    storage_area: "working",
    locator: "test/content.txt",
    retention: "ephemeral",
    ...overrides,
  };
}

function makeContextItem(
  overrides: Partial<ContextItem> = {},
): ContextItem {
  return {
    context_id: "ctx-001",
    layer: "episodic",
    role: "user",
    content_ref: makeContentRef(),
    origin: "user",
    retention: "ephemeral",
    ...overrides,
  };
}

function makeTool(overrides: Partial<AvailableToolEntry> = {}): AvailableToolEntry {
  return {
    name: "test_tool",
    description: "A test tool",
    input_schema: {
      type: "object",
      properties: { param: { type: "string" } },
      required: ["param"],
    },
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<LLMInferenceRequest> = {},
): LLMInferenceRequest {
  return {
    request_id: "req-001",
    turn_id: "turn-001",
    context_items: [],
    available_tools: [],
    inference_policy: {},
    ...overrides,
  };
}

function makeAdapterConfig(
  overrides: Partial<DeepSeekAdapterConfig> = {},
): DeepSeekAdapterConfig {
  return {
    endpoint: "https://api.deepseek.com",
    apiKey: "sk-test-key",
    model: "deepseek-chat",
    ...overrides,
  };
}

/** Minimal valid DeepSeek API response for a simple text response. */
function makeApiResponse(
  overrides: Partial<{
    content: string | null;
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: string;
    }>;
    usage: Record<string, unknown>;
  }> = {},
): object {
  const msg: Record<string, unknown> = {
    role: "assistant",
    content: overrides.content ?? "Hello!",
  };

  if (overrides.toolCalls) {
    msg["tool_calls"] = overrides.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));
  }

  const response: Record<string, unknown> = {
    id: "chatcmpl-001",
    object: "chat.completion",
    created: Date.now(),
    model: "deepseek-chat",
    choices: [{ index: 0, message: msg, finish_reason: "stop" }],
  };

  if (overrides.usage) {
    response["usage"] = overrides.usage;
  }

  return response;
}

/** Create a ContentResolver that maps ref_id → content text. */
function makeContentResolver(
  map: Record<string, string>,
): ContentResolver {
  return async (ref: ContentRef): Promise<string> => {
    const content = map[ref.ref_id];
    if (content === undefined) {
      throw new Error(`No content for ref ${ref.ref_id}`);
    }
    return content;
  };
}

/** Spy factory for TraceWriter. */
function makeTraceWriterSpy(): {
  writer: TraceWriter;
  calls: Array<{ ref: ContentRef; payload: unknown }>;
} {
  const calls: Array<{ ref: ContentRef; payload: unknown }> = [];
  const writer: TraceWriter = async (ref, payload) => {
    calls.push({ ref, payload });
  };
  return { writer, calls };
}

// ── Adapter implements LLMProvider ───────────────────────────────

describe("DeepSeekAdapter — interface conformance", () => {
  it("implements LLMProvider and compiles as assignable", () => {
    const adapter: LLMProvider = new DeepSeekAdapter(makeAdapterConfig());
    expect(typeof adapter.infer).toBe("function");
  });

  it("is importable from @argentum/llm-provider", () => {
    expect(typeof DeepSeekAdapter).toBe("function");
  });
});

// ── Constructor defaults ────────────────────────────────────────

describe("DeepSeekAdapter — constructor", () => {
  it("applies default temperature 0 and maxOutputTokens 4096 in API request body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({
        temperature: undefined,
        maxOutputTokens: undefined,
        resolveContent: makeContentResolver({ "ref-1": "text" }),
      }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as {
      temperature: number;
      max_tokens: number;
    };
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(4096);

    vi.unstubAllGlobals();
  });

  it("passes custom temperature and maxOutputTokens in API request body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({
        temperature: 0.7,
        maxOutputTokens: 2048,
        resolveContent: makeContentResolver({ "ref-1": "text" }),
      }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as {
      temperature: number;
      max_tokens: number;
    };
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2048);

    vi.unstubAllGlobals();
  });

  it("strips trailing slashes from endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({
        endpoint: "https://api.deepseek.com/",
        resolveContent: makeContentResolver({ "ref-001": "hello" }),
      }),
    );

    const request = makeRequest({
      context_items: [makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-001" }) })],
    });

    await adapter.infer(request);

    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(url).not.toContain("//v1");

    vi.unstubAllGlobals();
  });
});

// ── Message building ─────────────────────────────────────────────

describe("DeepSeekAdapter — message building", () => {
  it("builds messages from ContextItems with correct role and content", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({
      "ref-user": "User message",
      "ref-assistant": "Assistant reply",
    });

    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({
          context_id: "ctx-1",
          role: "user",
          content_ref: makeContentRef({ ref_id: "ref-user" }),
        }),
        makeContextItem({
          context_id: "ctx-2",
          role: "assistant",
          content_ref: makeContentRef({ ref_id: "ref-assistant" }),
        }),
      ],
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "user", content: "User message" });
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: "Assistant reply",
    });

    vi.unstubAllGlobals();
  });

  it("maps unrecognized ContextItem roles to 'user'", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({
          role: "unknown_role",
          content_ref: makeContentRef({ ref_id: "ref-1" }),
        }),
      ],
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ role: string }>;
    };
    expect(body.messages[0]?.role).toBe("user");

    vi.unstubAllGlobals();
  });

  it("passes through recognized roles unchanged", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({
      "r1": "a", "r2": "b", "r3": "c", "r4": "d",
    });

    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const roles = ["user", "assistant", "system", "tool"] as const;
    const request = makeRequest({
      context_items: roles.map((role, i) =>
        makeContextItem({
          context_id: `ctx-${i}`,
          role,
          content_ref: makeContentRef({ ref_id: `r${i + 1}` }),
        }),
      ),
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as {
      messages: Array<{ role: string }>;
    };
    expect(body.messages.map((m) => m.role)).toEqual([...roles]);

    vi.unstubAllGlobals();
  });
});

// ── Missing ContentResolver ──────────────────────────────────────

describe("DeepSeekAdapter — missing ContentResolver", () => {
  it("throws LLMProviderError when ContentResolver is not configured", async () => {
    const adapter = new DeepSeekAdapter(makeAdapterConfig());

    const request = makeRequest({
      context_items: [makeContextItem()],
    });

    await expect(adapter.infer(request)).rejects.toThrow(LLMProviderError);
    await expect(adapter.infer(request)).rejects.toThrow(
      "ContentResolver is not configured",
    );

    // Verify requestId is propagated
    try {
      await adapter.infer(request);
      expect.unreachable("Expected LLMProviderError");
    } catch (error) {
      const e = error as LLMProviderError;
      expect(e.providerId).toBe("deepseek");
      expect(e.requestId).toBe("req-001");
    }
  });
});

// ── Tool projection ──────────────────────────────────────────────

describe("DeepSeekAdapter — tool projection", () => {
  it("includes tools array and tool_choice: auto when tools are provided", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      available_tools: [makeTool({ name: "tool_a" }), makeTool({ name: "tool_b" })],
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as {
      tools: unknown[];
      tool_choice: string;
    };
    expect(body.tools).toHaveLength(2);
    expect(body.tool_choice).toBe("auto");

    vi.unstubAllGlobals();
  });

  it("omits tools and tool_choice when available_tools is empty", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      available_tools: [],
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");

    vi.unstubAllGlobals();
  });
});

// ── Authorization header ─────────────────────────────────────────

describe("DeepSeekAdapter — auth header", () => {
  it("includes Authorization: Bearer header with the apiKey", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ apiKey: "sk-my-secret", resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    await adapter.infer(request);

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-my-secret");
    expect(headers["Content-Type"]).toBe("application/json");

    vi.unstubAllGlobals();
  });
});

// ── Native tool calling normalization ────────────────────────────

describe("DeepSeekAdapter — native tool calling", () => {
  it("normalizes tool_calls into ActionDecision with native_tool status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({
            toolCalls: [
              {
                id: "call_1",
                name: "read_file",
                arguments: '{"path":"/foo"}',
              },
            ],
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    expect(result.normalization_status).toBe("native_tool");
    expect(result.decision.kind).toBe("tool_calls");
    expect(result.decision.decision_id).toBeTruthy();
    expect(typeof result.decision.decision_id).toBe("string");
    expect(result.decision.decision_id!.length).toBeGreaterThan(0);

    const tc = result.decision.tool_calls?.[0];
    expect(tc?.tool_name).toBe("read_file");
    expect(tc?.arguments).toEqual({ path: "/foo" });
    expect(tc?.provider_call_ref).toBe("call_1");

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("preserves tool-call ordering for multiple tool calls", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({
            toolCalls: [
              { id: "c1", name: "alpha", arguments: "{}" },
              { id: "c2", name: "beta", arguments: "{}" },
              { id: "c3", name: "gamma", arguments: "{}" },
            ],
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    expect(result.decision.tool_calls).toHaveLength(3);
    expect(result.decision.tool_calls![0]?.tool_name).toBe("alpha");
    expect(result.decision.tool_calls![1]?.tool_name).toBe("beta");
    expect(result.decision.tool_calls![2]?.tool_name).toBe("gamma");
    expect(result.decision.decision_id).toBeTruthy();

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("throws LLMProviderError on unparseable tool call arguments", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({
            toolCalls: [
              { id: "c1", name: "bad_tool", arguments: "not valid json" },
            ],
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    let caught: unknown;
    try {
      await adapter.infer(request);
      expect.unreachable("Expected LLMProviderError");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LLMProviderError);
    expect((caught as Error).message).toMatch(/not valid JSON|did not parse to a JSON object/);
    expect((caught as LLMProviderError).requestId).toBe("req-001");

    vi.unstubAllGlobals();
  });
});

// ── JSON mode normalization ──────────────────────────────────────

describe("DeepSeekAdapter — JSON mode", () => {
  it("parses JSON content into respond decision with json_mode status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({ content: '{"kind":"respond","message":"Hello!"}' }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      inference_policy: { normalization_mode: "json_mode" },
    });

    const result = await adapter.infer(request);

    expect(result.normalization_status).toBe("json_mode");
    expect(result.decision.kind).toBe("respond");
    expect(result.decision.message).toBe("Hello!");
    expect(result.decision.decision_id).toBeTruthy();

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("parses JSON content with tool_calls kind", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({
            content: JSON.stringify({
              kind: "tool_calls",
              tool_calls: [
                {
                  tool_name: "read_file",
                  arguments: { path: "/bar" },
                  provider_call_ref: "prov-1",
                },
              ],
            }),
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      inference_policy: { normalization_mode: "json_mode" },
    });

    const result = await adapter.infer(request);

    expect(result.normalization_status).toBe("json_mode");
    expect(result.decision.kind).toBe("tool_calls");
    expect(result.decision.tool_calls![0]?.tool_name).toBe("read_file");
    expect(result.decision.tool_calls![0]?.arguments).toEqual({ path: "/bar" });
    expect(result.decision.tool_calls![0]?.provider_call_ref).toBe("prov-1");
    expect(result.decision.decision_id).toBeTruthy();

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("falls through to parsed_text when JSON is malformed", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({ content: "{not valid json}" }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      inference_policy: { normalization_mode: "json_mode" },
    });

    const result = await adapter.infer(request);

    expect(result.normalization_status).toBe("parsed_text");
    expect(result.decision.kind).toBe("respond");
    expect(result.decision.message).toBe("{not valid json}");
    expect(result.decision.decision_id).toBeTruthy();

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });
});

// ── Parsed text normalization ────────────────────────────────────

describe("DeepSeekAdapter — parsed text", () => {
  it("treats plain text content as respond decision", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({ content: "The answer is 42." }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    expect(result.normalization_status).toBe("parsed_text");
    expect(result.decision.kind).toBe("respond");
    expect(result.decision.message).toBe("The answer is 42.");
    expect(result.decision.decision_id).toBeTruthy();

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("extracts JSON from markdown fence without newlines as json_mode", async () => {
    const content = '```json {"kind":"abort","message":"Done."}```';
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(makeApiResponse({ content })),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    // Inline markdown fence JSON is parsed as json_mode
    expect(result.normalization_status).toBe("json_mode");
    expect(result.decision.kind).toBe("abort");
    expect(result.decision.message).toBe("Done.");
    expect(result.decision.decision_id).toBeTruthy();

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("extracts JSON from markdown fence with newlines as json_mode", async () => {
    const content = '```json\n{"kind":"abort","message":"Done."}\n```';
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(makeApiResponse({ content })),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    // When markdown fence JSON is found, it's parsed as json_mode
    expect(result.normalization_status).toBe("json_mode");
    expect(result.decision.kind).toBe("abort");
    expect(result.decision.message).toBe("Done.");
    expect(result.decision.decision_id).toBeTruthy();

    // Round-trip validation
    expect(() => parseLLMInferenceResult(result)).not.toThrow();
    expect(() => parseActionDecision(result.decision)).not.toThrow();

    vi.unstubAllGlobals();
  });
});

// ── Raw trace capture ────────────────────────────────────────────

describe("DeepSeekAdapter — trace capture", () => {
  it("calls TraceWriter with ContentRef and payload", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { writer, calls } = makeTraceWriterSpy();
    const resolveContent = makeContentResolver({ "ref-1": "text" });

    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent, writeTrace: writer }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    expect(calls).toHaveLength(1);
    const traceRef = calls[0]?.ref;
    expect(traceRef?.kind).toBe("trace");
    expect(traceRef?.storage_area).toBe("logs");
    expect(traceRef?.retention).toBe("session");

    const payload = calls[0]?.payload as Record<string, unknown>;
    expect(payload).toHaveProperty("request");
    expect(payload).toHaveProperty("response");

    expect(result.raw_trace_ref).toEqual(traceRef);

    vi.unstubAllGlobals();
  });

  it("sets raw_trace_ref to undefined when TraceWriter is not configured", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    expect(result.raw_trace_ref).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

// ── Usage passthrough ────────────────────────────────────────────

describe("DeepSeekAdapter — usage passthrough", () => {
  it("passes through usage from API response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(
          makeApiResponse({
            content: "ok",
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    const result = await adapter.infer(request);

    expect(result.usage).toEqual({ prompt_tokens: 100, completion_tokens: 50 });

    vi.unstubAllGlobals();
  });
});

// ── Error paths ──────────────────────────────────────────────────

describe("DeepSeekAdapter — error paths", () => {
  it("throws LLMProviderError on HTTP 401", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      request_id: "req-401",
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    try {
      await adapter.infer(request);
      expect.unreachable("Expected LLMProviderError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMProviderError);
      const e = error as LLMProviderError;
      expect(e.providerId).toBe("deepseek");
      expect(e.requestId).toBe("req-401");
      expect(e.message).toContain("401");
    }

    vi.unstubAllGlobals();
  });

  it("throws LLMProviderError on HTTP 500", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('{"error":"Internal Server Error"}', { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      request_id: "req-500",
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    try {
      await adapter.infer(request);
      expect.unreachable("Expected LLMProviderError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMProviderError);
      const e = error as LLMProviderError;
      expect(e.providerId).toBe("deepseek");
      expect(e.requestId).toBe("req-500");
      expect(e.message).toContain("500");
    }

    vi.unstubAllGlobals();
  });

  it("throws LLMProviderError on network failure with cause", async () => {
    const networkError = new Error("connect ECONNREFUSED");
    const fetchSpy = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      request_id: "req-net",
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    try {
      await adapter.infer(request);
      expect.unreachable("Expected LLMProviderError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMProviderError);
      const e = error as LLMProviderError;
      expect(e.providerId).toBe("deepseek");
      expect(e.requestId).toBe("req-net");
      expect(e.message).toContain("ECONNREFUSED");
      expect(e.cause).toBe(networkError);
    }

    vi.unstubAllGlobals();
  });
});

// ── Malformed response / exhaustion ──────────────────────────────

describe("DeepSeekAdapter — malformed response handling", () => {
  it("throws LLMProviderError on empty choices", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: "chatcmpl-1", choices: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    let caught: unknown;
    try {
      await adapter.infer(request);
      expect.unreachable("Expected LLMProviderError");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LLMProviderError);
    expect((caught as Error).message).toMatch(/exhausted|normalization/);
    expect((caught as LLMProviderError).requestId).toBe("req-001");

    vi.unstubAllGlobals();
  });

  it("throws LLMProviderError on null message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          choices: [{ index: 0, message: null }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
    });

    let caught: unknown;
    try {
      await adapter.infer(request);
      expect.unreachable("Expected LLMProviderError");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LLMProviderError);
    expect((caught as Error).message).toMatch(/exhausted|normalization/);
    expect((caught as LLMProviderError).requestId).toBe("req-001");

    vi.unstubAllGlobals();
  });
});

// ── Normalization mode handling ──────────────────────────────────

describe("DeepSeekAdapter — normalization mode", () => {
  it("defaults to native_tool for unrecognized normalization_mode", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      available_tools: [makeTool()],
      inference_policy: { normalization_mode: "invalid_mode" },
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    // Should still include tools + tool_choice because native_tool is the default
    expect(body).toHaveProperty("tools");
    expect(body["tool_choice"]).toBe("auto");
    // Should NOT include response_format since it defaulted to native_tool
    expect(body).not.toHaveProperty("response_format");

    vi.unstubAllGlobals();
  });

  it("sets response_format in json_mode", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      available_tools: [makeTool()],
      inference_policy: { normalization_mode: "json_mode" },
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty("response_format");
    expect(body["response_format"]).toEqual({ type: "json_object" });
    // json_mode omits tools
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");

    vi.unstubAllGlobals();
  });

  it("omits both tools and response_format in parsed_text mode", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resolveContent = makeContentResolver({ "ref-1": "text" });
    const adapter = new DeepSeekAdapter(
      makeAdapterConfig({ resolveContent }),
    );

    const request = makeRequest({
      context_items: [
        makeContextItem({ content_ref: makeContentRef({ ref_id: "ref-1" }) }),
      ],
      available_tools: [makeTool()],
      inference_policy: { normalization_mode: "parsed_text" },
    });

    await adapter.infer(request);

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("response_format");

    vi.unstubAllGlobals();
  });
});

// ── Package entrypoint smoke test ────────────────────────────────

describe("DeepSeekAdapter — package entrypoint", () => {
  it("exports DeepSeekAdapter, DeepSeekAdapterConfig, ContentResolver, TraceWriter", () => {
    // Verify types compile and runtime class exists
    expect(typeof DeepSeekAdapter).toBe("function");

    // Type-level check: these assignments compile
    const config: DeepSeekAdapterConfig = {
      endpoint: "https://api.deepseek.com",
      apiKey: "sk-test",
      model: "deepseek-chat",
    };
    expect(config).toBeTruthy();

    const resolver: ContentResolver = async (_ref) => "content";
    expect(typeof resolver).toBe("function");

    const writer: TraceWriter = async (_ref, _payload) => {};
    expect(typeof writer).toBe("function");
  });

  it("assigns DeepSeekAdapter to LLMProvider type variable", () => {
    const adapter: LLMProvider = new DeepSeekAdapter(makeAdapterConfig());
    expect(adapter).toBeInstanceOf(DeepSeekAdapter);
  });
});
