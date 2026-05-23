import {
	loadRuntimeStartupConfig,
	type RuntimeStartupConfigResult,
} from "@argentum/environment";

export interface RuntimeBootstrapOptions {
	configOverridePath?: string;
}

export interface RuntimeBootstrapContext {
	startupConfig: RuntimeStartupConfigResult;
}

export interface RuntimeBootstrapDependencies {
	initializeDownstream?: (
		context: RuntimeBootstrapContext,
	) => Promise<void> | void;
}

export async function bootstrapRuntime(
	options: RuntimeBootstrapOptions = {},
	dependencies: RuntimeBootstrapDependencies = {},
): Promise<RuntimeBootstrapContext> {
	const initializeDownstream =
		dependencies.initializeDownstream ?? noopInitializeDownstream;
	const startupConfig = await loadRuntimeStartupConfig(
		toLoadRuntimeStartupConfigOptions(options),
	);
	const context: RuntimeBootstrapContext = { startupConfig };

	await initializeDownstream(context);

	return context;
}

function toLoadRuntimeStartupConfigOptions(
	options: RuntimeBootstrapOptions,
): { overridePath: string } | undefined {
	if (!options.configOverridePath) {
		return undefined;
	}

	return {
		overridePath: options.configOverridePath,
	};
}

async function noopInitializeDownstream(): Promise<void> {}