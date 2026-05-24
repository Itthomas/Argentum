import type { ContextItem, TurnBudget } from "@argentum/contracts";

// ── Types ─────────────────────────────────────────────────────

/** Reason an item was omitted from selection. */
export type OmissionReason =
  | "budget_exceeded"
  | "priority_filtered"
  | "layer_filtered";

/** Record of a single omitted context item. */
export interface OmissionRecord {
  readonly contextId: string;
  readonly reason: OmissionReason;
  /** The layer of the omitted item (may be an unrecognized value for layer_filtered). */
  readonly layer: string;
}

/** Options controlling selection behaviour. */
export interface SelectionOptions {
  /**
   * Overrides `budget.max_tokens_per_step` for this selection.
   * Useful for testing or caller-controlled budget caps.
   */
  readonly maxTokens?: number;
  /**
   * When `true` (default), the result includes `OmissionRecord` entries
   * for items that were available but not selected.
   */
  readonly includeOmitted?: boolean;
}

/** Result of a context selection operation. */
export interface SelectionResult {
  /** Items selected for the inference step, in selection order. */
  readonly selected: ContextItem[];
  /** Items available but not selected (empty when `includeOmitted` is `false`). */
  readonly omitted: OmissionRecord[];
  /** Sum of `token_estimate` for selected items (0 for missing estimates). */
  readonly totalTokens: number;
  /** `true` when some items were omitted due to budget constraints, or
   *  mandatory items alone exceeded the budget. */
  readonly budgetExhausted: boolean;
}

// ── Constants ─────────────────────────────────────────────────

/** Layers recognised by the selector. Items outside this set are omitted with `"layer_filtered"`. */
const RECOGNIZED_LAYERS: ReadonlySet<string> = new Set([
  "bedrock",
  "system",
  "episodic",
  "tool_summary",
  "environment",
]);

/** Layers that are always selected first and never omitted for budget. */
const MANDATORY_LAYERS: ReadonlySet<string> = new Set(["bedrock", "system"]);

/** Pattern for identifying ingress-origin episodic items (H2). */
const INGRESS_ORIGIN_RE = /ingress/i;

// ── ContextSelector ───────────────────────────────────────────

/**
 * Stateless context selection policy.
 *
 * Consumes a flat `ContextItem[]` and a `TurnBudget`, and produces a
 * `SelectionResult` with items ordered per the spec selection rules:
 *
 * 1. Mandatory bedrock + system items (never budget-limited)
 * 2. Episodic items — ingress-origin first, then remainder; newest-first
 *    within each group; raw items whose `content_ref.ref_id` matches a
 *    `tool_summary` are omitted with `"priority_filtered"`
 * 3. Compacted tool summaries
 * 4. Environment context (budget permitting)
 *
 * Items with a layer outside the recognised set are omitted with
 * `"layer_filtered"`.
 */
export class ContextSelector {
  /**
   * Select context items for one inference step.
   *
   * @param available  All available context items (insertion order, oldest first).
   * @param budget     Turn-level budget; `max_tokens_per_step` caps token usage.
   * @param options    Optional overrides (`maxTokens`, `includeOmitted`).
   * @returns A `SelectionResult` with selected items, omission records, and budget status.
   */
  select(
    available: readonly ContextItem[],
    budget: TurnBudget,
    options?: SelectionOptions,
  ): SelectionResult {
    const includeOmitted = options?.includeOmitted !== false; // default true
    const effectiveMaxTokens = options?.maxTokens ?? budget.max_tokens_per_step;
    const noBudgetEnforcement = effectiveMaxTokens === undefined;

    const omitted: OmissionRecord[] = [];

    const recordOmission = (
      item: ContextItem,
      reason: OmissionReason,
    ): void => {
      if (includeOmitted) {
        omitted.push({
          contextId: item.context_id,
          reason,
          layer: item.layer,
        });
      }
    };

    // ── Partition by layer ──────────────────────────────────

    const mandatory: ContextItem[] = [];
    const episodic: ContextItem[] = [];
    const toolSummaries: ContextItem[] = [];
    const environment: ContextItem[] = [];

    for (const item of available) {
      if (!RECOGNIZED_LAYERS.has(item.layer)) {
        recordOmission(item, "layer_filtered");
        continue;
      }
      if (MANDATORY_LAYERS.has(item.layer)) {
        mandatory.push(item);
      } else if (item.layer === "episodic") {
        episodic.push(item);
      } else if (item.layer === "tool_summary") {
        toolSummaries.push(item);
      } else if (item.layer === "environment") {
        environment.push(item);
      }
    }

    // ── Compact-summary preference ──────────────────────────

    // Build set of tool_summary ref_ids so we can filter raw duplicates.
    const toolSummaryRefIds = new Set(
      toolSummaries.map((ts) => ts.content_ref.ref_id),
    );

    const filteredEpisodic: ContextItem[] = [];
    for (const item of episodic) {
      if (toolSummaryRefIds.has(item.content_ref.ref_id)) {
        recordOmission(item, "priority_filtered");
      } else {
        filteredEpisodic.push(item);
      }
    }

    // ── Episodic ordering (H2: ingress-first, then newest-first) ─

    const isIngress = (item: ContextItem): boolean =>
      INGRESS_ORIGIN_RE.test(item.origin);

    const ingressEpisodic = filteredEpisodic
      .filter(isIngress)
      .reverse(); // newest first
    const otherEpisodic = filteredEpisodic
      .filter((item) => !isIngress(item))
      .reverse(); // newest first

    const orderedEpisodic = [...ingressEpisodic, ...otherEpisodic];

    // ── Selection ───────────────────────────────────────────

    const selected: ContextItem[] = [];
    let cumulativeTokens = 0;

    /**
     * Attempt to select an item within the token budget.
     * Returns `true` if selected, `false` if omitted due to budget.
     */
    const trySelect = (item: ContextItem): boolean => {
      if (noBudgetEnforcement) {
        selected.push(item);
        cumulativeTokens += item.token_estimate ?? 0;
        return true;
      }

      const estimate = item.token_estimate ?? 0;
      // Zero-estimate items are always selected and don't count against budget.
      if (estimate === 0) {
        selected.push(item);
        // cumulativeTokens unchanged for zero-estimate items
        return true;
      }

      if (cumulativeTokens + estimate <= effectiveMaxTokens!) {
        selected.push(item);
        cumulativeTokens += estimate;
        return true;
      }

      return false;
    };

    // 1. Mandatory items — always selected, never budget-limited
    for (const item of mandatory) {
      selected.push(item);
      cumulativeTokens += item.token_estimate ?? 0;
    }

    // 2. Episodic items
    for (const item of orderedEpisodic) {
      if (!trySelect(item)) {
        recordOmission(item, "budget_exceeded");
      }
    }

    // 3. Tool summaries
    for (const item of toolSummaries) {
      if (!trySelect(item)) {
        recordOmission(item, "budget_exceeded");
      }
    }

    // 4. Environment items
    for (const item of environment) {
      if (!trySelect(item)) {
        recordOmission(item, "budget_exceeded");
      }
    }

    // ── Budget exhausted? ───────────────────────────────────

    let budgetExhausted = false;
    if (!noBudgetEnforcement) {
      // True if any item was omitted due to budget, or if mandatory
      // items alone exceed the budget (in which case no items may have
      // been omitted yet but the budget is still blown).
      budgetExhausted =
        omitted.some((o) => o.reason === "budget_exceeded") ||
        cumulativeTokens > effectiveMaxTokens!;
    }

    return {
      selected,
      omitted,
      totalTokens: cumulativeTokens,
      budgetExhausted,
    };
  }
}
