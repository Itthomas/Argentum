import type {
  ActionDecision,
  ContentRef,
  ContextItem,
  DecisionKind,
  LLMInferenceRequest,
  LLMInferenceResult,
  NormalizationStatus,
  ToolCallEntry,
} from "@argentum/contracts";

import type { ContentResolver, TraceWriter } from "./content-resolver.js";
import type { LLMProvider } from "./llm-provider.js";
import { LLMProviderError } from "./llm-provider.js";
import { projectToolSchemas } from "./tool-schema-projection.js";

// ── Configuration ───────────────────────────────────────────────

/**
 * Configuration for the {@link DeepSeekAdapter}.
 *
 * `endpoint`, `apiKey`, and `model` are required. `temperature`
 * defaults to `0` and `maxOutputTokens` defaults to `4096`.
 *
 * `resolveContent` is an optional {@link ContentResolver} for
 * resolving {@link ContentRef} entries on {@link ContextItem} values.
 * When omitted, any `ContextItem` that requires resolution will cause
 * the adapter to throw {@link LLMProviderError}.
 *
 * `writeTrace` is an optional {@link TraceWriter} for persisting
 * raw request/response trace artifacts. When omitted, trace capture
 * is gracefully degraded.
 */
export interface DeepSeekAdapterConfig {
  /** DeepSeek API base URL (e.g., `"https://api.deepseek.com"`). */
  readonly endpoint: string;

  /** DeepSeek API key (resolved externally, e.g. from `DEEPSEEK_API_KEY`). */
  readonly apiKey: string;

  /** Model identifier (e.g., `"deepseek-chat"`). */
  readonly model: string;

  /** Temperature override. Defaults to `0`. */
  readonly temperature?: number;

  /** Maximum output token cap. Defaults to `4096`. */
  readonly maxOutputTokens?: number;

  /** Optional content resolver for `ContextItem.content_ref` resolution. */
  readonly resolveContent?: ContentResolver;

  /** Optional trace writer for raw request/response persistence. */
  readonly writeTrace?: TraceWriter;
}

// ── Internal types ──────────────────────────────────────────────

interface DeepSeekChatMessage {
  role: string;
  content: string;
}

interface DeepSeekToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface DeepSeekApiResponse {
  choices: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: DeepSeekToolCall[];
    } | null;
  }>;
  usage?: Record<string, unknown>;
}

/** Recognized {@link ContextItem.role} values mapped directly. */
const RECOGNIZED_ROLES = new Set(["user", "assistant", "system", "tool"]);

/** Valid {@link DecisionKind} literals. */
const DECISION_KINDS = new Set<DecisionKind>([
  "respond",
  "tool_calls",
  "clarify",
  "abort",
]);

// ── UUID generator ─────────────────────────────────────────────

let _cryptoRandomUUID: (() => string) | undefined;

function randomUUID(): string {
  if (!_cryptoRandomUUID) {
    // Node 22+ always has crypto.randomUUID; fall back for older
    // environments (though not supported by this package).
    if (
      typeof crypto !== "undefined" &&
      typeof (crypto as { randomUUID?: unknown }).randomUUID === "function"
    ) {
      _cryptoRandomUUID = (
        crypto as { randomUUID(): string }
      ).randomUUID.bind(crypto);
    } else {
      // Minimal fallback: not cryptographically strong, acceptable
      // only in test/unsupported environments.
      _cryptoRandomUUID = () =>
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
    }
  }
  return _cryptoRandomUUID();
}

// ── Adapter ─────────────────────────────────────────────────────

/**
 * DeepSeek adapter implementing the {@link LLMProvider} interface.
 *
 * Translates canonical {@link LLMInferenceRequest} values into
 * DeepSeek-native chat completion requests and normalizes responses
 * back into canonical {@link LLMInferenceResult} values.
 *
 * ## Normalization paths (tried in order)
 *
 * | Path | Trigger | `normalization_status` |
 * |------|---------|------------------------|
 * | A — Native tool calling | `choices[0].message.tool_calls` non-empty | `"native_tool"` |
 * | B — JSON mode | `choices[0].message.content` is valid JSON | `"json_mode"` |
 * | C — Parsed text | Content is not valid JSON; markdown fence / raw text | `"parsed_text"` |
 * | D — Exhaustion | No path produced a valid decision → throw | (error) |
 *
 * @throws {LLMProviderError} on adapter-level failure.
 */
export class DeepSeekAdapter implements LLMProvider {
  private readonly config: {
    readonly endpoint: string;
    readonly apiKey: string;
    readonly model: string;
    readonly temperature: number;
    readonly maxOutputTokens: number;
    readonly resolveContent?: ContentResolver;
    readonly writeTrace?: TraceWriter;
  };

  constructor(config: DeepSeekAdapterConfig) {
    // Normalize endpoint: strip trailing slashes to prevent
    // double-slash in constructed URL.
    const normalizedEndpoint = config.endpoint.replace(/\/+$/, "");

    this.config = {
      endpoint: normalizedEndpoint,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature ?? 0,
      maxOutputTokens: config.maxOutputTokens ?? 4096,
    };
    if (config.resolveContent !== undefined) {
      (
        this.config as { resolveContent?: ContentResolver }
      ).resolveContent = config.resolveContent;
    }
    if (config.writeTrace !== undefined) {
      (
        this.config as { writeTrace?: TraceWriter }
      ).writeTrace = config.writeTrace;
    }
  }

  // ── Public API ──────────────────────────────────────────────

  async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
    const requestId = request.request_id;

    // 1. Build DeepSeek chat messages
    const messages = await this.buildMessages(request.context_items, requestId);

    // 2. Project tool schemas
    const tools = projectToolSchemas(request.available_tools);

    // 3. Determine API mode from inference_policy
    const normalizationMode = this.resolveNormalizationMode(
      request.inference_policy,
    );

    // 4. Build request body
    const requestBody = this.buildRequestBody(
      messages,
      tools,
      normalizationMode,
    );

    // 5. Call DeepSeek API
    let responseJson: DeepSeekApiResponse;
    try {
      responseJson = await this.callDeepSeekApi(requestBody, requestId);
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }
      throw new LLMProviderError(
        "deepseek",
        requestId,
        `DeepSeek API network failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
    }

    // 6. Write raw trace (best-effort)
    let rawTraceRef: ContentRef | undefined;
    if (this.config.writeTrace) {
      rawTraceRef = {
        ref_id: `${request.request_id}-trace`,
        kind: "trace",
        storage_area: "logs",
        locator: `deepseek/${request.request_id}/trace.json`,
        retention: "session",
      };
      try {
        await this.config.writeTrace(rawTraceRef, {
          request: requestBody,
          response: responseJson,
        });
      } catch {
        // Trace write failure is non-fatal; clear the ref so
        // consumers don't see a dangling reference.
        rawTraceRef = undefined;
      }
    }

    // 7. Normalize response into ActionDecision + normalization_status
    const { decision, normalizationStatus } =
      this.normalizeResponse(responseJson, requestId);

    // 8. Assemble result
    const result = {
      request_id: request.request_id,
      decision,
      normalization_status: normalizationStatus,
    } as LLMInferenceResult;
    if (responseJson.usage !== undefined) {
      (result as { usage?: Record<string, unknown> }).usage =
        responseJson.usage;
    }
    if (rawTraceRef !== undefined) {
      (result as { raw_trace_ref?: ContentRef }).raw_trace_ref =
        rawTraceRef;
    }
    return Object.freeze(result);
  }

  // ── Message building ────────────────────────────────────────

  private async buildMessages(
    contextItems: readonly ContextItem[],
    requestId: string,
  ): Promise<DeepSeekChatMessage[]> {
    if (contextItems.length > 0 && !this.config.resolveContent) {
      throw new LLMProviderError(
        "deepseek",
        requestId,
        "ContentResolver is not configured. Cannot resolve ContextItem content_ref values.",
      );
    }

    // Safe: guarded above when items are present; unreachable otherwise.
    const resolveContent = this.config.resolveContent!;

    const messages: DeepSeekChatMessage[] = [];
    for (const item of contextItems) {
      const content = await resolveContent(item.content_ref);
      const role = RECOGNIZED_ROLES.has(item.role) ? item.role : "user";
      messages.push({ role, content });
    }
    return messages;
  }

  // ── Normalization mode resolution ───────────────────────────

  private resolveNormalizationMode(
    inferencePolicy: Record<string, unknown>,
  ): string {
    const mode = inferencePolicy["normalization_mode"];
    if (typeof mode !== "string") {
      return "native_tool";
    }
    // Recognized values: "native_tool", "json_mode", "parsed_text"
    // Unknown values default to "native_tool" without throwing.
    if (
      mode === "native_tool" ||
      mode === "json_mode" ||
      mode === "parsed_text"
    ) {
      return mode;
    }
    // Unrecognized → default to native_tool
    return "native_tool";
  }

  // ── Request body construction ───────────────────────────────

  private buildRequestBody(
    messages: DeepSeekChatMessage[],
    tools: ReturnType<typeof projectToolSchemas>,
    normalizationMode: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxOutputTokens,
    };

    if (normalizationMode === "json_mode") {
      body["response_format"] = { type: "json_object" };
      // Omit tools / tool_choice in JSON mode
    } else if (
      normalizationMode === "native_tool" &&
      tools.length > 0
    ) {
      body["tools"] = tools;
      body["tool_choice"] = "auto";
    }
    // parsed_text / unrecognized without tools: omit both

    return body;
  }

  // ── API call ────────────────────────────────────────────────

  private async callDeepSeekApi(
    body: Record<string, unknown>,
    requestId: string,
  ): Promise<DeepSeekApiResponse> {
    const url = `${this.config.endpoint}/v1/chat/completions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new LLMProviderError(
        "deepseek",
        requestId,
        `DeepSeek API network failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
    }

    if (!response.ok) {
      let bodySummary = "";
      try {
        bodySummary = await response.text();
        if (bodySummary.length > 500) {
          bodySummary = bodySummary.slice(0, 500) + "...";
        }
      } catch {
        bodySummary = "(could not read response body)";
      }
      throw new LLMProviderError(
        "deepseek",
        requestId,
        `DeepSeek API returned HTTP ${response.status}: ${bodySummary}`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new LLMProviderError(
        "deepseek",
        requestId,
        "DeepSeek API returned non-JSON response",
        error,
      );
    }

    if (
      json === null ||
      typeof json !== "object" ||
      Array.isArray(json)
    ) {
      throw new LLMProviderError(
        "deepseek",
        requestId,
        "DeepSeek API returned unexpected response shape",
      );
    }

    return json as DeepSeekApiResponse;
  }

  // ── Response normalization ──────────────────────────────────

  private normalizeResponse(response: DeepSeekApiResponse, requestId: string): {
    decision: ActionDecision;
    normalizationStatus: NormalizationStatus;
  } {
    const choice = response.choices?.[0];
    const message = choice?.message;

    // Path A — Native tool calling
    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCalls = this.extractNativeToolCalls(message.tool_calls, requestId);
      // toolCalls already validated — no unparseable entries survived
      return {
        decision: this.makeDecision("tool_calls", undefined, toolCalls),
        normalizationStatus: "native_tool",
      };
    }

    // Path B — JSON mode (content is valid JSON)
    const content = typeof message?.content === "string"
      ? message.content
      : "";

    if (content.length > 0) {
      const jsonDecision = this.tryParseJsonContent(content);
      if (jsonDecision) {
        return {
          decision: jsonDecision,
          normalizationStatus: "json_mode",
        };
      }

      // Path C — Parsed text (may upgrade to json_mode via fence)
      const textResult = this.tryExtractFromText(content);
      if (textResult) {
        return textResult;
      }
    }

    // Path D — Exhaustion
    throw new LLMProviderError(
      "deepseek",
      requestId,
      "DeepSeek adapter normalization exhausted: no tool_calls, content is not parseable JSON, and text heuristics produced no valid decision",
    );
  }

  // ── Native tool call extraction ─────────────────────────────

  private extractNativeToolCalls(
    toolCalls: DeepSeekToolCall[],
    requestId: string,
  ): ToolCallEntry[] {
    return toolCalls.map((tc) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        if (args === null || typeof args !== "object" || Array.isArray(args)) {
          throw new LLMProviderError(
            "deepseek",
            requestId,
            `DeepSeek tool call arguments for "${tc.function.name}" did not parse to a JSON object`,
          );
        }
      } catch (error) {
        if (error instanceof LLMProviderError) {
          throw error;
        }
        throw new LLMProviderError(
          "deepseek",
          requestId,
          `DeepSeek tool call arguments for "${tc.function.name}" are not valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error,
        );
      }
      const entry: ToolCallEntry = {
        tool_name: tc.function.name,
        arguments: args,
      };
      if (tc.id !== undefined) {
        (entry as { provider_call_ref?: string }).provider_call_ref = tc.id;
      }
      return entry;
    });
  }

  // ── JSON content parsing ────────────────────────────────────

  private tryParseJsonContent(content: string): ActionDecision | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    const kind = obj["kind"];
    if (typeof kind !== "string" || !DECISION_KINDS.has(kind as DecisionKind)) {
      return null;
    }

    const decisionKind = kind as DecisionKind;

    // Extract message for respond/clarify/abort
    const message =
      typeof obj["message"] === "string" ? obj["message"] : undefined;

    // Extract tool_calls for tool_calls kind
    let toolCalls: ToolCallEntry[] | undefined;
    if (decisionKind === "tool_calls" && Array.isArray(obj["tool_calls"])) {
      toolCalls = (obj["tool_calls"] as unknown[]).map(
        (tc: unknown): ToolCallEntry => {
          const entry = tc as Record<string, unknown>;
          const result: ToolCallEntry = {
            tool_name:
              typeof entry["tool_name"] === "string"
                ? entry["tool_name"]
                : "unknown",
            arguments:
              typeof entry["arguments"] === "object" &&
              entry["arguments"] !== null &&
              !Array.isArray(entry["arguments"])
                ? (entry["arguments"] as Record<string, unknown>)
                : {},
          };
          if (typeof entry["provider_call_ref"] === "string") {
            (
              result as { provider_call_ref?: string }
            ).provider_call_ref = entry["provider_call_ref"];
          }
          return result;
        },
      );
    }

    return this.makeDecision(decisionKind, message, toolCalls);
  }

  // ── Text heuristics ─────────────────────────────────────────

  private tryExtractFromText(content: string): {
    decision: ActionDecision;
    normalizationStatus: NormalizationStatus;
  } | null {
    // Try to find a markdown-fenced JSON block
    const fenceMatch = content.match(/```json\s*([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
      const jsonContent = fenceMatch[1].trim();
      const jsonDecision = this.tryParseJsonContent(jsonContent);
      if (jsonDecision) {
        return { decision: jsonDecision, normalizationStatus: "json_mode" };
      }
    }

    // Fallback: treat entire content as a "respond" decision
    return {
      decision: this.makeDecision("respond", content, undefined),
      normalizationStatus: "parsed_text",
    };
  }

  // ── Decision factory ────────────────────────────────────────

  private makeDecision(
    kind: DecisionKind,
    message?: string,
    toolCalls?: ToolCallEntry[],
  ): ActionDecision {
    const decision: ActionDecision = {
      decision_id: randomUUID(),
      kind,
    };
    if (message !== undefined) {
      (decision as { message?: string }).message = message;
    }
    if (toolCalls !== undefined && toolCalls.length > 0) {
      (decision as { tool_calls?: readonly ToolCallEntry[] }).tool_calls =
        Object.freeze(toolCalls.map((tc) => Object.freeze({ ...tc })));
    }
    return Object.freeze(decision);
  }
}
