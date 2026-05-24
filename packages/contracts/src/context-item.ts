import {
  type ContentRef,
  type ContentRefValidationCode,
  parseContentRefAtPath,
} from "./content-ref.js";
import {
  expectRecord,
  isPlainObject,
  joinPath,
  pushUnknownKeys,
} from "./validation-helpers.js";

// ── Literal unions ──────────────────────────────────────────────

export type ContextLayer =
  | "bedrock"
  | "environment"
  | "episodic"
  | "tool_summary"
  | "system";

export type ContextRetention = "sticky" | "rolling" | "ephemeral";

// ── Contract type ───────────────────────────────────────────────

export interface ContextItem {
  readonly context_id: string;
  readonly layer: ContextLayer;
  readonly role: string;
  readonly content_ref: ContentRef;
  readonly origin: string;
  readonly retention: ContextRetention;
  readonly version?: string;
  readonly token_estimate?: number;
}

// ── Validation codes ────────────────────────────────────────────

export type ContextItemValidationCode =
  | ContentRefValidationCode
  | "invalid_integer"
  | "invalid_literal"
  | "invalid_type"
  | "missing_required"
  | "unknown_key";

export interface ContextItemValidationIssue {
  path: string;
  code: ContextItemValidationCode;
  message: string;
}

// ── Validation error ────────────────────────────────────────────

export class ContextItemValidationError extends Error {
  readonly issues: ContextItemValidationIssue[];

  constructor(issues: ContextItemValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid context item: ${summary}.`);
    this.name = "ContextItemValidationError";
    this.issues = issues;
  }
}

// ── Known fields ────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const CONTEXT_ITEM_FIELDS = new Set([
  "context_id",
  "layer",
  "role",
  "content_ref",
  "origin",
  "retention",
  "version",
  "token_estimate",
]);

const CONTEXT_LAYERS: readonly ContextLayer[] = [
  "bedrock",
  "environment",
  "episodic",
  "tool_summary",
  "system",
];

const CONTEXT_RETENTIONS: readonly ContextRetention[] = [
  "sticky",
  "rolling",
  "ephemeral",
];

// ── Public parser entrypoints ───────────────────────────────────

export function parseContextItem(value: unknown): ContextItem {
  const issues: ContextItemValidationIssue[] = [];
  const item = parseContextItemAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!item || issues.length > 0) {
    throw new ContextItemValidationError(issues);
  }

  return item;
}

export function parseContextItemArray(value: unknown): readonly ContextItem[] {
  const issues: ContextItemValidationIssue[] = [];

  if (!Array.isArray(value)) {
    issues.push({
      path: "$",
      code: "invalid_type",
      message: `Expected "$" to be an array.`,
    });
    throw new ContextItemValidationError(issues);
  }

  const items: ContextItem[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `[${index}]`;
    const item = parseContextItemAtPath(value[index], itemPath, (issue) => {
      issues.push(issue);
    });

    if (item) {
      items.push(item);
    }
  }

  if (issues.length > 0) {
    throw new ContextItemValidationError(issues);
  }

  return Object.freeze(items);
}

// ── Internal parser ─────────────────────────────────────────────

function parseContextItemAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ContextItemValidationIssue) => void,
): ContextItem | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, CONTEXT_ITEM_FIELDS, path, addIssue);

  const contextId = parseRequiredString(record, "context_id", path, addIssue);
  const layer = parseRequiredLiteral(
    record,
    "layer",
    path,
    CONTEXT_LAYERS,
    addIssue,
  );
  const role = parseRequiredString(record, "role", path, addIssue);
  const contentRef = parseRequiredContentRef(record, "content_ref", path, addIssue);
  const origin = parseRequiredString(record, "origin", path, addIssue);
  const retention = parseRequiredLiteral(
    record,
    "retention",
    path,
    CONTEXT_RETENTIONS,
    addIssue,
  );
  const version = parseOptionalString(record, "version", path, addIssue);
  const tokenEstimate = parseOptionalTokenEstimate(
    record,
    "token_estimate",
    path,
    addIssue,
  );

  if (
    contextId === undefined ||
    layer === undefined ||
    role === undefined ||
    contentRef === undefined ||
    origin === undefined ||
    retention === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    context_id: contextId,
    layer,
    role,
    content_ref: contentRef,
    origin,
    retention,
    ...(version !== undefined ? { version } : {}),
    ...(tokenEstimate !== undefined ? { token_estimate: tokenEstimate } : {}),
  });
}

// ── Field parsers ───────────────────────────────────────────────

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ContextItemValidationIssue) => void,
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

  return parseStringValue(record[key], fieldPath, addIssue);
}

function parseOptionalString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ContextItemValidationIssue) => void,
): string | undefined {
  if (!(key in record)) {
    return undefined;
  }

  return parseStringValue(record[key], joinPath(path, key), addIssue);
}

function parseRequiredLiteral<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  literals: readonly T[],
  addIssue: (issue: ContextItemValidationIssue) => void,
): T | undefined {
  const fieldPath = joinPath(path, key);
  const value = parseRequiredString(record, key, path, addIssue);

  if (value === undefined) {
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

function parseStringValue(
  value: unknown,
  path: string,
  addIssue: (issue: ContextItemValidationIssue) => void,
): string | undefined {
  if (typeof value !== "string") {
    addIssue({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be a string.`,
    });
    return undefined;
  }

  if (value.length === 0) {
    addIssue({
      path,
      code: "invalid_value",
      message: `Expected "${path}" to be a non-empty string.`,
    });
    return undefined;
  }

  return value;
}

function parseRequiredContentRef(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ContextItemValidationIssue) => void,
): ContentRef | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  return parseContentRefAtPath(record[key], fieldPath, (issue) => {
    addIssue(issue);
  });
}

function parseOptionalTokenEstimate(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ContextItemValidationIssue) => void,
): number | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const fieldPath = joinPath(path, key);
  const value = record[key];

  if (typeof value !== "number") {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a number.`,
    });
    return undefined;
  }

  if (!Number.isInteger(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_integer",
      message: `Expected "${fieldPath}" to be an integer.`,
    });
    return undefined;
  }

  return value;
}
