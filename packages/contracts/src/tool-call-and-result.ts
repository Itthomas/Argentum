import {
  type ContentRef,
  type ContentRefValidationCode,
  parseContentRefAtPath,
} from "./content-ref.js";
import {
  type ExecutionGrantDTO,
  type ExecutionGrantValidationCode,
  parseExecutionGrantAtPath,
} from "./execution-grant.js";
import {
  expectRecord,
  isPlainObject,
  joinPath,
  pushUnknownKeys,
} from "./validation-helpers.js";

// ── Literal unions ──────────────────────────────────────────────

export type ToolResultStatus = "success" | "error" | "blocked";

const TOOL_RESULT_STATUSES: readonly ToolResultStatus[] = [
  "success",
  "error",
  "blocked",
];

// ── Contract types ──────────────────────────────────────────────

export interface ToolCallDTO {
  readonly call_id: string;
  readonly turn_id: string;
  readonly tool_name: string;
  readonly arguments: Record<string, unknown>;
  readonly grant: ExecutionGrantDTO;
  readonly timeout_ms: number;
  readonly idempotency_key: string;
}

export interface ToolResultDTO {
  readonly call_id: string;
  readonly status: ToolResultStatus;
  readonly human_summary: string;
  readonly artifact_refs?: readonly ContentRef[];
  readonly structured_payload_ref?: ContentRef;
  readonly duration_ms: number;
  readonly truncated: boolean;
  readonly retryable: boolean;
  readonly error_code?: string;
}

// ── Validation codes ────────────────────────────────────────────

export type ToolCallDTOValidationCode =
  | ExecutionGrantValidationCode
  | "invalid_literal"
  | "invalid_value"
  | "invalid_integer"
  | "missing_required"
  | "unknown_key";

export interface ToolCallDTOValidationIssue {
  path: string;
  code: ToolCallDTOValidationCode;
  message: string;
}

export type ToolResultValidationCode =
  | ContentRefValidationCode
  | "invalid_literal"
  | "invalid_value"
  | "invalid_integer"
  | "invalid_type"
  | "missing_required"
  | "unknown_key";

export interface ToolResultValidationIssue {
  path: string;
  code: ToolResultValidationCode;
  message: string;
}

// ── Validation errors ───────────────────────────────────────────

export class ToolCallDTOValidationError extends Error {
  readonly issues: ToolCallDTOValidationIssue[];

  constructor(issues: ToolCallDTOValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid tool call: ${summary}.`);
    this.name = "ToolCallDTOValidationError";
    this.issues = issues;
  }
}

export class ToolResultValidationError extends Error {
  readonly issues: ToolResultValidationIssue[];

  constructor(issues: ToolResultValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid tool result: ${summary}.`);
    this.name = "ToolResultValidationError";
    this.issues = issues;
  }
}

// ── Known fields ────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const TOOL_CALL_FIELDS = new Set([
  "call_id",
  "turn_id",
  "tool_name",
  "arguments",
  "grant",
  "timeout_ms",
  "idempotency_key",
]);

const TOOL_RESULT_FIELDS = new Set([
  "call_id",
  "status",
  "human_summary",
  "artifact_refs",
  "structured_payload_ref",
  "duration_ms",
  "truncated",
  "retryable",
  "error_code",
]);

// ── Public parser entrypoints ───────────────────────────────────

export function parseToolCallDTO(value: unknown): ToolCallDTO {
  const issues: ToolCallDTOValidationIssue[] = [];
  const call = parseToolCallDTOAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!call || issues.length > 0) {
    throw new ToolCallDTOValidationError(issues);
  }

  return call;
}

export function parseToolResultDTO(value: unknown): ToolResultDTO {
  const issues: ToolResultValidationIssue[] = [];
  const result = parseToolResultDTOAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!result || issues.length > 0) {
    throw new ToolResultValidationError(issues);
  }

  return result;
}

// ── Exported at-path parsers (for cross-module composition) ────

export function parseToolCallDTOAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ToolCallDTOValidationIssue) => void,
): ToolCallDTO | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, TOOL_CALL_FIELDS, path, addIssue);

  const callId = parseRequiredNonEmptyString(record, "call_id", path, addIssue);
  const turnId = parseRequiredNonEmptyString(record, "turn_id", path, addIssue);
  const toolName = parseRequiredNonEmptyString(record, "tool_name", path, addIssue);
  const args = parseRequiredArgumentsObject(record, "arguments", path, addIssue);
  const grant = parseRequiredGrant(record, "grant", path, addIssue);
  const timeoutMs = parseRequiredPositiveInteger(
    record,
    "timeout_ms",
    path,
    addIssue,
  );
  const idempotencyKey = parseRequiredNonEmptyString(
    record,
    "idempotency_key",
    path,
    addIssue,
  );

  // Cross-field: timeout_ms must equal grant.max_runtime_ms.
  // Only check when both parsed successfully.
  if (timeoutMs !== undefined && grant !== undefined) {
    if (timeoutMs !== grant.max_runtime_ms) {
      addIssue({
        path: joinPath(path, "timeout_ms"),
        code: "invalid_value",
        message: `Expected "${joinPath(path, "timeout_ms")}" to equal grant.max_runtime_ms (${grant.max_runtime_ms}), but got ${timeoutMs}.`,
      });
    }
  }

  if (
    callId === undefined ||
    turnId === undefined ||
    toolName === undefined ||
    args === undefined ||
    grant === undefined ||
    timeoutMs === undefined ||
    idempotencyKey === undefined
  ) {
    return undefined;
  }

  // If cross-field check failed, return undefined even though all
  // fields technically parsed.
  if (timeoutMs !== grant.max_runtime_ms) {
    return undefined;
  }

  return Object.freeze({
    call_id: callId,
    turn_id: turnId,
    tool_name: toolName,
    arguments: args,
    grant,
    timeout_ms: timeoutMs,
    idempotency_key: idempotencyKey,
  });
}

export function parseToolResultDTOAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ToolResultValidationIssue) => void,
): ToolResultDTO | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, TOOL_RESULT_FIELDS, path, addIssue);

  const callId = parseRequiredNonEmptyString(record, "call_id", path, addIssue);
  const status = parseRequiredLiteral(
    record,
    "status",
    path,
    TOOL_RESULT_STATUSES,
    addIssue,
  );
  const humanSummary = parseRequiredNonEmptyString(
    record,
    "human_summary",
    path,
    addIssue,
  );
  const artifactRefs = parseOptionalArtifactRefs(
    record,
    "artifact_refs",
    path,
    addIssue,
  );
  const structuredPayloadRef = parseOptionalContentRef(
    record,
    "structured_payload_ref",
    path,
    addIssue,
  );
  const durationMs = parseRequiredNonNegativeInteger(
    record,
    "duration_ms",
    path,
    addIssue,
  );
  const truncated = parseRequiredBoolean(record, "truncated", path, addIssue);
  const retryable = parseRequiredBoolean(record, "retryable", path, addIssue);
  const errorCode = parseOptionalNonEmptyString(
    record,
    "error_code",
    path,
    addIssue,
  );

  if (
    callId === undefined ||
    status === undefined ||
    humanSummary === undefined ||
    durationMs === undefined ||
    truncated === undefined ||
    retryable === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    call_id: callId,
    status,
    human_summary: humanSummary,
    ...(artifactRefs !== undefined ? { artifact_refs: artifactRefs } : {}),
    ...(structuredPayloadRef !== undefined
      ? { structured_payload_ref: structuredPayloadRef }
      : {}),
    duration_ms: durationMs,
    truncated,
    retryable,
    ...(errorCode !== undefined ? { error_code: errorCode } : {}),
  });
}

// ── Shared field parsers (generic over issue type) ─────────────

function parseRequiredNonEmptyString<
  TIssue extends { path: string; code: string; message: string },
>(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: TIssue) => void,
): string | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    } as TIssue);
    return undefined;
  }

  return parseNonEmptyStringValue(record[key], fieldPath, addIssue);
}

function parseOptionalNonEmptyString<
  TIssue extends { path: string; code: string; message: string },
>(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: TIssue) => void,
): string | undefined {
  if (!(key in record)) {
    return undefined;
  }

  return parseNonEmptyStringValue(record[key], joinPath(path, key), addIssue);
}

function parseNonEmptyStringValue<
  TIssue extends { path: string; code: string; message: string },
>(
  value: unknown,
  path: string,
  addIssue: (issue: TIssue) => void,
): string | undefined {
  if (typeof value !== "string") {
    addIssue({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be a string.`,
    } as TIssue);
    return undefined;
  }

  if (value.length === 0) {
    addIssue({
      path,
      code: "invalid_value",
      message: `Expected "${path}" to be a non-empty string.`,
    } as TIssue);
    return undefined;
  }

  return value;
}

function parseRequiredArgumentsObject(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolCallDTOValidationIssue) => void,
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

  // Empty objects are accepted — tool-layer owns argument validation.
  return value;
}

function parseRequiredGrant(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolCallDTOValidationIssue) => void,
): ExecutionGrantDTO | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  return parseExecutionGrantAtPath(record[key], fieldPath, (issue) => {
    addIssue(issue);
  });
}

function parseRequiredPositiveInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolCallDTOValidationIssue) => void,
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

  if (value <= 0) {
    addIssue({
      path: fieldPath,
      code: "invalid_value",
      message: `Expected "${fieldPath}" to be a positive integer (> 0).`,
    });
    return undefined;
  }

  return value;
}

// ── ToolResultDTO field parsers ─────────────────────────────────

function parseRequiredLiteral<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  literals: readonly T[],
  addIssue: (issue: ToolResultValidationIssue) => void,
): T | undefined {
  const fieldPath = joinPath(path, key);
  const value = parseRequiredNonEmptyString(record, key, path, addIssue);

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

function parseOptionalArtifactRefs(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolResultValidationIssue) => void,
): readonly ContentRef[] | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const fieldPath = joinPath(path, key);
  const value = record[key];

  if (!Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array.`,
    });
    return undefined;
  }

  const entries: ContentRef[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${fieldPath}[${index}]`;
    const entry = parseContentRefAtPath(value[index], entryPath, (issue) => {
      addIssue(issue as ToolResultValidationIssue);
    });
    if (entry) {
      entries.push(entry);
    }
  }

  return Object.freeze(entries);
}

function parseOptionalContentRef(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolResultValidationIssue) => void,
): ContentRef | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const fieldPath = joinPath(path, key);

  return parseContentRefAtPath(record[key], fieldPath, (issue) => {
    addIssue(issue as ToolResultValidationIssue);
  });
}

function parseRequiredNonNegativeInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolResultValidationIssue) => void,
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

  if (value < 0) {
    addIssue({
      path: fieldPath,
      code: "invalid_value",
      message: `Expected "${fieldPath}" to be a non-negative integer (>= 0).`,
    });
    return undefined;
  }

  return value;
}

function parseRequiredBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ToolResultValidationIssue) => void,
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
