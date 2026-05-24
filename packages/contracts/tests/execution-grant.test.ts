import { describe, expect, it } from "vitest";

import type { ExecutionGrantDTO } from "../src/index.js";
import {
  ExecutionGrantValidationError,
  parseExecutionGrant,
} from "../src/index.js";

// ── Shared helpers ──────────────────────────────────────────────

function makeValidPathPermission(
  overrides: Record<string, unknown> = {},
) {
  return {
    root: "bedrock",
    path: "/workspace/bedrock",
    capabilities: ["read"],
    ...overrides,
  };
}

function makeValidGrant(overrides: Record<string, unknown> = {}) {
  return {
    grant_id: "grant-001",
    cwd: "/workspace",
    path_permissions: [makeValidPathPermission()],
    env_secret_handles: ["API_KEY"],
    network_policy: "inherit",
    approval_mode: "auto_allow",
    max_runtime_ms: 30000,
    ...overrides,
  };
}

function getGrantIssues(value: unknown) {
  try {
    parseExecutionGrant(value);
  } catch (error) {
    if (error instanceof ExecutionGrantValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected execution grant parsing to fail.");
}

function expectGrantIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getGrantIssues(value);

  expect(issues).toHaveLength(expected.length);
  expect(issues).toEqual(
    expect.arrayContaining(
      expected.map((issue) => expect.objectContaining(issue)),
    ),
  );
}

// ── Tests ───────────────────────────────────────────────────────

describe("parseExecutionGrant", () => {
  // ── Valid grants ───────────────────────────────────────────

  it("accepts a full valid grant with auto_allow and inherit", () => {
    const grant = makeValidGrant({
      approval_mode: "auto_allow",
      network_policy: "inherit",
    });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.grant_id).toBe("grant-001");
    expect(parsed.cwd).toBe("/workspace");
    expect(parsed.approval_mode).toBe("auto_allow");
    expect(parsed.network_policy).toBe("inherit");
    expect(parsed.max_runtime_ms).toBe(30000);
    expect(parsed.path_permissions).toHaveLength(1);
    expect(parsed.env_secret_handles).toEqual(["API_KEY"]);
  });

  it("accepts a full valid grant with deny approval and deny network", () => {
    const grant = makeValidGrant({
      approval_mode: "deny",
      network_policy: "deny",
    });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.approval_mode).toBe("deny");
    expect(parsed.network_policy).toBe("deny");
  });

  it("accepts a grant with empty path_permissions", () => {
    const grant = makeValidGrant({ path_permissions: [] });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.path_permissions).toEqual([]);
  });

  it("accepts a grant with empty env_secret_handles", () => {
    const grant = makeValidGrant({ env_secret_handles: [] });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.env_secret_handles).toEqual([]);
  });

  it("accepts path_permission entries for all four root literals", () => {
    const roots = ["bedrock", "working", "artifacts", "logs"] as const;
    const grant = makeValidGrant({
      path_permissions: roots.map((root) =>
        makeValidPathPermission({ root, path: `/${root}/data` }),
      ),
    });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.path_permissions).toHaveLength(4);
    for (let i = 0; i < roots.length; i += 1) {
      expect(parsed.path_permissions[i].root).toBe(roots[i]);
    }
  });

  it("accepts multiple path_permission entries with varying capability sets", () => {
    const grant = makeValidGrant({
      path_permissions: [
        makeValidPathPermission({
          root: "bedrock",
          path: "/bedrock/config",
          capabilities: ["read"],
        }),
        makeValidPathPermission({
          root: "working",
          path: "/working/output",
          capabilities: ["read", "write", "append"],
        }),
        makeValidPathPermission({
          root: "artifacts",
          path: "/artifacts/build",
          capabilities: ["write", "append"],
        }),
      ],
    });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.path_permissions).toHaveLength(3);
    expect(parsed.path_permissions[0].capabilities).toEqual(["read"]);
    expect(parsed.path_permissions[1].capabilities).toEqual([
      "read",
      "write",
      "append",
    ]);
    expect(parsed.path_permissions[2].capabilities).toEqual(["write", "append"]);
  });

  it("accepts max_runtime_ms = 1 as minimum positive integer", () => {
    const grant = makeValidGrant({ max_runtime_ms: 1 });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.max_runtime_ms).toBe(1);
  });

  // ── Required-field missing tests ───────────────────────────

  it("rejects missing grant_id", () => {
    const { grant_id: _, ...rest } = makeValidGrant();

    expectGrantIssues(rest, [
      { path: "grant_id", code: "missing_required" },
    ]);
  });

  it("rejects missing cwd", () => {
    const { cwd: _, ...rest } = makeValidGrant();

    expectGrantIssues(rest, [
      { path: "cwd", code: "missing_required" },
    ]);
  });

  it("rejects missing path_permissions", () => {
    const { path_permissions: _, ...rest } = makeValidGrant();

    expectGrantIssues(rest, [
      { path: "path_permissions", code: "missing_required" },
    ]);
  });

  it("rejects missing env_secret_handles", () => {
    const { env_secret_handles: _, ...rest } = makeValidGrant();

    expectGrantIssues(rest, [
      { path: "env_secret_handles", code: "missing_required" },
    ]);
  });

  it("rejects missing network_policy", () => {
    const { network_policy: _, ...rest } = makeValidGrant();

    expectGrantIssues(rest, [
      { path: "network_policy", code: "missing_required" },
    ]);
  });

  it("rejects missing approval_mode", () => {
    const { approval_mode: _, ...rest } = makeValidGrant();

    expectGrantIssues(rest, [
      { path: "approval_mode", code: "missing_required" },
    ]);
  });

  it("rejects missing max_runtime_ms", () => {
    const { max_runtime_ms: _, ...rest } = makeValidGrant();

    expectGrantIssues(rest, [
      { path: "max_runtime_ms", code: "missing_required" },
    ]);
  });

  it("rejects bulk missing all fields with multiple missing_required issues", () => {
    expectGrantIssues({}, [
      { path: "grant_id", code: "missing_required" },
      { path: "cwd", code: "missing_required" },
      { path: "path_permissions", code: "missing_required" },
      { path: "env_secret_handles", code: "missing_required" },
      { path: "network_policy", code: "missing_required" },
      { path: "approval_mode", code: "missing_required" },
      { path: "max_runtime_ms", code: "missing_required" },
    ]);
  });

  // ── Non-coercion: grant_id ─────────────────────────────────

  it("rejects grant_id when it is a number instead of a string", () => {
    expectGrantIssues(makeValidGrant({ grant_id: 123 }), [
      { path: "grant_id", code: "invalid_type" },
    ]);
  });

  it("rejects grant_id when it is a boolean instead of a string", () => {
    expectGrantIssues(makeValidGrant({ grant_id: true }), [
      { path: "grant_id", code: "invalid_type" },
    ]);
  });

  it("rejects grant_id when it is an array instead of a string", () => {
    expectGrantIssues(makeValidGrant({ grant_id: ["not", "a", "string"] }), [
      { path: "grant_id", code: "invalid_type" },
    ]);
  });

  it("rejects grant_id when it is an object instead of a string", () => {
    expectGrantIssues(makeValidGrant({ grant_id: { nested: "value" } }), [
      { path: "grant_id", code: "invalid_type" },
    ]);
  });

  it("rejects grant_id when it is an empty string", () => {
    expectGrantIssues(makeValidGrant({ grant_id: "" }), [
      { path: "grant_id", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: cwd ──────────────────────────────────────

  it("rejects cwd when it is a number instead of a string", () => {
    expectGrantIssues(makeValidGrant({ cwd: 999 }), [
      { path: "cwd", code: "invalid_type" },
    ]);
  });

  it("rejects cwd when it is a boolean instead of a string", () => {
    expectGrantIssues(makeValidGrant({ cwd: false }), [
      { path: "cwd", code: "invalid_type" },
    ]);
  });

  it("rejects cwd when it is an array instead of a string", () => {
    expectGrantIssues(makeValidGrant({ cwd: ["/tmp"] }), [
      { path: "cwd", code: "invalid_type" },
    ]);
  });

  it("rejects cwd when it is an object instead of a string", () => {
    expectGrantIssues(makeValidGrant({ cwd: { dir: "/tmp" } }), [
      { path: "cwd", code: "invalid_type" },
    ]);
  });

  it("rejects cwd when it is an empty string", () => {
    expectGrantIssues(makeValidGrant({ cwd: "" }), [
      { path: "cwd", code: "invalid_type" },
    ]);
  });

  // ── Non-coercion: max_runtime_ms ───────────────────────────

  it("rejects max_runtime_ms when it is a string (invalid_integer)", () => {
    expectGrantIssues(makeValidGrant({ max_runtime_ms: "30000" }), [
      { path: "max_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_runtime_ms when it is a float (invalid_integer)", () => {
    expectGrantIssues(makeValidGrant({ max_runtime_ms: 30.5 }), [
      { path: "max_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_runtime_ms when it is a boolean (invalid_integer)", () => {
    expectGrantIssues(makeValidGrant({ max_runtime_ms: true }), [
      { path: "max_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_runtime_ms when it is NaN (invalid_integer)", () => {
    expectGrantIssues(makeValidGrant({ max_runtime_ms: NaN }), [
      { path: "max_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_runtime_ms when it is Infinity (invalid_integer)", () => {
    expectGrantIssues(makeValidGrant({ max_runtime_ms: Infinity }), [
      { path: "max_runtime_ms", code: "invalid_integer" },
    ]);
  });

  it("rejects max_runtime_ms = 0 (invalid_value)", () => {
    expectGrantIssues(makeValidGrant({ max_runtime_ms: 0 }), [
      { path: "max_runtime_ms", code: "invalid_value" },
    ]);
  });

  it("rejects max_runtime_ms negative integer (invalid_value)", () => {
    expectGrantIssues(makeValidGrant({ max_runtime_ms: -1 }), [
      { path: "max_runtime_ms", code: "invalid_value" },
    ]);
  });

  // ── Invalid literal: network_policy ────────────────────────

  it("rejects network_policy with unknown string literal", () => {
    expectGrantIssues(makeValidGrant({ network_policy: "allow_all" }), [
      { path: "network_policy", code: "invalid_literal" },
    ]);
  });

  it("rejects network_policy with wrong type (number)", () => {
    expectGrantIssues(makeValidGrant({ network_policy: 42 }), [
      { path: "network_policy", code: "invalid_type" },
    ]);
  });

  // ── Invalid literal: approval_mode ─────────────────────────

  it("rejects approval_mode with unknown string literal", () => {
    expectGrantIssues(makeValidGrant({ approval_mode: "prompt" }), [
      { path: "approval_mode", code: "invalid_literal" },
    ]);
  });

  it("rejects approval_mode with wrong type (boolean)", () => {
    expectGrantIssues(makeValidGrant({ approval_mode: false }), [
      { path: "approval_mode", code: "invalid_type" },
    ]);
  });

  // ── Invalid array: path_permissions ────────────────────────

  it("rejects path_permissions when it is an object instead of array", () => {
    expectGrantIssues(makeValidGrant({ path_permissions: { root: "bedrock" } }), [
      { path: "path_permissions", code: "invalid_type" },
    ]);
  });

  it("rejects path_permissions when it is a string instead of array", () => {
    expectGrantIssues(makeValidGrant({ path_permissions: "bedrock" }), [
      { path: "path_permissions", code: "invalid_type" },
    ]);
  });

  it("rejects path_permissions when it is a number instead of array", () => {
    expectGrantIssues(makeValidGrant({ path_permissions: 42 }), [
      { path: "path_permissions", code: "invalid_type" },
    ]);
  });

  // ── Invalid array: env_secret_handles ──────────────────────

  it("rejects env_secret_handles when it is an object instead of array", () => {
    expectGrantIssues(
      makeValidGrant({ env_secret_handles: { key: "API_KEY" } }),
      [{ path: "env_secret_handles", code: "invalid_type" }],
    );
  });

  it("rejects env_secret_handles when it is a string instead of array", () => {
    expectGrantIssues(makeValidGrant({ env_secret_handles: "API_KEY" }), [
      { path: "env_secret_handles", code: "invalid_type" },
    ]);
  });

  it("rejects env_secret_handles when it is a number instead of array", () => {
    expectGrantIssues(makeValidGrant({ env_secret_handles: 123 }), [
      { path: "env_secret_handles", code: "invalid_type" },
    ]);
  });

  it("rejects env_secret_handles containing a number element", () => {
    expectGrantIssues(
      makeValidGrant({ env_secret_handles: ["API_KEY", 42] }),
      [{ path: "env_secret_handles[1]", code: "invalid_type" }],
    );
  });

  it("rejects env_secret_handles containing a boolean element", () => {
    expectGrantIssues(
      makeValidGrant({ env_secret_handles: [true, "API_KEY"] }),
      [{ path: "env_secret_handles[0]", code: "invalid_type" }],
    );
  });

  it("rejects env_secret_handles containing a null element", () => {
    expectGrantIssues(
      makeValidGrant({ env_secret_handles: [null, "API_KEY"] }),
      [{ path: "env_secret_handles[0]", code: "invalid_type" }],
    );
  });

  it("rejects env_secret_handles containing an empty-string element", () => {
    expectGrantIssues(
      makeValidGrant({ env_secret_handles: ["API_KEY", ""] }),
      [{ path: "env_secret_handles[1]", code: "invalid_type" }],
    );
  });

  // ── Path-permission entry: valid ───────────────────────────

  it("accepts a path-permission entry with root=bedrock and capabilities=[read]", () => {
    const grant = makeValidGrant({
      path_permissions: [
        makeValidPathPermission({
          root: "bedrock",
          path: "/workspace/bedrock",
          capabilities: ["read"],
        }),
      ],
    });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.path_permissions[0].root).toBe("bedrock");
    expect(parsed.path_permissions[0].path).toBe("/workspace/bedrock");
    expect(parsed.path_permissions[0].capabilities).toEqual(["read"]);
  });

  it("accepts a path-permission entry with all three capabilities", () => {
    const grant = makeValidGrant({
      path_permissions: [
        makeValidPathPermission({
          capabilities: ["read", "write", "append"],
        }),
      ],
    });
    const parsed = parseExecutionGrant(grant);

    expect(parsed.path_permissions[0].capabilities).toEqual([
      "read",
      "write",
      "append",
    ]);
  });

  // ── Path-permission entry: missing fields ──────────────────

  it("rejects missing root in path_permission entry", () => {
    const { root: _, ...entry } = makeValidPathPermission();

    expectGrantIssues(makeValidGrant({ path_permissions: [entry] }), [
      { path: "path_permissions[0].root", code: "missing_required" },
    ]);
  });

  it("rejects missing path in path_permission entry", () => {
    const { path: _, ...entry } = makeValidPathPermission();

    expectGrantIssues(makeValidGrant({ path_permissions: [entry] }), [
      { path: "path_permissions[0].path", code: "missing_required" },
    ]);
  });

  it("rejects missing capabilities in path_permission entry", () => {
    const { capabilities: _, ...entry } = makeValidPathPermission();

    expectGrantIssues(makeValidGrant({ path_permissions: [entry] }), [
      { path: "path_permissions[0].capabilities", code: "missing_required" },
    ]);
  });

  // ── Path-permission entry: invalid root literal ────────────

  it("rejects unknown root literal in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [
          makeValidPathPermission({ root: "network" }),
        ],
      }),
      [{ path: "path_permissions[0].root", code: "invalid_literal" }],
    );
  });

  // ── Path-permission entry: invalid capability literal ──────

  it("rejects unknown capability literal in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [
          makeValidPathPermission({ capabilities: ["read", "execute"] }),
        ],
      }),
      [{ path: "path_permissions[0].capabilities[1]", code: "invalid_literal" }],
    );
  });

  // ── Path-permission entry: empty capabilities ──────────────

  it("rejects empty capabilities array in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [
          makeValidPathPermission({ capabilities: [] }),
        ],
      }),
      [{ path: "path_permissions[0].capabilities", code: "empty_array" }],
    );
  });

  it("rejects capabilities as a string in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [
          makeValidPathPermission({ capabilities: "read" }),
        ],
      }),
      [{ path: "path_permissions[0].capabilities", code: "invalid_type" }],
    );
  });

  it("rejects capabilities as a number in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [
          makeValidPathPermission({ capabilities: 42 }),
        ],
      }),
      [{ path: "path_permissions[0].capabilities", code: "invalid_type" }],
    );
  });

  it("rejects capabilities as an object in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [
          makeValidPathPermission({ capabilities: { read: true } }),
        ],
      }),
      [{ path: "path_permissions[0].capabilities", code: "invalid_type" }],
    );
  });

  // ── Path-permission entry: non-object element ──────────────

  it("rejects a string element in path_permissions array", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: ["not-an-object"],
      }),
      [{ path: "path_permissions[0]", code: "invalid_type" }],
    );
  });

  // ── Path-permission entry: path non-coercion ───────────────

  it("rejects path as a number in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [makeValidPathPermission({ path: 123 })],
      }),
      [{ path: "path_permissions[0].path", code: "invalid_type" }],
    );
  });

  it("rejects path as a boolean in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [makeValidPathPermission({ path: true })],
      }),
      [{ path: "path_permissions[0].path", code: "invalid_type" }],
    );
  });

  it("rejects path as an empty string in path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [makeValidPathPermission({ path: "" })],
      }),
      [{ path: "path_permissions[0].path", code: "invalid_type" }],
    );
  });

  // ── Path-permission entry: unknown keys ────────────────────

  it("rejects unknown key on path_permission entry", () => {
    expectGrantIssues(
      makeValidGrant({
        path_permissions: [
          makeValidPathPermission({ extra_field: "should not be here" }),
        ],
      }),
      [{ path: "path_permissions[0].extra_field", code: "unknown_key" }],
    );
  });

  // ── Unknown keys: top-level ────────────────────────────────

  it("rejects unknown key on top-level grant object", () => {
    expectGrantIssues(makeValidGrant({ extra: "unexpected" }), [
      { path: "extra", code: "unknown_key" },
    ]);
  });

  // ── Wrong top-level type ───────────────────────────────────

  it("rejects string input instead of object", () => {
    expectGrantIssues("not an object", [
      { path: "$", code: "invalid_type" },
    ]);
  });

  it("rejects number input instead of object", () => {
    expectGrantIssues(42, [{ path: "$", code: "invalid_type" }]);
  });

  it("rejects array input instead of object", () => {
    expectGrantIssues([1, 2, 3], [{ path: "$", code: "invalid_type" }]);
  });

  it("rejects null input instead of object", () => {
    expectGrantIssues(null, [{ path: "$", code: "invalid_type" }]);
  });

  // ── Entrypoint smoke ───────────────────────────────────────

  it("exposes ExecutionGrantValidationError as catchable", () => {
    let caught = false;

    try {
      parseExecutionGrant({});
    } catch (error) {
      caught = error instanceof ExecutionGrantValidationError;
    }

    expect(caught).toBe(true);
  });

  it("returns a frozen result that cannot be mutated", () => {
    const grant = makeValidGrant();
    const parsed = parseExecutionGrant(grant);

    expect(() => {
      (parsed as Record<string, unknown>).grant_id = "hacked";
    }).toThrow();
  });
});
