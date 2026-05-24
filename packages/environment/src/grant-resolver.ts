import { randomUUID } from "node:crypto";

import type {
  ApprovalMode,
  ExecutionGrantDTO,
  ExecutionGrantPathPermission,
  NetworkPolicy,
  PathRoot,
  PathScope,
  RuntimePolicyDTO,
  ToolDefinition,
  WorkspaceRootsDTO,
} from "@argentum/contracts";

// ── Denial codes ────────────────────────────────────────────────

export type GrantDenialCode =
  | "tool_disabled"
  | "secret_unavailable"
  | "policy_denied";

export const DENIAL_CODES: readonly GrantDenialCode[] = [
  "tool_disabled",
  "secret_unavailable",
  "policy_denied",
];

// ── Grant resolution result ─────────────────────────────────────

export type GrantResolution =
  | {
      readonly approval_mode: "auto_allow";
      readonly grant: ExecutionGrantDTO;
    }
  | {
      readonly approval_mode: "deny";
      readonly grant: ExecutionGrantDTO;
      readonly denial_reason: string;
      readonly error_code: GrantDenialCode;
    };

// ── Canonical path root ordering ────────────────────────────────

const PATH_ROOT_ORDER: readonly PathRoot[] = [
  "bedrock",
  "working",
  "artifacts",
  "logs",
];

// ── Public entrypoint ───────────────────────────────────────────

/**
 * Derives one `ExecutionGrantDTO` per tool call from a `ToolDefinition`
 * and a `RuntimePolicyDTO`.
 *
 * The result is deterministic except for the `grant_id` field, which
 * is generated via `crypto.randomUUID()` on each call.
 */
export function resolveGrant(
  toolDef: ToolDefinition,
  policy: RuntimePolicyDTO,
): GrantResolution {
  // 1. Enabled-tool check
  if (!policy.enabled_tools.includes(toolDef.name)) {
    return deny(
      policy,
      "tool_disabled",
      `Tool '${toolDef.name}' is not in the enabled_tools policy.`,
    );
  }

  // 2. Secret-intersection check
  const { available, missing } = intersectSecretHandles(
    toolDef.required_secret_handles,
    policy.enabled_secret_handles,
  );

  if (missing.length > 0) {
    const missingList = missing.join(", ");
    return deny(
      policy,
      "secret_unavailable",
      `Tool '${toolDef.name}' requires secret handle(s) [${missingList}] not present in enabled_secret_handles.`,
    );
  }

  // 3. Path-permission derivation
  const pathPermissions = derivePathPermissions(
    toolDef.path_scope,
    policy.workspace_roots,
  );

  // 4. Network-policy mapping
  const networkPolicy: NetworkPolicy = toolDef.network_access;

  // 5. Runtime ceiling
  const maxRuntimeMs = Math.min(
    toolDef.default_timeout_ms,
    policy.max_tool_runtime_ms,
  );

  // 6. cwd
  const cwd = policy.workspace_roots.working;

  // 7. Trusted-local-mode check → auto_allow
  if (policy.trusted_local_mode) {
    return {
      approval_mode: "auto_allow",
      grant: buildGrant({
        cwd,
        pathPermissions,
        envSecretHandles: available,
        networkPolicy,
        maxRuntimeMs,
        approvalMode: "auto_allow",
      }),
    };
  }

  // 8. trusted_local_mode === false → deny
  return deny(
    policy,
    "policy_denied",
    `Tool '${toolDef.name}' denied: trusted_local_mode is disabled.`,
  );
}

// ── Internal helpers ────────────────────────────────────────────

/**
 * Build a denied `GrantResolution`.
 *
 * Denied grants still carry a full `ExecutionGrantDTO` with:
 * - `path_permissions = []`
 * - `env_secret_handles = []`
 * - `network_policy = "deny"`
 * - `max_runtime_ms = 0`
 * - `approval_mode = "deny"`
 */
function deny(
  policy: RuntimePolicyDTO,
  errorCode: GrantDenialCode,
  reason: string,
): GrantResolution & { approval_mode: "deny" } {
  const grant = buildGrant({
    cwd: policy.workspace_roots.working,
    pathPermissions: [],
    envSecretHandles: [],
    networkPolicy: "deny",
    maxRuntimeMs: 0,
    approvalMode: "deny",
  });

  return {
    approval_mode: "deny",
    grant,
    denial_reason: reason,
    error_code: errorCode,
  };
}

interface BuildGrantParams {
  cwd: string;
  pathPermissions: readonly ExecutionGrantPathPermission[];
  envSecretHandles: readonly string[];
  networkPolicy: NetworkPolicy;
  maxRuntimeMs: number;
  approvalMode: ApprovalMode;
}

function buildGrant(params: BuildGrantParams): ExecutionGrantDTO {
  return Object.freeze({
    grant_id: randomUUID(),
    cwd: params.cwd,
    path_permissions: params.pathPermissions,
    env_secret_handles: params.envSecretHandles,
    network_policy: params.networkPolicy,
    approval_mode: params.approvalMode,
    max_runtime_ms: params.maxRuntimeMs,
  });
}

/**
 * Derive `ExecutionGrantPathPermission[]` from a `PathScope` and
 * concrete workspace roots.
 *
 * Results are returned in canonical order: bedrock → working →
 * artifacts → logs.
 */
function derivePathPermissions(
  scope: PathScope,
  roots: WorkspaceRootsDTO,
): ExecutionGrantPathPermission[] {
  const perms: ExecutionGrantPathPermission[] = [];

  switch (scope) {
    case "none":
      return [];

    case "working":
      // working: read + write, artifacts: read + write
      perms.push({
        root: "working",
        path: roots.working,
        capabilities: ["read", "write"] as const,
      });
      perms.push({
        root: "artifacts",
        path: roots.artifacts,
        capabilities: ["read", "write"] as const,
      });
      break;

    case "workspace":
      // bedrock: read, working: r/w, artifacts: r/w, logs: append
      perms.push({
        root: "bedrock",
        path: roots.bedrock,
        capabilities: ["read"] as const,
      });
      perms.push({
        root: "working",
        path: roots.working,
        capabilities: ["read", "write"] as const,
      });
      perms.push({
        root: "artifacts",
        path: roots.artifacts,
        capabilities: ["read", "write"] as const,
      });
      perms.push({
        root: "logs",
        path: roots.logs,
        capabilities: ["append"] as const,
      });
      break;

    default: {
      // Exhaustiveness check — should never happen at runtime with
      // validated ToolDefinition inputs.
      const _exhaustive: never = scope;
      void _exhaustive;
      return [];
    }
  }

  // Ensure canonical order: bedrock → working → artifacts → logs
  return perms.sort(
    (a, b) => PATH_ROOT_ORDER.indexOf(a.root) - PATH_ROOT_ORDER.indexOf(b.root),
  );
}

/**
 * Compute the intersection of required and enabled secret handles.
 */
function intersectSecretHandles(
  required: readonly string[],
  enabled: readonly string[],
): { available: string[]; missing: string[] } {
  const enabledSet = new Set(enabled);
  const available: string[] = [];
  const missing: string[] = [];

  for (const handle of required) {
    if (enabledSet.has(handle)) {
      available.push(handle);
    } else {
      missing.push(handle);
    }
  }

  return { available, missing };
}
