// NOTE: stream-event.ts retains local expectRecord/joinPath/pushUnknownKeys
// because its callers use array.push() rather than the callback-based
// signatures exported from validation-helpers.ts.  A future extraction
// pass can unify the pattern.

export type StreamEventScope = "session" | "turn";

export type StreamEventVisibility = "user" | "system" | "telemetry";

export interface StreamEventPayload {
  [key: string]: unknown;
}

export interface StreamEventBase<TPayload extends StreamEventPayload = StreamEventPayload> {
  event_id: string;
  session_id: string;
  sequence: number;
  kind: string;
  timestamp: string;
  visibility: StreamEventVisibility;
  payload: TPayload;
}

export interface SessionStreamEvent<TPayload extends StreamEventPayload = StreamEventPayload>
  extends StreamEventBase<TPayload> {
  scope: "session";
  turn_id?: string;
}

export interface TurnStreamEvent<TPayload extends StreamEventPayload = StreamEventPayload>
  extends StreamEventBase<TPayload> {
  scope: "turn";
  turn_id: string;
}

export type StreamEvent<TPayload extends StreamEventPayload = StreamEventPayload> =
  | SessionStreamEvent<TPayload>
  | TurnStreamEvent<TPayload>;

export const SESSION_SCOPED_STREAM_EVENT_FAMILIES = ["queue."] as const;

export const TURN_SCOPED_STREAM_EVENT_FAMILIES = [
  "turn.",
  "validation.",
  "llm.",
  "tool.",
  "memory.",
  "response.",
] as const;

export const MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS = {
  "turn.started": ["session_id", "ingress_id", "state"],
  "turn.state_changed": ["from_state", "to_state"],
  "turn.completed": ["final_outcome", "step_count"],
  "turn.aborted": ["reason", "error_code"],
  "validation.failed": ["phase", "reason", "repairable"],
  "validation.repair_requested": ["phase", "attempt_number"],
  "llm.started": ["request_id", "tool_count"],
  "llm.completed": ["request_id", "normalization_status"],
  "llm.failed": ["request_id", "reason", "error_code"],
  "tool.planned": ["call_id", "tool_name"],
  "tool.started": ["call_id", "tool_name"],
  "tool.finished": ["call_id", "tool_name", "status", "duration_ms"],
  "tool.blocked": ["call_id", "tool_name", "reason", "error_code"],
  "memory.compaction_started": ["call_id", "compaction_revision"],
  "memory.compaction_committed": [
    "call_id",
    "compaction_revision",
    "artifact_count",
  ],
  "response.started": ["response_kind"],
  "response.completed": ["response_kind", "final_outcome"],
  "queue.queued": ["session_id", "ingress_id", "queue_length"],
  "queue.dequeued": ["session_id", "ingress_id", "queue_length"],
  "queue.rejected": ["session_id", "ingress_id", "queue_length", "reason"],
} as const satisfies Record<string, readonly string[]>;

export type MvpStreamEventKind = keyof typeof MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS;

type RequiredPayloadShape<Fields extends readonly string[]> = StreamEventPayload & {
  [K in Fields[number]]: unknown;
};

export type MvpStreamEventPayloadByKind = {
  [K in MvpStreamEventKind]: RequiredPayloadShape<
    (typeof MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS)[K]
  >;
};

export type StreamEventValidationCode =
  | "invalid_format"
  | "invalid_integer"
  | "invalid_literal"
  | "invalid_scope"
  | "invalid_type"
  | "missing_required"
  | "unknown_key";

export interface StreamEventValidationIssue {
  path: string;
  code: StreamEventValidationCode;
  message: string;
}

export class StreamEventValidationError extends Error {
  readonly issues: StreamEventValidationIssue[];

  constructor(issues: StreamEventValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid stream event: ${summary}.`);
    this.name = "StreamEventValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

const TOP_LEVEL_FIELDS = new Set([
  "event_id",
  "session_id",
  "scope",
  "turn_id",
  "sequence",
  "kind",
  "timestamp",
  "visibility",
  "payload",
]);

const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

export function parseStreamEvent(value: unknown): StreamEvent {
  const issues: StreamEventValidationIssue[] = [];
  const root = expectRecord(value, "$", issues);

  if (!root) {
    throw new StreamEventValidationError(issues);
  }

  pushUnknownKeys(root, TOP_LEVEL_FIELDS, "", issues);

  const eventId = parseRequiredString(root, "event_id", "", issues);
  const sessionId = parseRequiredString(root, "session_id", "", issues);
  const scope = parseRequiredLiteral(root, "scope", "", ["session", "turn"], issues);
  const hasTurnId = "turn_id" in root;
  const turnId = parseOptionalString(root, "turn_id", "", issues);
  const sequence = parseRequiredInteger(root, "sequence", "", issues);
  const kind = parseRequiredString(root, "kind", "", issues);
  const timestamp = parseRequiredUtcTimestamp(root, "timestamp", "", issues);
  const visibility = parseRequiredLiteral(
    root,
    "visibility",
    "",
    ["user", "system", "telemetry"],
    issues,
  );
  const payload = parseRequiredPayload(root, "payload", "", issues);

  if (scope === "turn" && !hasTurnId) {
    issues.push({
      path: "turn_id",
      code: "missing_required",
      message: 'Missing required field "turn_id" when "scope" is "turn".',
    });
  }

  if (kind !== undefined && scope !== undefined) {
    const expectedScope = getExpectedScope(kind);

    if (expectedScope && scope !== expectedScope) {
      issues.push({
        path: "scope",
        code: "invalid_scope",
        message: `Expected event kind "${kind}" to use scope "${expectedScope}".`,
      });
    }
  }

  if (payload && kind !== undefined) {
    enforceMinimumPayloadFields(kind, payload, issues);
  }

  if (
    issues.length > 0 ||
    eventId === undefined ||
    sessionId === undefined ||
    scope === undefined ||
    sequence === undefined ||
    kind === undefined ||
    timestamp === undefined ||
    visibility === undefined ||
    payload === undefined ||
    (scope === "turn" && turnId === undefined)
  ) {
    throw new StreamEventValidationError(issues);
  }

  if (scope === "turn") {
    if (turnId === undefined) {
      throw new StreamEventValidationError(issues);
    }

    return {
      event_id: eventId,
      session_id: sessionId,
      scope,
      turn_id: turnId,
      sequence,
      kind,
      timestamp,
      visibility,
      payload,
    };
  }

  return {
    event_id: eventId,
    session_id: sessionId,
    scope,
    ...(turnId !== undefined ? { turn_id: turnId } : {}),
    sequence,
    kind,
    timestamp,
    visibility,
    payload,
  };
}

function getExpectedScope(kind: string): StreamEventScope | undefined {
  if (SESSION_SCOPED_STREAM_EVENT_FAMILIES.some((prefix) => kind.startsWith(prefix))) {
    return "session";
  }

  if (TURN_SCOPED_STREAM_EVENT_FAMILIES.some((prefix) => kind.startsWith(prefix))) {
    return "turn";
  }

  return undefined;
}

function enforceMinimumPayloadFields(
  kind: string,
  payload: StreamEventPayload,
  issues: StreamEventValidationIssue[],
): void {
  const requiredFields = MINIMUM_STREAM_EVENT_PAYLOAD_FIELDS[
    kind as MvpStreamEventKind
  ] as readonly string[] | undefined;

  if (!requiredFields) {
    return;
  }

  for (const field of requiredFields) {
    if (field in payload) {
      continue;
    }

    issues.push({
      path: joinPath("payload", field),
      code: "missing_required",
      message: `Missing required field "payload.${field}" for event kind "${kind}".`,
    });
  }
}

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StreamEventValidationIssue[],
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
  issues: StreamEventValidationIssue[],
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
  issues: StreamEventValidationIssue[],
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

function parseRequiredInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StreamEventValidationIssue[],
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

  return parseIntegerValue(record[key], fieldPath, issues);
}

function parseRequiredUtcTimestamp(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StreamEventValidationIssue[],
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
      message: `Expected "${fieldPath}" to be a valid UTC timestamp string ending in "Z".`,
    });
    return undefined;
  }

  return value;
}

function isValidUtcTimestamp(value: string): boolean {
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
  ] = match;

  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day) &&
    parsed.getUTCHours() === Number(hour) &&
    parsed.getUTCMinutes() === Number(minute) &&
    parsed.getUTCSeconds() === Number(second)
  );
}

function parseRequiredPayload(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: StreamEventValidationIssue[],
): StreamEventPayload | undefined {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    issues.push({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  return expectRecord(record[key], fieldPath, issues);
}

function parseStringValue(
  value: unknown,
  path: string,
  issues: StreamEventValidationIssue[],
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

function parseIntegerValue(
  value: unknown,
  path: string,
  issues: StreamEventValidationIssue[],
): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    issues.push({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be a number.`,
    });
    return undefined;
  }

  if (!Number.isInteger(value)) {
    issues.push({
      path,
      code: "invalid_integer",
      message: `Expected "${path}" to be an integer.`,
    });
    return undefined;
  }

  return value;
}

function expectRecord(
  value: unknown,
  path: string,
  issues: StreamEventValidationIssue[],
): UnknownRecord | undefined {
  if (!isPlainRecord(value)) {
    issues.push({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be an object.`,
    });
    return undefined;
  }

  return value;
}

function pushUnknownKeys(
  record: UnknownRecord,
  allowedKeys: ReadonlySet<string>,
  path: string,
  issues: StreamEventValidationIssue[],
): void {
  for (const key of Object.keys(record).sort()) {
    if (allowedKeys.has(key)) {
      continue;
    }

    const fieldPath = joinPath(path, key);
    issues.push({
      path: fieldPath,
      code: "unknown_key",
      message: `Unknown key "${fieldPath}" is not allowed.`,
    });
  }
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function joinPath(path: string, key: string): string {
  return path.length === 0 ? key : `${path}.${key}`;
}