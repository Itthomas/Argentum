import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  Capability,
  ExecutionGrantDTO,
  ExecutionGrantPathPermission,
  PathRoot,
  WorkspaceRootsDTO,
} from "@argentum/contracts";

import {
  authorizeWorkspacePath,
  type WorkspacePathAuthorizationResult,
  type WorkspacePathRequest,
} from "../src/workspace-path-guard.js";

const originalCwd = process.cwd();
const ambientNoiseKey = "ARGENTUM_WORKSPACE_GUARD_TEST_NOISE";
const originalAmbientNoiseValue = process.env[ambientNoiseKey];
const tempDirectories: string[] = [];

afterEach(async () => {
  process.chdir(originalCwd);

  if (originalAmbientNoiseValue === undefined) {
    delete process.env[ambientNoiseKey];
  } else {
    process.env[ambientNoiseKey] = originalAmbientNoiseValue;
  }

  await Promise.all(tempDirectories.splice(0).map((dirPath) => rm(dirPath, { recursive: true, force: true })));
});

describe("authorizeWorkspacePath", () => {
  it("returns grant_denied before inspecting forbidden request paths", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      approval_mode: "deny",
      path_permissions: [makePermission("working", "relative/root", ["read"])],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "C:..\\escape.txt",
      capability: "write",
    });

    expectDenied(result, "grant_denied");
  });

  it("returns grant_denied before inspecting duplicate matching roots", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      approval_mode: "deny",
      path_permissions: [
        makePermission("working", workspaceRoots.working, ["read"]),
        makePermission("working", `${workspaceRoots.working}/project-a`, ["write"]),
      ],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "nested/file.txt",
      capability: "write",
    });

    expectDenied(result, "grant_denied");
  });

  it("allows bedrock reads without adding a helper-specific bedrock write rule", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);

    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "bedrock",
        relativePath: "prompts/system.md",
        capability: "read",
      }),
      "/workspace/bedrock/prompts/system.md",
    );

    expectDenied(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "bedrock",
        relativePath: "prompts/system.md",
        capability: "write",
      }),
      "permission_denied",
    );
  });

  it("allows working writes, artifacts writes, and logs append", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);

    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "working",
        relativePath: "notes/plan.md",
        capability: "write",
      }),
      "/workspace/working/notes/plan.md",
    );
    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "artifacts",
        relativePath: "tool-output.json",
        capability: "write",
      }),
      "/workspace/artifacts/tool-output.json",
    );
    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "logs",
        relativePath: "runtime.log",
        capability: "append",
      }),
      "/workspace/logs/runtime.log",
    );
  });

  it("denies ordinary policy cases for missing root permissions and missing capabilities", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [
        makePermission("bedrock", workspaceRoots.bedrock, ["read"]),
        makePermission("working", workspaceRoots.working, ["read", "write"]),
        makePermission("artifacts", workspaceRoots.artifacts, ["read", "write"]),
      ],
    });

    expectDenied(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "logs",
        relativePath: "runtime.log",
        capability: "append",
      }),
      "permission_denied",
    );
    expectDenied(
      authorizeWorkspacePath(workspaceRoots, makeGrant(workspaceRoots), {
        root: "logs",
        relativePath: "runtime.log",
        capability: "write",
      }),
      "permission_denied",
    );
  });

  it("treats duplicate root permissions as invalid_grant", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [
        makePermission("working", workspaceRoots.working, ["read"]),
        makePermission("working", `${workspaceRoots.working}/project-a`, ["write"]),
      ],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "nested/file.txt",
      capability: "write",
    });

    expectDenied(result, "invalid_grant");
  });
});

describe("authorizeWorkspacePath — grant root validation and alignment", () => {
  it.each([
    ["relative/root"],
    ["C:temp\\root"],
    ["\\temp\\root"],
  ])("denies malformed grant roots: %s", (grantRoot) => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", grantRoot, ["read"])],
    });

    expectDenied(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "working",
        relativePath: "file.txt",
        capability: "write",
      }),
      "invalid_grant",
    );
  });

  it("classifies malformed grant roots before capability matching", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "relative/root", ["read"])],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "file.txt",
      capability: "write",
    });

    expectDenied(result, "invalid_grant");
  });

  it("denies mislabeled working paths rooted under canonical bedrock before capability matching", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "/workspace/bedrock/project-a", ["read"])],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "file.txt",
      capability: "write",
    });

    expectDenied(result, "invalid_grant");
  });

  it("denies mislabeled bedrock paths rooted under canonical working before capability matching", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("bedrock", "/workspace/working/project-a", ["read"])],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "bedrock",
      relativePath: "file.txt",
      capability: "write",
    });

    expectDenied(result, "invalid_grant");
  });

  it("allows descendant grant roots under the canonical root in POSIX style", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "/workspace/working/project-a", ["read", "write"])],
    });

    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "working",
        relativePath: "nested/file.txt",
        capability: "write",
      }),
      "/workspace/working/project-a/nested/file.txt",
    );
  });

  it("allows descendant grant roots under the canonical root in Windows style", () => {
    const workspaceRoots = makeWorkspaceRoots({
      bedrock: "C:\\workspace\\bedrock",
      working: "C:\\workspace\\working",
      artifacts: "C:\\workspace\\artifacts",
      logs: "C:\\workspace\\logs",
    });
    const grant = makeGrant(workspaceRoots, {
      cwd: "C:\\workspace\\working",
      path_permissions: [makePermission("working", "C:\\workspace\\working\\project-a", ["read", "write"])],
    });

    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "working",
        relativePath: "nested\\file.txt",
        capability: "write",
      }),
      "C:\\workspace\\working\\project-a\\nested\\file.txt",
    );
  });

  it.each([
    ["/workspace/working-copy/project-a"],
    ["C:\\workspace\\working-copy\\project-a"],
  ])("denies sibling-prefix collisions for aligned root checks: %s", (grantRoot) => {
    const workspaceRoots = grantRoot.startsWith("C:")
      ? makeWorkspaceRoots({
          bedrock: "C:\\workspace\\bedrock",
          working: "C:\\workspace\\working",
          artifacts: "C:\\workspace\\artifacts",
          logs: "C:\\workspace\\logs",
        })
      : makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      cwd: workspaceRoots.working,
      path_permissions: [makePermission("working", grantRoot, ["read", "write"])],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "nested/file.txt",
      capability: "write",
    });

    expectDenied(result, "invalid_grant");
  });
});

describe("authorizeWorkspacePath — lexical relative path handling", () => {
  it.each([
    ["/tmp/x", "invalid_request_path"],
    ["C:\\temp\\x", "invalid_request_path"],
    ["C:temp\\file", "invalid_request_path"],
    ["c:..\\escape.txt", "invalid_request_path"],
    ["\\temp\\x", "invalid_request_path"],
    ["\\\\server\\share\\x", "invalid_request_path"],
    ["\\\\?\\C:\\foo", "invalid_request_path"],
    ["\\\\.\\COM1", "invalid_request_path"],
    ["../escape.txt", "path_escape"],
    ["..\\escape.txt", "path_escape"],
    ["../working-copy/file", "path_escape"],
    ["..\\working-copy\\file", "path_escape"],
  ] as const)("classifies denied request forms host-independently: %s", (relativePath, code) => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "/workspace/working/project-a", ["read", "write"])],
    });

    const result = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath,
      capability: "write",
    });

    expectDenied(result, code);
  });

  it("allows empty and dot-only relative paths to resolve to the grant root", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "/workspace/working/project-a", ["read", "write"])],
    });

    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "working",
        relativePath: "",
        capability: "write",
      }),
      "/workspace/working/project-a",
    );
    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "working",
        relativePath: ".",
        capability: "write",
      }),
      "/workspace/working/project-a",
    );
  });

  it("normalizes nested dot segments lexically", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "/workspace/working/project-a", ["read", "write"])],
    });

    expectAllowed(
      authorizeWorkspacePath(workspaceRoots, grant, {
        root: "working",
        relativePath: "./nested/./file.txt",
        capability: "write",
      }),
      "/workspace/working/project-a/nested/file.txt",
    );
  });

  it("normalizes slash and backslash separators to the same allowed path", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "/workspace/working/project-a", ["read", "write"])],
    });

    const slashResult = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "subdir/../file.txt",
      capability: "write",
    });
    const backslashResult = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      relativePath: "subdir\\..\\file.txt",
      capability: "write",
    });

    expectAllowed(slashResult, "/workspace/working/project-a/file.txt");
    expect(backslashResult).toEqual(slashResult);
  });

  it("resolves the same relative path under different roots to different absolute paths", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request = {
      relativePath: "shared/output.txt",
      capability: "write" as const,
    };

    const workingResult = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "working",
      ...request,
    });
    const artifactsResult = authorizeWorkspacePath(workspaceRoots, grant, {
      root: "artifacts",
      ...request,
    });

    expectAllowed(workingResult, "/workspace/working/shared/output.txt");
    expectAllowed(artifactsResult, "/workspace/artifacts/shared/output.txt");
    expect(artifactsResult).not.toEqual(workingResult);
  });
});

describe("authorizeWorkspacePath — deterministic ambient-state independence", () => {
  it("returns structurally identical results for repeated identical calls", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };

    const firstResult = authorizeWorkspacePath(workspaceRoots, grant, request);
    const secondResult = authorizeWorkspacePath(workspaceRoots, grant, request);

    expect(secondResult).toEqual(firstResult);
  });

  it("ignores network_policy when roots, permissions, and request stay constant", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const denyPolicyGrant = makeGrant(workspaceRoots, { network_policy: "deny" });
    const inheritPolicyGrant = makeGrant(workspaceRoots, { network_policy: "inherit" });
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };

    expect(authorizeWorkspacePath(workspaceRoots, inheritPolicyGrant, request)).toEqual(
      authorizeWorkspacePath(workspaceRoots, denyPolicyGrant, request),
    );
  });

  it("ignores env_secret_handles when roots, permissions, and request stay constant", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const withoutSecretsGrant = makeGrant(workspaceRoots, { env_secret_handles: [] });
    const withSecretsGrant = makeGrant(workspaceRoots, {
      env_secret_handles: ["provider/deepseek/default", "tool/github/token"],
    });
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };

    expect(authorizeWorkspacePath(workspaceRoots, withSecretsGrant, request)).toEqual(
      authorizeWorkspacePath(workspaceRoots, withoutSecretsGrant, request),
    );
  });

  it("ignores unrelated ambient process.env noise", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };
    const baseline = authorizeWorkspacePath(workspaceRoots, grant, request);

    process.env[ambientNoiseKey] = "changed-value";

    expect(authorizeWorkspacePath(workspaceRoots, grant, request)).toEqual(baseline);

    delete process.env[ambientNoiseKey];

    expect(authorizeWorkspacePath(workspaceRoots, grant, request)).toEqual(baseline);
  });
});

describe.sequential("authorizeWorkspacePath — cwd independence", () => {
  it("keeps valid grant outcomes stable across cwd changes", async () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };
    const firstCwd = await createTempDirectory();
    const secondCwd = await createTempDirectory();

    process.chdir(firstCwd);
    const firstResult = authorizeWorkspacePath(workspaceRoots, grant, request);

    process.chdir(secondCwd);
    const secondResult = authorizeWorkspacePath(workspaceRoots, grant, request);

    expect(secondResult).toEqual(firstResult);
  });

  it("keeps malformed-grant outcomes stable across cwd changes", async () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "relative/root", ["read", "write"])],
    });
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };
    const firstCwd = await createTempDirectory();
    const secondCwd = await createTempDirectory();

    process.chdir(firstCwd);
    const firstResult = authorizeWorkspacePath(workspaceRoots, grant, request);

    process.chdir(secondCwd);
    const secondResult = authorizeWorkspacePath(workspaceRoots, grant, request);

    expect(secondResult).toEqual(firstResult);
    expectDenied(secondResult, "invalid_grant");
  });

  it("keeps logical-area mislabel outcomes stable across cwd changes", async () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots, {
      path_permissions: [makePermission("working", "/workspace/bedrock/project-a", ["read", "write"])],
    });
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };
    const firstCwd = await createTempDirectory();
    const secondCwd = await createTempDirectory();

    process.chdir(firstCwd);
    const firstResult = authorizeWorkspacePath(workspaceRoots, grant, request);

    process.chdir(secondCwd);
    const secondResult = authorizeWorkspacePath(workspaceRoots, grant, request);

    expect(secondResult).toEqual(firstResult);
    expectDenied(secondResult, "invalid_grant");
  });
});

function makeWorkspaceRoots(override: Partial<WorkspaceRootsDTO> = {}): WorkspaceRootsDTO {
  return {
    bedrock: "/workspace/bedrock",
    working: "/workspace/working",
    artifacts: "/workspace/artifacts",
    logs: "/workspace/logs",
    ...override,
  };
}

function makeGrant(
  workspaceRoots: WorkspaceRootsDTO,
  override: Partial<ExecutionGrantDTO> = {},
): ExecutionGrantDTO {
  return {
    grant_id: "grant-001",
    cwd: workspaceRoots.working,
    path_permissions: [
      makePermission("bedrock", workspaceRoots.bedrock, ["read"]),
      makePermission("working", workspaceRoots.working, ["read", "write"]),
      makePermission("artifacts", workspaceRoots.artifacts, ["read", "write"]),
      makePermission("logs", workspaceRoots.logs, ["append"]),
    ],
    env_secret_handles: [],
    network_policy: "deny",
    approval_mode: "auto_allow",
    max_runtime_ms: 30_000,
    ...override,
  };
}

function makePermission(
  root: PathRoot,
  grantedPath: string,
  capabilities: readonly Capability[],
): ExecutionGrantPathPermission {
  return {
    root,
    path: grantedPath,
    capabilities,
  };
}

function expectAllowed(result: WorkspacePathAuthorizationResult, resolvedPath: string): void {
  expect(result).toEqual({
    status: "allowed",
    resolvedPath,
  });
}

function expectDenied(
  result: WorkspacePathAuthorizationResult,
  code: Exclude<WorkspacePathAuthorizationResult, { status: "allowed" }>["code"],
): void {
  expect(result).toEqual({
    status: "denied",
    code,
  });
}

async function createTempDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), "argentum-workspace-guard-"));

  tempDirectories.push(directoryPath);
  return directoryPath;
}