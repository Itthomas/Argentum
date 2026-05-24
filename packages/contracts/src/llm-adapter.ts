import {
  type ActionDecision,
  type ActionDecisionValidationCode,
  ActionDecisionValidationError,
  parseActionDecision,
} from "./action-decision.js";
import {
  type ContentRef,
  type ContentRefValidationCode,
  parseContentRefAtPath,
} from "./content-ref.js";
import {
  type ContextItem,
  type ContextItemValidationCode,
  ContextItemValidationError,
  parseContextItemArray,
} from "./context-item.js";
import {
  expectRecord,
  isPlainObject,
  joinPath,
  pushUnknownKeys,
} from "./validation-helpers.js";

// ── Literal unions ──────────────────────────────────────────────

export type NormalizationStatus = "native_tool" | "json_mode" | "parsed_text";

const NORMALIZATION_STATUSES: readonly NormalizationStatus[] = [
  "native_tool",
  "json_mode",
  "parsed_text",
];

// ── Contract types ──────────────────────────────────────────────

export interface AvailableToolEntry {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

export interface LLMInferenceRequest {
  readonly request_id: string;
  readonly turn_id: string;
  readonly context_items: readonly ContextItem[];
  readonly available_tools: readonly AvailableToolEntry[];
  readonly inference_policy: Record<string, unknown>;
}

export interface LLMInferenceResult {
  readonly request_id: string;
  readonly decision: ActionDecision;
  readonly normalization_status: NormalizationStatus;
  readonly usage?: Record<string, unknown>;
  readonly raw_trace_ref?: ContentRef;
}

// ── Validation codes ────────────────────────────────────────────

export type LLMRequestValidationCode = ContextItemValidationCode;

export interface LLMRequestValidationIssue {
  path: string;
  code: LLMRequestValidationCode;
  message: string;
}

export type LLMResultValidationCode = ActionDecisionValidationCode;

export interface LLMResultValidationIssue {
  path: string;
  code: LLMResultValidationCode;
  message: string;
}

// ── Validation errors ───────────────────────────────────────────

export class LLMRequestValidationError extends Error {
  readonly issues: LLMRequestValidationIssue[];

  constructor(issues: LLMRequestValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid LLM inference request: ${summary}.`);
    this.name = "LLMRequestValidationError";
    this.issues = issues;
  }
}

export class LLMResultValidationError extends Error {
  readonly issues: LLMResultValidationIssue[];

  constructor(issues: LLMResultValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid LLM inference result: ${summary}.`);
    this.name = "LLMResultValidationError";
    this.issues = issues;
  }
}

// ── Known fields ────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const REQUEST_FIELDS = new Set([
  "request_id",
  "turn_id",
  "context_items",
  "available_tools",
  "inference_policy",
]);

const RESULT_FIELDS = new Set([
  "request_id",
  "decision",
  "normalization_status",
  "usage",
  "raw_trace_ref",
]);

const TOOL_ENTRY_FIELDS = new Set([
  "name",
  "description",
  "input_schema",
]);

// ── Public parser entrypoints: LLMInferenceRequest ──────────────

export function parseLLMInferenceRequest(
  value: unknown,
): LLMInferenceRequest {
  const issues: LLMRequestValidationIssue[] = [];
  const request = parseLLMInferenceRequestAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!request || issues.length > 0) {
    throw new LLMRequestValidationError(issues);
  }

  return request;
}

// ── Public parser entrypoints: LLMInferenceResult ───────────────

export function parseLLMInferenceResult(
  value: unknown,
): LLMInferenceResult {
  const issues: LLMResultValidationIssue[] = [];
  const result = parseLLMInferenceResultAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!result || issues.length > 0) {
    throw new LLMResultValidationError(issues);
  }

  return result;
}

// ── Internal parsers ────────────────────────────────────────────

function parseLLMInferenceRequestAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: LLMRequestValidationIssue) => void,
): LLMInferenceRequest | undefined {
  // Wrap the specific addIssue so shared helpers can emit with string-code.
  const add = (
    issue: { path: string; code: string; message: string },
  ): void => {
    addIssue(issue as LLMRequestValidationIssue);
  };

  const record = expectRecord(value, path, add);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, REQUEST_FIELDS, path, add);

  const requestId = parseRequiredNonEmptyString(
    record,
    "request_id",
    path,
    add,
  );
  const turnId = parseRequiredNonEmptyString(
    record,
    "turn_id",
    path,
    add,
  );
  const contextItems = parseContextItemsField(record, path, add);
  const availableTools = parseAvailableToolsField(record, path, add);
  const inferencePolicy = parseInferencePolicyField(record, path, add);

  if (
    requestId === undefined ||
    turnId === undefined ||
    contextItems === undefined ||
    availableTools === undefined ||
    inferencePolicy === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    request_id: requestId,
    turn_id: turnId,
    context_items: contextItems,
    available_tools: availableTools,
    inference_policy: inferencePolicy,
  });
}

function parseLLMInferenceResultAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: LLMResultValidationIssue) => void,
): LLMInferenceResult | undefined {
  // Wrap the specific addIssue so shared helpers can emit with string-code.
  const add = (
    issue: { path: string; code: string; message: string },
  ): void => {
    addIssue(issue as LLMResultValidationIssue);
  };

  const record = expectRecord(value, path, add);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, RESULT_FIELDS, path, add);

  const requestId = parseRequiredNonEmptyString(
    record,
    "request_id",
    path,
    add,
  );
  const decision = parseDecisionField(record, path, addIssue);
  const normalizationStatus = parseNormalizationStatusField(
    record,
    path,
    addIssue,
  );
  const usage = parseUsageField(record, path, addIssue);
  const rawTraceRef = parseRawTraceRefField(record, path, addIssue);

  if (
    requestId === undefined ||
    decision === undefined ||
    normalizationStatus === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    request_id: requestId,
    decision,
    normalization_status: normalizationStatus,
    ...(usage !== undefined ? { usage } : {}),
    ...(rawTraceRef !== undefined ? { raw_trace_ref: rawTraceRef } : {}),
  });
}

// ── Field validators: LLMInferenceRequest ───────────────────────

function parseContextItemsField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: { path: string; code: string; message: string }) => void,
): readonly ContextItem[] | undefined {
  const fieldPath = joinPath(path, "context_items");

  if (!("context_items" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.context_items;

  if (!Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array.`,
    });
    return undefined;
  }

  // Empty arrays are accepted — a request with no context items is valid.
  // Delegate per-element structural validation to parseContextItemArray.
  try {
    return parseContextItemArray(value);
  } catch (error) {
    if (error instanceof ContextItemValidationError) {
      for (const issue of error.issues) {
        addIssue({
          path: joinPath("context_items", issue.path),
          code: issue.code as LLMRequestValidationCode,
          message: issue.message,
        });
      }
      return undefined;
    }
    throw error;
  }
}

function parseAvailableToolsField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: { path: string; code: string; message: string }) => void,
): readonly AvailableToolEntry[] | undefined {
  const fieldPath = joinPath(path, "available_tools");

  if (!("available_tools" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.available_tools;

  if (!Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array.`,
    });
    return undefined;
  }

  const entries: AvailableToolEntry[] = [];
  let hasErrors = false;

  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${fieldPath}[${index}]`;
    const entry = parseAvailableToolEntryAtPath(
      value[index],
      entryPath,
      addIssue,
    );

    if (entry) {
      entries.push(entry);
    } else {
      hasErrors = true;
    }
  }

  if (hasErrors) {
    return undefined;
  }

  return Object.freeze(entries);
}

function parseInferencePolicyField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: { path: string; code: string; message: string }) => void,
): Record<string, unknown> | undefined {
  const fieldPath = joinPath(path, "inference_policy");

  if (!("inference_policy" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.inference_policy;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  // No subfield validation — exact subfields are deferred per spec.
  // Unknown keys on the policy object are NOT rejected.
  return value as Record<string, unknown>;
}

// ── Field validators: LLMInferenceResult ────────────────────────

function parseDecisionField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: LLMResultValidationIssue) => void,
): ActionDecision | undefined {
  const fieldPath = joinPath(path, "decision");

  if (!("decision" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.decision;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  // Delegate deep structural validation to parseActionDecision from slice 0013.
  // parseActionDecisionAtPath is not exported, so we catch and re-emit with prefix.
  try {
    return parseActionDecision(value);
  } catch (error) {
    if (error instanceof ActionDecisionValidationError) {
      for (const issue of error.issues) {
        addIssue({
          path: joinPath("decision", issue.path),
          code: issue.code as LLMResultValidationCode,
          message: issue.message,
        });
      }
      return undefined;
    }
    throw error;
  }
}

function parseNormalizationStatusField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: LLMResultValidationIssue) => void,
): NormalizationStatus | undefined {
  const fieldPath = joinPath(path, "normalization_status");

  if (!("normalization_status" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.normalization_status;

  if (typeof value !== "string") {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a string.`,
    });
    return undefined;
  }

  if (!NORMALIZATION_STATUSES.includes(value as NormalizationStatus)) {
    addIssue({
      path: fieldPath,
      code: "invalid_literal",
      message: `Expected "${fieldPath}" to be one of ${NORMALIZATION_STATUSES.map((s) => `"${s}"`).join(", ")}.`,
    });
    return undefined;
  }

  return value as NormalizationStatus;
}

function parseUsageField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: LLMResultValidationIssue) => void,
): Record<string, unknown> | undefined {
  if (!("usage" in record)) {
    return undefined;
  }

  const value = record.usage;
  const fieldPath = joinPath(path, "usage");

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  // No subfield validation — provider-specific.
  return value as Record<string, unknown>;
}

function parseRawTraceRefField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: LLMResultValidationIssue) => void,
): ContentRef | undefined {
  if (!("raw_trace_ref" in record)) {
    return undefined;
  }

  const value = record.raw_trace_ref;
  const fieldPath = joinPath(path, "raw_trace_ref");

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  // parseContentRefAtPath is exported — use it directly with path prefix.
  return parseContentRefAtPath(value, fieldPath, (issue) => {
    addIssue({
      path: issue.path,
      code: issue.code as LLMResultValidationCode,
      message: issue.message,
    });
  });
}

// ── AvailableToolEntry validation ───────────────────────────────

function parseAvailableToolEntryAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: { path: string; code: string; message: string }) => void,
): AvailableToolEntry | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, TOOL_ENTRY_FIELDS, path, addIssue);

  const name = parseRequiredNonEmptyString(record, "name", path, addIssue);
  const description = parseRequiredNonEmptyString(
    record,
    "description",
    path,
    addIssue,
  );
  const inputSchema = parseInputSchemaField(record, path, addIssue);

  if (name === undefined || description === undefined || inputSchema === undefined) {
    return undefined;
  }

  return Object.freeze({
    name,
    description,
    input_schema: inputSchema,
  });
}

function parseInputSchemaField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: { path: string; code: string; message: string }) => void,
): Record<string, unknown> | undefined {
  const fieldPath = joinPath(path, "input_schema");

  if (!("input_schema" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.input_schema;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  // Accept any plain object — canonical tool schema shape is deferred.
  return value as Record<string, unknown>;
}

// ── Field parsers ───────────────────────────────────────────────

type AddIssueFn = (
  issue: { path: string; code: string; message: string },
) => void;

function parseRequiredNonEmptyString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: AddIssueFn,
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

  return parseNonEmptyStringValue(record[key], fieldPath, addIssue);
}

function parseNonEmptyStringValue(
  value: unknown,
  path: string,
  addIssue: AddIssueFn,
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
