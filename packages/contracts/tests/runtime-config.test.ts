import { describe, expect, it } from "vitest";

import {
  RuntimeConfigValidationError,
  parseRuntimeConfig,
} from "../src/index.js";

describe("parseRuntimeConfig", () => {
  it("accepts the canonical runtime config shape from the spec", () => {
    const parsed = parseRuntimeConfig(makeValidConfig());

    expect(parsed).toEqual(makeValidConfig());
  });

  it("does not materialize optional fields when they are omitted", () => {
    const parsed = parseRuntimeConfig(makeValidConfig());

    expect(parsed.provider).not.toHaveProperty("temperature");
    expect(parsed.provider).not.toHaveProperty("max_output_tokens");
    expect(parsed).not.toHaveProperty("features");
  });

  it("accepts the supported features toggle when explicitly present", () => {
    const config = makeValidConfig();
    config.features = { enable_native_tool_calling: true };

    const parsed = parseRuntimeConfig(config);

    expect(parsed.features).toEqual({ enable_native_tool_calling: true });
  });

  it("rejects a missing required section", () => {
    const config = makeValidConfig();

    delete (config as Record<string, unknown>).workspace;

    expectIssues(config, [{ path: "workspace", code: "missing_required" }]);
  });

  it("rejects a missing required field inside a present section", () => {
    const config = makeValidConfig();

    delete (config.workspace as Record<string, unknown>).logs_root;

    expectIssues(config, [{ path: "workspace.logs_root", code: "missing_required" }]);
  });

  it("rejects unsupported provider, gateway, and telemetry literals", () => {
    const config = makeValidConfig();
    config.provider.name = "other";
    config.gateway.queue_overflow_policy = "drop_oldest";
    config.telemetry.format = "text";

    expectIssues(config, [
      { path: "provider.name", code: "invalid_literal" },
      { path: "gateway.queue_overflow_policy", code: "invalid_literal" },
      { path: "telemetry.format", code: "invalid_literal" },
    ]);
  });

  it("rejects wrong primitive types and coercion for integers and booleans", () => {
    const config = makeValidConfig();

    (config.governor as Record<string, unknown>).max_inference_steps = "5";
    (config.tool_policy as Record<string, unknown>).trusted_local_mode = "true";

    expectIssues(config, [
      { path: "governor.max_inference_steps", code: "invalid_type" },
      { path: "tool_policy.trusted_local_mode", code: "invalid_type" },
    ]);
  });

  it("accepts numeric temperature but rejects non-integer max output tokens", () => {
    const config = makeValidConfig();
    config.provider.temperature = 0.7;
    (config.provider as Record<string, unknown>).max_output_tokens = 42.5;

    expectIssues(config, [{ path: "provider.max_output_tokens", code: "invalid_integer" }]);
  });

  it("rejects non-number temperature values without coercion", () => {
    const config = makeValidConfig();

    (config.provider as Record<string, unknown>).temperature = "0.7";

    expectIssues(config, [{ path: "provider.temperature", code: "invalid_type" }]);
  });

  it("rejects non-string array members in tool and secret handle lists", () => {
    const config = makeValidConfig();

    (config.tool_policy.enabled_tools as unknown[]).push(123);
    (config.tool_policy.enabled_secret_handles as unknown[]).push(false);

    expectIssues(config, [
      { path: "tool_policy.enabled_tools[1]", code: "invalid_type" },
      { path: "tool_policy.enabled_secret_handles[1]", code: "invalid_type" },
    ]);
  });

  it("rejects unknown sections, unknown nested fields, and secret-like extras", () => {
    const config = makeValidConfig() as Record<string, unknown>;

    config.unexpected = {};
    (config.provider as Record<string, unknown>).api_key = "raw-secret";
    (config.tool_policy as Record<string, unknown>).secret_blob = { token: "raw-secret" };
    (config.features as Record<string, unknown> | undefined) ??= {};
    (config.features as Record<string, unknown>).unsupported_toggle = true;

    expectIssues(config, [
      { path: "unexpected", code: "unknown_key" },
      { path: "provider.api_key", code: "unknown_key" },
      { path: "tool_policy.secret_blob", code: "unknown_key" },
      { path: "features.unsupported_toggle", code: "unknown_key" },
    ]);
  });

  it("accepts empty strings and empty arrays when the contract type allows them", () => {
    const config = makeValidConfig();

    config.workspace.bedrock_root = "";
    config.provider.model_id = "";
    config.provider.endpoint = "";
    config.tool_policy.enabled_tools = [];
    config.tool_policy.enabled_secret_handles = [];

    const parsed = parseRuntimeConfig(config);

    expect(parsed.workspace.bedrock_root).toBe("");
    expect(parsed.provider.model_id).toBe("");
    expect(parsed.provider.endpoint).toBe("");
    expect(parsed.tool_policy.enabled_tools).toEqual([]);
    expect(parsed.tool_policy.enabled_secret_handles).toEqual([]);
  });

  it("preserves the workspace, governor, and tool policy fields needed downstream", () => {
    const config = makeValidConfig();
    config.provider.temperature = 0.4;
    config.provider.max_output_tokens = 512;

    const parsed = parseRuntimeConfig(config);

    expect(parsed.workspace).toEqual(config.workspace);
    expect(parsed.governor).toEqual(config.governor);
    expect(parsed.tool_policy).toEqual(config.tool_policy);
    expect(parsed.provider.temperature).toBe(0.4);
    expect(parsed.provider.max_output_tokens).toBe(512);
  });
});

function expectIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getIssues(value);

  expect(issues).toEqual(
    expect.arrayContaining(
      expected.map((issue) => expect.objectContaining(issue)),
    ),
  );
}

function getIssues(value: unknown) {
  try {
    parseRuntimeConfig(value);
  } catch (error) {
    if (error instanceof RuntimeConfigValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected runtime config parsing to fail.");
}

function makeValidConfig() {
  return {
    workspace: {
      bedrock_root: "Z:/Projects/Argentum/runtime/bedrock",
      working_root: "Z:/Projects/Argentum/runtime/working",
      artifacts_root: "Z:/Projects/Argentum/runtime/artifacts",
      logs_root: "Z:/Projects/Argentum/runtime/logs",
    },
    provider: {
      name: "deepseek" as const,
      model_id: "deepseek-chat",
      endpoint: "http://localhost:11434/v1",
    },
    governor: {
      max_inference_steps: 8,
      max_repair_attempts: 2,
      max_wall_clock_ms: 20000,
    },
    gateway: {
      max_queued_ingress_per_session: 8,
      queue_overflow_policy: "reject_newest" as const,
    },
    tool_policy: {
      enabled_tools: ["functions.read_file"],
      enabled_secret_handles: ["provider/deepseek/default"],
      max_tool_runtime_ms: 15000,
      trusted_local_mode: true,
    },
    telemetry: {
      format: "jsonl" as const,
      persist_events: true,
    },
  };
}