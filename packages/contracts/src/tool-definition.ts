// ── Literal unions ──────────────────────────────────────────────

import {
  expectRecord,
  isPlainObject,
  joinPath,
  pushUnknownKeys,
} from "./validation-helpers.js";

export type SideEffectLevel =
  | "read_only"
  | "workspace_mutation"
  | "host_mutation"
  | "external_effect";

export type PathScope = "none" | "working" | "workspace";

export type NetworkAccess = "deny" | "inherit";

// ── Contract types ──────────────────────────────────────────────

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
  readonly side_effect_level: SideEffectLevel;
  readonly path_scope: PathScope;
  readonly required_secret_handles: readonly string[];
  readonly network_access: NetworkAccess;
  readonly default_timeout_ms: number;
  readonly defaults?: Record<string, unknown>;
}

// ── Validation codes ────────────────────────────────────────────

export type ToolDefinitionValidationCode =
  | "invalid_literal"
  | "invalid_type"
  | "invalid_integer"
  | "invalid_value"
  | "missing_required"
  | "unknown_key";

export interface ToolDefinitionValidationIssue {
  path: string;
  code: ToolDefinitionValidationCode;
  message: string;
}

// ── Validation error ────────────────────────────────────────────

export class ToolDefinitionValidationError extends Error {
  readonly issues: ToolDefinitionValidationIssue[];

  constructor(issues: ToolDefinitionValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid tool definition: ${summary}.`);
    this.name = "ToolDefinitionValidationError";
    this.issues = issues;
  }
}

// ── Known fields ────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const TOOL_DEFINITION_FIELDS = new Set([
  "name",
  "description",
  "input_schema",
  "side_effect_level",
  "path_scope",
  "required_secret_handles",
  "network_access",
  "default_timeout_ms",
  "defaults",
]);

const SIDE_EFFECT_LEVELS: readonly SideEffectLevel[] = [
  "read_only",
  "workspace_mutation",
  "host_mutation",
  "external_effect",
];

const PATH_SCOPES: readonly PathScope[] = ["none", "working", "workspace"];

const NETWORK_ACCESS_VALUES: readonly NetworkAccess[] = ["deny", "inherit"];

// ── Public parser entrypoint ────────────────────────────────────

export function parseToolDefinition(value: unknown): ToolDefinition {
  const issues: ToolDefinitionValidationIssue[] = [];
  const definition = parseToolDefinitionAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!definition || issues.length > 0) {
    throw new ToolDefinitionValidationError(issues);
  }

  return definition;
}

// ── Exported at-path parser (used for cross-module composition) ─

export function parseToolDefinitionAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ToolDefinitionValidationIssue) => void,
): ToolDefinition | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, TOOL_DEFINITION_FIELDS, path, addIssue);

  const name = parseRequiredNonEmptyString(record, "name", path, addIssue);
  const description = parseRequiredNonEmptyString(
    record,
    "description",
    path,
    addIssue,
  );
  const inputSchema = parseRequiredPlainObject(
    record,
    "input_schema",
    path,
    addIssue,
  );
  const sideEffectLevel = parseRequiredLiteral(
    record,
    "side_effect_level",
    path,
    SIDE_EFFECT_LEVELS,
    addIssue,
  );
  const pathScope = parseRequiredLiteral(
    record,
    "path_scope",
    path,
    PATH_SCOPES,
    addIssue,
  );
  const requiredSecretHandles = parseRequiredSecretHandles(
    record,
    "required_secret_handles",
    path,
    addIssue,
  );
  const networkAccess = parseRequiredLiteral(
    record,
    "network_access",
    path,
    NETWORK_ACCESS_VALUES,
    addIssue,
  );
  const defaultTimeoutMs = parseRequiredPositiveInteger(
    record,
    "default_timeout_ms",
    path,
    addIssue,
  );
  const defaults = parseOptionalPlainObject(
    record,
    "defaults",
    path,
    addIssue,
  );

  if (
    name === undefined ||
    description === undefined ||
    inputSchema === undefined ||
    sideEffectLevel === undefined ||
    pathScope === undefined ||
    requiredSecretHandles === undefined ||
    networkAccess === undefined ||
    defaultTimeoutMs === undefined
  ) {
    return undefined;
  }

  const result = {
    name,
    description,
    input_schema: inputSchema,
    side_effect_level: sideEffectLevel,
    path_scope: pathScope,
    required_secret_handles: requiredSecretHandles,
    network_access: networkAccess,
    default_timeout_ms: defaultTimeoutMs,
    ...(defaults !== undefined ? { defaults } : {}),
  };

  return Object.freeze(result) as ToolDefinition;
}

// ── Field parsers ───────────────────────────────────────────────

function parseRequiredNonEmptyString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolDefinitionValidationIssue) => void,
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
  addIssue: (issue: ToolDefinitionValidationIssue) => void,
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
  addIssue: (issue: ToolDefinitionValidationIssue) => void,
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

function parseRequiredPlainObject(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolDefinitionValidationIssue) => void,
): Record<string, unknown> | undefined {
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
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  return value;
}

function parseOptionalPlainObject(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolDefinitionValidationIssue) => void,
): Record<string, unknown> | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const fieldPath = joinPath(path, key);
  const value = record[key];

  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  return value;
}

function parseRequiredSecretHandles(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolDefinitionValidationIssue) => void,
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
