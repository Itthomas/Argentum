import type {
  ToolCallDTO,
  ToolDefinition,
  ToolResultDTO,
} from "@argentum/contracts";

import type { ToolRegistry } from "./registry.js";

/**
 * Pure decision function: should a failed tool call be retried exactly once?
 *
 * Returns `true` ONLY when ALL of the following hold:
 * - `toolDef.side_effect_level === "read_only"` — mutations are never retried automatically.
 * - `result.status === "error"` — successful or blocked calls are never retried.
 * - `result.retryable === true` — the implementation or registry must signal that retry is safe.
 *
 * Does NOT inspect `error_code`. The `ToolRegistry` already sets `retryable: false`
 * on structural failures (`TOOL_NOT_REGISTERED`, `SCHEMA_VALIDATION_FAILED`),
 * so they are correctly rejected through the standard `retryable` check.
 */
export function shouldRetry(
  toolDef: ToolDefinition,
  result: ToolResultDTO,
): boolean {
  return (
    toolDef.side_effect_level === "read_only" &&
    result.status === "error" &&
    result.retryable === true
  );
}

/**
 * Wraps a single registry `dispatch()` call with at most one automatic retry.
 *
 * Behavior:
 * 1. Calls `registry.dispatch(call)` for the first result.
 * 2. If `shouldRetry(toolDef, firstResult)` returns `true`, calls `dispatch()`
 *    exactly one more time and returns the second result.
 * 3. Otherwise, returns the first result immediately.
 *
 * Max 2 total `dispatch()` calls per invocation. No try/catch is needed —
 * `ToolRegistry.dispatch()` never throws; it catches all implementation
 * errors internally and returns `TOOL_EXECUTION_FAILED` error results.
 */
export async function dispatchWithRetry(
  registry: ToolRegistry,
  toolDef: ToolDefinition,
  call: ToolCallDTO,
): Promise<ToolResultDTO> {
  const firstResult = await registry.dispatch(call);

  if (shouldRetry(toolDef, firstResult)) {
    return registry.dispatch(call);
  }

  return firstResult;
}
