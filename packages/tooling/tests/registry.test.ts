import { describe, expect, it } from "vitest";

import type {
  ToolCallDTO,
  ToolDefinition,
  ToolResultDTO,
} from "@argentum/contracts";
import {
  parseLLMInferenceRequest,
  ToolDefinitionValidationError,
} from "@argentum/contracts";

import {
  SCHEMA_VALIDATION_FAILED,
  TOOL_EXECUTION_FAILED,
  TOOL_NOT_REGISTERED,
  ToolRegistry,
} from "../src/index.js";

import type { ToolImplementation } from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidToolDefinition(
  overrides: Record<string, unknown> = {},
): ToolDefinition {
  return {
    name: "test_search",
    description: "Search the web for information",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    side_effect_level: "read_only",
    path_scope: "none",
    required_secret_handles: [],
    network_access: "deny",
    default_timeout_ms: 30000,
    ...overrides,
  } as ToolDefinition;
}

function makeValidToolCall(
  overrides: Record<string, unknown> = {},
): ToolCallDTO {
  return {
    call_id: "call-001",
    turn_id: "turn-001",
    tool_name: "test_search",
    arguments: { query: "hello" },
    grant: {
      grant_id: "grant-001",
      cwd: "/workspace",
      path_permissions: [],
      env_secret_handles: [],
      network_policy: "inherit",
      approval_mode: "auto_allow",
      max_runtime_ms: 30000,
    },
    timeout_ms: 30000,
    idempotency_key: "idem-001",
    ...overrides,
  } as ToolCallDTO;
}

function makeSuccessfulResult(
  overrides: Partial<ToolResultDTO> = {},
): ToolResultDTO {
  return {
    call_id: "call-001",
    status: "success",
    human_summary: "Done.",
    duration_ms: 42,
    truncated: false,
    retryable: false,
    ...overrides,
  } as ToolResultDTO;
}

function makePassthroughImpl(
  result?: ToolResultDTO,
): ToolImplementation {
  return (_call: ToolCallDTO) => {
    return result ?? makeSuccessfulResult();
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("ToolRegistry", () => {
  // ── Registration ────────────────────────────────────────────

  describe("register()", () => {
    it("accepts a valid ToolDefinition and implementation", () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      const impl = makePassthroughImpl();

      expect(() => registry.register(def, impl)).not.toThrow();
      expect(registry.isRegistered("test_search")).toBe(true);
    });

    it("throws on duplicate tool name with a stable error", () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      const impl = makePassthroughImpl();

      registry.register(def, impl);

      expect(() => registry.register(def, impl)).toThrow(
        /already registered/,
      );
    });

    it("throws ToolDefinitionValidationError when passed an invalid definition", () => {
      const registry = new ToolRegistry();
      const impl = makePassthroughImpl();

      // Missing required fields
      const invalidDef = { name: "bad" };

      expect(() =>
        registry.register(invalidDef as ToolDefinition, impl),
      ).toThrow(ToolDefinitionValidationError);
    });

    it("isRegistered() returns false for unknown tools", () => {
      const registry = new ToolRegistry();
      expect(registry.isRegistered("nonexistent")).toBe(false);
    });

    it("getDefinition() returns the registered definition", () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition({ name: "get_def_test" });
      registry.register(def, makePassthroughImpl());

      const retrieved = registry.getDefinition("get_def_test");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("get_def_test");
      expect(retrieved?.description).toBe(def.description);
    });

    it("getDefinition() returns undefined for unregistered name", () => {
      const registry = new ToolRegistry();
      expect(registry.getDefinition("nonexistent")).toBeUndefined();
    });
  });

  // ── Dispatch ────────────────────────────────────────────────

  describe("dispatch()", () => {
    it("routes to the correct implementation for a registered tool", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      registry.register(def, makePassthroughImpl());

      const call = makeValidToolCall();
      const result = await registry.dispatch(call);

      expect(result.status).toBe("success");
      expect(result.call_id).toBe(call.call_id);
    });

    it("returns TOOL_NOT_REGISTERED result for unregistered tool name", async () => {
      const registry = new ToolRegistry();
      const call = makeValidToolCall({ tool_name: "nonexistent" });

      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(TOOL_NOT_REGISTERED);
      expect(result.call_id).toBe(call.call_id);
      expect(result.truncated).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.human_summary).toContain("nonexistent");
    });

    it("returns SCHEMA_VALIDATION_FAILED when arguments fail schema validation", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition({
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      });
      registry.register(def, makePassthroughImpl());

      // Missing required "query"
      const call = makeValidToolCall({ arguments: {} });

      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(SCHEMA_VALIDATION_FAILED);
      expect(result.call_id).toBe(call.call_id);
      expect(result.truncated).toBe(false);
      expect(result.retryable).toBe(false);
    });

    it("returns TOOL_EXECUTION_FAILED when implementation throws", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      registry.register(def, () => {
        throw new Error("boom!");
      });

      const call = makeValidToolCall();
      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(TOOL_EXECUTION_FAILED);
      expect(result.call_id).toBe(call.call_id);
      expect(result.human_summary).toContain("boom!");
    });

    it("measures and populates duration_ms on successful results, overriding implementation value", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      // Implementation returns an implausibly large duration_ms — the
      // registry MUST override it with its own measured wall-clock time.
      registry.register(
        def,
        makePassthroughImpl(makeSuccessfulResult({ duration_ms: 999999 })),
      );

      const call = makeValidToolCall();
      const result = await registry.dispatch(call);

      expect(result.status).toBe("success");
      expect(typeof result.duration_ms).toBe("number");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      // Proves the registry overrode the implementation's value.
      expect(result.duration_ms).toBeLessThan(999999);
    });

    it("registry duration_ms on success is always reasonable (< 5000) even when impl returns extreme value", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      registry.register(
        def,
        makePassthroughImpl(makeSuccessfulResult({ duration_ms: 999999999 })),
      );

      const call = makeValidToolCall();
      const result = await registry.dispatch(call);

      expect(result.status).toBe("success");
      expect(typeof result.duration_ms).toBe("number");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(result.duration_ms).toBeLessThan(5000);
    });

    it("populates duration_ms on TOOL_NOT_REGISTERED error results", async () => {
      const registry = new ToolRegistry();
      const call = makeValidToolCall({ tool_name: "nonexistent" });

      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(TOOL_NOT_REGISTERED);
      expect(typeof result.duration_ms).toBe("number");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("populates duration_ms on SCHEMA_VALIDATION_FAILED error results", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition({
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      });
      registry.register(def, makePassthroughImpl());

      const call = makeValidToolCall({ arguments: {} });
      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(SCHEMA_VALIDATION_FAILED);
      expect(typeof result.duration_ms).toBe("number");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("populates duration_ms on TOOL_EXECUTION_FAILED error results", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      registry.register(def, () => {
        throw new Error("fail");
      });

      const call = makeValidToolCall();
      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(TOOL_EXECUTION_FAILED);
      expect(typeof result.duration_ms).toBe("number");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("preserves call_id from inbound ToolCallDTO on the returned result", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      registry.register(def, makePassthroughImpl());

      const call = makeValidToolCall({ call_id: "my-call-id" });
      const result = await registry.dispatch(call);

      expect(result.call_id).toBe("my-call-id");
    });

    it("returns TOOL_EXECUTION_FAILED when result fails parseToolResultDTO (missing required field)", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      // Return something that's missing required ToolResultDTO fields
      registry.register(def, () => {
        return { call_id: "call-001" } as ToolResultDTO;
      });

      const call = makeValidToolCall();
      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(TOOL_EXECUTION_FAILED);
    });

    it("returns TOOL_EXECUTION_FAILED when result fails parseToolResultDTO (wrong-type field)", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      registry.register(def, () => {
        return {
          call_id: "call-001",
          status: "invalid_status",
          human_summary: "ok",
          duration_ms: "not_a_number",
          truncated: false,
          retryable: false,
        } as unknown as ToolResultDTO;
      });

      const call = makeValidToolCall();
      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(TOOL_EXECUTION_FAILED);
    });

    it("patches call_id when implementation returns a mismatched call_id", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      const wrongResult = makeSuccessfulResult({ call_id: "wrong-id" });
      registry.register(def, () => wrongResult);

      const call = makeValidToolCall({ call_id: "correct-id" });
      const result = await registry.dispatch(call);

      expect(result.call_id).toBe("correct-id");
    });

    it("preserves other fields when patching call_id", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition();
      const wrongResult = makeSuccessfulResult({
        call_id: "wrong-id",
        status: "success",
        human_summary: "All good.",
        duration_ms: 123,
        truncated: true,
        retryable: true,
        error_code: "SOME_CODE",
      });
      registry.register(def, () => wrongResult);

      const call = makeValidToolCall({ call_id: "correct-id" });
      const result = await registry.dispatch(call);

      expect(result.call_id).toBe("correct-id");
      expect(result.status).toBe("success");
      expect(result.human_summary).toBe("All good.");
      // duration_ms is overridden by registry measurement (H1 fix).
      // The implementation's self-reported value is discarded.
      expect(typeof result.duration_ms).toBe("number");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(result.truncated).toBe(true);
      expect(result.retryable).toBe(true);
      expect(result.error_code).toBe("SOME_CODE");
    });

    it("with empty input_schema accepts any arguments object", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition({ input_schema: {} });
      registry.register(def, makePassthroughImpl());

      const call = makeValidToolCall({
        arguments: { anything: "goes", foo: 42, bar: true },
      });
      const result = await registry.dispatch(call);

      expect(result.status).toBe("success");
    });

    it("accepts arguments matching schema with additionalProperties: false", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition({
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      });
      registry.register(def, makePassthroughImpl());

      const call = makeValidToolCall({ arguments: { query: "hello" } });
      const result = await registry.dispatch(call);

      expect(result.status).toBe("success");
    });

    it("rejects unknown properties when additionalProperties is false", async () => {
      const registry = new ToolRegistry();
      const def = makeValidToolDefinition({
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          additionalProperties: false,
        },
      });
      registry.register(def, makePassthroughImpl());

      const call = makeValidToolCall({
        arguments: { query: "hello", extra: "bad" },
      });
      const result = await registry.dispatch(call);

      expect(result.status).toBe("error");
      expect(result.error_code).toBe(SCHEMA_VALIDATION_FAILED);
      expect(result.human_summary).toContain("extra");
    });
  });

  // ── Projection ──────────────────────────────────────────────

  describe("projectForProvider()", () => {
    it("returns empty array for empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.projectForProvider()).toEqual([]);
    });

    it("returns one entry per registered tool", () => {
      const registry = new ToolRegistry();
      registry.register(
        makeValidToolDefinition({ name: "tool_a" }),
        makePassthroughImpl(),
      );
      registry.register(
        makeValidToolDefinition({ name: "tool_b", description: "Tool B desc" }),
        makePassthroughImpl(),
      );

      const projection = registry.projectForProvider();
      expect(projection).toHaveLength(2);

      const names = projection.map((e) => e.name);
      expect(names).toContain("tool_a");
      expect(names).toContain("tool_b");
    });

    it("each entry has name, description, and input_schema from registered definition", () => {
      const registry = new ToolRegistry();
      const schema = {
        type: "object",
        properties: { x: { type: "number" } },
      };
      registry.register(
        makeValidToolDefinition({
          name: "my_tool",
          description: "My tool description",
          input_schema: schema,
        }),
        makePassthroughImpl(),
      );

      const projection = registry.projectForProvider();
      expect(projection).toHaveLength(1);

      const [entry] = projection;
      expect(entry!.name).toBe("my_tool");
      expect(entry!.description).toBe("My tool description");
      expect(entry!.input_schema).toEqual(schema);
    });

    it("returned entries match AvailableToolEntry shape", () => {
      const registry = new ToolRegistry();
      registry.register(
        makeValidToolDefinition({ name: "shape_test" }),
        makePassthroughImpl(),
      );

      const projection = registry.projectForProvider();
      expect(projection).toHaveLength(1);

      const [entry] = projection;
      expect(typeof entry!.name).toBe("string");
      expect(typeof entry!.description).toBe("string");
      expect(typeof entry!.input_schema).toBe("object");
    });

    it("mutation of projected input_schema does not affect registry internal state", () => {
      const registry = new ToolRegistry();
      const schema = {
        type: "object",
        properties: { x: { type: "number" } },
      };
      registry.register(
        makeValidToolDefinition({
          name: "mut_test",
          input_schema: schema,
        }),
        makePassthroughImpl(),
      );

      const projection = registry.projectForProvider();
      expect(projection).toHaveLength(1);

      // Mutate the projected entry's input_schema
      const [entry] = projection;
      (entry!.input_schema as Record<string, unknown>)["type"] = "array";
      (entry!.input_schema as Record<string, unknown>)["malicious"] = true;

      // Registry's stored definition must be unaffected
      const stored = registry.getDefinition("mut_test");
      expect(stored?.input_schema).toEqual(schema);
      expect(stored?.input_schema).not.toHaveProperty("malicious");
    });

    it("projected entries validate via parseLLMInferenceRequest", () => {
      const registry = new ToolRegistry();
      registry.register(
        makeValidToolDefinition({ name: "integ_test", description: "A test tool" }),
        makePassthroughImpl(),
      );

      const projection = registry.projectForProvider();

      // Build a minimal LLMInferenceRequest stub wrapping the projection.
      // This must NOT throw — proving the projection satisfies the
      // AvailableToolEntry contract as validated by parseLLMInferenceRequest.
      const stub = {
        request_id: "req-001",
        turn_id: "turn-001",
        context_items: [],
        available_tools: projection,
        inference_policy: {},
      };

      expect(() => parseLLMInferenceRequest(stub)).not.toThrow();
    });
  });

  // ── Error code constants ────────────────────────────────────

  describe("error code constants", () => {
    it("TOOL_NOT_REGISTERED has stable value", () => {
      expect(TOOL_NOT_REGISTERED).toBe("TOOL_NOT_REGISTERED");
    });

    it("SCHEMA_VALIDATION_FAILED has stable value", () => {
      expect(SCHEMA_VALIDATION_FAILED).toBe("SCHEMA_VALIDATION_FAILED");
    });

    it("TOOL_EXECUTION_FAILED has stable value", () => {
      expect(TOOL_EXECUTION_FAILED).toBe("TOOL_EXECUTION_FAILED");
    });
  });
});
