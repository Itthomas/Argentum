import type {
  AvailableToolEntry,
  ContextItem,
  LLMInferenceRequest,
  ToolDefinition,
  TurnBudget,
} from "@argentum/contracts";
import { randomUUID } from "node:crypto";

// ── InferencePolicy ─────────────────────────────────────────────

/**
 * Lightweight policy knobs for inference requests.
 * All fields are optional; sensible defaults are applied when omitted.
 */
export interface InferencePolicy {
  /** Temperature in [0, 2]. Default 0.7. */
  readonly temperature?: number;
  /** Maximum output tokens. Must be > 0 if provided. Default 4096. */
  readonly max_output_tokens?: number;
  /**
   * Preferred normalization strategy hint.
   * Default `"native_tool"`.
   */
  readonly normalization_mode?: "native_tool" | "json_mode" | "parsed_text";
}

// ── PromptCompilerInput ─────────────────────────────────────────

/**
 * Validated input bag for the prompt compiler.
 *
 * NOTE: The prompt-compiler spec lists "selection" as a compiler
 * responsibility, but this implementation delegates selection to
 * the context selection policy (slice 0027). The compiler receives
 * already-selected items and validates/assembles them. This is
 * modularization, not a behavior change.
 */
export interface PromptCompilerInput {
  /** Owning turn identifier (required, non-empty). */
  readonly turnId: string;
  /** Ordered context items selected for this step (required, non-empty). */
  readonly contextItems: readonly ContextItem[];
  /** Provider-neutral tool schemas exposed for this step (required, may be empty). */
  readonly availableTools: readonly ToolDefinition[];
  /** Optional override for request_id; generated via crypto.randomUUID() if omitted. */
  readonly requestId?: string;
  /** Optional inference policy overrides. */
  readonly inferencePolicy?: InferencePolicy;
  /**
   * Optional callback invoked when estimated token count exceeds
   * `budget.max_tokens_per_step`. The compiler warns but does NOT
   * reject — budget enforcement is owned by the governor.
   */
  readonly onBudgetWarning?: (estimated: number, max: number) => void;
  /** Optional turn budget for token-awareness (C1). */
  readonly budget?: TurnBudget;
}

// ── PromptCompilerError ─────────────────────────────────────────

/** Discriminated error codes for PromptCompilerError. */
export type PromptCompilerErrorCode =
  | "EMPTY_CONTEXT_ITEMS"
  | "MISSING_TURN_ID"
  | "INVALID_CONTEXT_ITEM"
  | "INVALID_TOOL_DEFINITION"
  | "INVALID_POLICY";

/**
 * Named Error subclass thrown for invalid compiler inputs.
 * The `code` property allows callers to discriminate error causes.
 */
export class PromptCompilerError extends Error {
  readonly code: PromptCompilerErrorCode;

  constructor(code: PromptCompilerErrorCode, message: string) {
    super(message);
    this.name = "PromptCompilerError";
    this.code = code;
  }
}

// ── Defaults ────────────────────────────────────────────────────

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_NORMALIZATION_MODE = "native_tool" as const;

// ── PromptCompiler ──────────────────────────────────────────────

/**
 * Assembles provider-neutral `LLMInferenceRequest` objects from
 * validated inputs. Operates exclusively on canonical contract types;
 * does NOT import or reference any provider-native types.
 */
export class PromptCompiler {
  // ── Public entrypoint ─────────────────────────────────────────

  /**
   * Compile a validated `PromptCompilerInput` into an `LLMInferenceRequest`.
   * @throws {PromptCompilerError} for invalid inputs.
   */
  compile(input: PromptCompilerInput): LLMInferenceRequest {
    this.validateTurnId(input);
    this.validateContextItems(input);
    this.validateToolDefinitions(input);
    this.validatePolicy(input);
    this.checkBudget(input);

    const requestId = input.requestId ?? randomUUID();
    const policy = this.resolvePolicy(input.inferencePolicy);
    const availableTools = this.convertTools(input.availableTools);

    return {
      request_id: requestId,
      turn_id: input.turnId,
      context_items: [...input.contextItems],
      available_tools: availableTools,
      inference_policy: policy,
    };
  }

  // ── Validation ────────────────────────────────────────────────

  private validateTurnId(input: PromptCompilerInput): void {
    if (typeof input.turnId !== "string" || input.turnId.length === 0) {
      throw new PromptCompilerError(
        "MISSING_TURN_ID",
        "turnId is required and must be a non-empty string.",
      );
    }
  }

  private validateContextItems(input: PromptCompilerInput): void {
    const items = input.contextItems;

    if (!Array.isArray(items) || items.length === 0) {
      throw new PromptCompilerError(
        "EMPTY_CONTEXT_ITEMS",
        "contextItems must be a non-empty array.",
      );
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      // Validate required fields on each ContextItem.
      if (typeof item.context_id !== "string" || item.context_id.length === 0) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: missing or empty context_id.`,
        );
      }
      if (typeof item.layer !== "string" || item.layer.length === 0) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: missing or empty layer.`,
        );
      }
      if (typeof item.role !== "string" || item.role.length === 0) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: missing or empty role.`,
        );
      }
      if (typeof item.origin !== "string" || item.origin.length === 0) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: missing or empty origin.`,
        );
      }
      if (typeof item.retention !== "string" || item.retention.length === 0) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: missing or empty retention.`,
        );
      }
      // content_ref must be a non-null object with required fields.
      const ref = item.content_ref;
      if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: content_ref must be a non-null object.`,
        );
      }
      const refRecord = ref as Record<string, unknown>;
      if (typeof refRecord.ref_id !== "string" || refRecord.ref_id.length === 0) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: content_ref.ref_id is missing or empty.`,
        );
      }
      if (typeof refRecord.kind !== "string" || refRecord.kind.length === 0) {
        throw new PromptCompilerError(
          "INVALID_CONTEXT_ITEM",
          `contextItems[${i}]: content_ref.kind is missing or empty.`,
        );
      }
    }
  }

  private validateToolDefinitions(input: PromptCompilerInput): void {
    const tools = input.availableTools;

    if (!Array.isArray(tools)) {
      throw new PromptCompilerError(
        "INVALID_TOOL_DEFINITION",
        "availableTools must be an array.",
      );
    }

    for (let i = 0; i < tools.length; i += 1) {
      const tool = tools[i]!;
      if (typeof tool.name !== "string" || tool.name.length === 0) {
        throw new PromptCompilerError(
          "INVALID_TOOL_DEFINITION",
          `availableTools[${i}]: missing or empty name (tool_name).`,
        );
      }
      if (typeof tool.description !== "string" || tool.description.length === 0) {
        throw new PromptCompilerError(
          "INVALID_TOOL_DEFINITION",
          `availableTools[${i}]: missing or empty description.`,
        );
      }
      if (
        typeof tool.input_schema !== "object" ||
        tool.input_schema === null ||
        Array.isArray(tool.input_schema)
      ) {
        throw new PromptCompilerError(
          "INVALID_TOOL_DEFINITION",
          `availableTools[${i}]: input_schema must be a non-null object.`,
        );
      }
    }
  }

  private validatePolicy(input: PromptCompilerInput): void {
    const policy = input.inferencePolicy;
    if (policy === undefined) return;

    if ("temperature" in policy && typeof policy.temperature === "number") {
      if (policy.temperature < 0 || policy.temperature > 2) {
        throw new PromptCompilerError(
          "INVALID_POLICY",
          `inferencePolicy.temperature must be in [0, 2], got ${policy.temperature}.`,
        );
      }
    }

    if (
      "max_output_tokens" in policy &&
      typeof policy.max_output_tokens === "number"
    ) {
      if (policy.max_output_tokens <= 0) {
        throw new PromptCompilerError(
          "INVALID_POLICY",
          `inferencePolicy.max_output_tokens must be > 0, got ${policy.max_output_tokens}.`,
        );
      }
    }
  }

  // ── Budget awareness ──────────────────────────────────────────

  private checkBudget(input: PromptCompilerInput): void {
    const budget = input.budget;
    if (!budget) return;

    const maxTokens = budget.max_tokens_per_step;
    if (maxTokens === undefined) return;

    const estimated = this.estimateTokens(input.contextItems);

    if (estimated > maxTokens && input.onBudgetWarning) {
      input.onBudgetWarning(estimated, maxTokens);
    }
    // Never reject — budget enforcement is the governor's job.
  }

  // ── Token estimation ──────────────────────────────────────────

  /**
   * Sum `token_estimate` across context items.
   * Items with absent/undefined estimates contribute 0.
   */
  estimateTokens(items: readonly ContextItem[]): number {
    let total = 0;
    for (const item of items) {
      if (typeof item.token_estimate === "number" && item.token_estimate > 0) {
        total += item.token_estimate;
      }
    }
    return total;
  }

  // ── Tool conversion (H1) ──────────────────────────────────────

  /**
   * Convert ToolDefinition[] to AvailableToolEntry[].
   * Only `name`, `description`, and `input_schema` are preserved;
   * `side_effect_level`, `path_scope`, `required_secret_handles`,
   * `network_access`, `default_timeout_ms`, and `defaults` are stripped.
   */
  private convertTools(
    tools: readonly ToolDefinition[],
  ): readonly AvailableToolEntry[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  // ── Policy resolution ─────────────────────────────────────────

  /**
   * Resolve inference policy with defaults applied.
   * Returns a plain `Record<string, unknown>` matching the
   * `LLMInferenceRequest.inference_policy` contract shape.
   */
  private resolvePolicy(
    override?: InferencePolicy,
  ): Record<string, unknown> {
    const policy: Record<string, unknown> = {
      temperature: DEFAULT_TEMPERATURE,
      max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
      normalization_mode: DEFAULT_NORMALIZATION_MODE,
    };

    if (override) {
      if (typeof override.temperature === "number") {
        policy.temperature = override.temperature;
      }
      if (typeof override.max_output_tokens === "number") {
        policy.max_output_tokens = override.max_output_tokens;
      }
      if (typeof override.normalization_mode === "string") {
        policy.normalization_mode = override.normalization_mode;
      }
    }

    return policy;
  }
}
