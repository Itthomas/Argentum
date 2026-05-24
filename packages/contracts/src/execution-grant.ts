// ── Literal unions ──────────────────────────────────────────────

import {
  expectRecord,
  isPlainObject,
  joinPath,
  pushUnknownKeys,
} from "./validation-helpers.js";

export type ApprovalMode = "auto_allow" | "deny";

export type NetworkPolicy = "deny" | "inherit";

export type PathRoot = "bedrock" | "working" | "artifacts" | "logs";

export type Capability = "read" | "write" | "append";

// ── Contract types ──────────────────────────────────────────────

export interface ExecutionGrantPathPermission {
  readonly root: PathRoot;
  readonly path: string;
  readonly capabilities: readonly Capability[];
}

export interface ExecutionGrantDTO {
  readonly grant_id: string;
  readonly cwd: string;
  readonly path_permissions: readonly ExecutionGrantPathPermission[];
  readonly env_secret_handles: readonly string[];
  readonly network_policy: NetworkPolicy;
  readonly approval_mode: ApprovalMode;
  readonly max_runtime_ms: number;
}

// ── Validation codes ────────────────────────────────────────────

export type ExecutionGrantValidationCode =
  | "invalid_literal"
  | "invalid_type"
  | "invalid_integer"
  | "invalid_value"
  | "missing_required"
  | "unknown_key"
  | "empty_array";

export interface ExecutionGrantValidationIssue {
  path: string;
  code: ExecutionGrantValidationCode;
  message: string;
}

// ── Validation error ────────────────────────────────────────────

export class ExecutionGrantValidationError extends Error {
  readonly issues: ExecutionGrantValidationIssue[];

  constructor(issues: ExecutionGrantValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid execution grant: ${summary}.`);
    this.name = "ExecutionGrantValidationError";
    this.issues = issues;
  }
}

// ── Known fields ────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const EXECUTION_GRANT_FIELDS = new Set([
  "grant_id",
  "cwd",
  "path_permissions",
  "env_secret_handles",
  "network_policy",
  "approval_mode",
  "max_runtime_ms",
]);

const APPROVAL_MODES: readonly ApprovalMode[] = ["auto_allow", "deny"];

const NETWORK_POLICIES: readonly NetworkPolicy[] = ["deny", "inherit"];

const PATH_ROOTS: readonly PathRoot[] = [
  "bedrock",
  "working",
  "artifacts",
  "logs",
];

const CAPABILITIES: readonly Capability[] = ["read", "write", "append"];

const PATH_PERMISSION_FIELDS = new Set(["root", "path", "capabilities"]);

// ── Public parser entrypoint ────────────────────────────────────

export function parseExecutionGrant(value: unknown): ExecutionGrantDTO {
  const issues: ExecutionGrantValidationIssue[] = [];
  const grant = parseExecutionGrantAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!grant || issues.length > 0) {
    throw new ExecutionGrantValidationError(issues);
  }

  return grant;
}

// ── Exported at-path parser (used by tool-call-and-result.ts) ──

export function parseExecutionGrantAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): ExecutionGrantDTO | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, EXECUTION_GRANT_FIELDS, path, addIssue);

  const grantId = parseRequiredNonEmptyString(record, "grant_id", path, addIssue);
  const cwd = parseRequiredNonEmptyString(record, "cwd", path, addIssue);
  const networkPolicy = parseRequiredLiteral(
    record,
    "network_policy",
    path,
    NETWORK_POLICIES,
    addIssue,
  );
  const approvalMode = parseRequiredLiteral(
    record,
    "approval_mode",
    path,
    APPROVAL_MODES,
    addIssue,
  );
  const maxRuntimeMs = parseRequiredPositiveInteger(
    record,
    "max_runtime_ms",
    path,
    addIssue,
  );
  const pathPermissions = parseRequiredPathPermissions(
    record,
    "path_permissions",
    path,
    addIssue,
  );
  const envSecretHandles = parseRequiredSecretHandles(
    record,
    "env_secret_handles",
    path,
    addIssue,
  );

  if (
    grantId === undefined ||
    cwd === undefined ||
    networkPolicy === undefined ||
    approvalMode === undefined ||
    maxRuntimeMs === undefined ||
    pathPermissions === undefined ||
    envSecretHandles === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    grant_id: grantId,
    cwd,
    path_permissions: pathPermissions,
    env_secret_handles: envSecretHandles,
    network_policy: networkPolicy,
    approval_mode: approvalMode,
    max_runtime_ms: maxRuntimeMs,
  });
}

// ── Field parsers ───────────────────────────────────────────────

function parseRequiredNonEmptyString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): string | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];

  if (typeof value !== "string") {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a string.`,
    });
    return undefined;
  }

  if (value.length === 0) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a non-empty string.`,
    });
    return undefined;
  }

  return value;
}

function parseRequiredLiteral<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  literals: readonly T[],
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): T | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];

  if (typeof value !== "string") {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a string.`,
    });
    return undefined;
  }

  if (!literals.includes(value as T)) {
    addIssue({
      path: fieldPath,
      code: "invalid_literal",
      message: `Expected "${fieldPath}" to be one of ${literals.map((item) => `"${item}"`).join(", ")}.`,
    });
    return undefined;
  }

  return value as T;
}

function parseRequiredPositiveInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): number | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];

  if (typeof value !== "number" || !Number.isInteger(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_integer",
      message: `Expected "${fieldPath}" to be an integer.`,
    });
    return undefined;
  }

  if (value < 1) {
    addIssue({
      path: fieldPath,
      code: "invalid_value",
      message: `Expected "${fieldPath}" to be a positive integer (>= 1).`,
    });
    return undefined;
  }

  return value;
}

function parseRequiredPathPermissions(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): readonly ExecutionGrantPathPermission[] | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];

  if (!Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array.`,
    });
    return undefined;
  }

  const entries: ExecutionGrantPathPermission[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${fieldPath}[${index}]`;
    const entry = parsePathPermissionEntryAtPath(
      value[index],
      entryPath,
      addIssue,
    );
    if (entry) {
      entries.push(entry);
    }
  }

  return Object.freeze(entries);
}

function parseRequiredSecretHandles(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): readonly string[] | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];

  if (!Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array.`,
    });
    return undefined;
  }

  const handles: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const elementPath = `${fieldPath}[${index}]`;
    const element = value[index];

    if (typeof element !== "string") {
      addIssue({
        path: elementPath,
        code: "invalid_type",
        message: `Expected "${elementPath}" to be a string.`,
      });
      continue;
    }

    if (element.length === 0) {
      addIssue({
        path: elementPath,
        code: "invalid_type",
        message: `Expected "${elementPath}" to be a non-empty string.`,
      });
      continue;
    }

    handles.push(element);
  }

  return Object.freeze(handles);
}

function parsePathPermissionEntryAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): ExecutionGrantPathPermission | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, PATH_PERMISSION_FIELDS, path, addIssue);

  const root = parseRequiredLiteral(record, "root", path, PATH_ROOTS, addIssue);
  const permPath = parseRequiredNonEmptyString(record, "path", path, addIssue);
  const capabilities = parseRequiredCapabilities(
    record,
    "capabilities",
    path,
    addIssue,
  );

  if (root === undefined || permPath === undefined || capabilities === undefined) {
    return undefined;
  }

  return Object.freeze({
    root,
    path: permPath,
    capabilities,
  });
}

function parseRequiredCapabilities(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ExecutionGrantValidationIssue) => void,
): readonly Capability[] | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];

  if (!Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array.`,
    });
    return undefined;
  }

  if (value.length === 0) {
    addIssue({
      path: fieldPath,
      code: "empty_array",
      message: `Expected "${fieldPath}" to be a non-empty array.`,
    });
    return undefined;
  }

  const caps: Capability[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const elementPath = `${fieldPath}[${index}]`;
    const element = value[index];

    if (typeof element !== "string") {
      addIssue({
        path: elementPath,
        code: "invalid_type",
        message: `Expected "${elementPath}" to be a capability string.`,
      });
      continue;
    }

    if (!CAPABILITIES.includes(element as Capability)) {
      addIssue({
        path: elementPath,
        code: "invalid_literal",
        message: `Expected "${elementPath}" to be one of ${CAPABILITIES.map((item) => `"${item}"`).join(", ")}.`,
      });
      continue;
    }

    caps.push(element as Capability);
  }

  return Object.freeze(caps);
}
