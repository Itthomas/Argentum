import type {
  ActionDecision,
  ContentRef,
  ContextItem,
  LLMInferenceRequest,
  LLMInferenceResult,
  ToolCallEntry,
  ToolDefinition,
  ToolResultDTO,
  TurnBudget,
  TurnEnvelope,
  TurnState,
} from "@argentum/contracts";
import { LLMProviderError } from "@argentum/llm-provider";
import type { LLMProvider } from "@argentum/llm-provider";
import { describe, expect, it, vi } from "vitest";

import {
  CompactionPolicy,
  ContextSelector,
  CoreLoopOrchestrator,
  EpisodicMemory,
  PromptCompiler,
  PromptCompilerError,
} from "../src/index.js";
import type {
  CoreLoopOrchestratorDependencies,
  TurnContentStore,
  ToolCallExecutor,
  ValidationOutcome,
} from "../src/index.js";

// ── Factory helpers ──────────────────────────────────────────────

function makeTurnBudget(
  overrides: Partial<TurnBudget> = {},
): TurnBudget {
  return {
    max_inference_steps: 12,
    max_repair_attempts: 3,
    max_wall_clock_ms: 600_000,
    repair_attempts_used: 0,
    ...overrides,
  };
}

function makeTurnEnvelope(
  overrides: Partial<TurnEnvelope> = {},
): TurnEnvelope {
  return {
    turn_id: "turn-001",
    session_id: "session-001",
    ingress_id: "ingress-001",
    state: "accepted" as TurnState,
    step_count: 0,
    budget: makeTurnBudget(),
    context_refs: [],
    compaction_revision: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRespondDecision(
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-001",
    kind: "respond",
    message: "Hello, how can I help?",
    ...overrides,
  };
}

function makeToolCallsDecision(
  toolCalls: ToolCallEntry[],
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-002",
    kind: "tool_calls",
    tool_calls: toolCalls,
    ...overrides,
  };
}

function makeClarifyDecision(
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-003",
    kind: "clarify",
    message: "Which file do you want to read?",
    ...overrides,
  };
}

function makeAbortDecision(
  overrides: Partial<ActionDecision> = {},
): ActionDecision {
  return {
    decision_id: "dec-004",
    kind: "abort",
    message: "Cannot proceed due to policy restriction.",
    ...overrides,
  };
}

function makeToolCallEntry(
  overrides: Partial<ToolCallEntry> = {},
): ToolCallEntry {
  return {
    tool_name: "read_file",
    arguments: { path: "/tmp/test.txt" },
    ...overrides,
  };
}

function makeToolResult(
  overrides: Partial<ToolResultDTO> = {},
): ToolResultDTO {
  return {
    call_id: "call-001",
    status: "success",
    human_summary: "File contents: Hello World",
    duration_ms: 42,
    truncated: false,
    retryable: false,
    ...overrides,
  };
}

function makeLLMInferenceResult(
  decision: ActionDecision,
  overrides: Partial<LLMInferenceResult> = {},
): LLMInferenceResult {
  return {
    request_id: "req-001",
    decision,
    normalization_status: "native_tool",
    ...overrides,
  };
}

const TEST_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a file from the workspace",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
    side_effect_level: "read_only",
    path_scope: "working",
    required_secret_handles: [],
    network_access: "deny",
    default_timeout_ms: 10_000,
  },
];

// ── Mock helpers ─────────────────────────────────────────────────

interface InMemoryTurnContentStore extends TurnContentStore {
  readonly artifactWrites: Array<{ callId: string; content: string }>;
  readonly workingWrites: Array<{ ref: ContentRef; content: string }>;
  readonly contents: Map<string, string>;
}

function makeContentStore(): InMemoryTurnContentStore {
  const artifactWrites: Array<{ callId: string; content: string }> = [];
  const workingWrites: Array<{ ref: ContentRef; content: string }> = [];
  const contents = new Map<string, string>();

  return {
    artifactWrites,
    workingWrites,
    contents,
    async store(callId: string, content: string): Promise<ContentRef> {
      artifactWrites.push({ callId, content });
      const ref: ContentRef = {
        ref_id: `artifact:${callId}`,
        kind: "text",
        storage_area: "artifacts",
        locator: `${callId}.txt`,
        retention: "session",
      };
      contents.set(`${ref.storage_area}:${ref.locator}`, content);
      return ref;
    },
    async write(ref: ContentRef, content: string): Promise<void> {
      workingWrites.push({ ref, content });
      contents.set(`${ref.storage_area}:${ref.locator}`, content);
    },
  };
}

function readStoredContent(
  store: InMemoryTurnContentStore,
  ref: ContentRef,
): string | undefined {
  return store.contents.get(`${ref.storage_area}:${ref.locator}`);
}

function readAbortContext(
  store: InMemoryTurnContentStore,
  ref: ContentRef,
): { reason: string; last_known_state: TurnState } {
  const content = readStoredContent(store, ref);

  if (content === undefined) {
    throw new Error(`Missing stored content for ${ref.storage_area}:${ref.locator}`);
  }

  return JSON.parse(content) as {
    reason: string;
    last_known_state: TurnState;
  };
}

function makeStorageLocatorResolver(
  store: InMemoryTurnContentStore,
): (ref: ContentRef) => Promise<string> {
  return async (ref: ContentRef): Promise<string> => {
    const content = store.contents.get(`${ref.storage_area}:${ref.locator}`);
    if (content === undefined) {
      throw new Error(`No content for ${ref.storage_area}:${ref.locator}`);
    }
    return content;
  };
}

interface OrchestratorMocks {
  memory: EpisodicMemory;
  promptCompiler: PromptCompiler;
  contextSelector: ContextSelector;
  compactionPolicy: CompactionPolicy;
  llmProvider: LLMProvider;
  toolExecutor: ToolCallExecutor;
  contentStore: InMemoryTurnContentStore;
  eventEmitter: { emit: ReturnType<typeof vi.fn> };
}

function setupMocks(
  overrides: Partial<OrchestratorMocks> = {},
): OrchestratorMocks {
  return {
    memory: new EpisodicMemory("session-test"),
    promptCompiler: new PromptCompiler({
      defaultToolExposurePolicy: { mode: "all" },
    }),
    contextSelector: new ContextSelector(),
    compactionPolicy: new CompactionPolicy(),
    llmProvider: {
      infer: vi.fn(),
    },
    toolExecutor: {
      execute: vi.fn(),
    },
    contentStore: makeContentStore(),
    eventEmitter: {
      emit: vi.fn(),
    },
    ...overrides,
  };
}

function createOrchestrator(
  mocks: OrchestratorMocks,
  overrides: Partial<CoreLoopOrchestratorDependencies> = {},
): CoreLoopOrchestrator {
  return new CoreLoopOrchestrator({
    memory: mocks.memory,
    promptCompiler: mocks.promptCompiler,
    contextSelector: mocks.contextSelector,
    compactionPolicy: mocks.compactionPolicy,
    llmProvider: mocks.llmProvider,
    toolExecutor: mocks.toolExecutor,
    contentStore: mocks.contentStore,
    eventEmitter: mocks.eventEmitter,
    registeredTools: TEST_TOOLS,
    ...overrides,
  });
}

function getEventNames(mocks: OrchestratorMocks): string[] {
  return vi.mocked(mocks.eventEmitter.emit).mock.calls.map((call) => call[0]);
}

// ── Seed memory with an ingress item (required for prompt compilation) ──

function seedIngressItem(memory: EpisodicMemory, turnId: string): void {
  const item: ContextItem = {
    context_id: `ingress:${turnId}`,
    layer: "episodic",
    role: "user",
    content_ref: {
      ref_id: `ingress-ref:${turnId}`,
      kind: "text",
      storage_area: "working",
      locator: turnId,
      retention: "session",
    },
    origin: "ingress",
    retention: "ephemeral",
    token_estimate: 10,
  };
  memory.add(item);
}

// ═══════════════════════════════════════════════════════════════════
// Happy path: respond decision completes turn
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — happy path: respond", () => {
  it("completes a turn with a respond decision", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(result.step_count).toBe(1); // finalizing→completed increments
    expect(mocks.llmProvider.infer).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the input envelope", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    const frozen = { ...envelope, budget: { ...envelope.budget } };
    await orchestrator.executeTurn(envelope);

    // Input envelope must be unchanged.
    expect(envelope.state).toBe("accepted");
    expect(envelope.step_count).toBe(frozen.step_count);
    expect(envelope.budget.repair_attempts_used).toBe(
      frozen.budget.repair_attempts_used,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Happy path: tool_calls → compaction → respond completes turn
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — happy path: tool_calls → respond", () => {
  it("loops through tool_calls then respond to complete", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    // First inference: tool_calls
    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(
        makeToolCallsDecision([makeToolCallEntry({ tool_name: "read_file" })]),
      ),
    );
    // Second inference: respond
    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision({ message: "Done" })),
    );

    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult({ call_id: "call-001", human_summary: "file content" }),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    // Two complete decision cycles: tool_calls (compacting→building_context)
    // then respond (finalizing→completed), so step_count = 2
    expect(result.step_count).toBe(2);
    expect(mocks.llmProvider.infer).toHaveBeenCalledTimes(2);
    expect(mocks.toolExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it("externalizes truncated tool output and persists the compacted summary", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(
        makeLLMInferenceResult(
          makeToolCallsDecision([makeToolCallEntry({ tool_name: "read_file" })]),
        ),
      )
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision({ message: "Done" })),
      );

    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult({
        call_id: "call-truncated",
        human_summary: "Concise summary for the next step",
        truncated: true,
      }),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(mocks.contentStore.artifactWrites).toEqual([
      {
        callId: "call-truncated",
        content: "Concise summary for the next step",
      },
    ]);

    const toolSummary = mocks.memory
      .getRecent()
      .find((item) => item.context_id === "compaction:call-truncated");
    expect(toolSummary).toBeDefined();
    expect(
      readStoredContent(mocks.contentStore, toolSummary!.content_ref),
    ).toBe("Concise summary for the next step");
  });

  it("round-trips a persisted tool-summary ContentRef through storage_area and locator", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    const resolveContent = makeStorageLocatorResolver(mocks.contentStore);
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult({
        call_id: "call-roundtrip",
        human_summary: "Round-trip summary for resolver proof",
      }),
    );

    vi.mocked(mocks.llmProvider.infer).mockImplementationOnce(async () => {
      return makeLLMInferenceResult(
        makeToolCallsDecision([makeToolCallEntry({ tool_name: "read_file" })]),
      );
    });
    vi.mocked(mocks.llmProvider.infer).mockImplementationOnce(async (request) => {
      const persistedSummary = request.context_items.find(
        (item) => item.context_id === "compaction:call-roundtrip",
      );

      expect(persistedSummary).toBeDefined();
      await expect(resolveContent(persistedSummary!.content_ref)).resolves.toBe(
        "Round-trip summary for resolver proof",
      );

      return makeLLMInferenceResult(
        makeRespondDecision({ message: "Resolver proof complete" }),
      );
    });

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(mocks.llmProvider.infer).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Multi-tool sequential execution
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — multi-tool sequential execution", () => {
  it("executes three tool calls in order", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(
        makeToolCallsDecision([
          makeToolCallEntry({ tool_name: "tool_a" }),
          makeToolCallEntry({ tool_name: "tool_b" }),
          makeToolCallEntry({ tool_name: "tool_c" }),
        ]),
      ),
    );
    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    vi.mocked(mocks.toolExecutor.execute)
      .mockResolvedValueOnce(makeToolResult({ call_id: "call-a" }))
      .mockResolvedValueOnce(makeToolResult({ call_id: "call-b" }))
      .mockResolvedValueOnce(makeToolResult({ call_id: "call-c" }));

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(mocks.toolExecutor.execute).toHaveBeenCalledTimes(3);

    // Verify call order
    const calls = vi.mocked(mocks.toolExecutor.execute).mock.calls;
    expect(calls[0]![0].tool_name).toBe("tool_a");
    expect(calls[1]![0].tool_name).toBe("tool_b");
    expect(calls[2]![0].tool_name).toBe("tool_c");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Clarify follows same terminal path as respond
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — clarify terminal path", () => {
  it("clarify transitions through responding → finalizing → completed", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeClarifyDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(result.step_count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Abort decision terminates turn
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — abort decision", () => {
  it("abort decision transitions validating → aborted", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeAbortDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("aborted");
    // validating→aborted increments step_count per STEP_INCREMENT_TRANSITIONS
    expect(result.step_count).toBe(1);

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
    expect(readAbortContext(mocks.contentStore, abortItems[0]!.content_ref)).toEqual({
      reason: "Cannot proceed due to policy restriction.",
      last_known_state: "validating",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Governor step limit boundary
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — governor step limit boundary", () => {
  it("allows a terminal respond path to complete on the final permitted step", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({
      step_count: 11,
      budget: makeTurnBudget({
        max_inference_steps: 12,
        repair_attempts_used: 0,
      }),
    });
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(result.step_count).toBe(12);
  });

  it("aborts before inference when a tool-call loop reaches the step limit", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({
      step_count: 11,
      budget: makeTurnBudget({
        max_inference_steps: 12,
        repair_attempts_used: 0,
      }),
    });
    seedIngressItem(mocks.memory, envelope.turn_id);

    // First inference: tool_calls → step_count becomes 12 after compacting→building_context
    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(
        makeToolCallsDecision([makeToolCallEntry()]),
      ),
    );
    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult(),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    // After first cycle: step_count=12, then governor check → abort
    expect(result.state).toBe("aborted");
    // The abort from building_context→aborted does NOT increment step_count
    // (not in STEP_INCREMENT_TRANSITIONS), so step_count stays at 12
    // (incremented only once by compacting→building_context)
    expect(result.step_count).toBe(12);
    // Inference was called exactly once (governor aborted before second call)
    expect(mocks.llmProvider.infer).toHaveBeenCalledTimes(1);

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
    expect(readAbortContext(mocks.contentStore, abortItems[0]!.content_ref)).toEqual({
      reason: "step_limit_exceeded",
      last_known_state: "building_context",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Governor wall clock abort
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — governor wall clock abort", () => {
  it("aborts when wall clock budget is exceeded", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    // Set startedAt far in the past so elapsed time exceeds budget.
    const startedAt = 0;
    // Budget is 600_000 ms (10 min), Date.now() is well past that.

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope, startedAt);

    expect(result.state).toBe("aborted");
    // Governor check happens before any inference, so infer is never called.
    expect(mocks.llmProvider.infer).not.toHaveBeenCalled();

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
    expect(readAbortContext(mocks.contentStore, abortItems[0]!.content_ref)).toEqual({
      reason: "wall_clock_exceeded",
      last_known_state: "building_context",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Repair → re-enter building_context → successful re-inference
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — repair and re-inference", () => {
  it("repairs then succeeds on re-inference", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    // First inference returns an INVALID decision (missing required fields).
    // The real validateAndRepair will catch it via parseActionDecision.
    const invalidDecision: ActionDecision = {
      decision_id: "",
      kind: "respond",
      // missing message for respond kind
    };

    const validDecision = makeRespondDecision({ message: "Fixed response" });

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(makeLLMInferenceResult(invalidDecision))
      .mockResolvedValueOnce(makeLLMInferenceResult(validDecision));

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(mocks.llmProvider.infer).toHaveBeenCalledTimes(2);
    // repair_attempts_used should have been incremented
    expect(result.budget.repair_attempts_used).toBe(1);
    // step_count: first inference failed (no step increment for repair loop),
    // second inference succeeded → finalizing→completed = 1
    expect(result.step_count).toBe(1);
  });

  it("persists repair feedback content so re-inference can resolve it", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    const resolveContent = makeStorageLocatorResolver(mocks.contentStore);
    seedIngressItem(mocks.memory, envelope.turn_id);

    const invalidDecision = {
      decision_id: "dec-repair-persisted",
      kind: "respond",
    } as unknown as ActionDecision;

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(makeLLMInferenceResult(invalidDecision))
      .mockImplementationOnce(async (request) => {
        const repairFeedback = request.context_items.find(
          (item) => item.context_id === "repair:dec-repair-persisted",
        );

        expect(repairFeedback).toBeDefined();
        await expect(resolveContent(repairFeedback!.content_ref)).resolves.toContain(
          "Validation failed for decision dec-repair-persisted:",
        );

        return makeLLMInferenceResult(
          makeRespondDecision({ message: "Repair feedback resolved" }),
        );
      });

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(result.budget.repair_attempts_used).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LLMProviderError caught and aborts turn
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — LLMProviderError aborts turn", () => {
  it("catches LLMProviderError and transitions to aborted", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockRejectedValueOnce(
      new LLMProviderError("test-provider", "req-001", "Network error"),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("aborted");
    // inferring→aborted does NOT increment step_count
    expect(result.step_count).toBe(0);

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
    expect(readAbortContext(mocks.contentStore, abortItems[0]!.content_ref)).toEqual({
      reason: "provider_failure: Network error",
      last_known_state: "inferring",
    });

    const eventNames = getEventNames(mocks);
    expect(eventNames.indexOf("llm.failed")).toBeGreaterThan(-1);
    expect(eventNames.indexOf("turn.aborted")).toBeGreaterThan(-1);
    expect(eventNames.indexOf("llm.failed")).toBeLessThan(
      eventNames.indexOf("turn.aborted"),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Unexpected error propagates
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — unexpected error propagates", () => {
  it("does not catch non-LLMProviderError errors", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockRejectedValueOnce(
      new Error("Unexpected crash"),
    );

    const orchestrator = createOrchestrator(mocks);
    await expect(orchestrator.executeTurn(envelope)).rejects.toThrow(
      "Unexpected crash",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Event emission at every transition
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — event emission", () => {
  it("emits turn, llm, validation, and response events in respond path order", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope);

    const emitCalls = vi.mocked(mocks.eventEmitter.emit).mock.calls;
    const eventNames = emitCalls.map((call) => call[0]);

    expect(eventNames).toEqual([
      "turn.building_context",
      "turn.inferring",
      "llm.started",
      "llm.finished",
      "turn.validating",
      "validation.started",
      "validation.passed",
      "turn.responding",
      "response.emitted",
      "turn.finalizing",
      "response.completed",
      "turn.completed",
    ]);
  });

  it("emits llm, validation, tool, memory, and response events for a tool_calls cycle", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(
        makeLLMInferenceResult(
          makeToolCallsDecision([makeToolCallEntry()]),
        ),
      )
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision()),
      );

    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult(),
    );

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope);

    const emitCalls = vi.mocked(mocks.eventEmitter.emit).mock.calls;
    const eventNames = emitCalls.map((call) => call[0]);

    expect(eventNames).toEqual([
      "turn.building_context",
      "turn.inferring",
      "llm.started",
      "llm.finished",
      "turn.validating",
      "validation.started",
      "validation.passed",
      "turn.executing_tools",
      "tool.planned",
      "tool.started",
      "tool.finished",
      "memory.compaction_started",
      "memory.compaction_committed",
      "turn.compacting",
      "turn.building_context",
      "turn.inferring",
      "llm.started",
      "llm.finished",
      "turn.validating",
      "validation.started",
      "validation.passed",
      "turn.responding",
      "response.emitted",
      "turn.finalizing",
      "response.completed",
      "turn.completed",
    ]);
  });

  it("emits validation events alongside turn events for abort path", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeAbortDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope);

    const emitCalls = vi.mocked(mocks.eventEmitter.emit).mock.calls;
    const eventNames = emitCalls.map((call) => call[0]);

    expect(eventNames).toEqual([
      "turn.building_context",
      "turn.inferring",
      "llm.started",
      "llm.finished",
      "turn.validating",
      "validation.started",
      "validation.passed",
      "turn.aborted",
    ]);
  });

  it("emits validation.repair_requested before validating re-enters building_context", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    const invalidDecision: ActionDecision = {
      decision_id: "",
      kind: "respond",
    };

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(makeLLMInferenceResult(invalidDecision))
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision({ message: "Fixed response" })),
      );

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope);

    const eventNames = getEventNames(mocks);
    const repairRequestedIndex = eventNames.indexOf("validation.repair_requested");
    const validatingIndex = eventNames.indexOf("turn.validating");
    const reentryIndex = eventNames.indexOf("turn.building_context", validatingIndex + 1);

    expect(repairRequestedIndex).toBeGreaterThan(validatingIndex);
    expect(reentryIndex).toBeGreaterThan(repairRequestedIndex);
  });

  it("emits validation.aborted before turn.aborted on repair exhaustion", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({
        repair_attempts_used: 3,
        max_repair_attempts: 3,
      }),
    });
    seedIngressItem(mocks.memory, envelope.turn_id);

    const invalidDecision: ActionDecision = {
      decision_id: "",
      kind: "respond",
    };

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(invalidDecision),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("aborted");

    const eventNames = getEventNames(mocks);
    expect(eventNames.indexOf("validation.aborted")).toBeGreaterThan(-1);
    expect(eventNames.indexOf("turn.aborted")).toBeGreaterThan(-1);
    expect(eventNames.indexOf("validation.aborted")).toBeLessThan(
      eventNames.indexOf("turn.aborted"),
    );
  });

  it("emits tool.blocked when a tool result is blocked", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeToolCallsDecision([makeToolCallEntry()])),
      )
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision({ message: "done" })),
      );
    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult({
        call_id: "call-blocked",
        status: "blocked",
        human_summary: "Blocked by policy",
      }),
    );

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope);

    const eventNames = vi
      .mocked(mocks.eventEmitter.emit)
      .mock.calls.map((call) => call[0]);

    expect(eventNames).toContain("tool.blocked");
  });
});

// ═══════════════════════════════════════════════════════════════════
// No event emitter — proceeds silently
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — no event emitter", () => {
  it("completes without event emitter", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks, {
      eventEmitter: undefined,
    });
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    // No emitter calls should have been attempted (but since we provided
    // a mock emitter in setupMocks, this test uses undefined instead).
  });
});

// ═══════════════════════════════════════════════════════════════════
// Transition metadata carries decisionKind
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — transition metadata", () => {
  it("responding transition includes decisionKind metadata", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope);

    // Find the responding event
    const respondingCall = vi
      .mocked(mocks.eventEmitter.emit)
      .mock.calls.find((call) => call[0] === "turn.responding");

    expect(respondingCall).toBeDefined();
    expect(respondingCall![2]).toEqual({ decisionKind: "respond" });
  });

  it("governor abort metadata includes reason", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    // Force wall clock abort
    const startedAt = 0;

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope, startedAt);

    const abortCall = vi
      .mocked(mocks.eventEmitter.emit)
      .mock.calls.find((call) => call[0] === "turn.aborted");

    expect(abortCall).toBeDefined();
    expect(abortCall![2]).toEqual(
      expect.objectContaining({ reason: "wall_clock_exceeded" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Safety counter prevents infinite loop
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — safety counter", () => {
  it("throws when loop exceeds hard safety limit", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({
        max_inference_steps: 999_999, // effectively unlimited
        max_repair_attempts: 999_999, // effectively unlimited
      }),
    });
    seedIngressItem(mocks.memory, envelope.turn_id);

    // Return a decision that always fails validation (missing decision_id).
    // This causes repair every iteration, step_count never increments,
    // and with effectively unlimited repair attempts, the loop continues
    // until the hard safety limit fires.
    const invalidDecision: ActionDecision = {
      decision_id: "",
      kind: "respond",
    };

    vi.mocked(mocks.llmProvider.infer).mockResolvedValue(
      makeLLMInferenceResult(invalidDecision),
    );

    const orchestrator = createOrchestrator(mocks);
    await expect(orchestrator.executeTurn(envelope)).rejects.toThrow(
      /safety limit exceeded/,
    );
    // Should have called infer many times (up to safety limit)
    expect(mocks.llmProvider.infer).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Empty tool_calls array
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — empty tool_calls", () => {
  it("transitions through executing_tools → compacting → building_context", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeToolCallsDecision([])),
      )
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision()),
      );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    // toolExecutor should NOT have been called (empty tool_calls)
    expect(mocks.toolExecutor.execute).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Compaction revision is updated
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — compaction revision update", () => {
  it("updates compaction_revision after tool execution cycle with inline success result", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({ compaction_revision: 1 });
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(
        makeLLMInferenceResult(
          makeToolCallsDecision([makeToolCallEntry()]),
        ),
      )
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision()),
      );

    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult({
        call_id: "call-inline-success",
        human_summary: "Short result that stays inline",
      }),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    expect(result.compaction_revision).toBe(2);
  });

  it("updates compaction_revision after tool execution cycle with error result", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({ compaction_revision: 1 });
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(
        makeLLMInferenceResult(
          makeToolCallsDecision([makeToolCallEntry()]),
        ),
      )
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision()),
      );

    // Return an error result — error compaction increments revision
    // without needing an ArtifactExternalizer.
    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult({
        call_id: "call-001",
        status: "error",
        human_summary: "File not found",
        error_code: "ENOENT",
      }),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    // compaction_revision should be incremented from 1 to 2 (error summary path)
    expect(result.compaction_revision).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Step count increment on terminal transitions
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — step count increments", () => {
  it("increments step_count for finalizing→completed", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({ step_count: 0 });
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.step_count).toBe(1);
  });

  it("increments step_count for compacting→building_context", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({ step_count: 0 });
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer)
      .mockResolvedValueOnce(
        makeLLMInferenceResult(
          makeToolCallsDecision([makeToolCallEntry()]),
        ),
      )
      .mockResolvedValueOnce(
        makeLLMInferenceResult(makeRespondDecision()),
      );

    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult(),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    // tool_calls cycle: +1 for compacting→building_context
    // respond cycle: +1 for finalizing→completed = 2 total
    expect(result.step_count).toBe(2);
  });

  it("does NOT increment step_count on system abort (building_context→aborted)", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({ step_count: 5 });
    seedIngressItem(mocks.memory, envelope.turn_id);

    // Force wall clock abort before any inference
    const startedAt = 0;

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope, startedAt);

    expect(result.state).toBe("aborted");
    // building_context→aborted is NOT in STEP_INCREMENT_TRANSITIONS
    expect(result.step_count).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Response message stored in memory
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — response message in memory", () => {
  it("stores response message as a ContextItem in memory", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(
        makeRespondDecision({ message: "Hello from the agent!" }),
      ),
    );

    const orchestrator = createOrchestrator(mocks);
    await orchestrator.executeTurn(envelope);

    // Check that memory contains the response message
    const allItems = mocks.memory.getRecent();
    const responseItems = allItems.filter(
      (item) => item.origin === "assistant",
    );
    expect(responseItems.length).toBeGreaterThanOrEqual(1);
    expect(responseItems[0]!.layer).toBe("episodic");
    expect(responseItems[0]!.role).toBe("assistant");
    expect(
      readStoredContent(mocks.contentStore, responseItems[0]!.content_ref),
    ).toBe("Hello from the agent!");
  });
});

// ═══════════════════════════════════════════════════════════════════
// PromptCompilerError caught and aborts turn
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — PromptCompilerError aborts turn", () => {
  it("catches PromptCompilerError and transitions to aborted", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    // Deliberately do NOT seed memory — empty context will trigger
    // PromptCompilerError (EMPTY_CONTEXT_ITEMS)

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("aborted");
    expect(mocks.llmProvider.infer).not.toHaveBeenCalled();

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Governor repair limit abort via validateAndRepair
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — repair exhaustion abort", () => {
  it("aborts when repairs are exhausted", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope({
      budget: makeTurnBudget({
        max_repair_attempts: 0, // no repairs allowed
        repair_attempts_used: 0,
      }),
    });
    seedIngressItem(mocks.memory, envelope.turn_id);

    // Return an invalid decision that will fail validation
    const invalidDecision: ActionDecision = {
      decision_id: "",
      kind: "respond",
    };

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(invalidDecision),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("aborted");

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tool executor throws — caught and turn aborted
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — tool executor throws", () => {
  it("catches tool executor error and aborts turn", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(
        makeToolCallsDecision([makeToolCallEntry({ tool_name: "crash_tool" })]),
      ),
    );

    vi.mocked(mocks.toolExecutor.execute).mockRejectedValueOnce(
      new Error("Tool execution crashed"),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("aborted");
    expect(mocks.toolExecutor.execute).toHaveBeenCalledTimes(1);
    // No further inference after abort
    expect(mocks.llmProvider.infer).toHaveBeenCalledTimes(1);

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
    expect(abortItems[0]!.context_id).toMatch(/^abort:/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Compaction throws — caught and turn aborted
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — compaction throws", () => {
  it("catches compaction error and aborts turn", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(
        makeToolCallsDecision([makeToolCallEntry({ tool_name: "read_file" })]),
      ),
    );

    vi.mocked(mocks.toolExecutor.execute).mockResolvedValueOnce(
      makeToolResult({ call_id: "call-001" }),
    );

    // Mock compaction to throw
    vi.spyOn(mocks.compactionPolicy, "compact").mockRejectedValueOnce(
      new Error("Compaction engine failure"),
    );

    const orchestrator = createOrchestrator(mocks);
    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("aborted");
    expect(mocks.llmProvider.infer).toHaveBeenCalledTimes(1);

    // Verify abort context stored in memory
    const abortItems = mocks.memory
      .getRecent()
      .filter(
        (item) =>
          item.origin === "system" && /^abort:/.test(item.context_id),
      );
    expect(abortItems.length).toBeGreaterThanOrEqual(1);
    expect(abortItems[0]!.layer).toBe("episodic");
    expect(abortItems[0]!.role).toBe("system");
    expect(abortItems[0]!.context_id).toMatch(/^abort:/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Full turn integration test (real components, mock LLM + tools)
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — full turn integration", () => {
  it("completes a 3-step turn: tool_calls → tool_calls → respond", async () => {
    const memory = new EpisodicMemory("session-integration");
    const promptCompiler = new PromptCompiler({
      defaultToolExposurePolicy: { mode: "all" },
    });
    const contextSelector = new ContextSelector();
    const compactionPolicy = new CompactionPolicy();
    const contentStore = makeContentStore();

    seedIngressItem(memory, "turn-integration");

    const llmProvider: LLMProvider = {
      infer: vi
        .fn()
        .mockResolvedValueOnce(
          makeLLMInferenceResult(
            makeToolCallsDecision([makeToolCallEntry({ tool_name: "tool_a" })]),
            { request_id: "req-1" },
          ),
        )
        .mockResolvedValueOnce(
          makeLLMInferenceResult(
            makeToolCallsDecision([makeToolCallEntry({ tool_name: "tool_b" })]),
            { request_id: "req-2" },
          ),
        )
        .mockResolvedValueOnce(
          makeLLMInferenceResult(makeRespondDecision({ message: "All done!" }), {
            request_id: "req-3",
          }),
        ),
    };

    const toolExecutor: ToolCallExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(
          makeToolResult({ call_id: "call-a", human_summary: "Result A" }),
        )
        .mockResolvedValueOnce(
          makeToolResult({ call_id: "call-b", human_summary: "Result B" }),
        ),
    };

    const orchestrator = new CoreLoopOrchestrator({
      memory,
      promptCompiler,
      contextSelector,
      compactionPolicy,
      llmProvider,
      toolExecutor,
      contentStore,
      registeredTools: TEST_TOOLS,
    });

    const envelope = makeTurnEnvelope({
      turn_id: "turn-integration",
      step_count: 0,
      compaction_revision: 0,
    });

    const result = await orchestrator.executeTurn(envelope);

    expect(result.state).toBe("completed");
    // 3 decision cycles: tool_calls (+1), tool_calls (+1), respond (+1) = 3
    expect(result.step_count).toBe(3);
    expect(llmProvider.infer).toHaveBeenCalledTimes(3);
    expect(toolExecutor.execute).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// startedAt defaults to Date.now()
// ═══════════════════════════════════════════════════════════════════

describe("CoreLoopOrchestrator — startedAt default", () => {
  it("uses Date.now() when startedAt is not provided", async () => {
    const mocks = setupMocks();
    const envelope = makeTurnEnvelope();
    seedIngressItem(mocks.memory, envelope.turn_id);

    vi.mocked(mocks.llmProvider.infer).mockResolvedValueOnce(
      makeLLMInferenceResult(makeRespondDecision()),
    );

    const orchestrator = createOrchestrator(mocks);

    // Should not throw — startedAt defaults to Date.now()
    const result = await orchestrator.executeTurn(envelope);
    expect(result.state).toBe("completed");
  });
});
