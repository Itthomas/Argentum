import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  RuntimeConfigValidationError,
  parseRuntimeConfig,
  type RuntimeConfigDTO,
  type RuntimePolicyDTO,
  type WorkspaceRootsDTO,
} from "@argentum/contracts";

const DEFAULT_RUNTIME_CONFIG_PATH = path.join("config", "runtime.json");
const MVP_MAX_QUEUED_INGRESS_PER_SESSION = 8;
const SECRET_HANDLES_ENV_VAR = "ARGENTUM_SECRET_HANDLES";

export type RuntimeStartupConfigErrorCode =
  | "config_not_found"
  | "config_unreadable"
  | "config_invalid_json"
  | "config_invalid_shape"
  | "config_invalid_runtime_rules"
  | "workspace_roots_not_distinct"
  | "secret_handles_unavailable";

export interface GovernorDefaults {
  max_inference_steps: number;
  max_repair_attempts: number;
  max_wall_clock_ms: number;
  repair_attempts_used: 0;
}

export interface RuntimeStartupConfigResult {
  configPath: string;
  runtimeConfig: RuntimeConfigDTO;
  workspaceRoots: WorkspaceRootsDTO;
  runtimePolicy: RuntimePolicyDTO;
  governorDefaults: GovernorDefaults;
  gatewayDefaults: RuntimeConfigDTO["gateway"];
}

export interface LoadRuntimeStartupConfigOptions {
  overridePath?: string;
}

interface RuntimeStartupConfigErrorDetails {
  issues?: RuntimeConfigValidationError["issues"];
  missingSecretHandles?: string[];
}

export class RuntimeStartupConfigError extends Error {
  readonly code: RuntimeStartupConfigErrorCode;
  readonly configPath: string;
  readonly details: RuntimeStartupConfigErrorDetails | undefined;

  constructor(
    code: RuntimeStartupConfigErrorCode,
    configPath: string,
    message: string,
    details?: RuntimeStartupConfigErrorDetails,
  ) {
    super(message);
    this.name = "RuntimeStartupConfigError";
    this.code = code;
    this.configPath = configPath;
    this.details = details;
  }
}

export async function loadRuntimeStartupConfig(
  options: LoadRuntimeStartupConfigOptions = {},
): Promise<RuntimeStartupConfigResult> {
  const workspaceRoot = path.resolve(process.cwd());
  const configPath = path.resolve(
    workspaceRoot,
    options.overridePath ?? DEFAULT_RUNTIME_CONFIG_PATH,
  );

  const configText = await readRuntimeConfigFile(configPath);
  const parsedJson = parseRuntimeConfigJson(configText, configPath);
  const runtimeConfig = validateRuntimeConfig(parsedJson, configPath);
  const workspaceRoots = deriveWorkspaceRoots(runtimeConfig, workspaceRoot, configPath);

  validateFrozenMvpRules(runtimeConfig, configPath);
  validateWorkspaceRoots(workspaceRoots, configPath);
  validateSecretHandles(runtimeConfig, process.env, configPath);

  return {
    configPath,
    runtimeConfig,
    workspaceRoots,
    runtimePolicy: deriveRuntimePolicy(runtimeConfig, workspaceRoots),
    governorDefaults: deriveGovernorDefaults(runtimeConfig),
    gatewayDefaults: { ...runtimeConfig.gateway },
  };
}

async function readRuntimeConfigFile(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new RuntimeStartupConfigError(
        "config_not_found",
        configPath,
        `Runtime config file was not found at ${configPath}.`,
      );
    }

    throw new RuntimeStartupConfigError(
      "config_unreadable",
      configPath,
      `Runtime config file could not be read at ${configPath}.`,
    );
  }
}

function parseRuntimeConfigJson(configText: string, configPath: string): unknown {
  try {
    return JSON.parse(configText) as unknown;
  } catch {
    throw new RuntimeStartupConfigError(
      "config_invalid_json",
      configPath,
      `Runtime config file at ${configPath} is not valid JSON.`,
    );
  }
}

function validateRuntimeConfig(value: unknown, configPath: string): RuntimeConfigDTO {
  try {
    return parseRuntimeConfig(value);
  } catch (error) {
    if (error instanceof RuntimeConfigValidationError) {
      throw new RuntimeStartupConfigError(
        "config_invalid_shape",
        configPath,
        `Runtime config file at ${configPath} failed contract validation.`,
        { issues: error.issues },
      );
    }

    throw error;
  }
}

function deriveWorkspaceRoots(
  runtimeConfig: RuntimeConfigDTO,
  workspaceRoot: string,
  configPath: string,
): WorkspaceRootsDTO {
  try {
    return {
      bedrock: resolveWorkspacePath(workspaceRoot, runtimeConfig.workspace.bedrock_root),
      working: resolveWorkspacePath(workspaceRoot, runtimeConfig.workspace.working_root),
      artifacts: resolveWorkspacePath(workspaceRoot, runtimeConfig.workspace.artifacts_root),
      logs: resolveWorkspacePath(workspaceRoot, runtimeConfig.workspace.logs_root),
    };
  } catch {
    throw new RuntimeStartupConfigError(
      "workspace_roots_not_distinct",
      configPath,
      `Runtime config file at ${configPath} contains an invalid workspace root path.`,
    );
  }
}

function resolveWorkspacePath(workspaceRoot: string, configuredPath: string): string {
  return path.resolve(workspaceRoot, configuredPath);
}

function validateWorkspaceRoots(workspaceRoots: WorkspaceRootsDTO, configPath: string): void {
  const entries = Object.entries(workspaceRoots) as Array<[keyof WorkspaceRootsDTO, string]>;

  for (const [index, leftEntry] of entries.entries()) {
    const [leftName, leftPath] = leftEntry;

    for (const [rightName, rightPath] of entries.slice(index + 1)) {
      const normalizedLeftPath = normalizeWorkspacePath(leftPath);
      const normalizedRightPath = normalizeWorkspacePath(rightPath);

      if (
        normalizedLeftPath === normalizedRightPath ||
        isNestedPath(normalizedLeftPath, normalizedRightPath) ||
        isNestedPath(normalizedRightPath, normalizedLeftPath)
      ) {
        throw new RuntimeStartupConfigError(
          "workspace_roots_not_distinct",
          configPath,
          `Runtime config file at ${configPath} must keep workspace roots distinct; ${leftName} and ${rightName} overlap.`,
        );
      }
    }
  }
}

function deriveRuntimePolicy(
  runtimeConfig: RuntimeConfigDTO,
  workspaceRoots: WorkspaceRootsDTO,
): RuntimePolicyDTO {
  return {
    enabled_tools: [...runtimeConfig.tool_policy.enabled_tools],
    enabled_secret_handles: [...runtimeConfig.tool_policy.enabled_secret_handles],
    max_tool_runtime_ms: runtimeConfig.tool_policy.max_tool_runtime_ms,
    workspace_roots: { ...workspaceRoots },
    trusted_local_mode: runtimeConfig.tool_policy.trusted_local_mode,
  };
}

function deriveGovernorDefaults(runtimeConfig: RuntimeConfigDTO): GovernorDefaults {
  return {
    max_inference_steps: runtimeConfig.governor.max_inference_steps,
    max_repair_attempts: runtimeConfig.governor.max_repair_attempts,
    max_wall_clock_ms: runtimeConfig.governor.max_wall_clock_ms,
    repair_attempts_used: 0,
  };
}

function validateSecretHandles(
  runtimeConfig: RuntimeConfigDTO,
  environmentVariables: NodeJS.ProcessEnv,
  configPath: string,
): void {
  const requiredHandles = runtimeConfig.tool_policy.enabled_secret_handles;
  if (requiredHandles.length === 0) {
    return;
  }

  const availableSecretHandles = getAvailableSecretHandles(environmentVariables);
  const missingSecretHandles = requiredHandles.filter((handle) => !availableSecretHandles.has(handle));

  if (missingSecretHandles.length > 0) {
    throw new RuntimeStartupConfigError(
      "secret_handles_unavailable",
      configPath,
      `Runtime config file at ${configPath} references unavailable secret handles: ${missingSecretHandles.join(
        ", ",
      )}.`,
      { missingSecretHandles },
    );
  }
}

function getAvailableSecretHandles(environmentVariables: NodeJS.ProcessEnv): Set<string> {
  const configuredHandles = environmentVariables[SECRET_HANDLES_ENV_VAR];
  if (!configuredHandles) {
    return new Set<string>();
  }

  return new Set(
    configuredHandles
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function normalizeWorkspacePath(candidatePath: string): string {
  const normalizedPath = path.normalize(candidatePath);

  return process.platform === "win32"
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);

  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function validateFrozenMvpRules(runtimeConfig: RuntimeConfigDTO, configPath: string): void {
  if (runtimeConfig.gateway.max_queued_ingress_per_session !== MVP_MAX_QUEUED_INGRESS_PER_SESSION) {
    throw new RuntimeStartupConfigError(
      "config_invalid_runtime_rules",
      configPath,
      `Runtime config file at ${configPath} must set gateway.max_queued_ingress_per_session to ${MVP_MAX_QUEUED_INGRESS_PER_SESSION} for MVP.`,
    );
  }
}