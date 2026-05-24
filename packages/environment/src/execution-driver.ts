import type { ToolCallDTO, ToolResultDTO } from "@argentum/contracts";

// ── Stable error code constant ──────────────────────────────────

/**
 * Stable error code returned by {@link NativeExecutionDriver} for every call.
 * Consumers can check `ToolResultDTO.error_code === NOOP_DRIVER_STUB` to detect
 * the no-op stub regardless of the input grant configuration.
 */
export const NOOP_DRIVER_STUB = "NOOP_DRIVER_STUB";

// ── Execution driver interface ──────────────────────────────────

/**
 * Abstract seam through which tool calls are executed.
 *
 * The core loop calls {@link execute} with a fully materialized {@link ToolCallDTO}
 * (including a resolved {@link ExecutionGrantDTO} in `call.grant`) and receives a
 * {@link ToolResultDTO}. It never spawns subprocesses or performs direct tool
 * invocation — all execution flows through this interface.
 *
 * ## Grant-driven execution contract
 *
 * Implementations read **all** execution permissions from `call.grant` (the
 * embedded {@link ExecutionGrantDTO}). Callers must resolve a complete grant
 * before invoking the driver; the driver must not assume or derive its own
 * permissions.
 *
 * Implementations **must** honor the following grant fields:
 *
 * - **`call.grant.cwd`** — working directory for execution. The child process
 *   must start in this directory.
 * - **`call.grant.path_permissions`** — allowed filesystem roots and their
 *   capabilities (`read`, `write`, `append`). Implementations must restrict
 *   filesystem access to these permitted paths.
 * - **`call.grant.network_policy`** — network posture.
 *   - `"deny"`: the implementation must prevent all network access for the
 *     duration of the call.
 *   - `"inherit"`: host network inheritance is permitted in MVP.
 * - **`call.grant.env_secret_handles`** — secret names available for injection
 *   into the execution environment. Secret values must be resolved at execution
 *   time from the handle names and **must not** be serialized into turn memory
 *   or telemetry streams.
 * - **`call.grant.max_runtime_ms`** — execution time ceiling. The implementation
 *   must enforce this as a hard timeout and return a blocked or error result if
 *   the call exceeds it.
 * - **`call.grant.approval_mode`** — execution posture.
 *   - `"deny"`: the implementation must block the call and return
 *     `ToolResultDTO.status = "blocked"`.
 *   - `"auto_allow"`: the implementation may proceed without interactive
 *     approval.
 *
 * ## Container-ready design
 *
 * This interface is defined as a TypeScript interface (not a concrete class)
 * so a future container driver can implement the same contract without any
 * changes to this interface or its callers.
 *
 * ## MVP scope
 *
 * In MVP, execution is provided by a native subprocess driver. The interface
 * itself is provider-neutral and does not encode any subprocess-specific
 * assumptions.
 */
export interface ExecutionDriver {
  /**
   * Execute a tool call with the permissions described by `call.grant`.
   *
   * @param call - Fully materialized tool call with a resolved execution grant.
   * @returns A {@link ToolResultDTO} describing the outcome of the call.
   */
  execute(call: ToolCallDTO): Promise<ToolResultDTO>;
}

// ── No-op stub implementation ───────────────────────────────────

/**
 * No-op placeholder implementation of {@link ExecutionDriver}.
 *
 * **This stub does NOT satisfy the full behavioral contract of
 * {@link ExecutionDriver}.** It is intentionally inert — every call returns
 * `status = "blocked"` regardless of the grant contents.
 *
 * ## Unimplemented obligations
 *
 * The following grant-driven behaviors are **not** honored by this stub:
 *
 * - `call.grant.cwd` — not used; no child process is spawned.
 * - `call.grant.path_permissions` — not enforced; no filesystem access occurs.
 * - `call.grant.network_policy` — not enforced; no network operations occur.
 * - `call.grant.env_secret_handles` — not resolved; no environment variables
 *   are injected.
 * - `call.grant.max_runtime_ms` — not enforced; no timeout mechanism is
 *   active.
 * - `call.grant.approval_mode` — not honored; all calls return `"blocked"`
 *   even when the grant allows execution.
 *
 * The real subprocess driver (future slice) will satisfy all of these
 * obligations.
 *
 * ## Behavior
 *
 * Every call to {@link execute} returns a {@link ToolResultDTO} with:
 *
 * | Field              | Value                         |
 * |--------------------|-------------------------------|
 * | `status`           | `"blocked"`                   |
 * | `call_id`          | mirrored from `call.call_id`  |
 * | `human_summary`    | descriptive no-op message     |
 * | `duration_ms`      | `0`                           |
 * | `truncated`        | `false`                       |
 * | `retryable`        | `false`                       |
 * | `error_code`       | `"NOOP_DRIVER_STUB"`          |
 */
export class NativeExecutionDriver implements ExecutionDriver {
  /**
   * Returns a blocked result for every call. The grant is intentionally
   * ignored — see the class JSDoc for the full list of unimplemented
   * obligations.
   */
  execute(call: ToolCallDTO): Promise<ToolResultDTO> {
    return Promise.resolve({
      call_id: call.call_id,
      status: "blocked",
      human_summary:
        "Native execution driver is not yet implemented (no-op stub). " +
        "Tool calls are blocked until the real subprocess driver is available.",
      duration_ms: 0,
      truncated: false,
      retryable: false,
      error_code: NOOP_DRIVER_STUB,
    });
  }
}
