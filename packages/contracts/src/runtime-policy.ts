// ── Shared helpers ──────────────────────────────────────────────

import {
  expectRecord,
  isPlainObject,
  joinPath,
  pushUnknownKeys,
} from "./validation-helpers.js";

// ── Contract types ──────────────────────────────────────────────

export interface WorkspaceRootsDTO {
  readonly bedrock: string;
  readonly working: string;
  readonly artifacts: string;
  readonly logs: string;
}

export interface RuntimePolicyDTO {
  readonly enabled_tools: readonly string[];
  readonly enabled_secret_handles: readonly string[];
  readonly max_tool_runtime_ms: number;
  readonly workspace_roots: WorkspaceRootsDTO;
  readonly trusted_local_mode: boolean;
}

// ── Validation codes ────────────────────────────────────────────

export type RuntimePolicyValidationCode =
  | "invalid_type"
  | "invalid_integer"
  | "invalid_value"
  | "missing_required"
  | "unknown_key";

export interface RuntimePolicyValidationIssue {
  path: string;
  code: RuntimePolicyValidationCode;
  message: string;
}

// ── Validation error ────────────────────────────────────────────

export class RuntimePolicyValidationError extends Error {
  readonly issues: RuntimePolicyValidationIssue[];

  constructor(issues: RuntimePolicyValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid runtime policy: ${summary}.`);
    this.name = "RuntimePolicyValidationError";
    this.issues = issues;
  }
}

// ── Known fields ────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const RUNTIME_POLICY_FIELDS = new Set([
  "enabled_tools",
  "enabled_secret_handles",
  "max_tool_runtime_ms",
  "workspace_roots",
  "trusted_local_mode",
]);

const WORKSPACE_ROOTS_FIELDS = new Set([
  "bedrock",
  "working",
  "artifacts",
  "logs",
]);

// ── Public parser entrypoint ────────────────────────────────────

export function parseRuntimePolicyDTO(value: unknown): RuntimePolicyDTO {
  const issues: RuntimePolicyValidationIssue[] = [];
  const policy = parseRuntimePolicyDTOAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!policy || issues.length > 0) {
    throw new RuntimePolicyValidationError(issues);
  }

  return policy;
}

// ── Exported at-path parser (used by environment/gateway layers) ─

export function parseRuntimePolicyDTOAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: RuntimePolicyValidationIssue) => void,
): RuntimePolicyDTO | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, RUNTIME_POLICY_FIELDS, path, addIssue);

  const enabledTools = parseRequiredStringArray(
    record,
    "enabled_tools",
    path,
    addIssue,
  );
  const enabledSecretHandles = parseRequiredStringArray(
    record,
    "enabled_secret_handles",
    path,
    addIssue,
  );
  const maxToolRuntimeMs = parseRequiredPositiveInteger(
    record,
    "max_tool_runtime_ms",
    path,
    addIssue,
  );
  const workspaceRoots = parseWorkspaceRoots(
    record,
    "workspace_roots",
    path,
    addIssue,
  );
  const trustedLocalMode = parseRequiredBoolean(
    record,
    "trusted_local_mode",
    path,
    addIssue,
  );

  if (
    enabledTools === undefined ||
    enabledSecretHandles === undefined ||
    maxToolRuntimeMs === undefined ||
    workspaceRoots === undefined ||
    trustedLocalMode === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    enabled_tools: enabledTools,
    enabled_secret_handles: enabledSecretHandles,
    max_tool_runtime_ms: maxToolRuntimeMs,
    workspace_roots: workspaceRoots,
    trusted_local_mode: trustedLocalMode,
  });
}

// ── Exported workspace-roots at-path parser ─────────────────────

export function parseWorkspaceRootsAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: RuntimePolicyValidationIssue) => void,
): WorkspaceRootsDTO | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, WORKSPACE_ROOTS_FIELDS, path, addIssue);

  const bedrock = parseRequiredNonEmptyString(record, "bedrock", path, addIssue);
  const working = parseRequiredNonEmptyString(record, "working", path, addIssue);
  const artifacts = parseRequiredNonEmptyString(record, "artifacts", path, addIssue);
  const logs = parseRequiredNonEmptyString(record, "logs", path, addIssue);

  if (
    bedrock === undefined ||
    working === undefined ||
    artifacts === undefined ||
    logs === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    bedrock,
    working,
    artifacts,
    logs,
  });
}

// ── Internal: workspace_roots field parser ──────────────────────

function parseWorkspaceRoots(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: RuntimePolicyValidationIssue) => void,
): WorkspaceRootsDTO | undefined {
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

  if (!isPlainObject(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an object.`,
    });
    return undefined;
  }

  return parseWorkspaceRootsAtPath(value, fieldPath, addIssue);
}

// ── Field parsers ───────────────────────────────────────────────

function parseRequiredStringArray(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: RuntimePolicyValidationIssue) => void,
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

  const items: string[] = [];
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

    items.push(element);
  }

  return Object.freeze(items);
}

function parseRequiredNonEmptyString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: RuntimePolicyValidationIssue) => void,
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

function parseRequiredPositiveInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: RuntimePolicyValidationIssue) => void,
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

function parseRequiredBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: RuntimePolicyValidationIssue) => void,
): boolean | undefined {
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

  if (typeof value !== "boolean") {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a boolean.`,
    });
    return undefined;
  }

  return value;
}