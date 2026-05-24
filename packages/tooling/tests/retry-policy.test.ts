import { describe, expect, it } from "vitest";

import type {
  SideEffectLevel,
  ToolCallDTO,
  ToolDefinition,
  ToolResultDTO,
  ToolResultStatus,
} from "@argentum/contracts";

import {
  dispatchWithRetry,
  shouldRetry,
  ToolRegistry,
} from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeToolDef(
  sideEffectLevel: SideEffectLevel,
): ToolDefinition {
  return {
    name: "test_tool",
    description: "A test tool",
    input_schema: {
      type: "object",
      properties: {},
    },
    side_effect_level: sideEffectLevel,
    path_scope: "none",
    required_secret_handles: [],
    network_access: "deny",
    default_timeout_ms: 30000,
  } as ToolDefinition;
}

function makeResult(
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

function makeToolCall(
  overrides: Partial<ToolCallDTO> = {},
): ToolCallDTO {
  return {
    call_id: "call-001",
    turn_id: "turn-001",
    tool_name: "test_tool",
    arguments: {},
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

// ── shouldRetry decision matrix ─────────────────────────────────

const SIDE_EFFECT_LEVELS: SideEffectLevel[] = [
  "read_only",
  "workspace_mutation",
  "host_mutation",
  "external_effect",
];

const STATUSES: ToolResultStatus[] = ["success", "error", "blocked"];

const RETRYABLE_VALUES: boolean[] = [true, false];

describe("shouldRetry decision matrix", () => {
  for (const sideEffect of SIDE_EFFECT_LEVELS) {
    for (const status of STATUSES) {
      for (const retryable of RETRYABLE_VALUES) {
        const toolDef = makeToolDef(sideEffect);
        const result = makeResult({ status, retryable });

        const expected =
          sideEffect === "read_only" &&
          status === "error" &&
          retryable === true;

        it(`${sideEffect} + ${status} + retryable=${retryable} → ${expected}`, () => {
          expect(shouldRetry(toolDef, result)).toBe(expected);
        });
      }
    }
  }
});

// ── shouldRetry specific rules ──────────────────────────────────

describe("shouldRetry rejects mutating tools", () => {
  const errorResult = makeResult({ status: "error", retryable: true });

  for (const sideEffect of SIDE_EFFECT_LEVELS) {
    if (sideEffect === "read_only") continue;

    it(`${sideEffect} → false regardless of result`, () => {
      const toolDef = makeToolDef(sideEffect);
      expect(shouldRetry(toolDef, errorResult)).toBe(false);
    });
  }
});

describe("shouldRetry rejects non-error statuses", () => {
  const toolDef = makeToolDef("read_only");

  it("success → false even with retryable=true", () => {
    const result = makeResult({ status: "success", retryable: true });
    expect(shouldRetry(toolDef, result)).toBe(false);
  });

  it("blocked → false even with retryable=true", () => {
    const result = makeResult({ status: "blocked", retryable: true });
    expect(shouldRetry(toolDef, result)).toBe(false);
  });
});

describe("shouldRetry: retryable=false always disqualifies", () => {
  const toolDef = makeToolDef("read_only");

  it("error + retryable=false → false", () => {
    const result = makeResult({ status: "error", retryable: false });
    expect(shouldRetry(toolDef, result)).toBe(false);
  });
});

// ── dispatchWithRetry integration tests ─────────────────────────

describe("dispatchWithRetry", () => {
  it("read-only tool: first dispatch returns retryable error → second dispatch called, returns second result", async () => {
    const registry = new ToolRegistry();
    let callCount = 0;

    const toolDef = makeToolDef("read_only");

    registry.register(toolDef, async (call) => {
      callCount++;
      if (callCount === 1) {
        return makeResult({
          call_id: call.call_id,
          status: "error",
          retryable: true,
          human_summary: "First failure",
        });
      }
      return makeResult({
        call_id: call.call_id,
        status: "success",
        retryable: false,
        human_summary: "Retry success",
      });
    });

    const call = makeToolCall();

    const result = await dispatchWithRetry(registry, toolDef, call);

    expect(callCount).toBe(2);
    expect(result.status).toBe("success");
    expect(result.human_summary).toBe("Retry success");
  });

  it("read-only tool: first dispatch returns retryable error, second also fails → returns second failure, exactly 2 calls", async () => {
    const registry = new ToolRegistry();
    let callCount = 0;

    const toolDef = makeToolDef("read_only");

    registry.register(toolDef, async (call) => {
      callCount++;
      return makeResult({
        call_id: call.call_id,
        status: "error",
        retryable: callCount === 1, // second call: retryable=false
        human_summary: `Failure #${callCount}`,
      });
    });

    const call = makeToolCall();

    const result = await dispatchWithRetry(registry, toolDef, call);

    expect(callCount).toBe(2);
    expect(result.status).toBe("error");
    expect(result.human_summary).toBe("Failure #2");
  });

  it("read-only tool: first dispatch succeeds → no retry, returns first result", async () => {
    const registry = new ToolRegistry();
    let callCount = 0;

    const toolDef = makeToolDef("read_only");

    registry.register(toolDef, async (call) => {
      callCount++;
      return makeResult({
        call_id: call.call_id,
        status: "success",
        retryable: false,
        human_summary: "First success",
      });
    });

    const call = makeToolCall();

    const result = await dispatchWithRetry(registry, toolDef, call);

    expect(callCount).toBe(1);
    expect(result.status).toBe("success");
    expect(result.human_summary).toBe("First success");
  });

  it("mutating tool (workspace_mutation): first dispatch fails retryable → no retry, returns first result", async () => {
    const registry = new ToolRegistry();
    let callCount = 0;

    const toolDef = makeToolDef("workspace_mutation");

    registry.register(toolDef, async (call) => {
      callCount++;
      return makeResult({
        call_id: call.call_id,
        status: "error",
        retryable: true,
        human_summary: "Mutation error",
      });
    });

    const call = makeToolCall({ tool_name: "test_tool" });

    const result = await dispatchWithRetry(registry, toolDef, call);

    expect(callCount).toBe(1);
    expect(result.status).toBe("error");
    expect(result.human_summary).toBe("Mutation error");
  });

  it("TOOL_EXECUTION_FAILED with retryable=true → retry occurs, returns second dispatch result", async () => {
    const registry = new ToolRegistry();
    let callCount = 0;

    const toolDef = makeToolDef("read_only");

    registry.register(toolDef, async (call) => {
      callCount++;
      if (callCount === 1) {
        // Simulate an execution error result that the tool implementation
        // returns (not thrown) — with retryable=true.
        return {
          call_id: call.call_id,
          status: "error",
          human_summary: "Execution failure",
          duration_ms: 10,
          truncated: false,
          retryable: true,
          error_code: "TOOL_EXECUTION_FAILED",
        } as ToolResultDTO;
      }
      return makeResult({
        call_id: call.call_id,
        status: "success",
        retryable: false,
        human_summary: "Recovered",
      });
    });

    const call = makeToolCall();

    const result = await dispatchWithRetry(registry, toolDef, call);

    expect(callCount).toBe(2);
    expect(result.status).toBe("success");
    expect(result.human_summary).toBe("Recovered");
  });

  it("TOOL_EXECUTION_FAILED with retryable=false → no retry, returns first result", async () => {
    const registry = new ToolRegistry();
    let callCount = 0;

    const toolDef = makeToolDef("read_only");

    registry.register(toolDef, async (call) => {
      callCount++;
      // Implementation throws → registry returns TOOL_EXECUTION_FAILED
      // with retryable=false from makeErrorResult.
      throw new Error("Boom");
    });

    const call = makeToolCall();

    const result = await dispatchWithRetry(registry, toolDef, call);

    // Registry catches the throw and returns TOOL_EXECUTION_FAILED with retryable=false.
    // dispatchWithRetry sees retryable=false → no retry.
    expect(callCount).toBe(1);
    expect(result.status).toBe("error");
    expect(result.error_code).toBe("TOOL_EXECUTION_FAILED");
  });

  it("TOOL_NOT_REGISTERED → single dispatch, no retry (registry sets retryable=false)", async () => {
    const registry = new ToolRegistry();
    // Do NOT register the tool — dispatch will return TOOL_NOT_REGISTERED.

    const toolDef = makeToolDef("read_only");
    const call = makeToolCall({ tool_name: "unregistered_tool" });

    const result = await dispatchWithRetry(registry, toolDef, call);

    expect(result.status).toBe("error");
    expect(result.error_code).toBe("TOOL_NOT_REGISTERED");
    expect(result.retryable).toBe(false);
  });

  it("SCHEMA_VALIDATION_FAILED → single dispatch, no retry (registry sets retryable=false)", async () => {
    const registry = new ToolRegistry();
    let callCount = 0;

    const toolDef = {
      ...makeToolDef("read_only"),
      name: "schema_tool",
      input_schema: {
        type: "object",
        properties: {
          required_field: { type: "string" },
        },
        required: ["required_field"],
      },
    } as ToolDefinition;

    registry.register(toolDef, async (call) => {
      callCount++;
      return makeResult({
        call_id: call.call_id,
        status: "success",
        human_summary: "Should not be called",
      });
    });

    const call = makeToolCall({
      tool_name: "schema_tool",
      arguments: { wrong_field: 123 },
    });

    const result = await dispatchWithRetry(registry, toolDef, call);

    expect(result.status).toBe("error");
    expect(result.error_code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(result.retryable).toBe(false);
    expect(callCount).toBe(0); // Implementation never invoked — schema rejects first
  });
});

// ── Package entrypoint ──────────────────────────────────────────

describe("package entrypoint exports", () => {
  it("exports shouldRetry as a callable function", () => {
    expect(typeof shouldRetry).toBe("function");
  });

  it("exports dispatchWithRetry as a callable function", () => {
    expect(typeof dispatchWithRetry).toBe("function");
  });
});
