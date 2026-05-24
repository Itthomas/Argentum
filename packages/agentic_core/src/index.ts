export { EpisodicMemory } from "./episodic-memory.js";
export {
  ALLOWED_TRANSITIONS,
  STEP_INCREMENT_TRANSITIONS,
  TransitionError,
  executeTransition,
  isTerminal,
  isValidTransition,
} from "./turn-state-machine.js";
export type {
  TransitionMetadata,
  TurnEventEmitter,
} from "./turn-state-machine.js";

export {
  CompactionPolicy,
  DEFAULT_COMPACTION_THRESHOLD_BYTES,
} from "./compaction-policy.js";
export type {
  ArtifactExternalizer,
  CompactionDisposition,
  CompactionOptions,
  CompactionResult,
} from "./compaction-policy.js";

export { ContextSelector } from "./context-selector.js";
export type {
  OmissionReason,
  OmissionRecord,
  SelectionOptions,
  SelectionResult,
} from "./context-selector.js";

export { PromptCompiler, PromptCompilerError } from "./prompt-compiler.js";
export type {
  InferencePolicy,
  PromptCompilerErrorCode,
  PromptCompilerInput,
} from "./prompt-compiler.js";

export { evaluateGovernor } from "./turn-governor.js";
export type {
  GovernorAbortReason,
  GovernorDecision,
} from "./turn-governor.js";