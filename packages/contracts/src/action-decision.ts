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

export type DecisionKind =
  | "respond"
  | "tool_calls"
  | "clarify"
  | "abort";

// ── Contract types ──────────────────────────────────────────────

export interface ToolCallEntry {
  readonly tool_name: string;
  readonly arguments: Record<string, unknown>;
  readonly provider_call_ref?: string;
}

export interface ActionDecision {
  readonly decision_id: string;
  readonly kind: DecisionKind;
  readonly message?: string;
  readonly tool_calls?: readonly ToolCallEntry[];
  readonly decision_summary?: string;
  readonly provider_trace_ref?: ContentRef;
}

// ── Validation codes ────────────────────────────────────────────

export type ActionDecisionValidationCode =
  | ContentRefValidationCode
  | "empty_array"
  | "invalid_literal"
  | "invalid_type"
  | "invalid_value"
  | "missing_required"
  | "unexpected_field"
  | "unknown_key";

export interface ActionDecisionValidationIssue {
  path: string;
  code: ActionDecisionValidationCode;
  message: string;
}

// ── Validation error ────────────────────────────────────────────

export class ActionDecisionValidationError extends Error {
  readonly issues: ActionDecisionValidationIssue[];

  constructor(issues: ActionDecisionValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid action decision: ${summary}.`);
    this.name = "ActionDecisionValidationError";
    this.issues = issues;
  }
}

// ── Known fields ────────────────────────────────────────────────

type UnknownRecord = Record<string, unknown>;

const ACTION_DECISION_FIELDS = new Set([
  "decision_id",
  "kind",
  "message",
  "tool_calls",
  "decision_summary",
  "provider_trace_ref",
]);

const TOOL_CALL_ENTRY_FIELDS = new Set([
  "tool_name",
  "arguments",
  "provider_call_ref",
]);

const DECISION_KINDS: readonly DecisionKind[] = [
  "respond",
  "tool_calls",
  "clarify",
  "abort",
];

// ── Public parser entrypoint ────────────────────────────────────

export function parseActionDecision(value: unknown): ActionDecision {
  const issues: ActionDecisionValidationIssue[] = [];
  const decision = parseActionDecisionAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!decision || issues.length > 0) {
    throw new ActionDecisionValidationError(issues);
  }

  return decision;
}

// ── Internal parser ─────────────────────────────────────────────

function parseActionDecisionAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): ActionDecision | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, ACTION_DECISION_FIELDS, path, addIssue);

  const kind = parseKind(record, path, addIssue);
  const decisionId = parseRequiredString(record, "decision_id", path, addIssue);

  // Validate conditional fields based on kind
  const message = validateMessageByKind(record, kind, path, addIssue);
  const toolCalls = validateToolCallsByKind(record, kind, path, addIssue);

  const decisionSummary = parseOptionalString(
    record,
    "decision_summary",
    path,
    addIssue,
  );

  const providerTraceRef = parseOptionalContentRef(
    record,
    "provider_trace_ref",
    path,
    addIssue,
  );

  if (decisionId === undefined || kind === undefined) {
    return undefined;
  }

  // If kind is tool_calls and toolCalls is undefined due to validation errors, bail
  if (kind === "tool_calls" && toolCalls === undefined) {
    return undefined;
  }

  return Object.freeze({
    decision_id: decisionId,
    kind,
    ...(message !== undefined ? { message } : {}),
    ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
    ...(decisionSummary !== undefined ? { decision_summary: decisionSummary } : {}),
    ...(providerTraceRef !== undefined
      ? { provider_trace_ref: providerTraceRef }
      : {}),
  });
}

// ── Kind validation ─────────────────────────────────────────────

function parseKind(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): DecisionKind | undefined {
  const fieldPath = joinPath(path, "kind");

  if (!("kind" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.kind;

  if (typeof value !== "string") {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a string.`,
    });
    return undefined;
  }

  if (!DECISION_KINDS.includes(value as DecisionKind)) {
    addIssue({
      path: fieldPath,
      code: "invalid_literal",
      message: `Expected "${fieldPath}" to be one of ${DECISION_KINDS.map((k) => `"${k}"`).join(", ")}.`,
    });
    return undefined;
  }

  return value as DecisionKind;
}

// ── Conditional field validation ────────────────────────────────

function validateMessageByKind(
  record: UnknownRecord,
  kind: DecisionKind | undefined,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): string | undefined {
  const messagePresent = "message" in record;

  if (kind === "tool_calls") {
    // message must NOT be present for tool_calls
    if (messagePresent) {
      const fieldPath = joinPath(path, "message");
      addIssue({
        path: fieldPath,
        code: "unexpected_field",
        message: `Unexpected field "${fieldPath}" — not allowed when kind is "tool_calls".`,
      });
    }
    return undefined;
  }

  if (kind === "abort") {
    // message is optional for abort
    if (!messagePresent) {
      return undefined;
    }
    return parseStringValue(record.message, joinPath(path, "message"), addIssue);
  }

  // For respond, clarify, and unknown kind: message is required
  if (!messagePresent && kind !== undefined) {
    const fieldPath = joinPath(path, "message");
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  if (!messagePresent) {
    // kind is undefined, can't determine requirement — we already reported kind issue
    return undefined;
  }

  return parseStringValue(record.message, joinPath(path, "message"), addIssue);
}

function validateToolCallsByKind(
  record: UnknownRecord,
  kind: DecisionKind | undefined,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): readonly ToolCallEntry[] | undefined {
  const toolCallsPresent = "tool_calls" in record;

  // tool_calls must NOT be present on non-tool_calls kinds
  if (kind !== undefined && kind !== "tool_calls") {
    if (toolCallsPresent) {
      const fieldPath = joinPath(path, "tool_calls");
      addIssue({
        path: fieldPath,
        code: "unexpected_field",
        message: `Unexpected field "${fieldPath}" — only allowed when kind is "tool_calls".`,
      });
    }
    return undefined;
  }

  if (kind === "tool_calls") {
    if (!toolCallsPresent) {
      const fieldPath = joinPath(path, "tool_calls");
      addIssue({
        path: fieldPath,
        code: "missing_required",
        message: `Missing required field "${fieldPath}".`,
      });
      return undefined;
    }

    const fieldPath = joinPath(path, "tool_calls");
    const rawValue = record.tool_calls;

    if (!Array.isArray(rawValue)) {
      addIssue({
        path: fieldPath,
        code: "invalid_type",
        message: `Expected "${fieldPath}" to be an array.`,
      });
      return undefined;
    }

    if (rawValue.length === 0) {
      addIssue({
        path: fieldPath,
        code: "empty_array",
        message: `Expected "${fieldPath}" to be a non-empty array.`,
      });
      return undefined;
    }

    const entries: ToolCallEntry[] = [];
    let hasErrors = false;

    for (let index = 0; index < rawValue.length; index += 1) {
      const entryPath = `${fieldPath}[${index}]`;
      const entry = parseToolCallEntryAtPath(
        rawValue[index],
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

  // kind is undefined or unhandled — don't validate tool_calls
  if (toolCallsPresent) {
    // We can't determine if it's unexpected since kind may be invalid
    // Just skip validation; the kind issue is already reported
  }

  return undefined;
}

// ── Tool call entry parsing ─────────────────────────────────────

function parseToolCallEntryAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): ToolCallEntry | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, TOOL_CALL_ENTRY_FIELDS, path, addIssue);

  const toolName = parseRequiredString(record, "tool_name", path, addIssue);
  const args = parseArgumentsField(record, path, addIssue);
  const providerCallRef = parseOptionalString(
    record,
    "provider_call_ref",
    path,
    addIssue,
  );

  if (toolName === undefined || args === undefined) {
    return undefined;
  }

  return Object.freeze({
    tool_name: toolName,
    arguments: args,
    ...(providerCallRef !== undefined
      ? { provider_call_ref: providerCallRef }
      : {}),
  });
}

function parseArgumentsField(
  record: UnknownRecord,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): Record<string, unknown> | undefined {
  const fieldPath = joinPath(path, "arguments");

  if (!("arguments" in record)) {
    addIssue({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record.arguments;

  if (!isPlainObject(value)) {
    addIssue({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a plain object.`,
    });
    return undefined;
  }

  // Empty objects ({}) are accepted — a parameterless tool call is valid per spec
  return Object.freeze(value) as Record<string, unknown>;
}

// ── Optional ContentRef validation ──────────────────────────────

function parseOptionalContentRef(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): ContentRef | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const fieldPath = joinPath(path, key);
  return parseContentRefAtPath(record[key], fieldPath, (issue) => {
    addIssue(issue);
  });
}

// ── Field parsers ───────────────────────────────────────────────

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
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
  addIssue: (issue: ActionDecisionValidationIssue) => void,
): string | undefined {
  if (!(key in record)) {
    return undefined;
  }

  return parseStringValue(record[key], joinPath(path, key), addIssue);
}

function parseStringValue(
  value: unknown,
  path: string,
  addIssue: (issue: ActionDecisionValidationIssue) => void,
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