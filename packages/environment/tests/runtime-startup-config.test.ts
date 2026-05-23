import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RuntimeStartupConfigError,
  loadRuntimeStartupConfig,
} from "../src/index.js";

const tempDirectories: string[] = [];
const originalCwd = process.cwd();
const originalSecretHandles = process.env.ARGENTUM_SECRET_HANDLES;

describe.sequential("loadRuntimeStartupConfig", () => {
  afterEach(async () => {
    process.chdir(originalCwd);

    if (originalSecretHandles === undefined) {
      delete process.env.ARGENTUM_SECRET_HANDLES;
    } else {
      process.env.ARGENTUM_SECRET_HANDLES = originalSecretHandles;
    }

    await Promise.all(tempDirectories.splice(0).map((dirPath) => rm(dirPath, { recursive: true, force: true })));
  });

  it("loads config/runtime.json by default and derives policy, roots, and governor defaults", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const config = makeRuntimeConfig();

    await writeRuntimeConfig(workspaceRoot, config);
    useWorkspaceRoot(workspaceRoot, config.tool_policy.enabled_secret_handles);

    const result = await loadRuntimeStartupConfig();

    expect(result.configPath).toBe(path.join(workspaceRoot, "config", "runtime.json"));
    expect(result.runtimeConfig).toEqual(config);
    expect(result.workspaceRoots).toEqual({
      bedrock: path.join(workspaceRoot, "runtime", "bedrock"),
      working: path.join(workspaceRoot, "runtime", "working"),
      artifacts: path.join(workspaceRoot, "runtime", "artifacts"),
      logs: path.join(workspaceRoot, "runtime", "logs"),
    });
    expect(result.runtimePolicy).toEqual({
      enabled_tools: [...config.tool_policy.enabled_tools],
      enabled_secret_handles: [...config.tool_policy.enabled_secret_handles],
      max_tool_runtime_ms: config.tool_policy.max_tool_runtime_ms,
      workspace_roots: result.workspaceRoots,
      trusted_local_mode: config.tool_policy.trusted_local_mode,
    });
    expect(result.governorDefaults).toEqual({
      ...config.governor,
      repair_attempts_used: 0,
    });
    expect(result.gatewayDefaults).toEqual(config.gateway);
  });

  it("loads config from an explicit override path", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const config = makeRuntimeConfig();
    const overridePath = path.join(workspaceRoot, "custom", "runtime.override.json");

    await writeRuntimeConfigFile(overridePath, config);
    useWorkspaceRoot(workspaceRoot, config.tool_policy.enabled_secret_handles);

    const result = await loadRuntimeStartupConfig({ overridePath });

    expect(result.configPath).toBe(overridePath);
    expect(result.runtimeConfig.provider).toEqual(config.provider);
  });

  it("fails explicitly when the default config file is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    useWorkspaceRoot(workspaceRoot);

    await expect(loadRuntimeStartupConfig()).rejects.toMatchObject({
      code: "config_not_found",
    });
  });

  it("fails explicitly when the override config file is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const overridePath = path.join(workspaceRoot, "custom", "missing.json");
    useWorkspaceRoot(workspaceRoot);

    await expect(loadRuntimeStartupConfig({ overridePath })).rejects.toMatchObject({
      code: "config_not_found",
      configPath: overridePath,
    });
  });

  it("fails explicitly when the config path exists but is unreadable as a file", async () => {
    const workspaceRoot = await createWorkspaceRoot();

    await mkdir(path.join(workspaceRoot, "config", "runtime.json"), { recursive: true });
    useWorkspaceRoot(workspaceRoot);

    await expect(loadRuntimeStartupConfig()).rejects.toMatchObject({
      code: "config_unreadable",
    });
  });

  it("fails explicitly for malformed JSON without echoing file contents", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const rawSecretValue = "super-secret-token";

    await writeRuntimeConfigFile(
      path.join(workspaceRoot, "config", "runtime.json"),
      `{"tool_policy":{"enabled_secret_handles":["provider/deepseek/default"],"raw_secret":"${rawSecretValue}"}`,
    );
    useWorkspaceRoot(workspaceRoot);

    await expect(loadRuntimeStartupConfig()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RuntimeStartupConfigError);
      expect((error as RuntimeStartupConfigError).code).toBe("config_invalid_json");
      expect((error as Error).message).not.toContain(rawSecretValue);
      return true;
    });
  });

  it("fails explicitly for invalid contract shape", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const config = makeRuntimeConfig() as Record<string, unknown>;

    delete config.workspace;

    await writeRuntimeConfig(workspaceRoot, config);
    useWorkspaceRoot(workspaceRoot);

    await expect(loadRuntimeStartupConfig()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RuntimeStartupConfigError);
      expect((error as RuntimeStartupConfigError).code).toBe("config_invalid_shape");
      expect((error as RuntimeStartupConfigError).details?.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "workspace" })]),
      );
      return true;
    });
  });

  it("fails when workspace roots do not remain logically distinct", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const config = makeRuntimeConfig();

    config.workspace.bedrock_root = "./runtime/shared";
    config.workspace.working_root = "./runtime/shared/nested";

    await writeRuntimeConfig(workspaceRoot, config);
    useWorkspaceRoot(workspaceRoot, config.tool_policy.enabled_secret_handles);

    await expect(loadRuntimeStartupConfig()).rejects.toMatchObject({
      code: "workspace_roots_not_distinct",
    });
  });

  it.skipIf(process.platform !== "win32")(
    "fails when workspace roots overlap by Windows path aliasing",
    async () => {
      const workspaceRoot = await createWorkspaceRoot();
      const config = makeRuntimeConfig();

      config.workspace.bedrock_root = "C:/Argentum/Runtime/Bedrock";
      config.workspace.working_root = "c:/argentum/runtime/bedrock";

      await writeRuntimeConfig(workspaceRoot, config);
      useWorkspaceRoot(workspaceRoot, config.tool_policy.enabled_secret_handles);

      await expect(loadRuntimeStartupConfig()).rejects.toMatchObject({
        code: "workspace_roots_not_distinct",
      });
    },
  );

  it("fails when the queue cap drifts from the frozen MVP startup rule", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const config = makeRuntimeConfig();

    config.gateway.max_queued_ingress_per_session = 7;

    await writeRuntimeConfig(workspaceRoot, config);
    useWorkspaceRoot(workspaceRoot, config.tool_policy.enabled_secret_handles);

    await expect(loadRuntimeStartupConfig()).rejects.toMatchObject({
      code: "config_invalid_runtime_rules",
    });
  });

  it("fails explicitly when a configured secret handle is unavailable at startup", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const config = makeRuntimeConfig();

    config.tool_policy.enabled_secret_handles = [
      "provider/deepseek/default",
      "tool/github/token",
    ];

    await writeRuntimeConfig(workspaceRoot, config);
    useWorkspaceRoot(workspaceRoot, ["provider/deepseek/default"]);

    await expect(loadRuntimeStartupConfig()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RuntimeStartupConfigError);
      expect((error as RuntimeStartupConfigError).code).toBe("secret_handles_unavailable");
      expect((error as RuntimeStartupConfigError).details?.missingSecretHandles).toEqual([
        "tool/github/token",
      ]);
      return true;
    });
  });
});

async function createWorkspaceRoot(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "argentum-environment-"));

  tempDirectories.push(workspaceRoot);
  await mkdir(path.join(workspaceRoot, "config"), { recursive: true });

  return workspaceRoot;
}

async function writeRuntimeConfig(workspaceRoot: string, config: unknown): Promise<void> {
  await writeRuntimeConfigFile(path.join(workspaceRoot, "config", "runtime.json"), config);
}

async function writeRuntimeConfigFile(filePath: string, config: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    typeof config === "string" ? config : `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

function useWorkspaceRoot(workspaceRoot: string, handles: string[] = []): void {
  process.chdir(workspaceRoot);

  if (handles.length === 0) {
    delete process.env.ARGENTUM_SECRET_HANDLES;
    return;
  }

  process.env.ARGENTUM_SECRET_HANDLES = handles.join(",");
}

function makeRuntimeConfig() {
  return {
    workspace: {
      bedrock_root: "./runtime/bedrock",
      working_root: "./runtime/working",
      artifacts_root: "./runtime/artifacts",
      logs_root: "./runtime/logs",
    },
    provider: {
      name: "deepseek" as const,
      model_id: "deepseek-chat",
      endpoint: "https://api.deepseek.com",
      temperature: 0,
      max_output_tokens: 4096,
    },
    governor: {
      max_inference_steps: 12,
      max_repair_attempts: 3,
      max_wall_clock_ms: 600000,
    },
    gateway: {
      max_queued_ingress_per_session: 8,
      queue_overflow_policy: "reject_newest" as const,
    },
    tool_policy: {
      enabled_tools: ["functions.read_file", "functions.list_dir"],
      enabled_secret_handles: ["provider/deepseek/default"],
      max_tool_runtime_ms: 30000,
      trusted_local_mode: true,
    },
    telemetry: {
      format: "jsonl" as const,
      persist_events: true,
    },
    features: {
      enable_native_tool_calling: true,
    },
  };
}