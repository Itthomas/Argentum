import {
  type AvailableToolEntry,
  type ToolCallDTO,
  type ToolDefinition,
  type ToolResultDTO,
  parseToolDefinition,
  parseToolResultDTO,
} from "@argentum/contracts";

import { validateAgainstSchema } from "./schema-validator.js";

// ── Stable error codes ──────────────────────────────────────────

export const TOOL_NOT_REGISTERED = "TOOL_NOT_REGISTERED";
export const SCHEMA_VALIDATION_FAILED = "SCHEMA_VALIDATION_FAILED";
export const TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED";

// ── Implementation type ─────────────────────────────────────────

export type ToolImplementation = (
  call: ToolCallDTO,
) => ToolResultDTO | Promise<ToolResultDTO>;

// ── Internal entry shape ────────────────────────────────────────

interface ToolRegistryEntry {
  readonly definition: ToolDefinition;
  readonly implementation: ToolImplementation;
}

// ── Registry class ──────────────────────────────────────────────

export class ToolRegistry {
  private readonly _entries = new Map<string, ToolRegistryEntry>();

  // ── Registration ────────────────────────────────────────────

  /**
   * Register a tool definition and its implementation.
   * Validates the definition via `parseToolDefinition` from @argentum/contracts.
   * Rejects duplicate tool names (one impl per name for MVP).
   */
  register(definition: ToolDefinition, implementation: ToolImplementation): void {
    // Validate the definition structurally and use the normalized + frozen result.
    // This strips unknown keys, validates all fields, and returns an Object.freeze-d copy.
    const validated = parseToolDefinition(definition);

    // Reject duplicates
    if (this._entries.has(validated.name)) {
      throw new Error(
        `Tool "${validated.name}" is already registered. Only one implementation per tool name is allowed (MVP).`,
      );
    }

    this._entries.set(validated.name, {
      definition: validated,
      implementation,
    });
  }

  // ── Dispatch ────────────────────────────────────────────────

  /**
   * Dispatch a tool call to the registered implementation.
   *
   * CRITICAL ORDERING:
   * 1. Start the clock (first line).
   * 2. Look up tool by name; return TOOL_NOT_REGISTERED if missing.
   * 3. Validate arguments against registered input_schema; return SCHEMA_VALIDATION_FAILED if invalid.
   * 4. Invoke implementation; catch throws → TOOL_EXECUTION_FAILED.
   * 5. Verify call_id on returned result; patch if mismatched.
   * 6. Validate result via parseToolResultDTO; return TOOL_EXECUTION_FAILED if invalid.
   * 7. Return validated result.
   */
  async dispatch(call: ToolCallDTO): Promise<ToolResultDTO> {
    const startMs = Date.now();

    // Lookup
    const entry = this._entries.get(call.tool_name);
    if (!entry) {
      return makeErrorResult(
        call.call_id,
        startMs,
        TOOL_NOT_REGISTERED,
        `Tool "${call.tool_name}" is not registered.`,
      );
    }

    // Schema validation
    const schemaResult = validateAgainstSchema(
      call.arguments,
      entry.definition.input_schema,
    );
    if (!schemaResult.valid) {
      return makeErrorResult(
        call.call_id,
        startMs,
        SCHEMA_VALIDATION_FAILED,
        `Schema validation failed for tool "${call.tool_name}": ${schemaResult.errors.join("; ")}`,
      );
    }

    // Invoke implementation
    let rawResult: ToolResultDTO;
    try {
      rawResult = await entry.implementation(call);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);
      return makeErrorResult(
        call.call_id,
        startMs,
        TOOL_EXECUTION_FAILED,
        `Tool "${call.tool_name}" execution failed: ${message}`,
      );
    }

    // Patch call_id if mismatched — construct NEW ToolResultDTO
    const callIdMatches = rawResult.call_id === call.call_id;
    const idPatchedResult: ToolResultDTO = callIdMatches
      ? rawResult
      : {
          call_id: call.call_id,
          status: rawResult.status,
          human_summary: rawResult.human_summary,
          duration_ms: rawResult.duration_ms,
          truncated: rawResult.truncated,
          retryable: rawResult.retryable,
          ...(rawResult.artifact_refs !== undefined
            ? { artifact_refs: rawResult.artifact_refs }
            : {}),
          ...(rawResult.structured_payload_ref !== undefined
            ? { structured_payload_ref: rawResult.structured_payload_ref }
            : {}),
          ...(rawResult.error_code !== undefined
            ? { error_code: rawResult.error_code }
            : {}),
        };

    // Validate the returned result structurally
    try {
      parseToolResultDTO(idPatchedResult);
    } catch {
      return makeErrorResult(
        call.call_id,
        startMs,
        TOOL_EXECUTION_FAILED,
        `Tool "${call.tool_name}" returned a structurally invalid ToolResultDTO.`,
      );
    }

    // Override duration_ms with registry-measured wall-clock time.
    // The implementation's self-reported duration_ms is discarded —
    // the registry is the canonical timing authority.
    const finalResult: ToolResultDTO = {
      ...idPatchedResult,
      duration_ms: Date.now() - startMs,
    };

    return finalResult;
  }

  // ── Projection ──────────────────────────────────────────────

  /**
   * Return provider-facing tool entries for all registered tools.
   */
  projectForProvider(): AvailableToolEntry[] {
    const entries: AvailableToolEntry[] = [];
    for (const { definition } of this._entries.values()) {
      entries.push({
        name: definition.name,
        description: definition.description,
        // Shallow-clone to prevent caller mutations from corrupting
        // the registry's internal state.
        input_schema: { ...definition.input_schema },
      });
    }
    return entries;
  }

  // ── Introspection helpers ───────────────────────────────────

  isRegistered(name: string): boolean {
    return this._entries.has(name);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this._entries.get(name)?.definition;
  }
}

// ── Internal helpers ────────────────────────────────────────────

function makeErrorResult(
  callId: string,
  startMs: number,
  errorCode: string,
  humanSummary: string,
): ToolResultDTO {
  return {
    call_id: callId,
    status: "error",
    human_summary: humanSummary,
    duration_ms: Date.now() - startMs,
    truncated: false,
    retryable: false,
    error_code: errorCode,
  };
}
