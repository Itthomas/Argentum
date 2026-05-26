import type { AvailableToolEntry } from "@argentum/contracts";

/**
 * DeepSeek-native tool schema shape.
 *
 * Represents one tool definition in the DeepSeek API chat completion
 * `tools` array.  The shape follows the OpenAI-compatible tool calling
 * format used by DeepSeek.
 *
 * This type is used by downstream adapter code (slice 0033) to type the
 * `tools` field of a DeepSeek chat completion request.
 *
 * ## Field mapping from {@link AvailableToolEntry}
 *
 * | AvailableToolEntry | DeepSeekToolSchema      |
 * |--------------------|-------------------------|
 * | name               | function.name           |
 * | description        | function.description    |
 * | input_schema       | function.parameters     |
 *
 * The `parameters` field is `Record<string, unknown>` — the JSON Schema
 * is passed through as-is.  The tool author is responsible for providing
 * a valid JSON Schema in `input_schema`.
 */
export interface DeepSeekToolSchema {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

/**
 * Projects canonical Argentum {@link AvailableToolEntry} values into
 * DeepSeek-native tool schema objects suitable for inclusion in DeepSeek
 * API chat completion requests.
 *
 * This is a **pure data transformation** — no API calls, no side
 * effects, no schema validation, no provider SDK usage.  The function
 * maps `name → function.name`, `description → function.description`,
 * and `input_schema → function.parameters`.
 *
 * The input is the same `AvailableToolEntry` shape that appears in
 * {@link LLMInferenceRequest.available_tools}; execution-policy fields
 * are already stripped upstream by the prompt compiler (slice 0026).
 *
 * @param tools - Provider-neutral tool entries from the canonical
 *   `LLMInferenceRequest.available_tools` array.  Each entry carries
 *   `name`, `description`, and `input_schema`.
 * @returns DeepSeek-native tool schema array.  Preserves input ordering:
 *   element at index `i` in the output corresponds to element at index
 *   `i` in the input.  Empty input produces an empty array.
 *
 * @example
 * ```typescript
 * const projected = projectToolSchemas([
 *   {
 *     name: "read_file",
 *     description: "Read a file from the workspace",
 *     input_schema: {
 *       type: "object",
 *       properties: { path: { type: "string" } },
 *       required: ["path"],
 *     },
 *   },
 * ]);
 * // projected[0].type === "function"
 * // projected[0].function.name === "read_file"
 * // projected[0].function.description === "Read a file from the workspace"
 * // projected[0].function.parameters.type === "object"
 * ```
 */
export function projectToolSchemas(
  tools: readonly AvailableToolEntry[],
): DeepSeekToolSchema[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
