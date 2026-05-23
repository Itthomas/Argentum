export interface RuntimeConfigWorkspaceDTO {
  bedrock_root: string;
  working_root: string;
  artifacts_root: string;
  logs_root: string;
}

export interface RuntimeConfigProviderDTO {
  name: "deepseek";
  model_id: string;
  endpoint: string;
  temperature?: number;
  max_output_tokens?: number;
}

export interface RuntimeConfigGovernorDTO {
  max_inference_steps: number;
  max_repair_attempts: number;
  max_wall_clock_ms: number;
}

export interface RuntimeConfigGatewayDTO {
  max_queued_ingress_per_session: number;
  queue_overflow_policy: "reject_newest";
}

export interface RuntimeConfigToolPolicyDTO {
  enabled_tools: string[];
  enabled_secret_handles: string[];
  max_tool_runtime_ms: number;
  trusted_local_mode: boolean;
}

export interface RuntimeConfigTelemetryDTO {
  format: "jsonl";
  persist_events: boolean;
}

export interface RuntimeConfigFeaturesDTO {
  enable_native_tool_calling?: boolean;
}

export interface RuntimeConfigDTO {
  workspace: RuntimeConfigWorkspaceDTO;
  provider: RuntimeConfigProviderDTO;
  governor: RuntimeConfigGovernorDTO;
  gateway: RuntimeConfigGatewayDTO;
  tool_policy: RuntimeConfigToolPolicyDTO;
  telemetry: RuntimeConfigTelemetryDTO;
  features?: RuntimeConfigFeaturesDTO;
}

export type RuntimeConfigValidationCode =
  | "invalid_integer"
  | "invalid_literal"
  | "invalid_type"
  | "missing_required"
  | "unknown_key";

export interface RuntimeConfigValidationIssue {
  path: string;
  code: RuntimeConfigValidationCode;
  message: string;
}

export class RuntimeConfigValidationError extends Error {
  readonly issues: RuntimeConfigValidationIssue[];

  constructor(issues: RuntimeConfigValidationIssue[]) {
    const summary = `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`;
    super(`Invalid runtime config: ${summary}.`);
    this.name = "RuntimeConfigValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

const ROOT_SECTIONS = new Set([
  "workspace",
  "provider",
  "governor",
  "gateway",
  "tool_policy",
  "telemetry",
  "features",
]);

const WORKSPACE_FIELDS = new Set([
  "bedrock_root",
  "working_root",
  "artifacts_root",
  "logs_root",
]);

const PROVIDER_FIELDS = new Set([
  "name",
  "model_id",
  "endpoint",
  "temperature",
  "max_output_tokens",
]);

const GOVERNOR_FIELDS = new Set([
  "max_inference_steps",
  "max_repair_attempts",
  "max_wall_clock_ms",
]);

const GATEWAY_FIELDS = new Set([
  "max_queued_ingress_per_session",
  "queue_overflow_policy",
]);

const TOOL_POLICY_FIELDS = new Set([
  "enabled_tools",
  "enabled_secret_handles",
  "max_tool_runtime_ms",
  "trusted_local_mode",
]);

const TELEMETRY_FIELDS = new Set(["format", "persist_events"]);

const FEATURES_FIELDS = new Set(["enable_native_tool_calling"]);

export function parseRuntimeConfig(value: unknown): RuntimeConfigDTO {
  const issues: RuntimeConfigValidationIssue[] = [];
  const root = expectRecord(value, "$", issues);

  if (!root) {
    throw new RuntimeConfigValidationError(issues);
  }

  pushUnknownKeys(root, ROOT_SECTIONS, "", issues);

  const workspace = parseRequiredSection(root, "workspace", parseWorkspace, issues);
  const provider = parseRequiredSection(root, "provider", parseProvider, issues);
  const governor = parseRequiredSection(root, "governor", parseGovernor, issues);
  const gateway = parseRequiredSection(root, "gateway", parseGateway, issues);
  const toolPolicy = parseRequiredSection(root, "tool_policy", parseToolPolicy, issues);
  const telemetry = parseRequiredSection(root, "telemetry", parseTelemetry, issues);
  const features = parseOptionalSection(root, "features", parseFeatures, issues);

  if (issues.length > 0 || !workspace || !provider || !governor || !gateway || !toolPolicy || !telemetry) {
    throw new RuntimeConfigValidationError(issues);
  }

  return {
    workspace,
    provider,
    governor,
    gateway,
    tool_policy: toolPolicy,
    telemetry,
    ...(features ? { features } : {}),
  };
}

function parseRequiredSection<T>(
  root: UnknownRecord,
  key: string,
  parser: (value: unknown, path: string, issues: RuntimeConfigValidationIssue[]) => T | undefined,
  issues: RuntimeConfigValidationIssue[],
): T | undefined {
  if (!(key in root)) {
    issues.push({
      path: key,
      code: "missing_required",
      message: `Missing required section "${key}".`,
    });
    return undefined;
  }

  return parser(root[key], key, issues);
}

function parseOptionalSection<T>(
  root: UnknownRecord,
  key: string,
  parser: (value: unknown, path: string, issues: RuntimeConfigValidationIssue[]) => T | undefined,
  issues: RuntimeConfigValidationIssue[],
): T | undefined {
  if (!(key in root)) {
    return undefined;
  }

  return parser(root[key], key, issues);
}

function parseWorkspace(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): RuntimeConfigWorkspaceDTO | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, WORKSPACE_FIELDS, path, issues);

  const bedrockRoot = parseRequiredString(record, "bedrock_root", path, issues);
  const workingRoot = parseRequiredString(record, "working_root", path, issues);
  const artifactsRoot = parseRequiredString(record, "artifacts_root", path, issues);
  const logsRoot = parseRequiredString(record, "logs_root", path, issues);

  if (
    bedrockRoot === undefined ||
    workingRoot === undefined ||
    artifactsRoot === undefined ||
    logsRoot === undefined
  ) {
    return undefined;
  }

  return {
    bedrock_root: bedrockRoot,
    working_root: workingRoot,
    artifacts_root: artifactsRoot,
    logs_root: logsRoot,
  };
}

function parseProvider(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): RuntimeConfigProviderDTO | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, PROVIDER_FIELDS, path, issues);

  const name = parseRequiredLiteral(record, "name", path, ["deepseek"], issues);
  const modelId = parseRequiredString(record, "model_id", path, issues);
  const endpoint = parseRequiredString(record, "endpoint", path, issues);
  const temperature = parseOptionalNumber(record, "temperature", path, issues);
  const maxOutputTokens = parseOptionalInteger(record, "max_output_tokens", path, issues);

  if (name === undefined || modelId === undefined || endpoint === undefined) {
    return undefined;
  }

  return {
    name,
    model_id: modelId,
    endpoint,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
  };
}

function parseGovernor(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): RuntimeConfigGovernorDTO | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, GOVERNOR_FIELDS, path, issues);

  const maxInferenceSteps = parseRequiredInteger(record, "max_inference_steps", path, issues);
  const maxRepairAttempts = parseRequiredInteger(record, "max_repair_attempts", path, issues);
  const maxWallClockMs = parseRequiredInteger(record, "max_wall_clock_ms", path, issues);

  if (
    maxInferenceSteps === undefined ||
    maxRepairAttempts === undefined ||
    maxWallClockMs === undefined
  ) {
    return undefined;
  }

  return {
    max_inference_steps: maxInferenceSteps,
    max_repair_attempts: maxRepairAttempts,
    max_wall_clock_ms: maxWallClockMs,
  };
}

function parseGateway(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): RuntimeConfigGatewayDTO | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, GATEWAY_FIELDS, path, issues);

  const maxQueuedIngressPerSession = parseRequiredInteger(
    record,
    "max_queued_ingress_per_session",
    path,
    issues,
  );
  const queueOverflowPolicy = parseRequiredLiteral(
    record,
    "queue_overflow_policy",
    path,
    ["reject_newest"],
    issues,
  );

  if (maxQueuedIngressPerSession === undefined || queueOverflowPolicy === undefined) {
    return undefined;
  }

  return {
    max_queued_ingress_per_session: maxQueuedIngressPerSession,
    queue_overflow_policy: queueOverflowPolicy,
  };
}

function parseToolPolicy(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): RuntimeConfigToolPolicyDTO | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, TOOL_POLICY_FIELDS, path, issues);

  const enabledTools = parseRequiredStringArray(record, "enabled_tools", path, issues);
  const enabledSecretHandles = parseRequiredStringArray(
    record,
    "enabled_secret_handles",
    path,
    issues,
  );
  const maxToolRuntimeMs = parseRequiredInteger(record, "max_tool_runtime_ms", path, issues);
  const trustedLocalMode = parseRequiredBoolean(record, "trusted_local_mode", path, issues);

  if (
    enabledTools === undefined ||
    enabledSecretHandles === undefined ||
    maxToolRuntimeMs === undefined ||
    trustedLocalMode === undefined
  ) {
    return undefined;
  }

  return {
    enabled_tools: enabledTools,
    enabled_secret_handles: enabledSecretHandles,
    max_tool_runtime_ms: maxToolRuntimeMs,
    trusted_local_mode: trustedLocalMode,
  };
}

function parseTelemetry(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): RuntimeConfigTelemetryDTO | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, TELEMETRY_FIELDS, path, issues);

  const format = parseRequiredLiteral(record, "format", path, ["jsonl"], issues);
  const persistEvents = parseRequiredBoolean(record, "persist_events", path, issues);

  if (format === undefined || persistEvents === undefined) {
    return undefined;
  }

  return {
    format,
    persist_events: persistEvents,
  };
}

function parseFeatures(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): RuntimeConfigFeaturesDTO | undefined {
  const record = expectRecord(value, path, issues);
  if (!record) {
    return undefined;
  }

  pushUnknownKeys(record, FEATURES_FIELDS, path, issues);

  const enableNativeToolCalling = parseOptionalBoolean(
    record,
    "enable_native_tool_calling",
    path,
    issues,
  );

  return enableNativeToolCalling === undefined
    ? {}
    : { enable_native_tool_calling: enableNativeToolCalling };
}

function parseRequiredString(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: RuntimeConfigValidationIssue[],
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

function parseRequiredLiteral<T extends string>(
  record: UnknownRecord,
  key: string,
  path: string,
  literals: readonly T[],
  issues: RuntimeConfigValidationIssue[],
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
  issues: RuntimeConfigValidationIssue[],
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

function parseOptionalInteger(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): number | undefined {
  if (!(key in record)) {
    return undefined;
  }

  return parseIntegerValue(record[key], joinPath(path, key), issues);
}

function parseOptionalNumber(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): number | undefined {
  if (!(key in record)) {
    return undefined;
  }

  return parseNumberValue(record[key], joinPath(path, key), issues);
}

function parseRequiredBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): boolean | undefined {
  const fieldPath = joinPath(path, key);
  if (!(key in record)) {
    issues.push({
      path: fieldPath,
      code: "missing_required",
      message: `Missing required field "${fieldPath}".`,
    });
    return undefined;
  }

  return parseBooleanValue(record[key], fieldPath, issues);
}

function parseOptionalBoolean(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): boolean | undefined {
  if (!(key in record)) {
    return undefined;
  }

  return parseBooleanValue(record[key], joinPath(path, key), issues);
}

function parseRequiredStringArray(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): string[] | undefined {
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
      message: `Expected "${fieldPath}" to be an array of strings.`,
    });
    return undefined;
  }

  const parsed: string[] = [];
  let hasInvalidMember = false;

  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemPath = `${fieldPath}[${index}]`;
    if (typeof item !== "string") {
      issues.push({
        path: itemPath,
        code: "invalid_type",
        message: `Expected "${itemPath}" to be a string.`,
      });
      hasInvalidMember = true;
      continue;
    }

    parsed.push(item);
  }

  return hasInvalidMember ? undefined : parsed;
}

function parseStringValue(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
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

function parseBooleanValue(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): boolean | undefined {
  if (typeof value !== "boolean") {
    issues.push({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be a boolean.`,
    });
    return undefined;
  }

  return value;
}

function parseNumberValue(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    issues.push({
      path,
      code: "invalid_type",
      message: `Expected "${path}" to be a number.`,
    });
    return undefined;
  }

  return value;
}

function parseIntegerValue(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): number | undefined {
  const numberValue = parseNumberValue(value, path, issues);
  if (numberValue === undefined) {
    return undefined;
  }

  if (!Number.isInteger(numberValue)) {
    issues.push({
      path,
      code: "invalid_integer",
      message: `Expected "${path}" to be an integer.`,
    });
    return undefined;
  }

  return numberValue;
}

function expectRecord(
  value: unknown,
  path: string,
  issues: RuntimeConfigValidationIssue[],
): UnknownRecord | undefined {
  if (!isRecord(value)) {
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
  issues: RuntimeConfigValidationIssue[],
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(path: string, key: string): string {
  return path.length === 0 ? key : `${path}.${key}`;
}