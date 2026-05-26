// ── Non-throwing tool schema validation wrapper ─────────────────
// Wraps `parseToolDefinition` from `@argentum/contracts` in a
// try/catch.  All validation logic stays in `parseToolDefinition`;
// this module performs zero validation on its own and imports no
// vocabulary constants.

import type { ToolDefinition } from "@argentum/contracts";
import {
  parseToolDefinition,
  ToolDefinitionValidationError,
} from "@argentum/contracts";

// ── Result type ─────────────────────────────────────────────────

export type ToolSchemaValidationResult =
  | { readonly valid: true; readonly definition: ToolDefinition }
  | { readonly valid: false; readonly errors: string[] };

// ── Public wrapper ──────────────────────────────────────────────

/**
 * Validate a value as a {@link ToolDefinition} without throwing.
 *
 * Delegates entirely to `parseToolDefinition` for structural and
 * vocabulary validation.  On success returns the frozen, normalized
 * definition.  On failure returns a `{ valid: false, errors }` result
 * with error messages extracted from the underlying validation issues.
 *
 * This wrapper **never** throws for invalid input.
 */
export function validateToolSchemaModel(
  value: unknown,
): ToolSchemaValidationResult {
  try {
    const definition = parseToolDefinition(value);
    return { valid: true, definition };
  } catch (err: unknown) {
    if (err instanceof ToolDefinitionValidationError) {
      return {
        valid: false,
        errors: err.issues.map((issue) => issue.message),
      };
    }

    // Unexpected error — still uphold the non-throwing contract.
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}
