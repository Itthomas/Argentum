import type { TurnEnvelope } from "@argentum/contracts";

// ── Types ───────────────────────────────────────────────────────

/** Reasons the governor may abort a turn. */
export type GovernorAbortReason =
  | "step_limit_exceeded"
  | "repair_limit_exceeded"
  | "wall_clock_exceeded";

/** The decision returned by the turn governor. */
export type GovernorDecision =
  | { readonly action: "continue" }
  | { readonly action: "abort"; readonly reason: GovernorAbortReason };

// ── Governor ─────────────────────────────────────────────────────

/**
 * Evaluate turn budget limits and return a continue or abort decision.
 *
 * Checks are performed in priority order:
 * 1. step_count vs max_inference_steps
 * 2. repair_attempts_used vs max_repair_attempts
 * 3. elapsed wall-clock time vs max_wall_clock_ms
 *
 * Step-count and wall-clock comparisons use `>=` so that a turn aborts when
 * the observed value meets the budget. Repair attempts abort only when the
 * counter would exceed the budget, allowing the current inference step to
 * reach validation and emit a controlled validation-side abort when no
 * repairs remain.
 *
 * @param envelope - The current turn envelope (includes step_count and budget).
 * @param startedAt - Epoch-ms timestamp recorded at turn start.
 * @returns A GovernorDecision: `{ action: "continue" }` if all budgets are
 *          within limits, or `{ action: "abort"; reason }` when a limit is hit.
 */
export function evaluateGovernor(
  envelope: TurnEnvelope,
  startedAt: number,
): GovernorDecision {
  const { step_count, budget } = envelope;

  // 1. Step limit
  if (step_count >= budget.max_inference_steps) {
    return { action: "abort", reason: "step_limit_exceeded" };
  }

  // 2. Repair limit
  if (budget.repair_attempts_used > budget.max_repair_attempts) {
    return { action: "abort", reason: "repair_limit_exceeded" };
  }

  // 3. Wall-clock limit
  if (Date.now() - startedAt >= budget.max_wall_clock_ms) {
    return { action: "abort", reason: "wall_clock_exceeded" };
  }

  return { action: "continue" };
}
