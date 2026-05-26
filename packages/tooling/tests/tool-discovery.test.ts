import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "@argentum/contracts";

import { ToolRegistry, planToolExposure } from "../src/index.js";

function makeToolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `Description for ${name}`,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    side_effect_level: "read_only",
    path_scope: "none",
    required_secret_handles: [],
    network_access: "deny",
    default_timeout_ms: 30000,
  };
}

function makeRegistryWithTools(...names: string[]): ToolRegistry {
  const registry = new ToolRegistry();

  for (const name of names) {
    registry.register(makeToolDefinition(name), async (call) => ({
      call_id: call.call_id,
      status: "success",
      human_summary: `Ran ${name}`,
      duration_ms: 1,
      truncated: false,
      retryable: false,
    }));
  }

  return registry;
}

function getQuerySchemaType(definition: ToolDefinition): string {
  return ((((definition.input_schema as Record<string, unknown>).properties ?? {}) as Record<
    string,
    unknown
  >).query as Record<string, unknown>).type as string;
}

describe("tool-discovery", () => {
  describe("ToolRegistry.snapshotDefinitions()", () => {
    it("returns canonical definitions in registration order without exposing a mutable registry array", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta", "tool.gamma");

      const snapshot = registry.snapshotDefinitions();

      expect(snapshot.map((definition) => definition.name)).toEqual([
        "tool.alpha",
        "tool.beta",
        "tool.gamma",
      ]);
      expect(snapshot[0]).toBe(registry.getDefinition("tool.alpha"));
      expect(() =>
        (snapshot as ToolDefinition[]).push(makeToolDefinition("tool.delta")),
      ).toThrow(TypeError);
    });

    it("returns structurally identical snapshots across repeated calls", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta");

      const first = registry.snapshotDefinitions();
      const second = registry.snapshotDefinitions();

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    });
  });

  describe("planToolExposure()", () => {
    it("mode all exposes every registered tool in deterministic registry order", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta", "tool.gamma");

      const snapshot = registry.snapshotDefinitions();
      const plan = planToolExposure(snapshot, { mode: "all" });

      expect(plan.exposedTools).toEqual(snapshot);
      expect(plan.exposedTools[1]).toBe(snapshot[1]);
      expect(plan.omittedRegisteredToolNames).toEqual([]);
      expect(plan.missingRequestedToolNames).toEqual([]);
    });

    it("mode explicit exposes only the requested ordered subset", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta", "tool.gamma");

      const plan = planToolExposure(registry.snapshotDefinitions(), {
        mode: "explicit",
        toolNames: ["tool.gamma", "tool.alpha"],
      });

      expect(plan.exposedTools.map((definition) => definition.name)).toEqual([
        "tool.gamma",
        "tool.alpha",
      ]);
      expect(plan.omittedRegisteredToolNames).toEqual(["tool.beta"]);
      expect(plan.missingRequestedToolNames).toEqual([]);
    });

    it("reports registered-but-omitted names separately from missing requested names", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta", "tool.gamma");

      const plan = planToolExposure(registry.snapshotDefinitions(), {
        mode: "explicit",
        toolNames: ["tool.gamma", "tool.missing", "tool.alpha"],
      });

      expect(plan.exposedTools.map((definition) => definition.name)).toEqual([
        "tool.gamma",
        "tool.alpha",
      ]);
      expect(plan.omittedRegisteredToolNames).toEqual(["tool.beta"]);
      expect(plan.missingRequestedToolNames).toEqual(["tool.missing"]);
    });

    it("collapses duplicate requested names by first occurrence for both exposed and missing tools", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta", "tool.gamma");

      const plan = planToolExposure(registry.snapshotDefinitions(), {
        mode: "explicit",
        toolNames: [
          "tool.beta",
          "tool.beta",
          "tool.missing",
          "tool.alpha",
          "tool.missing",
          "tool.alpha",
        ],
      });

      expect(plan.exposedTools.map((definition) => definition.name)).toEqual([
        "tool.beta",
        "tool.alpha",
      ]);
      expect(plan.omittedRegisteredToolNames).toEqual(["tool.gamma"]);
      expect(plan.missingRequestedToolNames).toEqual(["tool.missing"]);
    });

    it("preserves the registry-owned canonical definitions in exposedTools", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta");

      const snapshot = registry.snapshotDefinitions();
      const plan = planToolExposure(snapshot, {
        mode: "explicit",
        toolNames: ["tool.beta"],
      });

      expect(plan.exposedTools[0]).toBe(snapshot[1]);
      expect(plan.exposedTools[0]).toBe(registry.getDefinition("tool.beta"));
    });

    it("prevents nested input_schema mutation from leaking back into registry-owned definitions", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta");

      const snapshot = registry.snapshotDefinitions();
      const plan = planToolExposure(snapshot, {
        mode: "explicit",
        toolNames: ["tool.alpha"],
      });

      expect(() => {
        ((((snapshot[0]!.input_schema as Record<string, unknown>).properties ?? {}) as Record<
          string,
          unknown
        >).query as Record<string, unknown>).type = "number";
      }).toThrow(TypeError);
      expect(() => {
        ((((plan.exposedTools[0]!.input_schema as Record<string, unknown>).properties ?? {}) as Record<
          string,
          unknown
        >).query as Record<string, unknown>).type = "number";
      }).toThrow(TypeError);

      const freshSnapshot = registry.snapshotDefinitions();

      expect(getQuerySchemaType(freshSnapshot[0]!)).toBe("string");
      expect(getQuerySchemaType(registry.getDefinition("tool.alpha")!)).toBe("string");
    });

    it("returns an empty explicit plan without mutating registry state", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta");

      const snapshot = registry.snapshotDefinitions();
      const plan = planToolExposure(snapshot, {
        mode: "explicit",
        toolNames: [],
      });

      expect(plan.exposedTools).toEqual([]);
      expect(plan.omittedRegisteredToolNames).toEqual([
        "tool.alpha",
        "tool.beta",
      ]);
      expect(plan.missingRequestedToolNames).toEqual([]);
      expect(registry.snapshotDefinitions()).toEqual(snapshot);
    });

    it("returns structurally identical plans for repeated calls with identical inputs", () => {
      const registry = makeRegistryWithTools("tool.alpha", "tool.beta", "tool.gamma");
      const snapshot = registry.snapshotDefinitions();
      const request = {
        mode: "explicit" as const,
        toolNames: ["tool.gamma", "tool.missing", "tool.alpha", "tool.gamma"],
      };

      const first = planToolExposure(snapshot, request);
      const second = planToolExposure(snapshot, request);

      expect(first).toEqual(second);
    });
  });
});