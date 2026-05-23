export interface MessagePart {
  readonly kind: "text";
  readonly text: string;
}

export type MessagePartValidationCode =
  | "invalid_literal"
  | "invalid_type"
  | "missing_required"
  | "unknown_key";

export interface MessagePartValidationIssue {
  path: string;
  code: MessagePartValidationCode;
  message: string;
}

export class MessagePartValidationError extends Error {
  readonly issues: MessagePartValidationIssue[];

  constructor(issues: MessagePartValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid message part: ${summary}.`);
    this.name = "MessagePartValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

const MESSAGE_PART_FIELDS = new Set(["kind", "text"]);

export function parseMessagePart(value: unknown): MessagePart {
  const issues: MessagePartValidationIssue[] = [];
  const messagePart = parseMessagePartInternal(value, "", issues);

  if (!messagePart || issues.length > 0) {
    throw new MessagePartValidationError(issues);
  }

  return messagePart;
}

export function parseMessagePartAtPath(
  value: unknown,
  path: string,
  issues: MessagePartValidationIssue[],
): MessagePart | undefined {
  return parseMessagePartInternal(value, path, issues);
}

function parseMessagePartInternal(
  value: unknown,
  path: string,
  issues: MessagePartValidationIssue[],
): MessagePart | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, MESSAGE_PART_FIELDS, path, issues);

  const kind = parseRequiredLiteral(record, "kind", path, ["text"], issues);
  const text = parseRequiredString(record, "text", path, issues);

  if (kind === undefined || text === undefined) {
    return undefined;
  }

  return Object.freeze({
    kind,
    text,
  });
}

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: MessagePartValidationIssue[],
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

function parseRequiredLiteral<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  literals: readonly T[],
  issues: MessagePartValidationIssue[],
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

function expectRecord(
  value: unknown,
  path: string,
  issues: MessagePartValidationIssue[],
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
  issues: MessagePartValidationIssue[],
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

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}