import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolDefinition, ToolResultDTO } from "@argentum/contracts";

afterEach(() => {
	vi.doUnmock("../src/tooling-registration.js");
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("runtime tool-call tooling composition", () => {
	it("returns the registry snapshot without owning per-step tool exposure planning", async () => {
		const selectedTool = makeToolDefinition("tool.selected");
		const decoyTool = makeToolDefinition("tool.decoy");
		const toolingModule = await import("@argentum/tooling");
		const planToolExposureSpy = vi.spyOn(toolingModule, "planToolExposure");

		vi.doMock("../src/tooling-registration.js", () => ({
			registerRuntimeTools: (registry: InstanceType<typeof toolingModule.ToolRegistry>) => {
				registry.register(selectedTool, async () => makeToolResult());
				registry.register(decoyTool, async () => makeToolResult());
			},
		}));

		const { composeRuntimeTooling } = await import("../src/tooling-composition.js");
		const registry = new toolingModule.ToolRegistry();
		const composition = composeRuntimeTooling(registry);

		expect(planToolExposureSpy).not.toHaveBeenCalled();
		expect(composition.registeredTools).toEqual([selectedTool, decoyTool]);
	});
});

function makeToolDefinition(name: string): ToolDefinition {
	return {
		name,
		description: `Description for ${name}`,
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string" },
			},
			required: ["query"],
			additionalProperties: false,
		},
		side_effect_level: "read_only",
		path_scope: "none",
		required_secret_handles: [],
		network_access: "deny",
		default_timeout_ms: 30000,
	};
}

function makeToolResult(): ToolResultDTO {
	return {
		call_id: "tool-call",
		status: "success",
		human_summary: "ok",
		duration_ms: 1,
		truncated: false,
		retryable: false,
	};
}