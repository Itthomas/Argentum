import type { ToolDefinition } from "@argentum/contracts";
import { ToolRegistry } from "@argentum/tooling";

import { registerRuntimeTools } from "./tooling-registration.js";

export interface RuntimeToolingComposition {
	readonly registeredTools: readonly ToolDefinition[];
}

export function composeRuntimeTooling(
	toolRegistry: ToolRegistry,
): RuntimeToolingComposition {
	registerRuntimeTools(toolRegistry);

	return {
		registeredTools: toolRegistry.snapshotDefinitions(),
	};
}