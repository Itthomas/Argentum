import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeStartupConfigResult } from "@argentum/environment";

afterEach(() => {
  vi.doUnmock("@argentum/environment");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("bootstrapRuntime", () => {
  it("loads startup config before any downstream initializer runs", async () => {
    const callOrder: string[] = [];
    const { bootstrapRuntime, loadRuntimeStartupConfig } =
      await importRuntimeModuleWithEnvironmentMock();

    loadRuntimeStartupConfig.mockImplementation(async () => {
      callOrder.push("loader");

      return makeRuntimeStartupConfigResult();
    });
    const initializeDownstream = vi.fn(async () => {
      callOrder.push("downstream");
    });

    await bootstrapRuntime({}, { initializeDownstream });

    expect(callOrder).toEqual(["loader", "downstream"]);
  });

  it("forwards an explicit config override path to the environment loader", async () => {
    const overridePath = "./config/runtime.override.json";
    const { bootstrapRuntime, loadRuntimeStartupConfig } =
      await importRuntimeModuleWithEnvironmentMock();

    await bootstrapRuntime({ configOverridePath: overridePath });

    expect(loadRuntimeStartupConfig).toHaveBeenCalledWith({
      overridePath,
    });
  });

  it("uses the environment startup loader when no override dependency is supplied", async () => {
    const startupConfig = makeRuntimeStartupConfigResult();
    const { bootstrapRuntime, loadRuntimeStartupConfig } =
      await importRuntimeModuleWithEnvironmentMock({ startupConfig });

    const context = await bootstrapRuntime();

    expect(loadRuntimeStartupConfig).toHaveBeenCalledWith(undefined);
    expect(context.startupConfig).toBe(startupConfig);
  });

  it("does not invoke downstream initialization when startup config loading fails", async () => {
    const { RuntimeStartupConfigError } = await importActualEnvironmentModule();
    const startupError = new RuntimeStartupConfigError(
      "config_not_found",
      "C:/missing/runtime.json",
      "Runtime config file was not found.",
    );
    const { bootstrapRuntime } = await importRuntimeModuleWithEnvironmentMock({
      startupError,
    });
    const initializeDownstream = vi.fn(async () => undefined);

    await expect(
      bootstrapRuntime({}, { initializeDownstream }),
    ).rejects.toBe(startupError);
    expect(initializeDownstream).not.toHaveBeenCalled();
  });

  it("returns an app-local bootstrap context that preserves the environment startup result", async () => {
    const startupConfig = makeRuntimeStartupConfigResult();
    const { bootstrapRuntime } = await importRuntimeModuleWithEnvironmentMock({
      startupConfig,
    });

    const context = await bootstrapRuntime();

    expect(context.startupConfig).toBe(startupConfig);
    expect(context.startupConfig).toMatchObject({
      configPath: startupConfig.configPath,
      runtimeConfig: startupConfig.runtimeConfig,
      workspaceRoots: startupConfig.workspaceRoots,
      runtimePolicy: startupConfig.runtimePolicy,
      governorDefaults: startupConfig.governorDefaults,
      gatewayDefaults: startupConfig.gatewayDefaults,
    });
  });

  it("surfaces the environment startup error unchanged to the caller", async () => {
    const { RuntimeStartupConfigError } = await importActualEnvironmentModule();
    const startupError = new RuntimeStartupConfigError(
      "config_invalid_shape",
      "C:/config/runtime.json",
      "Runtime config file failed contract validation.",
    );
    const { bootstrapRuntime } = await importRuntimeModuleWithEnvironmentMock({
      startupError,
    });

    await expect(bootstrapRuntime()).rejects.toBe(startupError);
  });

  it("surfaces downstream initializer failures after the startup gate opens", async () => {
    const downstreamError = new Error("downstream initializer failed");
    const { bootstrapRuntime, loadRuntimeStartupConfig } =
      await importRuntimeModuleWithEnvironmentMock();

    await expect(
      bootstrapRuntime({}, {
        initializeDownstream: vi.fn(async () => {
          throw downstreamError;
        }),
      }),
    ).rejects.toBe(downstreamError);
    expect(loadRuntimeStartupConfig).toHaveBeenCalledOnce();
  });
});

async function importRuntimeModuleWithEnvironmentMock(options: {
  startupConfig?: RuntimeStartupConfigResult;
  startupError?: unknown;
} = {}) {
  const loadRuntimeStartupConfig = vi.fn(async () => {
    if (options.startupError) {
      throw options.startupError;
    }

    return options.startupConfig ?? makeRuntimeStartupConfigResult();
  });

  vi.doMock("@argentum/environment", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@argentum/environment")>();

    return {
      ...actual,
      loadRuntimeStartupConfig,
    };
  });

  const runtimeModule = await import("../src/index.js");

  return {
    bootstrapRuntime: runtimeModule.bootstrapRuntime,
    loadRuntimeStartupConfig,
  };
}

async function importActualEnvironmentModule() {
  return vi.importActual<typeof import("@argentum/environment")>(
    "@argentum/environment",
  );
}

function makeRuntimeStartupConfigResult(): RuntimeStartupConfigResult {
  return {
    configPath: "C:/argentum/config/runtime.json",
    runtimeConfig: {
      workspace: {
        bedrock_root: "./runtime/bedrock",
        working_root: "./runtime/working",
        artifacts_root: "./runtime/artifacts",
        logs_root: "./runtime/logs",
      },
      provider: {
        name: "deepseek",
        model_id: "deepseek-chat",
        endpoint: "http://localhost:11434/v1",
      },
      governor: {
        max_inference_steps: 6,
        max_repair_attempts: 2,
        max_wall_clock_ms: 30000,
      },
      gateway: {
        max_queued_ingress_per_session: 8,
        queue_overflow_policy: "reject_newest",
      },
      tool_policy: {
        enabled_tools: ["workspace.read_file"],
        enabled_secret_handles: ["provider/deepseek/default"],
        max_tool_runtime_ms: 10000,
        trusted_local_mode: true,
      },
      telemetry: {
        format: "jsonl",
        persist_events: true,
      },
    },
    workspaceRoots: {
      bedrock: "C:/argentum/runtime/bedrock",
      working: "C:/argentum/runtime/working",
      artifacts: "C:/argentum/runtime/artifacts",
      logs: "C:/argentum/runtime/logs",
    },
    runtimePolicy: {
      enabled_tools: ["workspace.read_file"],
      enabled_secret_handles: ["provider/deepseek/default"],
      max_tool_runtime_ms: 10000,
      workspace_roots: {
        bedrock: "C:/argentum/runtime/bedrock",
        working: "C:/argentum/runtime/working",
        artifacts: "C:/argentum/runtime/artifacts",
        logs: "C:/argentum/runtime/logs",
      },
      trusted_local_mode: true,
    },
    governorDefaults: {
      max_inference_steps: 6,
      max_repair_attempts: 2,
      max_wall_clock_ms: 30000,
      repair_attempts_used: 0,
    },
    gatewayDefaults: {
      max_queued_ingress_per_session: 8,
      queue_overflow_policy: "reject_newest",
    },
  };
}