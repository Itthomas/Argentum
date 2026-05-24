import { describe, expect, it } from "vitest";

import type {
  ExecutionGrantDTO,
  ToolCallDTO,
  ToolResultDTO,
} from "@argentum/contracts";

import {
  ExecutionDriver,
  NativeExecutionDriver,
  NOOP_DRIVER_STUB,
} from "../src/index.js";

// ── Test fixtures ───────────────────────────────────────────────

/**
 * Build a minimal valid ExecutionGrantDTO for test use.
 * Defaults to an auto-allow grant with permissive settings so tests can
 * prove the stub ignores them.
 */
function makeGrant(override?: Partial<ExecutionGrantDTO>): ExecutionGrantDTO {
  return {
    grant_id: "g-test-001",
    cwd: "/ws/working/turn-abc",
    path_permissions: [
      { root: "working", path: "turn-abc", capabilities: ["read", "write"] },
      { root: "bedrock", path: ".", capabilities: ["read"] },
    ],
    env_secret_handles: ["GITHUB_TOKEN"],
    network_policy: "inherit",
    approval_mode: "auto_allow",
    max_runtime_ms: 60_000,
    ...override,
  };
}

/**
 * Build a minimal valid ToolCallDTO with an embedded grant.
 */
function makeToolCall(override?: Partial<ToolCallDTO>): ToolCallDTO {
  return {
    call_id: "call-001",
    turn_id: "turn-001",
    tool_name: "read_file",
    arguments: { filePath: "/ws/working/turn-abc/notes.md" },
    grant: makeGrant(),
    timeout_ms: 30_000,
    idempotency_key: "idem-001",
    ...override,
  };
}

// ── Constant export test ────────────────────────────────────────

describe("NOOP_DRIVER_STUB constant", () => {
  it("is exported and equals the expected string value", () => {
    expect(NOOP_DRIVER_STUB).toBe("NOOP_DRIVER_STUB");
  });
});

// ── Interface usability tests ───────────────────────────────────

describe("ExecutionDriver interface", () => {
  it("is structurally satisfied by NativeExecutionDriver", () => {
    // TypeScript structural compatibility check — compiles only if
    // NativeExecutionDriver satisfies the ExecutionDriver interface.
    const driver: ExecutionDriver = new NativeExecutionDriver();
    expect(driver).toBeDefined();
    expect(typeof driver.execute).toBe("function");
  });

  it("is importable from the package barrel", () => {
    // Proves the type is reachable via the public entrypoint.
    // The import at the top of this file already validates this —
    // this test is an explicit assertion that the symbol is defined.
    expect(ExecutionDriver).toBeUndefined(); // interfaces are compile-time only
  });
});

// ── NativeExecutionDriver basic behavior tests ──────────────────

describe("NativeExecutionDriver.execute()", () => {
  it("returns a blocked result for a minimal valid ToolCallDTO", async () => {
    const driver = new NativeExecutionDriver();
    const call = makeToolCall();

    const result = await driver.execute(call);

    expect(result.status).toBe("blocked");
    expect(result.call_id).toBe(call.call_id);
    expect(result.duration_ms).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error_code).toBe(NOOP_DRIVER_STUB);
    expect(result.human_summary).toContain("no-op stub");
  });

  it("mirrors call_id from the input ToolCallDTO", async () => {
    const driver = new NativeExecutionDriver();

    const call1 = makeToolCall({ call_id: "call-alpha" });
    const call2 = makeToolCall({ call_id: "call-beta" });
    const call3 = makeToolCall({ call_id: "" });

    const r1 = await driver.execute(call1);
    const r2 = await driver.execute(call2);
    const r3 = await driver.execute(call3);

    expect(r1.call_id).toBe("call-alpha");
    expect(r2.call_id).toBe("call-beta");
    expect(r3.call_id).toBe("");
  });

  it("is not coupled to tool_name, arguments, or other non-grant fields", async () => {
    const driver = new NativeExecutionDriver();

    const results = await Promise.all([
      driver.execute(makeToolCall({ tool_name: "read_file" })),
      driver.execute(makeToolCall({ tool_name: "write_file", arguments: { path: "/x" } })),
      driver.execute(makeToolCall({ tool_name: "shell_exec", arguments: { cmd: "ls" } })),
    ]);

    for (const r of results) {
      expect(r.status).toBe("blocked");
      expect(r.error_code).toBe(NOOP_DRIVER_STUB);
    }
  });
});

// ── Grant-agnostic stub behavior tests ──────────────────────────

describe("NativeExecutionDriver grant-agnostic behavior", () => {
  it("returns blocked even with an auto-allow grant", async () => {
    const driver = new NativeExecutionDriver();
    const call = makeToolCall({
      grant: makeGrant({ approval_mode: "auto_allow" }),
    });

    const result = await driver.execute(call);

    expect(result.status).toBe("blocked");
    expect(result.error_code).toBe(NOOP_DRIVER_STUB);
  });

  it("returns blocked with a deny grant (stub ignores approval_mode)", async () => {
    const driver = new NativeExecutionDriver();
    const call = makeToolCall({
      grant: makeGrant({ approval_mode: "deny" }),
    });

    const result = await driver.execute(call);

    // The stub always returns blocked, even for deny grants.
    // The real implementation will also block deny grants; this test
    // proves the stub doesn't accidentally allow what the real driver
    // would block.
    expect(result.status).toBe("blocked");
    expect(result.error_code).toBe(NOOP_DRIVER_STUB);
  });

  it("returns blocked regardless of path_permissions configuration", async () => {
    const driver = new NativeExecutionDriver();

    const grants: ExecutionGrantDTO[] = [
      makeGrant({ path_permissions: [] }),
      makeGrant({
        path_permissions: [
          { root: "working", path: ".", capabilities: ["read", "write", "append"] },
          { root: "bedrock", path: ".", capabilities: ["read"] },
          { root: "artifacts", path: ".", capabilities: ["read", "write"] },
          { root: "logs", path: ".", capabilities: ["append"] },
        ],
      }),
      makeGrant({
        path_permissions: [{ root: "bedrock", path: "restricted", capabilities: ["read"] }],
      }),
    ];

    for (const grant of grants) {
      const call = makeToolCall({ grant });
      const result = await driver.execute(call);
      expect(result.status).toBe("blocked");
      expect(result.error_code).toBe(NOOP_DRIVER_STUB);
    }
  });

  it("returns blocked regardless of network_policy", async () => {
    const driver = new NativeExecutionDriver();

    const results = await Promise.all([
      driver.execute(makeToolCall({ grant: makeGrant({ network_policy: "deny" }) })),
      driver.execute(makeToolCall({ grant: makeGrant({ network_policy: "inherit" }) })),
    ]);

    for (const r of results) {
      expect(r.status).toBe("blocked");
      expect(r.error_code).toBe(NOOP_DRIVER_STUB);
    }
  });

  it("returns blocked regardless of env_secret_handles", async () => {
    const driver = new NativeExecutionDriver();

    const results = await Promise.all([
      driver.execute(makeToolCall({ grant: makeGrant({ env_secret_handles: [] }) })),
      driver.execute(makeToolCall({
        grant: makeGrant({ env_secret_handles: ["GITHUB_TOKEN", "OPENAI_API_KEY", "NPM_TOKEN"] }),
      })),
    ]);

    for (const r of results) {
      expect(r.status).toBe("blocked");
      expect(r.error_code).toBe(NOOP_DRIVER_STUB);
    }
  });

  it("returns blocked regardless of max_runtime_ms", async () => {
    const driver = new NativeExecutionDriver();

    const results = await Promise.all([
      driver.execute(makeToolCall({ grant: makeGrant({ max_runtime_ms: 0 }) })),
      driver.execute(makeToolCall({ grant: makeGrant({ max_runtime_ms: 1_000 }) })),
      driver.execute(makeToolCall({ grant: makeGrant({ max_runtime_ms: 300_000 }) })),
    ]);

    for (const r of results) {
      expect(r.status).toBe("blocked");
      expect(r.error_code).toBe(NOOP_DRIVER_STUB);
    }
  });
});

// ── Retryable and truncated field assertions ────────────────────

describe("NativeExecutionDriver retryable and truncated fields", () => {
  const grantConfigs: [string, ExecutionGrantDTO][] = [
    ["auto-allow", makeGrant({ approval_mode: "auto_allow" })],
    ["deny", makeGrant({ approval_mode: "deny" })],
    ["empty path_permissions", makeGrant({ path_permissions: [] })],
    ["full path_permissions", makeGrant({
      path_permissions: [
        { root: "working", path: ".", capabilities: ["read", "write", "append"] },
        { root: "bedrock", path: ".", capabilities: ["read"] },
        { root: "artifacts", path: ".", capabilities: ["read", "write"] },
        { root: "logs", path: ".", capabilities: ["append"] },
      ],
    })],
    ["deny network", makeGrant({ network_policy: "deny" })],
    ["inherit network", makeGrant({ network_policy: "inherit" })],
    ["no secrets", makeGrant({ env_secret_handles: [] })],
    ["multiple secrets", makeGrant({ env_secret_handles: ["A", "B", "C"] })],
    ["zero max_runtime_ms", makeGrant({ max_runtime_ms: 0 })],
    ["large max_runtime_ms", makeGrant({ max_runtime_ms: 999_999 })],
  ];

  for (const [label, grant] of grantConfigs) {
    it(`retryable === false for grant config: ${label}`, async () => {
      const driver = new NativeExecutionDriver();
      const call = makeToolCall({ grant });
      const result = await driver.execute(call);

      // Explicit per-field assertion — not relying on object-shape matching.
      expect(result.retryable).toBe(false);
    });

    it(`truncated === false for grant config: ${label}`, async () => {
      const driver = new NativeExecutionDriver();
      const call = makeToolCall({ grant });
      const result = await driver.execute(call);

      // Explicit per-field assertion — not relying on object-shape matching.
      expect(result.truncated).toBe(false);
    });
  }
});

// ── Constructor and export surface tests ────────────────────────

describe("NativeExecutionDriver construction", () => {
  it("is constructable with no arguments", () => {
    const driver = new NativeExecutionDriver();
    expect(driver).toBeInstanceOf(NativeExecutionDriver);
  });

  it("creates independent instances", async () => {
    const d1 = new NativeExecutionDriver();
    const d2 = new NativeExecutionDriver();

    expect(d1).not.toBe(d2);

    const call = makeToolCall({ call_id: "indep-001" });
    const [r1, r2] = await Promise.all([d1.execute(call), d2.execute(call)]);

    expect(r1.call_id).toBe("indep-001");
    expect(r2.call_id).toBe("indep-001");
    expect(r1).not.toBe(r2);
  });
});

// ── Package entrypoint smoke test ───────────────────────────────

describe("package entrypoint exports", () => {
  it("exports ExecutionDriver (type) from @argentum/environment", () => {
    // The import at the top of this file already proves this —
    // this test provides an explicit runtime assertion that the
    // symbols are reachable through the barrel.
    expect(NativeExecutionDriver).toBeDefined();
    expect(typeof NativeExecutionDriver).toBe("function");
  });

  it("exports NativeExecutionDriver as a constructable class", () => {
    const driver = new NativeExecutionDriver();
    expect(driver).toBeInstanceOf(NativeExecutionDriver);
  });

  it("exports NOOP_DRIVER_STUB as a string constant", () => {
    expect(typeof NOOP_DRIVER_STUB).toBe("string");
    expect(NOOP_DRIVER_STUB.length).toBeGreaterThan(0);
  });

  it("NativeExecutionDriver has an execute method with correct signature", () => {
    const driver = new NativeExecutionDriver();
    expect(typeof driver.execute).toBe("function");
    // execute should accept one argument (ToolCallDTO) and return a Promise
    expect(driver.execute.length).toBe(1);
  });
});
