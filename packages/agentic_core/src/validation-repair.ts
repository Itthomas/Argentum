import type {
  ActionDecision,
  ContextItem,
  ContextLayer,
  ContentRef,
  ContentRefKind,
  ContentRefRetention,
  ContentRefStorageArea,
  TurnEnvelope,
} from "@argentum/contracts";
import {
  ActionDecisionValidationError,
  parseActionDecision,
} from "@argentum/contracts";
import { Buffer } from "node:buffer";

import type { EpisodicMemory } from "./episodic-memory.js";

// ── ValidationOutcome discriminated union ───────────────────────

export type ValidationOutcome =
  | { readonly outcome: "valid"; readonly decision: ActionDecision }
  | {
      readonly outcome: "repair";
      readonly feedback: ContextItem;
      readonly feedbackText: string;
      readonly updatedEnvelope: TurnEnvelope;
    }
  | {
      readonly outcome: "abort";
      readonly reason: string;
      readonly updatedEnvelope: TurnEnvelope;
    };

// ── Main entrypoint ─────────────────────────────────────────────

/**
 * Validate an `ActionDecision` against canonical contracts and apply the
 * repair policy if validation fails.
 *
 * ## Validation
 *
 * The module delegates **entirely** to `parseActionDecision()` from
 * `@argentum/contracts` — there is no custom conditional field logic.
 * `parseActionDecision` is the single source of truth for all
 * `ActionDecision` schema rules.
 *
 * ## Repair policy
 *
 * When validation fails:
 * 1. If `repair_attempts_used < max_repair_attempts`: increment the counter,
 *    construct repair feedback as a `ContextItem`, append it to episodic
 *    memory, and return `{ outcome: "repair" }`.
 * 2. If repairs are exhausted: return `{ outcome: "abort" }` **without**
 *    incrementing the counter.
 *
 * ## Immutability
 *
 * Neither the input `decision` nor `envelope` are mutated.  The returned
 * `updatedEnvelope` is a shallow copy with an incremented
 * `repair_attempts_used` (repair path) or an identity copy (abort path).
 *
 * @param decision - The normalized decision to validate.
 * @param envelope - The current turn envelope with budget counters.
 * @param memory   - Session-scoped episodic memory for storing repair feedback.
 * @returns A {@link ValidationOutcome} discriminated on `outcome`.
 */
export function validateAndRepair(
  decision: ActionDecision,
  envelope: TurnEnvelope,
  memory: EpisodicMemory,
): ValidationOutcome {
  // 1. Validate via parseActionDecision (single source of truth).
  try {
    const validated = parseActionDecision(decision);
    return { outcome: "valid", decision: validated };
  } catch (error) {
    if (!(error instanceof ActionDecisionValidationError)) {
      // Unexpected error — escalate as abort.
      return {
        outcome: "abort",
        reason: `unexpected_validation_error: ${String(error)}`,
        updatedEnvelope: { ...envelope },
      };
    }

    const validationError: ActionDecisionValidationError = error;

    // 2. Check whether repair attempts remain.
    const { repair_attempts_used, max_repair_attempts } = envelope.budget;

    if (repair_attempts_used >= max_repair_attempts) {
      // Repairs exhausted — abort without incrementing.
      return {
        outcome: "abort",
        reason: "repair_attempts_exhausted",
        updatedEnvelope: { ...envelope },
      };
    }

    // 3. Repairs remain — build feedback, store in memory, increment.
    const feedback = buildRepairFeedback(decision, validationError);
    memory.add(feedback.contextItem);

    const updatedEnvelope = incrementRepairAttempts(envelope);

    return {
      outcome: "repair",
      feedback: feedback.contextItem,
      feedbackText: feedback.feedbackText,
      updatedEnvelope,
    };
  }
}

// ── Private helpers ─────────────────────────────────────────────

/**
 * Build a `ContextItem` that records a validation failure and provides
 * corrective guidance for the next inference step.
 *
 * The feedback is a compact, operational message that includes:
 * - The validation error summary (from `ActionDecisionValidationError.issues`)
 * - A directive to re-generate with corrected structure
 */
function buildRepairFeedback(
  decision: ActionDecision,
  error: ActionDecisionValidationError,
): { readonly contextItem: ContextItem; readonly feedbackText: string } {
  const decisionId = decision.decision_id;
  const contextId = `repair:${decisionId}`;

  // Build a compact error summary from structured validation issues.
  const errorSummary = error.issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("; ");

  const feedbackText =
    `Validation failed for decision ${decisionId}: ${errorSummary}. ` +
    `Please re-generate with corrected structure.`;

  const tokenEstimate = Math.ceil(
    Buffer.byteLength(feedbackText, "utf-8") / 4,
  );

  const contentRef: ContentRef = {
    ref_id: contextId,
    kind: "text" as ContentRefKind,
    storage_area: "working" as ContentRefStorageArea,
    locator: contextId,
    retention: "session" as ContentRefRetention,
  };

  const contextItem: ContextItem = {
    context_id: contextId,
    layer: "system" as ContextLayer,
    role: "system",
    content_ref: contentRef,
    origin: "repair",
    retention: "rolling",
    token_estimate: tokenEstimate,
  };

  return {
    contextItem,
    feedbackText,
  };
}

/**
 * Return a shallow copy of `envelope` with `repair_attempts_used`
 * incremented by exactly 1.  All other fields are preserved.
 */
function incrementRepairAttempts(envelope: TurnEnvelope): TurnEnvelope {
  return {
    ...envelope,
    budget: {
      ...envelope.budget,
      repair_attempts_used: envelope.budget.repair_attempts_used + 1,
    },
  };
}
