import type {
	LLMInferenceRequest,
	LLMInferenceResult,
} from "@argentum/contracts";
import type { LLMProvider } from "@argentum/llm-provider";

/**
 * Stateless mock implementation of {@link LLMProvider}.
 *
 * Returns a fully-formed {@link LLMInferenceResult} with a canned
 * `respond` decision and `parsed_text` normalization status.
 *
 * Does NOT make network calls, require API keys, or depend on
 * provider SDKs.  Suitable for end-to-end tests and composition-root
 * wiring before a real provider adapter is available.
 *
 * The `request_id` field is echoed from the incoming request for
 * traceability.
 */
export class MockLLMProvider implements LLMProvider {
	async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
		return {
			request_id: request.request_id,
			decision: {
				decision_id: "mock-decision-001",
				kind: "respond",
				message: "Hello! I'm Argentum, your AI assistant.",
			},
			normalization_status: "parsed_text",
		};
	}
}
