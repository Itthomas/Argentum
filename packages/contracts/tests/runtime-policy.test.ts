import { describe, expect, it } from "vitest";

import type { RuntimePolicyDTO } from "../src/index.js";
import {
  RuntimePolicyValidationError,
  parseRuntimePolicyDTO,
} from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidPolicy(overrides: Record<string, unknown> = {}) {
  return {
    enabled_tools: ["tool_a", "tool_b"],
    enabled_secret_handles: ["GITHUB_TOKEN"],
    max_tool_runtime_ms: 30000,
    workspace_roots: {
      bedrock: "/workspace/bedrock",
      working: "/workspace/working",
      artifacts: "/workspace/artifacts",
      logs: "/workspace/logs",
    },
    trusted_local_mode: true,
    ...overrides,
  };
}

function getPolicyIssues(value: unknown) {
  try {
    parseRuntimePolicyDTO(value);
  } catch (error) {
    if (error instanceof RuntimePolicyValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected runtime policy parsing to fail.");
}

function expectPolicyIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getPolicyIssues(value);
  const actual = issues.map(({ path, code }) => ({ path, code }));
  expect(actual).toEqual(expected);
}

// ── Tests ───────────────────────────────────────────────────────

describe("parseRuntimePolicyDTO", () => {
  // ── Valid policies ─────────────────────────────────────────

  it("accepts a full valid policy with populated fields and trusted_local_mode = true", () => {
    const policy = makeValidPolicy({ trusted_local_mode: true });
    const parsed = parseRuntimePolicyDTO(policy);

    expect(parsed.enabled_tools).toEqual(["tool_a", "tool_b"]);
    expect(parsed.enabled_secret_handles).toEqual(["GITHUB_TOKEN"]);
    expect(parsed.max_tool_runtime_ms).toBe(30000);
    expect(parsed.workspace_roots.bedrock).toBe("/workspace/bedrock");
    expect(parsed.workspace_roots.working).toBe("/workspace/working");
    expect(parsed.workspace_roots.artifacts).toBe("/workspace/artifacts");
    expect(parsed.workspace_roots.logs).toBe("/workspace/logs");
    expect(parsed.trusted_local_mode).toBe(true);
  });

  it("accepts a full valid policy with trusted_local_mode = false", () => {
    const policy = makeValidPolicy({ trusted_local_mode: false });
    const parsed = parseRuntimePolicyDTO(policy);

    expect(parsed.trusted_local_mode).toBe(false);
  });

  it("accepts a policy with empty enabled_tools", () => {
    const policy = makeValidPolicy({ enabled_tools: [] });
    const parsed = parseRuntimePolicyDTO(policy);

    expect(parsed.enabled_tools).toEqual([]);
  });

  it("accepts a policy with empty enabled_secret_handles", () => {
    const policy = makeValidPolicy({ enabled_secret_handles: [] });
    const parsed = parseRuntimePolicyDTO(policy);

    expect(parsed.enabled_secret_handles).toEqual([]);
  });

  it("accepts max_tool_runtime_ms = 1 as minimum positive integer", () => {
    const policy = makeValidPolicy({ max_tool_runtime_ms: 1 });
    const parsed = parseRuntimePolicyDTO(policy);

    expect(parsed.max_tool_runtime_ms).toBe(1);
  });

  // ── Required-field missing tests ───────────────────────────

  it("rejects missing enabled_tools", () => {
    const { enabled_tools: _, ...rest } = makeValidPolicy();

    expectPolicyIssues(rest, [
      { path: "enabled_tools", code: "missing_required" },
    ]);
  });

  it("rejects missing enabled_secret_handles", () => {
    const { enabled_secret_handles: _, ...rest } = makeValidPolicy();

    expectPolicyIssues(rest, [
      { path: "enabled_secret_handles", code: "missing_required" },
    ]);
  });

  it("rejects missing max_tool_runtime_ms", () => {
    const { max_tool_runtime_ms: _, ...rest } = makeValidPolicy();

    expectPolicyIssues(rest, [
      { path: "max_tool_runtime_ms", code: "missing_required" },
    ]);
  });

  it("rejects missing workspace_roots", () => {
    const { workspace_roots: _, ...rest } = makeValidPolicy();

    expectPolicyIssues(rest, [
      { path: "workspace_roots", code: "missing_required" },
    ]);
  });

  it("rejects missing trusted_local_mode", () => {
    const { trusted_local_mode: _, ...rest } = makeValidPolicy();

    expectPolicyIssues(rest, [
      { path: "trusted_local_mode", code: "missing_required" },
    ]);
  });

  // ── Missing workspace-root field tests ─────────────────────

  it("rejects missing bedrock in workspace_roots", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        working: "/workspace/working",
        artifacts: "/workspace/artifacts",
        logs: "/workspace/logs",
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.bedrock", code: "missing_required" },
    ]);
  });

  it("rejects missing working in workspace_roots", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        bedrock: "/workspace/bedrock",
        artifacts: "/workspace/artifacts",
        logs: "/workspace/logs",
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.working", code: "missing_required" },
    ]);
  });

  it("rejects missing artifacts in workspace_roots", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        bedrock: "/workspace/bedrock",
        working: "/workspace/working",
        logs: "/workspace/logs",
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.artifacts", code: "missing_required" },
    ]);
  });

  it("rejects missing logs in workspace_roots", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        bedrock: "/workspace/bedrock",
        working: "/workspace/working",
        artifacts: "/workspace/artifacts",
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.logs", code: "missing_required" },
    ]);
  });

  // ── Invalid type: enabled_tools ────────────────────────────

  it("rejects enabled_tools as a string instead of array", () => {
    expectPolicyIssues(makeValidPolicy({ enabled_tools: "tool_a" }), [
      { path: "enabled_tools", code: "invalid_type" },
    ]);
  });

  it("rejects enabled_tools as an object instead of array", () => {
    expectPolicyIssues(makeValidPolicy({ enabled_tools: { name: "tool_a" } }), [
      { path: "enabled_tools", code: "invalid_type" },
    ]);
  });

  it("rejects enabled_tools element as a number", () => {
    expectPolicyIssues(makeValidPolicy({ enabled_tools: ["tool_a", 42] }), [
      { path: "enabled_tools[1]", code: "invalid_type" },
    ]);
  });

  it("rejects enabled_tools element as a boolean", () => {
    expectPolicyIssues(makeValidPolicy({ enabled_tools: [true, "tool_a"] }), [
      { path: "enabled_tools[0]", code: "invalid_type" },
    ]);
  });

  it("rejects enabled_tools element as an empty string", () => {
    expectPolicyIssues(makeValidPolicy({ enabled_tools: ["", "tool_a"] }), [
      { path: "enabled_tools[0]", code: "invalid_type" },
    ]);
  });

  it("rejects enabled_tools element as an array", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_tools: [["nested"], "tool_a"] }),
      [{ path: "enabled_tools[0]", code: "invalid_type" }],
    );
  });

  it("rejects enabled_tools element as an object", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_tools: [{ name: "tool" }, "tool_a"] }),
      [{ path: "enabled_tools[0]", code: "invalid_type" }],
    );
  });

  // ── Invalid type: enabled_secret_handles ───────────────────

  it("rejects enabled_secret_handles as a string instead of array", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_secret_handles: "GITHUB_TOKEN" }),
      [{ path: "enabled_secret_handles", code: "invalid_type" }],
    );
  });

  it("rejects enabled_secret_handles as an object instead of array", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_secret_handles: { key: "GITHUB_TOKEN" } }),
      [{ path: "enabled_secret_handles", code: "invalid_type" }],
    );
  });

  it("rejects enabled_secret_handles element as a number", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_secret_handles: ["TOKEN", 123] }),
      [{ path: "enabled_secret_handles[1]", code: "invalid_type" }],
    );
  });

  it("rejects enabled_secret_handles element as a boolean", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_secret_handles: [false, "TOKEN"] }),
      [{ path: "enabled_secret_handles[0]", code: "invalid_type" }],
    );
  });

  it("rejects enabled_secret_handles element as an empty string", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_secret_handles: ["TOKEN", ""] }),
      [{ path: "enabled_secret_handles[1]", code: "invalid_type" }],
    );
  });

  it("rejects enabled_secret_handles element as an array", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_secret_handles: ["TOKEN", ["nested"]] }),
      [{ path: "enabled_secret_handles[1]", code: "invalid_type" }],
    );
  });

  it("rejects enabled_secret_handles element as an object", () => {
    expectPolicyIssues(
      makeValidPolicy({ enabled_secret_handles: [{ name: "tok" }, "TOKEN"] }),
      [{ path: "enabled_secret_handles[0]", code: "invalid_type" }],
    );
  });

  // ── Invalid type: max_tool_runtime_ms ──────────────────────

  it("rejects max_tool_runtime_ms as a string (invalid_integer)", () => {
    expectPolicyIssues(makeValidPolicy({ max_tool_runtime_ms: "30000" }), [
      { path: "max_tool_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_tool_runtime_ms as a float (invalid_integer)", () => {
    expectPolicyIssues(makeValidPolicy({ max_tool_runtime_ms: 30.5 }), [
      { path: "max_tool_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_tool_runtime_ms as a boolean (invalid_integer)", () => {
    expectPolicyIssues(makeValidPolicy({ max_tool_runtime_ms: true }), [
      { path: "max_tool_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_tool_runtime_ms as NaN (invalid_integer)", () => {
    expectPolicyIssues(makeValidPolicy({ max_tool_runtime_ms: NaN }), [
      { path: "max_tool_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_tool_runtime_ms as Infinity (invalid_integer)", () => {
    expectPolicyIssues(makeValidPolicy({ max_tool_runtime_ms: Infinity }), [
      { path: "max_tool_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_tool_runtime_ms = 0 (invalid_value)", () => {
    expectPolicyIssues(makeValidPolicy({ max_tool_runtime_ms: 0 }), [
      { path: "max_tool_runtime_ms", code: "invalid_value" },
    ]);
  });

  it("rejects max_tool_runtime_ms = -1 (invalid_value)", () => {
    expectPolicyIssues(makeValidPolicy({ max_tool_runtime_ms: -1 }), [
      { path: "max_tool_runtime_ms", code: "invalid_value" },
    ]);
  });

  // ── Invalid type: workspace_roots ──────────────────────────

  it("rejects workspace_roots as a string instead of object", () => {
    expectPolicyIssues(
      makeValidPolicy({ workspace_roots: "/some/path" }),
      [{ path: "workspace_roots", code: "invalid_type" }],
    );
  });

  it("rejects workspace_roots as an array instead of object", () => {
    expectPolicyIssues(
      makeValidPolicy({ workspace_roots: ["/some/path"] }),
      [{ path: "workspace_roots", code: "invalid_type" }],
    );
  });

  it("rejects workspace_roots as null instead of object", () => {
    expectPolicyIssues(
      makeValidPolicy({ workspace_roots: null }),
      [{ path: "workspace_roots", code: "invalid_type" }],
    );
  });

  // ── Invalid type: workspace_roots fields ───────────────────

  it("rejects workspace_roots.bedrock as a number", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        ...makeValidPolicy().workspace_roots,
        bedrock: 123,
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.bedrock", code: "invalid_type" },
    ]);
  });

  it("rejects workspace_roots.bedrock as a boolean", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        ...makeValidPolicy().workspace_roots,
        bedrock: true,
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.bedrock", code: "invalid_type" },
    ]);
  });

  it("rejects workspace_roots.bedrock as an array", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        ...makeValidPolicy().workspace_roots,
        bedrock: ["/path"],
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.bedrock", code: "invalid_type" },
    ]);
  });

  it("rejects workspace_roots.bedrock as an object", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        ...makeValidPolicy().workspace_roots,
        bedrock: { dir: "/path" },
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.bedrock", code: "invalid_type" },
    ]);
  });

  it("rejects workspace_roots.bedrock as an empty string", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        ...makeValidPolicy().workspace_roots,
        bedrock: "",
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.bedrock", code: "invalid_type" },
    ]);
  });

  // ── Invalid type: trusted_local_mode ───────────────────────

  it("rejects trusted_local_mode as a string \"true\"", () => {
    expectPolicyIssues(makeValidPolicy({ trusted_local_mode: "true" }), [
      { path: "trusted_local_mode", code: "invalid_type" },
    ]);
  });

  it("rejects trusted_local_mode as a string \"false\"", () => {
    expectPolicyIssues(makeValidPolicy({ trusted_local_mode: "false" }), [
      { path: "trusted_local_mode", code: "invalid_type" },
    ]);
  });

  it("rejects trusted_local_mode as number 0", () => {
    expectPolicyIssues(makeValidPolicy({ trusted_local_mode: 0 }), [
      { path: "trusted_local_mode", code: "invalid_type" },
    ]);
  });

  it("rejects trusted_local_mode as number 1", () => {
    expectPolicyIssues(makeValidPolicy({ trusted_local_mode: 1 }), [
      { path: "trusted_local_mode", code: "invalid_type" },
    ]);
  });

  it("rejects trusted_local_mode as null", () => {
    expectPolicyIssues(makeValidPolicy({ trusted_local_mode: null }), [
      { path: "trusted_local_mode", code: "invalid_type" },
    ]);
  });

  // ── Unknown key tests ──────────────────────────────────────

  it("rejects extra top-level key with unknown_key", () => {
    expectPolicyIssues(makeValidPolicy({ extra_field: "value" }), [
      { path: "extra_field", code: "unknown_key" },
    ]);
  });

  it("rejects extra key on workspace_roots with unknown_key", () => {
    const policy = makeValidPolicy({
      workspace_roots: {
        ...makeValidPolicy().workspace_roots,
        custom_root: "/custom/path",
      },
    });

    expectPolicyIssues(policy, [
      { path: "workspace_roots.custom_root", code: "unknown_key" },
    ]);
  });

  // ── Error class test ───────────────────────────────────────

  it("throws RuntimePolicyValidationError (instanceof check) on invalid input", () => {
    try {
      parseRuntimePolicyDTO({});
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimePolicyValidationError);
      return;
    }

    throw new Error("Expected parseRuntimePolicyDTO to throw.");
  });

  // ── Non-object top-level input ─────────────────────────────

  it("rejects null top-level input", () => {
    expectPolicyIssues(null, [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects string top-level input", () => {
    expectPolicyIssues("foo", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects number top-level input", () => {
    expectPolicyIssues(42, [
      { path: "$", code: "invalid_type" },
    ]);
  });

  // ── Multi-issue collection ─────────────────────────────────

  it("collects multiple validation issues in a single parse", () => {
    expectPolicyIssues({ trusted_local_mode: true }, [
      { path: "enabled_tools", code: "missing_required" },
      { path: "enabled_secret_handles", code: "missing_required" },
      { path: "max_tool_runtime_ms", code: "missing_required" },
      { path: "workspace_roots", code: "missing_required" },
    ]);
  });
});
