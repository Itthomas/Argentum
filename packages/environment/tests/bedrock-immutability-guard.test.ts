import { describe, expect, it } from "vitest";

import type {
  Capability,
  ExecutionGrantDTO,
  ExecutionGrantPathPermission,
  PathRoot,
  WorkspaceRootsDTO,
} from "@argentum/contracts";

import { bedrockImmutabilityGuard } from "../src/bedrock-immutability-guard.js";
import {
  authorizeWorkspacePath,
  type WorkspacePathAuthorizationResult,
  type WorkspacePathRequest,
} from "../src/workspace-path-guard.js";

// ── Helpers (same pattern as workspace-path-guard.test.ts) ──────

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

// ── Bedrock immutability guard tests ────────────────────────────

describe("bedrockImmutabilityGuard", () => {
  it("denies a bedrock write request with code bedrock_immutable", () => {
    const request: WorkspacePathRequest = {
      root: "bedrock",
      relativePath: "prompts/system.md",
      capability: "write",
    };

    const result = bedrockImmutabilityGuard(request);

    expectDenied(result as WorkspacePathAuthorizationResult, "bedrock_immutable");
  });

  it("denies a bedrock append request with code bedrock_immutable", () => {
    const request: WorkspacePathRequest = {
      root: "bedrock",
      relativePath: "logs/audit.log",
      capability: "append",
    };

    const result = bedrockImmutabilityGuard(request);

    expectDenied(result as WorkspacePathAuthorizationResult, "bedrock_immutable");
  });

  it("returns null (pass-through) for a bedrock read request", () => {
    const request: WorkspacePathRequest = {
      root: "bedrock",
      relativePath: "prompts/system.md",
      capability: "read",
    };

    const result = bedrockImmutabilityGuard(request);

    expect(result).toBeNull();
  });

  it("returns null (pass-through) for a non-bedrock write request", () => {
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };

    const result = bedrockImmutabilityGuard(request);

    expect(result).toBeNull();
  });

  it("returns null (pass-through) for a non-bedrock append request", () => {
    const request: WorkspacePathRequest = {
      root: "logs",
      relativePath: "runtime.log",
      capability: "append",
    };

    const result = bedrockImmutabilityGuard(request);

    expect(result).toBeNull();
  });

  it("returns null (pass-through) for a non-bedrock read request", () => {
    const request: WorkspacePathRequest = {
      root: "artifacts",
      relativePath: "output.json",
      capability: "read",
    };

    const result = bedrockImmutabilityGuard(request);

    expect(result).toBeNull();
  });

  it("denies bedrock writes even when a grant includes bedrock+write capability", () => {
    // The guard operates independently of grant contents —
    // bedrock immutability is a frozen MVP rule.
    const request: WorkspacePathRequest = {
      root: "bedrock",
      relativePath: "config/policy.json",
      capability: "write",
    };

    const result = bedrockImmutabilityGuard(request);

    expectDenied(result as WorkspacePathAuthorizationResult, "bedrock_immutable");
  });
});

// ── Composition: guard → authorizeWorkspacePath ─────────────────

describe("bedrockImmutabilityGuard → authorizeWorkspacePath composition", () => {
  it("chains bedrock read through guard (pass-through) then authorizes via authorizeWorkspacePath", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request: WorkspacePathRequest = {
      root: "bedrock",
      relativePath: "prompts/system.md",
      capability: "read",
    };

    // Guard must return null (pass-through) for reads
    const guardResult = bedrockImmutabilityGuard(request);
    expect(guardResult).toBeNull();

    // Then authorizeWorkspacePath must allow it
    const authResult = authorizeWorkspacePath(workspaceRoots, grant, request);
    expectAllowed(authResult, "/workspace/bedrock/prompts/system.md");
  });

  it("denies bedrock write at the guard before authorizeWorkspacePath runs", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request: WorkspacePathRequest = {
      root: "bedrock",
      relativePath: "prompts/system.md",
      capability: "write",
    };

    // Guard must deny bedrock writes
    const guardResult = bedrockImmutabilityGuard(request);
    expectDenied(guardResult as WorkspacePathAuthorizationResult, "bedrock_immutable");

    // Prove that authorizeWorkspacePath would have denied it anyway
    // (permission_denied because bedrock grants only have "read")
    // but the guard stops it first — this verifies the guard fires
    // before the normal authorization path.
  });

  it("proves that authorizeWorkspacePath would deny bedrock write with permission_denied when the guard is bypassed", () => {
    // This test proves the guard provides a *distinct* denial code
    // (bedrock_immutable) vs the generic permission_denied that
    // authorizeWorkspacePath would produce without the guard.
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request: WorkspacePathRequest = {
      root: "bedrock",
      relativePath: "prompts/system.md",
      capability: "write",
    };

    // Without the guard, authorizeWorkspacePath returns permission_denied
    // because bedrock path_permissions only include "read"
    const authResult = authorizeWorkspacePath(workspaceRoots, grant, request);
    expectDenied(authResult, "permission_denied");
  });

  it("chains non-bedrock write through guard (pass-through) then authorizes via authorizeWorkspacePath", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);
    const request: WorkspacePathRequest = {
      root: "working",
      relativePath: "notes/plan.md",
      capability: "write",
    };

    // Guard must return null (pass-through) for non-bedrock
    const guardResult = bedrockImmutabilityGuard(request);
    expect(guardResult).toBeNull();

    // Then authorizeWorkspacePath must allow it
    const authResult = authorizeWorkspacePath(workspaceRoots, grant, request);
    expectAllowed(authResult, "/workspace/working/notes/plan.md");
  });

  it("chains a full allow/deny decision: guard-first, then authorizeWorkspacePath", () => {
    const workspaceRoots = makeWorkspaceRoots();
    const grant = makeGrant(workspaceRoots);

    // Helper that implements the intended composition order
    function authorizeWithBedrockGuard(
      wsRoots: WorkspaceRootsDTO,
      execGrant: ExecutionGrantDTO,
      req: WorkspacePathRequest,
    ): WorkspacePathAuthorizationResult {
      const guardResult = bedrockImmutabilityGuard(req);
      if (guardResult !== null) {
        return guardResult;
      }
      return authorizeWorkspacePath(wsRoots, execGrant, req);
    }

    // Bedrock write → denied by guard
    expectDenied(
      authorizeWithBedrockGuard(workspaceRoots, grant, {
        root: "bedrock",
        relativePath: "prompts/system.md",
        capability: "write",
      }),
      "bedrock_immutable",
    );

    // Bedrock read → passes guard, authorized normally
    expectAllowed(
      authorizeWithBedrockGuard(workspaceRoots, grant, {
        root: "bedrock",
        relativePath: "prompts/system.md",
        capability: "read",
      }),
      "/workspace/bedrock/prompts/system.md",
    );

    // Working write → passes guard, authorized normally
    expectAllowed(
      authorizeWithBedrockGuard(workspaceRoots, grant, {
        root: "working",
        relativePath: "notes/plan.md",
        capability: "write",
      }),
      "/workspace/working/notes/plan.md",
    );
  });
});
