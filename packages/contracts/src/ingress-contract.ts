import {
  type MessagePart,
  type MessagePartValidationIssue,
  parseMessagePartAtPath,
} from "./message-part.js";

export interface IngressDTO {
  readonly ingress_id: string;
  readonly session_id: string;
  readonly channel: string;
  readonly user_id: string;
  readonly message_parts: readonly MessagePart[];
  readonly attachments?: readonly [];
  readonly received_at: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type IngressValidationCode =
  | MessagePartValidationIssue["code"]
  | "invalid_format"
  | "invalid_value";

export interface IngressValidationIssue {
  path: string;
  code: IngressValidationCode;
  message: string;
}

export class IngressValidationError extends Error {
  readonly issues: IngressValidationIssue[];

  constructor(issues: IngressValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid ingress DTO: ${summary}.`);
    this.name = "IngressValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

const INGRESS_FIELDS = new Set([
  "ingress_id",
  "session_id",
  "channel",
  "user_id",
  "message_parts",
  "attachments",
  "received_at",
  "metadata",
]);

const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

const EMPTY_ATTACHMENTS = Object.freeze([]) as readonly [];

export function parseIngressDTO(value: unknown): IngressDTO {
  const issues: IngressValidationIssue[] = [];
  const root = expectRecord(value, "", issues);

  if (!root) {
    throw new IngressValidationError(issues);
  }

  pushUnknownKeys(root, INGRESS_FIELDS, "", issues);

  const ingressId = parseRequiredString(root, "ingress_id", "", issues);
  const sessionId = parseRequiredString(root, "session_id", "", issues);
  const channel = parseRequiredString(root, "channel", "", issues);
  const userId = parseRequiredString(root, "user_id", "", issues);
  const messageParts = parseRequiredMessageParts(root, "message_parts", "", issues);
  const attachments = parseOptionalAttachments(root, "attachments", "", issues);
  const receivedAt = parseRequiredUtcTimestamp(root, "received_at", "", issues);
  const metadata = parseOptionalRecord(root, "metadata", "", issues);

  if (
    issues.length > 0 ||
    ingressId === undefined ||
    sessionId === undefined ||
    channel === undefined ||
    userId === undefined ||
    messageParts === undefined ||
    receivedAt === undefined
  ) {
    throw new IngressValidationError(issues);
  }

  return Object.freeze({
    ingress_id: ingressId,
    session_id: sessionId,
    channel,
    user_id: userId,
    message_parts: messageParts,
    ...(attachments !== undefined ? { attachments } : {}),
    received_at: receivedAt,
    ...(metadata !== undefined ? { metadata } : {}),
  });
}

function parseRequiredMessageParts(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: IngressValidationIssue[],
): readonly MessagePart[] | undefined {
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

  const messageParts: MessagePart[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${fieldPath}[${index}]`;
    const messagePart = parseMessagePartAtPath(
      value[index],
      itemPath,
      issues as MessagePartValidationIssue[],
    );

    if (messagePart) {
      messageParts.push(messagePart);
    }
  }

  return Object.freeze(messageParts);
}

function parseOptionalAttachments(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: IngressValidationIssue[],
): readonly [] | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const fieldPath = joinPath(path, key);
  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an array when present.`,
    });
    return undefined;
  }

  if (value.length > 0) {
    issues.push({
      path: fieldPath,
      code: "invalid_value",
      message: `Expected "${fieldPath}" to be omitted or an empty array until attachment item schema is defined.`,
    });
    return undefined;
  }

  return EMPTY_ATTACHMENTS;
}

function parseRequiredUtcTimestamp(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: IngressValidationIssue[],
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

function parseOptionalRecord(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: IngressValidationIssue[],
): Readonly<Record<string, unknown>> | undefined {
  if (!(key in record)) {
    return undefined;
  }

  const fieldPath = joinPath(path, key);
  const value = record[key];

  if (!isPlainObject(value)) {
    issues.push({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be an object.`,
    });
    return undefined;
  }

  return cloneAndFreezeRecord(value);
}

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: IngressValidationIssue[],
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

  const value = record[key];
  if (typeof value !== "string") {
    issues.push({
      path: fieldPath,
      code: "invalid_type",
      message: `Expected "${fieldPath}" to be a string.`,
    });
    return undefined;
  }

  return value;
}

function expectRecord(
  value: unknown,
  path: string,
  issues: IngressValidationIssue[],
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
  issues: IngressValidationIssue[],
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

function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

  const [, year, month, day, hour, minute, second] = match;
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day) &&
    parsed.getUTCHours() === Number(hour) &&
    parsed.getUTCMinutes() === Number(minute) &&
    parsed.getUTCSeconds() === Number(second)
  );
}

function cloneAndFreezeRecord(record: UnknownRecord): Readonly<Record<string, unknown>> {
  const clone: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    clone[key] = cloneAndFreezeUnknown(value);
  }

  return Object.freeze(clone);
}

function cloneAndFreezeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreezeUnknown(item)));
  }

  if (isPlainObject(value)) {
    return cloneAndFreezeRecord(value);
  }

  return value;
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}