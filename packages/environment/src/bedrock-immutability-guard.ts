import type { WorkspacePathAuthorizationResult, WorkspacePathDenialCode, WorkspacePathRequest } from "./workspace-path-guard.js";

/**
 * Bedrock immutability guard — root-level pre-filter that runs before
 * {@link authorizeWorkspacePath}.  Returns a denial for any write or delete
 * request targeting a bedrock path, regardless of grant contents.  Passes
 * through (returns `null`) for non-bedrock requests and for bedrock reads so
 * the normal path-authorization pipeline can proceed.
 *
 * ## Frozen MVP rule
 *
 * Bedrock files are read-only during MVP runtime.  The agent may not modify,
 * delete, or replace bedrock files.
 *
 * @returns A denial with code `"bedrock_immutable"` when a bedrock
 *   write/delete is attempted; `null` otherwise (pass-through).
 */
export function bedrockImmutabilityGuard(
	request: WorkspacePathRequest,
): WorkspacePathAuthorizationResult | null {
	if (request.root !== "bedrock") {
		return null;
	}

	if (request.capability === "read") {
		return null;
	}

	return denyBedrockImmutable();
}

function denyBedrockImmutable(): Extract<WorkspacePathAuthorizationResult, { status: "denied" }> {
	const code: WorkspacePathDenialCode = "bedrock_immutable";
	return {
		status: "denied",
		code,
	};
}
