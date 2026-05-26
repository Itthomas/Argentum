import type { ToolDefinition } from "@argentum/contracts";

export type ToolExposureMode = "all" | "explicit";

export type ToolExposureRequest =
  | { readonly mode: "all" }
  | {
      readonly mode: "explicit";
      readonly toolNames: readonly string[];
    };

export interface ToolExposurePlan {
  readonly exposedTools: readonly ToolDefinition[];
  readonly omittedRegisteredToolNames: readonly string[];
  readonly missingRequestedToolNames: readonly string[];
}

export function planToolExposure(
  snapshot: readonly ToolDefinition[],
  request: ToolExposureRequest,
): ToolExposurePlan {
  if (request.mode === "all") {
    return {
      exposedTools: Object.freeze([...snapshot]),
      omittedRegisteredToolNames: Object.freeze([]),
      missingRequestedToolNames: Object.freeze([]),
    };
  }

  const definitionsByName = new Map(
    snapshot.map((definition) => [definition.name, definition] as const),
  );
  const seenRequestedNames = new Set<string>();
  const exposedTools: ToolDefinition[] = [];
  const missingRequestedToolNames: string[] = [];

  for (const toolName of request.toolNames) {
    if (seenRequestedNames.has(toolName)) {
      continue;
    }

    seenRequestedNames.add(toolName);

    const definition = definitionsByName.get(toolName);
    if (definition === undefined) {
      missingRequestedToolNames.push(toolName);
      continue;
    }

    exposedTools.push(definition);
  }

  const exposedToolNames = new Set(
    exposedTools.map((definition) => definition.name),
  );
  const omittedRegisteredToolNames = snapshot
    .filter((definition) => !exposedToolNames.has(definition.name))
    .map((definition) => definition.name);

  return {
    exposedTools: Object.freeze(exposedTools),
    omittedRegisteredToolNames: Object.freeze(omittedRegisteredToolNames),
    missingRequestedToolNames: Object.freeze(missingRequestedToolNames),
  };
}