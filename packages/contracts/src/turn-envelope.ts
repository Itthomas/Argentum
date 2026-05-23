import {
  type ContentRef,
  type ContentRefValidationCode,
  parseContentRefAtPath,
} from "./content-ref.js";

export type TurnState =
  | "accepted"
  | "building_context"
  | "inferring"
  | "validating"
  | "executing_tools"
  | "compacting"
  | "responding"
  | "finalizing"
  | "completed"
  | "aborted";

export interface TurnBudget {
  readonly max_inference_steps: number;
  readonly max_repair_attempts: number;
  readonly max_wall_clock_ms: number;
  readonly repair_attempts_used: number;
}

export interface TurnEnvelope {
  readonly turn_id: string;
  readonly session_id: string;
  readonly ingress_id: string;
  readonly state: TurnState;
  readonly step_count: number;
  readonly budget: TurnBudget;
  readonly context_refs: readonly ContentRef[];
  readonly compaction_revision: number;
  readonly final_outcome?: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export type TurnEnvelopeValidationCode =
  | ContentRefValidationCode
  | "invalid_format"
  | "invalid_integer"
  | "invalid_literal"
  | "invalid_type"
  | "invalid_value"
  | "missing_required"
  | "unknown_key";

export interface TurnEnvelopeValidationIssue {
  path: string;
  code: TurnEnvelopeValidationCode;
  message: string;
}

export class TurnEnvelopeValidationError extends Error {
  readonly issues: TurnEnvelopeValidationIssue[];

  constructor(issues: TurnEnvelopeValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid turn envelope: ${summary}.`);
    this.name = "TurnEnvelopeValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

const TURN_ENVELOPE_FIELDS = new Set([
  "turn_id",
  "session_id",
  "ingress_id",
  "state",
  "step_count",
  "budget",
  "context_refs",
  "compaction_revision",
  "final_outcome",
  "created_at",
  "updated_at",
]);

const TURN_BUDGET_FIELDS = new Set([
  "max_inference_steps",
  "max_repair_attempts",
  "max_wall_clock_ms",
  "repair_attempts_used",
]);

const TURN_STATES: readonly TurnState[] = [
  "accepted",
  "building_context",
  "inferring",
  "validating",
  "executing_tools",
  "compacting",
  "responding",
  "finalizing",
  "completed",
  "aborted",
];

const ISO_UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]00:00)$/;

export function parseTurnEnvelope(value: unknown): TurnEnvelope {
  const issues: TurnEnvelopeValidationIssue[] = [];
  const root = expectRecord(value, "", issues);

  if (!root) {
    throw new TurnEnvelopeValidationError(issues);
  }

  pushUnknownKeys(root, TURN_ENVELOPE_FIELDS, "", issues);

  const turnId = parseRequiredString(root, "turn_id", "", issues);
  const sessionId = parseRequiredString(root, "session_id", "", issues);
  const ingressId = parseRequiredString(root, "ingress_id", "", issues);
  const state = parseRequiredLiteral(root, "state", "", TURN_STATES, issues);
  const stepCount = parseRequiredNonNegativeInteger(root, "step_count", "", issues);
  const budget = parseRequiredBudget(root, "budget", "", issues);
  const contextRefs = parseRequiredContextRefs(root, "context_refs", "", issues);
  const compactionRevision = parseRequiredNonNegativeInteger(
    root,
    "compaction_revision",
    "",
    issues,
  );
  const finalOutcome = parseOptionalString(root, "final_outcome", "", issues);
  const createdAt = parseRequiredUtcTimestamp(root, "created_at", "", issues);
  const updatedAt = parseRequiredUtcTimestamp(root, "updated_at", "", issues);

  if (
    issues.length > 0 ||
    turnId === undefined ||
    sessionId === undefined ||
    ingressId === undefined ||
    state === undefined ||
    stepCount === undefined ||
    budget === undefined ||
    contextRefs === undefined ||
    compactionRevision === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    throw new TurnEnvelopeValidationError(issues);
  }

  return Object.freeze({
    turn_id: turnId,
    session_id: sessionId,
    ingress_id: ingressId,
    state,
    step_count: stepCount,
    budget,
    context_refs: contextRefs,
    compaction_revision: compactionRevision,
    ...(finalOutcome !== undefined ? { final_outcome: finalOutcome } : {}),
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

function parseRequiredBudget(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): TurnBudget | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    issues.push({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const budgetRecord = expectRecord(record[key], fieldPath, issues);
  if (!budgetRecord) {
    return undefined;
  }

  pushUnknownKeys(budgetRecord, TURN_BUDGET_FIELDS, fieldPath, issues);

  const maxInferenceSteps = parseRequiredNonNegativeInteger(
    budgetRecord,
    "max_inference_steps",
    fieldPath,
    issues,
  );
  const maxRepairAttempts = parseRequiredNonNegativeInteger(
    budgetRecord,
    "max_repair_attempts",
    fieldPath,
    issues,
  );
  const maxWallClockMs = parseRequiredNonNegativeInteger(
    budgetRecord,
    "max_wall_clock_ms",
    fieldPath,
    issues,
  );
  const repairAttemptsUsed = parseRequiredNonNegativeInteger(
    budgetRecord,
    "repair_attempts_used",
    fieldPath,
    issues,
  );

  if (
    maxInferenceSteps === undefined ||
    maxRepairAttempts === undefined ||
    maxWallClockMs === undefined ||
    repairAttemptsUsed === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    max_inference_steps: maxInferenceSteps,
    max_repair_attempts: maxRepairAttempts,
    max_wall_clock_ms: maxWallClockMs,
    repair_attempts_used: repairAttemptsUsed,
  });
}

function parseRequiredContextRefs(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): readonly ContentRef[] | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    issues.push({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array.`,
    });
    return undefined;
  }

  const contentRefs: ContentRef[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${fieldPath}[${index}]`;
    const contentRef = parseContentRefAtPath(value[index], itemPath, (issue) => {
      issues.push(issue);
    });

    if (contentRef) {
      contentRefs.push(contentRef);
    }
  }

  return Object.freeze(contentRefs);
}

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): string | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    issues.push({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  return parseStringValue(record[key], fieldPath, issues);
}

function parseOptionalString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): string | undefined {
  if (!(key in record)) {
    return undefined;
  }

  return parseStringValue(record[key], joinPath(path, key), issues);
}

function parseRequiredLiteral<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  literals: readonly T[],
  issues: TurnEnvelopeValidationIssue[],
): T | undefined {
  const fieldPath = joinPath(path, key);
  const value = parseRequiredString(record, key, path, issues);

  if (value === undefined) {
    return undefined;
  }

  if (!literals.includes(value as T)) {
    issues.push({
      path: fieldPath,
      code: "invalid_literal",
      message: `Expected "${fieldPath}" to be one of ${literals.map((item) => `"${item}"`).join(", ")}.`,
    });
    return undefined;
  }

  return value as T;
}

function parseRequiredNonNegativeInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): number | undefined {
  const fieldPath = joinPath(path, key);

  if (!(key in record)) {
    issues.push({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  const value = record[key];
  if (typeof value !== "number") {
    issues.push({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a number.`,
    });
    return undefined;
  }

  if (!Number.isInteger(value)) {
    issues.push({
      path: fieldPath,
      code: "invalid_integer",
      message: `Expected "${fieldPath}" to be an integer.`,
    });
    return undefined;
  }

  if (value < 0) {
    issues.push({
      path: fieldPath,
      code: "invalid_value",
      message: `Expected "${fieldPath}" to be greater than or equal to 0.`,
    });
    return undefined;
  }

  return value;
}

function parseRequiredUtcTimestamp(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): string | undefined {
  const fieldPath = joinPath(path, key);
  const value = parseRequiredString(record, key, path, issues);

  if (value === undefined) {
    return undefined;
  }

  if (!isValidUtcTimestamp(value)) {
    issues.push({
      path: fieldPath,
      code: "invalid_format",
      message: `Expected "${fieldPath}" to be a valid UTC timestamp string.`,
    });
    return undefined;
  }

  return value;
}

function parseStringValue(
  value: unknown,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): string | undefined {
  if (typeof value !== "string") {
    issues.push({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be a string.`,
    });
    return undefined;
  }

  return value;
}

function expectRecord(
  value: unknown,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): UnknownRecord | undefined {
  if (!isPlainObject(value)) {
    issues.push({
      path: path || "$",
      code: "invalid_type",
      message: `Expected "${path || "$"}" to be an object.`,
    });
    return undefined;
  }

  return value;
}

function pushUnknownKeys(
  record: UnknownRecord,
  allowedKeys: Set<string>,
  path: string,
  issues: TurnEnvelopeValidationIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (allowedKeys.has(key)) {
      continue;
    }

    const fieldPath = joinPath(path, key);
    issues.push({
      path: fieldPath,
      code: "unknown_key",
      message: `Unknown field "${fieldPath}".`,
    });
  }
}

function isValidUtcTimestamp(value: string): boolean {
  const normalizedValue = value.trim();
  const isoMatch = ISO_UTC_TIMESTAMP_PATTERN.exec(normalizedValue);
  if (isoMatch) {
    const parsed = new Date(normalizedValue);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    const [, year, month, day, hour, minute, second] = isoMatch;
    return (
      parsed.getUTCFullYear() === Number(year) &&
      parsed.getUTCMonth() + 1 === Number(month) &&
      parsed.getUTCDate() === Number(day) &&
      parsed.getUTCHours() === Number(hour) &&
      parsed.getUTCMinutes() === Number(minute) &&
      parsed.getUTCSeconds() === Number(second)
    );
  }

  if (!/\b(?:UTC|GMT)$/.test(normalizedValue)) {
    return false;
  }

  const parsed = new Date(normalizedValue);
  return !Number.isNaN(parsed.getTime());
}

function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}