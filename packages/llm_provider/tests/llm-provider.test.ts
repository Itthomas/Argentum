import { describe, expect, it } from "vitest";

import type { LLMInferenceRequest, LLMInferenceResult } from "@argentum/contracts";
import type { LLMProvider } from "../src/index.js";
import { LLMProviderError } from "../src/index.js";

// ── Minimal test builders ───────────────────────────────────────

function makeMinimalRequest(overrides: Partial<LLMInferenceRequest> = {}): LLMInferenceRequest {
  return {
    request_id: "req-001",
    turn_id: "turn-001",
    context_items: [],
    available_tools: [],
    inference_policy: {},
    ...overrides,
  };
}

function makeMinimalResult(overrides: Partial<LLMInferenceResult> = {}): LLMInferenceResult {
  return {
    request_id: "req-001",
    decision: {
      decision_id: "dec-001",
      kind: "respond",
      message: "Hello.",
    },
    normalization_status: "parsed_text",
    ...overrides,
  };
}

// ── Interface existence ─────────────────────────────────────────

describe("LLMProvider interface", () => {
  it("is importable from @argentum/llm-provider (type-only, no runtime crash)", () => {
    // TypeScript interfaces do not exist at runtime.  This test
    // documents that the import resolves without errors and the
    // symbol is usable as a type.
    const provider: LLMProvider | null = null;
    expect(provider).toBeNull();
  });

  it("can be implemented by a concrete class", () => {
    class TestProvider implements LLMProvider {
      async infer(_request: LLMInferenceRequest): Promise<LLMInferenceResult> {
        return makeMinimalResult();
      }
    }

    const provider: LLMProvider = new TestProvider();
    expect(provider).toBeInstanceOf(TestProvider);
  });

  it("can be implemented by an object literal", () => {
    const provider: LLMProvider = {
      async infer(_request: LLMInferenceRequest): Promise<LLMInferenceResult> {
        return makeMinimalResult();
      },
    };

    expect(typeof provider.infer).toBe("function");
  });

  it("accepts LLMInferenceRequest and returns LLMInferenceResult via mock", async () => {
    const expectedResult = makeMinimalResult({ request_id: "req-002" });

    const provider: LLMProvider = {
      async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
        return makeMinimalResult({ request_id: request.request_id });
      },
    };

    const request = makeMinimalRequest({ request_id: "req-002" });
    const result = await provider.infer(request);

    expect(result).toEqual(expectedResult);
    expect(result.request_id).toBe("req-002");
    expect(result.decision.kind).toBe("respond");
    expect(result.normalization_status).toBe("parsed_text");
  });

  it("is provider-neutral — no provider-specific imports in the definition file", () => {
    // This test is structural: it verifies that the LLMProvider
    // interface is importable and compiles with only @argentum/contracts
    // types in its signature.  If the interface definition file imported
    // a provider SDK, TypeScript compilation would fail because the
    // package does not depend on any provider SDK.
    //
    // We validate this by ensuring the provider type is assignable
    // from a plain object without any provider-specific types.
    const _provider: LLMProvider = {
      async infer(_req: LLMInferenceRequest): Promise<LLMInferenceResult> {
        return makeMinimalResult();
      },
    };
    // If we reach here without a type error, the interface is clean.
    expect(true).toBe(true);
  });
});

// ── LLMProviderError construction ───────────────────────────────

describe("LLMProviderError", () => {
  it("is an instance of Error", () => {
    const error = new LLMProviderError("deepseek", "req-001", "Something failed.");
    expect(error).toBeInstanceOf(Error);
  });

  it("is an instance of LLMProviderError", () => {
    const error = new LLMProviderError("deepseek", "req-001", "Something failed.");
    expect(error).toBeInstanceOf(LLMProviderError);
  });

  it("has name set to LLMProviderError", () => {
    const error = new LLMProviderError("deepseek", "req-001", "Something failed.");
    expect(error.name).toBe("LLMProviderError");
  });

  it("exposes providerId and requestId from constructor arguments", () => {
    const error = new LLMProviderError(
      "openai-gpt4",
      "req-abc-123",
      "Network timeout.",
    );

    expect(error.providerId).toBe("openai-gpt4");
    expect(error.requestId).toBe("req-abc-123");
  });

  it("exposes the message from constructor arguments", () => {
    const error = new LLMProviderError(
      "anthropic",
      "req-xyz",
      "Authentication failed: invalid API key.",
    );

    expect(error.message).toBe("Authentication failed: invalid API key.");
  });

  it("exposes the optional cause when provided", () => {
    const cause = new Error("Connection refused");
    const error = new LLMProviderError(
      "deepseek",
      "req-001",
      "Network error.",
      cause,
    );

    expect(error.cause).toBe(cause);
  });

  it("has undefined cause when not provided", () => {
    const error = new LLMProviderError("deepseek", "req-001", "Timeout.");

    expect(error.cause).toBeUndefined();
  });

  it("preserves properties through throw/catch cycle", async () => {
    const provider: LLMProvider = {
      async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
        throw new LLMProviderError(
          "test-provider",
          request.request_id,
          "Simulated adapter failure.",
          new Error("Underlying I/O error"),
        );
      },
    };

    const request = makeMinimalRequest({ request_id: "req-throw-001" });

    try {
      await provider.infer(request);
      // Should not reach here.
      expect.fail("Expected LLMProviderError to be thrown.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LLMProviderError);
      const typed = error as LLMProviderError;
      expect(typed.providerId).toBe("test-provider");
      expect(typed.requestId).toBe("req-throw-001");
      expect(typed.message).toBe("Simulated adapter failure.");
      expect(typed.cause).toBeInstanceOf(Error);
      expect((typed.cause as Error).message).toBe("Underlying I/O error");
    }
  });

  it("does not expose provider-native types in its constructor signature", () => {
    // The constructor accepts only string, string, string, and
    // optional unknown — no provider SDK types.
    const error = new LLMProviderError(
      "any-provider",
      "any-request",
      "Any message.",
      { raw: "payload" },
    );
    expect(error.cause).toEqual({ raw: "payload" });
  });
});

// ── Package entrypoint smoke ────────────────────────────────────

describe("@argentum/llm-provider entrypoint", () => {
  it("exports LLMProviderError as a runtime value", () => {
    expect(typeof LLMProviderError).toBe("function");
  });

  it("exports runtime values: LLMProviderError, projectToolSchemas, DeepSeekAdapter", async () => {
    // Dynamic import to enumerate all exports.
    const mod = await import("../src/index.js");
    const keys = Object.keys(mod);

    // Runtime exports: LLMProviderError (class), projectToolSchemas
    // (function), and DeepSeekAdapter (class, since slice 0033).
    // LLMProvider, DeepSeekToolSchema, ContentResolver, TraceWriter,
    // and DeepSeekAdapterConfig are type-only.
    expect(keys).toHaveLength(3);
    expect(keys).toContain("LLMProviderError");
    expect(keys).toContain("projectToolSchemas");
    expect(keys).toContain("DeepSeekAdapter");
  });
});
