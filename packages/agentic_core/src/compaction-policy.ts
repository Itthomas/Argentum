import type { ContentRef, ContextItem, ToolResultDTO } from "@argentum/contracts";

// ── Constants ───────────────────────────────────────────────────

/** Default byte-size threshold above which a result is "large" and must be externalized. */
export const DEFAULT_COMPACTION_THRESHOLD_BYTES = 4096;

// ── ArtifactExternalizer interface ──────────────────────────────

/**
 * Interface for externalizing large tool outputs to artifact storage.
 * Implemented by the environment package; the compaction policy
 * delegates I/O through this seam.
 */
export interface ArtifactExternalizer {
  /**
   * Store raw tool output content in artifact storage.
   * @param callId - The tool call ID (matches `ToolResultDTO.call_id`).
   * @param content - The raw content to externalize.
   * @returns A `ContentRef` pointing to the stored artifact.
   */
  store(callId: string, content: string): Promise<ContentRef>;
}

// ── Disposition ─────────────────────────────────────────────────

/** The action taken by the compaction policy for a tool result. */
export type CompactionDisposition = "inline" | "externalized" | "error_summary";

// ── Options ─────────────────────────────────────────────────────

/** Optional configuration for the compaction policy. */
export interface CompactionOptions {
  /**
   * Byte-size threshold above which a result is considered "large"
   * and must be externalized. Default: 4096 (4 KiB).
   */
  sizeThresholdBytes?: number;
}

// ── Result ──────────────────────────────────────────────────────

/** The output of a compaction operation. */
export interface CompactionResult {
  /** The compacted `ContextItem` for episodic memory. */
  readonly contextItem: ContextItem;
  /** `ContentRef` references to externalized raw artifacts (empty if nothing externalized). */
  readonly externalizedRefs: ContentRef[];
  /** The new compaction revision (only incremented when memory-affecting changes are committed). */
  readonly newRevision: number;
  /** What action was taken. */
  readonly disposition: CompactionDisposition;
}

// ── Helpers ─────────────────────────────────────────────────────

function measureBytes(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

function makeContentRef(callId: string, suffix?: string): ContentRef {
  const id = suffix ? `compaction-summary:${callId}:${suffix}` : `compaction-summary:${callId}`;
  return {
    ref_id: id,
    kind: "text",
    storage_area: "working",
    locator: callId,
    retention: "session",
  };
}

function tokenEstimate(text: string): number {
  // Rough heuristic: ~4 bytes per token for English text.
  return Math.ceil(measureBytes(text) / 4);
}

/**
 * Truncate `text` so its UTF-8 byte length ≤ `maxBytes`.
 * Prefers truncating at the last sentence boundary (`. `) before the limit.
 * Falls back to character-level truncation ensuring valid UTF-8.
 */
function truncateToByteLimit(text: string, maxBytes: number): string {
  if (measureBytes(text) <= maxBytes) {
    return text;
  }

  // Find the approximate character index at the byte limit.
  // Walk forward from the start, counting bytes.
  let byteCount = 0;
  let charIdx = 0;
  for (; charIdx < text.length; charIdx++) {
    const charBytes = measureBytes(text[charIdx]!);
    if (byteCount + charBytes > maxBytes) {
      break;
    }
    byteCount += charBytes;
  }

  // charIdx is now the first character that would exceed the limit.
  // Try to find the last sentence boundary before charIdx.
  const prefix = text.slice(0, charIdx);
  const lastSentenceEnd = prefix.lastIndexOf(". ");

  if (lastSentenceEnd > 0) {
    // Truncate at sentence boundary (include the period, exclude the trailing space).
    return prefix.slice(0, lastSentenceEnd + 1);
  }

  // Fall back: use String.prototype.slice which is safe for UTF-8 (works on code points).
  return text.slice(0, charIdx);
}

function isErrorStatus(status: string): boolean {
  return status === "error" || status === "blocked";
}

function buildErrorSummary(result: ToolResultDTO): string {
  const label = result.status === "blocked" ? "Blocked" : "Error";
  const code = result.error_code ? ` [${result.error_code}]` : "";
  return `${label}${code}: ${result.human_summary}`;
}

const TRUNCATION_SUFFIX = "...";
const TRUNCATION_SUFFIX_BYTES = 3; // "..." is 3 ASCII bytes

function buildExternalSummary(result: ToolResultDTO, threshold: number): string {
  // If the human_summary already fits, use it verbatim.
  if (measureBytes(result.human_summary) <= threshold) {
    return result.human_summary;
  }

  // Reserve room for the truncation suffix so the final string stays ≤ threshold.
  const truncationLimit = Math.max(0, threshold - TRUNCATION_SUFFIX_BYTES);
  const truncated = truncateToByteLimit(result.human_summary, truncationLimit);
  return truncated + TRUNCATION_SUFFIX;
}

// ── CompactionPolicy ────────────────────────────────────────────

/**
 * Pure decision-engine module that compacts tool results before
 * they enter episodic memory. Delegates I/O to `ArtifactExternalizer`.
 */
export class CompactionPolicy {
  private readonly sizeThresholdBytes: number;

  constructor(options?: CompactionOptions) {
    this.sizeThresholdBytes = options?.sizeThresholdBytes ?? DEFAULT_COMPACTION_THRESHOLD_BYTES;
  }

  /**
   * Compact a tool result into a `ContextItem` suitable for episodic memory.
   *
   * @param result - The tool execution result to compact.
   * @param currentRevision - The current `compaction_revision` from the `TurnEnvelope`.
   * @param externalizer - Optional externalizer for large results; required when externalization is needed.
   * @returns The compaction result with disposition, context item, and revision.
   */
  async compact(
    result: ToolResultDTO,
    currentRevision: number,
    externalizer?: ArtifactExternalizer,
  ): Promise<CompactionResult> {
    const { call_id: callId, status, human_summary: humanSummary, truncated } = result;

    // ── Determine disposition ──────────────────────────────────
    if (isErrorStatus(status)) {
      return this.compactError(result, currentRevision);
    }

    const isLarge = truncated || measureBytes(humanSummary) > this.sizeThresholdBytes;

    if (isLarge) {
      return this.compactLarge(result, currentRevision, externalizer);
    }

    return this.compactInline(result, currentRevision);
  }

  // ── Inline (small, verbatim) ──────────────────────────────────

  private compactInline(
    result: ToolResultDTO,
    currentRevision: number,
  ): CompactionResult {
    const { call_id: callId, human_summary: humanSummary } = result;

    const contextItem: ContextItem = {
      context_id: `compaction:${callId}`,
      layer: "tool_summary",
      role: "tool",
      content_ref: makeContentRef(callId),
      origin: "compaction",
      retention: "rolling",
      token_estimate: tokenEstimate(humanSummary),
    };

    return {
      contextItem,
      externalizedRefs: [],
      newRevision: currentRevision, // No increment: verbatim small result.
      disposition: "inline",
    };
  }

  // ── Large (externalized) ─────────────────────────────────────

  private async compactLarge(
    result: ToolResultDTO,
    currentRevision: number,
    externalizer?: ArtifactExternalizer,
  ): Promise<CompactionResult> {
    if (!externalizer) {
      throw new Error(
        `CompactionPolicy: result for call ${result.call_id} requires externalization but no ArtifactExternalizer was provided.`,
      );
    }

    const { call_id: callId, human_summary: humanSummary } = result;

    // Externalize the raw full content.
    const externalRef = await externalizer.store(callId, humanSummary);

    // Build a truncated summary that fits under the threshold.
    const summary = buildExternalSummary(result, this.sizeThresholdBytes);

    const contextItem: ContextItem = {
      context_id: `compaction:${callId}`,
      layer: "tool_summary",
      role: "tool",
      content_ref: makeContentRef(callId, "summary"),
      origin: "compaction",
      retention: "rolling",
      token_estimate: tokenEstimate(summary),
    };

    return {
      contextItem,
      externalizedRefs: [externalRef],
      newRevision: currentRevision + 1, // Increment: externalization occurred.
      disposition: "externalized",
    };
  }

  // ── Error / Blocked ──────────────────────────────────────────

  private compactError(
    result: ToolResultDTO,
    currentRevision: number,
  ): CompactionResult {
    const { call_id: callId } = result;

    const summary = buildErrorSummary(result);

    const contextItem: ContextItem = {
      context_id: `compaction:${callId}`,
      layer: "tool_summary",
      role: "tool",
      content_ref: makeContentRef(callId, "error"),
      origin: "compaction",
      retention: "rolling",
      token_estimate: tokenEstimate(summary),
    };

    return {
      contextItem,
      externalizedRefs: [],
      newRevision: currentRevision + 1, // Increment: error context added (differs from raw summary).
      disposition: "error_summary",
    };
  }
}
