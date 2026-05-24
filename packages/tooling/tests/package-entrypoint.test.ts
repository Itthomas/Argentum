import { describe, expect, it } from "vitest";

import * as tooling from "../src/index.js";

describe("@argentum/tooling source entrypoint", () => {
  it("exports ToolRegistry class", () => {
    expect(typeof tooling.ToolRegistry).toBe("function");
  });

  it("exports stable error code constants", () => {
    expect(tooling.TOOL_NOT_REGISTERED).toBe("TOOL_NOT_REGISTERED");
    expect(tooling.SCHEMA_VALIDATION_FAILED).toBe("SCHEMA_VALIDATION_FAILED");
    expect(tooling.TOOL_EXECUTION_FAILED).toBe("TOOL_EXECUTION_FAILED");
  });

  it("allows constructing ToolRegistry and registering a tool", () => {
    const registry = new tooling.ToolRegistry();

    const def = {
      name: "entry_test",
      description: "Test tool",
      input_schema: {},
      side_effect_level: "read_only" as const,
      path_scope: "none" as const,
      required_secret_handles: [] as string[],
      network_access: "deny" as const,
      default_timeout_ms: 1000,
    };

    registry.register(def, async () => ({
      call_id: "call-001",
      status: "success" as const,
      human_summary: "ok",
      duration_ms: 1,
      truncated: false,
      retryable: false,
    }));

    expect(registry.isRegistered("entry_test")).toBe(true);
  });
});
