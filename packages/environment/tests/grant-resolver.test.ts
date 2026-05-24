import { describe, expect, it } from "vitest";

import type {
  ExecutionGrantPathPermission,
  RuntimePolicyDTO,
  ToolDefinition,
  WorkspaceRootsDTO,
} from "@argentum/contracts";

import { resolveGrant } from "../src/index.js";
import type { GrantResolution } from "../src/index.js";

// ── Test fixtures ───────────────────────────────────────────────

function makeWorkspaceRoots(override?: Partial<WorkspaceRootsDTO>): WorkspaceRootsDTO {
  return {
    bedrock: "/ws/bedrock",
    working: "/ws/working",
    artifacts: "/ws/artifacts",
    logs: "/ws/logs",
    ...override,
  };
}

function makePolicy(override?: Partial<RuntimePolicyDTO>): RuntimePolicyDTO {
  return {
    enabled_tools: ["read_file", "write_file", "shell_exec"],
    enabled_secret_handles: ["GITHUB_TOKEN", "OPENAI_API_KEY"],
    max_tool_runtime_ms: 60_000,
    workspace_roots: makeWorkspaceRoots(),
    trusted_local_mode: true,
    ...override,
  };
}

function makeToolDef(override?: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: "read_file",
    description: "Reads a file from the workspace.",
    input_schema: { type: "object", properties: {} },
    side_effect_level: "read_only",
    path_scope: "workspace",
    required_secret_handles: [],
    network_access: "deny",
    default_timeout_ms: 30_000,
    ...override,
  };
}

function pathPerm(
  root: ExecutionGrantPathPermission["root"],
  path: string,
  capabilities: ExecutionGrantPathPermission["capabilities"],
): ExecutionGrantPathPermission {
  return { root, path, capabilities };
}

// ── Helper to strip grant_id for structural comparisons ─────────

function withoutGrantId(grant: GrantResolution["grant"]) {
  const { grant_id: _, ...rest } = grant;
  return rest;
}

// ── Auto-allow path tests ───────────────────────────────────────

describe("resolveGrant — auto_allow", () => {
  it("grants auto_allow for a compliant tool with workspace scope", () => {
    const tool = makeToolDef({ path_scope: "workspace" });
    const policy = makePolicy();

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.approval_mode).toBe("auto_allow");
    expect(result.grant.cwd).toBe("/ws/working");
    expect(result.grant.network_policy).toBe("deny");
    expect(result.grant.max_runtime_ms).toBe(30_000);
    expect(result.grant.env_secret_handles).toEqual([]);

    // Canonical order: bedrock → working → artifacts → logs
    expect(result.grant.path_permissions).toEqual([
      pathPerm("bedrock", "/ws/bedrock", ["read"]),
      pathPerm("working", "/ws/working", ["read", "write"]),
      pathPerm("artifacts", "/ws/artifacts", ["read", "write"]),
      pathPerm("logs", "/ws/logs", ["append"]),
    ]);
  });

  it("grants working + artifacts for path_scope = 'working'", () => {
    const tool = makeToolDef({ path_scope: "working" });
    const policy = makePolicy();

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.path_permissions).toEqual([
      pathPerm("working", "/ws/working", ["read", "write"]),
      pathPerm("artifacts", "/ws/artifacts", ["read", "write"]),
    ]);
  });

  it("grants empty path_permissions for path_scope = 'none'", () => {
    const tool = makeToolDef({ path_scope: "none" });
    const policy = makePolicy();

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.path_permissions).toEqual([]);
  });

  it("grants auto_allow when no secrets are required", () => {
    const tool = makeToolDef({ required_secret_handles: [] });
    const policy = makePolicy({ enabled_secret_handles: [] });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.env_secret_handles).toEqual([]);
  });

  it("maps network_access = 'deny' to network_policy = 'deny'", () => {
    const tool = makeToolDef({ network_access: "deny" });
    const policy = makePolicy();

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.network_policy).toBe("deny");
  });

  it("maps network_access = 'inherit' to network_policy = 'inherit'", () => {
    const tool = makeToolDef({ network_access: "inherit" });
    const policy = makePolicy();

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.network_policy).toBe("inherit");
  });

  it("caps max_runtime_ms at policy max_tool_runtime_ms", () => {
    const tool = makeToolDef({ default_timeout_ms: 120_000 });
    const policy = makePolicy({ max_tool_runtime_ms: 60_000 });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.max_runtime_ms).toBe(60_000);
  });

  it("uses default_timeout_ms when it is lower than policy max", () => {
    const tool = makeToolDef({ default_timeout_ms: 10_000 });
    const policy = makePolicy({ max_tool_runtime_ms: 60_000 });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.max_runtime_ms).toBe(10_000);
  });

  it("sets cwd to workspace_roots.working", () => {
    const tool = makeToolDef();
    const policy = makePolicy({
      workspace_roots: makeWorkspaceRoots({ working: "/custom/working" }),
    });

    const result = resolveGrant(tool, policy);

    expect(result.grant.cwd).toBe("/custom/working");
  });
});

// ── Deny path tests ─────────────────────────────────────────────

describe("resolveGrant — deny", () => {
  it("denies when tool is not in enabled_tools", () => {
    const tool = makeToolDef({ name: "unknown_tool" });
    const policy = makePolicy();

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("deny");
    if (result.approval_mode !== "deny") {
      throw new Error("Expected deny");
    }
    expect(result.error_code).toBe("tool_disabled");
    expect(result.denial_reason).toContain("unknown_tool");
    expect(result.denial_reason).toContain("enabled_tools");
    expect(result.grant.approval_mode).toBe("deny");
    expect(result.grant.path_permissions).toEqual([]);
    expect(result.grant.env_secret_handles).toEqual([]);
    expect(result.grant.network_policy).toBe("deny");
    expect(result.grant.max_runtime_ms).toBe(0);
  });

  it("denies when a required secret is unavailable", () => {
    const tool = makeToolDef({
      required_secret_handles: ["MISSING_SECRET"],
    });
    const policy = makePolicy({
      enabled_secret_handles: ["GITHUB_TOKEN"],
    });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("deny");
    if (result.approval_mode !== "deny") {
      throw new Error("Expected deny");
    }
    expect(result.error_code).toBe("secret_unavailable");
    expect(result.denial_reason).toContain("MISSING_SECRET");
  });

  it("denies when trusted_local_mode is false (even if all other checks pass)", () => {
    const tool = makeToolDef();
    const policy = makePolicy({ trusted_local_mode: false });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("deny");
    if (result.approval_mode !== "deny") {
      throw new Error("Expected deny");
    }
    expect(result.error_code).toBe("policy_denied");
    expect(result.denial_reason).toContain("trusted_local_mode");
  });

  it("denies with all denied-grant defaults populated", () => {
    const tool = makeToolDef({ name: "disabled_tool" });
    const policy = makePolicy({
      enabled_tools: ["other_tool"],
      trusted_local_mode: true,
    });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("deny");
    if (result.approval_mode !== "deny") {
      throw new Error("Expected deny");
    }
    expect(result.grant.path_permissions).toEqual([]);
    expect(result.grant.env_secret_handles).toEqual([]);
    expect(result.grant.network_policy).toBe("deny");
    expect(result.grant.max_runtime_ms).toBe(0);
    expect(result.grant.approval_mode).toBe("deny");
    expect(result.grant.cwd).toBe("/ws/working");
  });
});

// ── Determinism tests ───────────────────────────────────────────

describe("resolveGrant — determinism", () => {
  it("produces identical fields (except grant_id) on repeated calls", () => {
    const tool = makeToolDef({ path_scope: "workspace" });
    const policy = makePolicy();

    const r1 = resolveGrant(tool, policy);
    const r2 = resolveGrant(tool, policy);

    expect(r1.approval_mode).toBe(r2.approval_mode);
    expect(withoutGrantId(r1.grant)).toEqual(withoutGrantId(r2.grant));
    // grant_id must be unique per call
    expect(r1.grant.grant_id).not.toBe(r2.grant.grant_id);
  });

  it("maintains canonical path_permissions array order (workspace)", () => {
    const tool = makeToolDef({ path_scope: "workspace" });
    const policy = makePolicy();

    const roots = ["bedrock", "working", "artifacts", "logs"] as const;
    for (let i = 0; i < 10; i++) {
      const result = resolveGrant(tool, policy);
      expect(result.grant.path_permissions.map((p) => p.root)).toEqual([
        ...roots,
      ]);
    }
  });

  it("maintains canonical path_permissions array order (working)", () => {
    const tool = makeToolDef({ path_scope: "working" });
    const policy = makePolicy();

    for (let i = 0; i < 10; i++) {
      const result = resolveGrant(tool, policy);
      expect(result.grant.path_permissions.map((p) => p.root)).toEqual([
        "working",
        "artifacts",
      ]);
    }
  });

  it("produces same denial fields on repeated calls", () => {
    const tool = makeToolDef({ name: "bad_tool" });
    const policy = makePolicy({ enabled_tools: ["other"] });

    const r1 = resolveGrant(tool, policy);
    const r2 = resolveGrant(tool, policy);

    expect(r1.approval_mode).toBe("deny");
    expect(r2.approval_mode).toBe("deny");
    if (r1.approval_mode !== "deny" || r2.approval_mode !== "deny") {
      throw new Error("Expected deny");
    }
    expect(r1.error_code).toBe(r2.error_code);
    expect(r1.denial_reason).toBe(r2.denial_reason);
    expect(withoutGrantId(r1.grant)).toEqual(withoutGrantId(r2.grant));
  });
});

// ── Edge case tests ─────────────────────────────────────────────

describe("resolveGrant — edge cases", () => {
  it("handles empty required_secret_handles + empty enabled_secret_handles", () => {
    const tool = makeToolDef({ required_secret_handles: [] });
    const policy = makePolicy({ enabled_secret_handles: [] });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.env_secret_handles).toEqual([]);
  });

  it("auto_allows path_scope = 'none' with trusted_local_mode = true", () => {
    const tool = makeToolDef({ path_scope: "none" });
    const policy = makePolicy({ trusted_local_mode: true });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.path_permissions).toEqual([]);
  });

  it("caps max_runtime_ms to 0 when policy max_tool_runtime_ms is 0", () => {
    const tool = makeToolDef({ default_timeout_ms: 30_000 });
    const policy = makePolicy({ max_tool_runtime_ms: 0 });

    const result = resolveGrant(tool, policy);

    expect(result.grant.max_runtime_ms).toBe(0);
  });

  it("intersects secrets correctly — available subset returned", () => {
    const tool = makeToolDef({
      required_secret_handles: ["GITHUB_TOKEN", "OPENAI_API_KEY"],
    });
    const policy = makePolicy({
      enabled_secret_handles: ["GITHUB_TOKEN"],
    });

    const result = resolveGrant(tool, policy);

    // OPENAI_API_KEY is missing → deny
    expect(result.approval_mode).toBe("deny");
    if (result.approval_mode !== "deny") {
      throw new Error("Expected deny");
    }
    expect(result.error_code).toBe("secret_unavailable");
    expect(result.denial_reason).toContain("OPENAI_API_KEY");
  });

  it("returns only the available secrets when all are available", () => {
    const tool = makeToolDef({
      required_secret_handles: ["GITHUB_TOKEN"],
    });
    const policy = makePolicy({
      enabled_secret_handles: ["GITHUB_TOKEN", "OPENAI_API_KEY"],
    });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    expect(result.grant.env_secret_handles).toEqual(["GITHUB_TOKEN"]);
  });

  it("preserves secret handle order from required_secret_handles", () => {
    const tool = makeToolDef({
      required_secret_handles: ["SECRET_B", "SECRET_A", "SECRET_C"],
    });
    const policy = makePolicy({
      enabled_secret_handles: ["SECRET_A", "SECRET_B", "SECRET_C"],
    });

    const result = resolveGrant(tool, policy);

    expect(result.approval_mode).toBe("auto_allow");
    // Order should match required_secret_handles order, not enabled order
    expect(result.grant.env_secret_handles).toEqual([
      "SECRET_B",
      "SECRET_A",
      "SECRET_C",
    ]);
  });
});

// ── Discriminated union narrowing ───────────────────────────────

describe("GrantResolution — type narrowing", () => {
  it("narrows to auto_allow branch via approval_mode discriminant", () => {
    const tool = makeToolDef();
    const policy = makePolicy();

    const result: GrantResolution = resolveGrant(tool, policy);

    if (result.approval_mode === "auto_allow") {
      // TypeScript should narrow: grant is available, denial_reason/error_code are not
      expect(result.grant.approval_mode).toBe("auto_allow");
      // @ts-expect-error: denial_reason should not exist on auto_allow branch
      void result.denial_reason;
    } else {
      expect.fail("Expected auto_allow");
    }
  });

  it("narrows to deny branch via approval_mode discriminant", () => {
    const tool = makeToolDef({ name: "no_such_tool" });
    const policy = makePolicy();

    const result: GrantResolution = resolveGrant(tool, policy);

    if (result.approval_mode === "deny") {
      expect(result.error_code).toBe("tool_disabled");
      expect(result.denial_reason).toBeTruthy();
      expect(result.grant.approval_mode).toBe("deny");
    } else {
      expect.fail("Expected deny");
    }
  });
});
