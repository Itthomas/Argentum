import type { LLMInferenceRequest, LLMInferenceResult } from "@argentum/contracts";

/**
 * Provider-neutral LLM inference seam.
 *
 * The core loop calls `infer(request)` and receives a canonical
 * `LLMInferenceResult` — it never constructs provider-native API payloads
 * or parses provider-native response shapes.
 *
 * ## Behavioral contract for implementations
 *
 * - Accept a canonical {@link LLMInferenceRequest} from the core loop.
 * - Translate `context_items` and `available_tools` into provider-native
 *   request shapes internally.  Provider-native tool schemas must be
 *   generated from the tool registry source of truth (the
 *   `available_tools` array in the request).
 * - May use provider-native tool calling, JSON mode / structured output,
 *   or parsed text internally.  The `normalization_status` field in the
 *   result reflects the strategy that actually produced the exported
 *   normalized decision.
 * - MUST return exactly one normalized {@link LLMInferenceResult} per
 *   request, containing a canonical `ActionDecision`.
 * - Raw provider payloads MUST remain adapter-private except by
 *   artifact reference (`raw_trace_ref` in the result).
 * - Multi-tool action decisions execute **sequentially** in MVP.  The
 *   adapter MUST NOT expose parallel execution semantics to the core
 *   loop.  Provider-native parallel intent, if present, MUST be
 *   flattened into sequential `tool_calls` entries.
 * - SHOULD throw {@link LLMProviderError} (or a subclass) on
 *   adapter-level failure: network errors, authentication failures,
 *   malformed provider responses that cannot be repaired, etc.
 *
 * ## MVP constraints
 *
 * - One provider implementation (DeepSeek).
 * - No provider failover or routing between multiple adapters.
 * - A single `LLMProvider` implementation is injected into the core
 *   loop at composition time.
 * - The interface is provider-neutral — any LLM backend can implement
 *   this contract without interface changes.
 *
 * @see {@link LLMProviderError} for the standard adapter-failure surface.
 */
export interface LLMProvider {
  /**
   * Execute one inference step.
   *
   * @param request - Canonical inference request carrying `request_id`,
   *   `turn_id`, ordered `context_items`, `available_tools`, and
   *   `inference_policy`.
   * @returns A normalized {@link LLMInferenceResult} containing a
   *   canonical `ActionDecision`.
   * @throws {LLMProviderError} on adapter-level failure (network,
   *   authentication, irreparable malformed response, etc.).
   */
  infer(request: LLMInferenceRequest): Promise<LLMInferenceResult>;
}

/**
 * Controlled adapter failure.
 *
 * `LLMProviderError` is the standard failure surface for
 * {@link LLMProvider.infer}.  Implementations should throw this (or a
 * subclass) when an adapter-level failure occurs that cannot be
 * repaired internally:
 *
 * - Network errors
 * - Authentication / authorization failures
 * - Malformed provider responses beyond adapter-local repair
 * - Provider-reported errors (rate limiting, server errors, etc.)
 *
 * Callers should catch this error to distinguish adapter failures
 * from other errors (validation errors, programming errors, etc.).
 *
 * The error carries the stable provider identifier and the originating
 * request identifier so that callers can attribute the failure.
 *
 * @example
 * ```typescript
 * throw new LLMProviderError(
 *   "deepseek-default",
 *   request.request_id,
 *   "DeepSeek API returned HTTP 503",
 *   underlyingError,
 * );
 * ```
 */
export class LLMProviderError extends Error {
  /** Stable identifier of the provider instance that failed. */
  readonly providerId: string;

  /** The `request_id` from the originating `LLMInferenceRequest`. */
  readonly requestId: string;

  /** The underlying error, if available. */
  readonly cause?: unknown;

  constructor(
    providerId: string,
    requestId: string,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "LLMProviderError";
    this.providerId = providerId;
    this.requestId = requestId;
    this.cause = cause;
  }
}
