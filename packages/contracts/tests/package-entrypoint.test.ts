import { describe, expect, it } from "vitest";

import {
  ContentRefValidationError,
  ContextItemValidationError,
  ExecutionGrantValidationError,
  LLMRequestValidationError,
  LLMResultValidationError,
  parseContentRef,
  parseContextItem,
  parseContextItemArray,
  parseExecutionGrant,
  parseIngressDTO,
  parseLLMInferenceRequest,
  parseLLMInferenceResult,
  parseMessagePart,
  parseRuntimePolicyDTO,
  parseToolCallDTO,
  parseToolDefinition,
  parseToolResultDTO,
  parseTurnEnvelope,
  RuntimePolicyValidationError,
  ToolCallDTOValidationError,
  ToolDefinitionValidationError,
  ToolResultValidationError,
  TurnEnvelopeValidationError,
} from "@argentum/contracts";

describe("@argentum/contracts package entrypoint", () => {
  it("resolves ingress and turn contracts through the published package surface", () => {
    expect(parseMessagePart({ kind: "text", text: "hello" })).toEqual({
      kind: "text",
      text: "hello",
    });

    expect(
      parseIngressDTO({
        ingress_id: "ingress-123",
        session_id: "session-123",
        channel: "terminal_cli",
        user_id: "user-123",
        message_parts: [{ kind: "text", text: "hello" }],
        received_at: "2026-05-22T10:30:00Z",
      }),
    ).toMatchObject({
      ingress_id: "ingress-123",
      session_id: "session-123",
      channel: "terminal_cli",
      user_id: "user-123",
      message_parts: [{ kind: "text", text: "hello" }],
      received_at: "2026-05-22T10:30:00Z",
    });

    expect(
      parseContentRef({
        ref_id: "ref-123",
        kind: "file",
        storage_area: "artifacts",
        locator: "turns/turn-123/output.md",
        retention: "persistent",
      }),
    ).toMatchObject({
      ref_id: "ref-123",
      kind: "file",
      storage_area: "artifacts",
      locator: "turns/turn-123/output.md",
      retention: "persistent",
    });

    expect(
      parseTurnEnvelope({
        turn_id: "turn-123",
        session_id: "session-123",
        ingress_id: "ingress-123",
        state: "accepted",
        step_count: 0,
        budget: {
          max_inference_steps: 12,
          max_repair_attempts: 3,
          max_wall_clock_ms: 600000,
          repair_attempts_used: 0,
        },
        context_refs: [
          {
            ref_id: "ref-123",
            kind: "file",
            storage_area: "artifacts",
            locator: "turns/turn-123/output.md",
            retention: "persistent",
          },
        ],
        compaction_revision: 0,
        created_at: "2026-05-22T10:30:00+00:00",
        updated_at: "Fri, 22 May 2026 10:30:00 GMT",
      }),
    ).toMatchObject({
      turn_id: "turn-123",
      session_id: "session-123",
      ingress_id: "ingress-123",
      state: "accepted",
      step_count: 0,
      compaction_revision: 0,
      created_at: "2026-05-22T10:30:00+00:00",
      updated_at: "Fri, 22 May 2026 10:30:00 GMT",
    });
  });

  it("resolves ContextItem contracts through the published package surface", () => {
    expect(
      parseContextItem({
        context_id: "ctx-001",
        layer: "bedrock",
        role: "system",
        content_ref: {
          ref_id: "ref-123",
          kind: "file",
          storage_area: "artifacts",
          locator: "turns/turn-123/output.md",
          retention: "persistent",
        },
        origin: "environment",
        retention: "sticky",
      }),
    ).toMatchObject({
      context_id: "ctx-001",
      layer: "bedrock",
      role: "system",
      origin: "environment",
      retention: "sticky",
    });

    expect(
      parseContextItemArray([
        {
          context_id: "ctx-001",
          layer: "bedrock",
          role: "system",
          content_ref: {
            ref_id: "ref-123",
            kind: "file",
            storage_area: "artifacts",
            locator: "turns/turn-123/output.md",
            retention: "persistent",
          },
          origin: "environment",
          retention: "sticky",
        },
      ]),
    ).toHaveLength(1);
  });

  it("exports validation errors for downstream callers", () => {
    expect(() => parseContentRef({})).toThrow(ContentRefValidationError);
    expect(() => parseTurnEnvelope({})).toThrow(TurnEnvelopeValidationError);
    expect(() => parseContextItem({})).toThrow(ContextItemValidationError);
    expect(() => parseContextItemArray("not-an-array")).toThrow(
      ContextItemValidationError,
    );
    expect(() => parseExecutionGrant({})).toThrow(
      ExecutionGrantValidationError,
    );
  });

  it("resolves LLM adapter contracts through the published package surface", () => {
    // LLMInferenceRequest
    const request = parseLLMInferenceRequest({
      request_id: "req-001",
      turn_id: "turn-001",
      context_items: [
        {
          context_id: "ctx-001",
          layer: "bedrock",
          role: "system",
          content_ref: {
            ref_id: "ref-123",
            kind: "file",
            storage_area: "artifacts",
            locator: "turns/turn-123/output.md",
            retention: "persistent",
          },
          origin: "environment",
          retention: "sticky",
        },
      ],
      available_tools: [
        {
          name: "search",
          description: "Search the web",
          input_schema: { type: "object" },
        },
      ],
      inference_policy: {},
    });
    expect(request.request_id).toBe("req-001");
    expect(request.turn_id).toBe("turn-001");
    expect(request.context_items).toHaveLength(1);
    expect(request.available_tools).toHaveLength(1);
    expect(request.inference_policy).toEqual({});

    // LLMInferenceResult
    const result = parseLLMInferenceResult({
      request_id: "req-001",
      decision: {
        decision_id: "dec-001",
        kind: "respond",
        message: "Hello",
      },
      normalization_status: "native_tool",
    });
    expect(result.request_id).toBe("req-001");
    expect(result.decision.kind).toBe("respond");
    expect(result.normalization_status).toBe("native_tool");

    // Validation errors
    expect(() => parseLLMInferenceRequest({})).toThrow(
      LLMRequestValidationError,
    );
    expect(() => parseLLMInferenceResult({})).toThrow(
      LLMResultValidationError,
    );
  });

  it("resolves ExecutionGrant contracts through the published package surface", () => {
    const grant = parseExecutionGrant({
      grant_id: "grant-001",
      cwd: "/workspace",
      path_permissions: [
        {
          root: "bedrock",
          path: "/workspace/bedrock",
          capabilities: ["read"],
        },
      ],
      env_secret_handles: ["API_KEY"],
      network_policy: "inherit",
      approval_mode: "auto_allow",
      max_runtime_ms: 30000,
    });
    expect(grant.grant_id).toBe("grant-001");
    expect(grant.cwd).toBe("/workspace");
    expect(grant.path_permissions).toHaveLength(1);
    expect(grant.path_permissions[0].root).toBe("bedrock");
    expect(grant.path_permissions[0].capabilities).toEqual(["read"]);
    expect(grant.env_secret_handles).toEqual(["API_KEY"]);
    expect(grant.network_policy).toBe("inherit");
    expect(grant.approval_mode).toBe("auto_allow");
    expect(grant.max_runtime_ms).toBe(30000);

    expect(() => parseExecutionGrant({})).toThrow(
      ExecutionGrantValidationError,
    );
  });

  it("resolves ToolDefinition contracts through the published package surface", () => {
    const td = parseToolDefinition({
      name: "search",
      description: "Search the web",
      input_schema: { type: "object" },
      side_effect_level: "read_only",
      path_scope: "none",
      required_secret_handles: ["API_KEY"],
      network_access: "inherit",
      default_timeout_ms: 30000,
      defaults: { query: "default" },
    });
    expect(td.name).toBe("search");
    expect(td.description).toBe("Search the web");
    expect(td.input_schema).toEqual({ type: "object" });
    expect(td.side_effect_level).toBe("read_only");
    expect(td.path_scope).toBe("none");
    expect(td.required_secret_handles).toEqual(["API_KEY"]);
    expect(td.network_access).toBe("inherit");
    expect(td.default_timeout_ms).toBe(30000);
    expect(td.defaults).toEqual({ query: "default" });

    expect(() => parseToolDefinition({})).toThrow(
      ToolDefinitionValidationError,
    );
  });

  it("resolves ToolCallDTO and ToolResultDTO contracts through the published package surface", () => {
    // ToolCallDTO
    const call = parseToolCallDTO({
      call_id: "call-001",
      turn_id: "turn-001",
      tool_name: "search",
      arguments: { query: "hello" },
      grant: {
        grant_id: "grant-001",
        cwd: "/workspace",
        path_permissions: [
          {
            root: "bedrock",
            path: "/workspace/bedrock",
            capabilities: ["read"],
          },
        ],
        env_secret_handles: ["API_KEY"],
        network_policy: "inherit",
        approval_mode: "auto_allow",
        max_runtime_ms: 30000,
      },
      timeout_ms: 30000,
      idempotency_key: "idem-turn-001-0-search",
    });
    expect(call.call_id).toBe("call-001");
    expect(call.turn_id).toBe("turn-001");
    expect(call.tool_name).toBe("search");
    expect(call.arguments).toEqual({ query: "hello" });
    expect(call.grant.grant_id).toBe("grant-001");
    expect(call.timeout_ms).toBe(30000);
    expect(call.idempotency_key).toBe("idem-turn-001-0-search");

    // ToolResultDTO
    const result = parseToolResultDTO({
      call_id: "call-001",
      status: "success",
      human_summary: "Search completed successfully.",
      duration_ms: 1500,
      truncated: false,
      retryable: false,
    });
    expect(result.call_id).toBe("call-001");
    expect(result.status).toBe("success");
    expect(result.human_summary).toBe("Search completed successfully.");
    expect(result.duration_ms).toBe(1500);
    expect(result.truncated).toBe(false);
    expect(result.retryable).toBe(false);

    // Validation errors
    expect(() => parseToolCallDTO({})).toThrow(ToolCallDTOValidationError);
    expect(() => parseToolResultDTO({})).toThrow(ToolResultValidationError);
  });

  it("resolves RuntimePolicyDTO contracts through the published package surface", () => {
    const policy = parseRuntimePolicyDTO({
      enabled_tools: ["tool_a", "tool_b"],
      enabled_secret_handles: ["GITHUB_TOKEN"],
      max_tool_runtime_ms: 30000,
      workspace_roots: {
        bedrock: "/workspace/bedrock",
        working: "/workspace/working",
        artifacts: "/workspace/artifacts",
        logs: "/workspace/logs",
      },
      trusted_local_mode: true,
    });
    expect(policy.enabled_tools).toEqual(["tool_a", "tool_b"]);
    expect(policy.enabled_secret_handles).toEqual(["GITHUB_TOKEN"]);
    expect(policy.max_tool_runtime_ms).toBe(30000);
    expect(policy.workspace_roots.bedrock).toBe("/workspace/bedrock");
    expect(policy.workspace_roots.working).toBe("/workspace/working");
    expect(policy.workspace_roots.artifacts).toBe("/workspace/artifacts");
    expect(policy.workspace_roots.logs).toBe("/workspace/logs");
    expect(policy.trusted_local_mode).toBe(true);

    expect(() => parseRuntimePolicyDTO({})).toThrow(
      RuntimePolicyValidationError,
    );
  });
});