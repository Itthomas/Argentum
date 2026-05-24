import {
  expectRecord,
  isPlainObject,
  joinPath,
  pushUnknownKeys,
} from "./validation-helpers.js";

export type ContentRefKind = "text" | "json" | "trace" | "file" | "blob";

export type ContentRefStorageArea = "bedrock" | "working" | "artifacts" | "logs";

export type ContentRefRetention = "persistent" | "session" | "ephemeral";

export interface ContentRef {
  readonly ref_id: string;
  readonly kind: ContentRefKind;
  readonly storage_area: ContentRefStorageArea;
  readonly locator: string;
  readonly media_type?: string;
  readonly retention: ContentRefRetention;
}

export type ContentRefValidationCode =
  | "invalid_value"
  | "invalid_literal"
  | "invalid_type"
  | "missing_required"
  | "unknown_key";

export interface ContentRefValidationIssue {
  path: string;
  code: ContentRefValidationCode;
  message: string;
}

export class ContentRefValidationError extends Error {
  readonly issues: ContentRefValidationIssue[];

  constructor(issues: ContentRefValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid content ref: ${summary}.`);
    this.name = "ContentRefValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

const CONTENT_REF_FIELDS = new Set([
  "ref_id",
  "kind",
  "storage_area",
  "locator",
  "media_type",
  "retention",
]);

export function parseContentRef(value: unknown): ContentRef {
  const issues: ContentRefValidationIssue[] = [];
  const contentRef = parseContentRefAtPath(value, "", (issue) => {
    issues.push(issue);
  });

  if (!contentRef || issues.length > 0) {
    throw new ContentRefValidationError(issues);
  }

  return contentRef;
}

export function parseContentRefAtPath(
  value: unknown,
  path: string,
  addIssue: (issue: ContentRefValidationIssue) => void,
): ContentRef | undefined {
  const record = expectRecord(value, path, addIssue);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, CONTENT_REF_FIELDS, path, addIssue);

  const refId = parseRequiredString(record, "ref_id", path, addIssue);
  const kind = parseRequiredLiteral(
    record,
    "kind",
    path,
    ["text", "json", "trace", "file", "blob"],
    addIssue,
  );
  const storageArea = parseRequiredLiteral(
    record,
    "storage_area",
    path,
    ["bedrock", "working", "artifacts", "logs"],
    addIssue,
  );
  const locator = parseRequiredString(record, "locator", path, addIssue);
  const mediaType = parseOptionalString(record, "media_type", path, addIssue);
  const retention = parseRequiredLiteral(
    record,
    "retention",
    path,
    ["persistent", "session", "ephemeral"],
    addIssue,
  );

  if (
    refId === undefined ||
    kind === undefined ||
    storageArea === undefined ||
    locator === undefined ||
    retention === undefined
  ) {
    return undefined;
  }

  if (!isRelativeLocator(locator)) {
    addIssue({
      path: joinPath(path, "locator"),
      code: "invalid_value",
      message: `Expected "${joinPath(path, "locator")}" to be relative to the declared storage area.`,
    });
    return undefined;
  }

  return Object.freeze({
    ref_id: refId,
    kind,
    storage_area: storageArea,
    locator,
    ...(mediaType !== undefined ? { media_type: mediaType } : {}),
    retention,
  });
}

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  addIssue: (issue: ContentRefValidationIssue) => void,
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
  addIssue: (issue: ContentRefValidationIssue) => void,
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
  addIssue: (issue: ContentRefValidationIssue) => void,
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
  addIssue: (issue: ContentRefValidationIssue) => void,
): string | undefined {
  if (typeof value !== "string") {
    addIssue({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be a string.`,
    });
    return undefined;
  }

  return value;
}

function isRelativeLocator(value: string): boolean {
  if (value.length === 0) {
    return true;
  }

  if (value.startsWith("/") || value.startsWith("\\")) {
    return false;
  }

  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    return false;
  }

  return true;
}