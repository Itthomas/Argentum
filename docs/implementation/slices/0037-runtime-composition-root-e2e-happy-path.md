# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: human decision (CRITICAL C1/C2 resolution)
- Approval date: 2026-05-24
- Phase: 6/7 (Composition & End-to-End)
- Owner: apps/runtime
- **CRITICAL C-0037-1 resolved 2026-05-24 by human decision (Option A)**: Create a `Gateway` facade class in `@argentum/gateway` that wraps the existing standalone functions. The facade orchestrates: `resolveSession()` → `admitIngress()` → `claimActiveTurn()` → `createGatewayTurnStartHandoffFromAcceptedAdmission()` → `createTurnFromHandoff()` → (orchestrator runs) → `releaseActiveTurnAndDequeue()`. The composition root instantiates `new Gateway(config)` instead of calling 5+ standalone functions directly.
- **CRITICAL C-0037-2 resolved 2026-05-24 by human decision (Option A)**: `startRuntime` returns `RuntimeContext` instead of `void`. The `RuntimeContext` interface exposes `orchestrator`, `gateway`, and a `shutdown` function. Signature: `async function startRuntime(configPath?: string): Promise<RuntimeContext>`.
- Execution readiness: implemented-and-validated. Upstream slices 0031 and 0033 through 0036 are validated, and this slice now composes the supported `runCliTurn()` happy-path runtime seam with session-scoped memory/orchestrator ownership, CLI normalization and rendering, telemetry persistence and flush-on-shutdown, and resolver-backed `ContentRef` rehydration proofs.

## Scope

- Slice name: Composition Root & End-to-End Happy Path
- Target package or boundary: `apps/runtime` (`@argentum/runtime`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority; frozen decisions include session lifecycle, one active turn per session, FIFO queued ingress
  - [docs/spec/10-architecture/runtime-lifecycle.md](../../spec/10-architecture/runtime-lifecycle.md) — session lifecycle (channel → gateway → turn → lock release → dequeue), turn lifecycle (accept → build context → infer → validate → execute → compact → respond/loop → finalize), lifecycle guarantees
  - [docs/spec/10-architecture/system-context.md](../../spec/10-architecture/system-context.md) — top-level data flow: channel → gateway → agentic core → LLM adapter → tool layer → agentic core → gateway/channel output, module boundaries and ownership
  - [docs/spec/10-architecture/state-ownership.md](../../spec/10-architecture/state-ownership.md) — ownership: gateway owns session lock/queue/turn creation, agentic core owns episodic memory/turn state, environment owns workspace/bedrock/secrets
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — all canonical contracts used at boundaries
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md) — package dependency rules
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires "end-to-end happy-path CLI tests for one full turn"
  - [docs/spec/50-implementation/persistence-plan.md](../../spec/50-implementation/persistence-plan.md) — runtime workspace layout (`runtime/artifacts/`, `runtime/bedrock/`, `runtime/logs/`, `runtime/working/`)
- Acceptance criteria:
  - **`startRuntime(configPath?: string): Promise<RuntimeContext>` function exported** from `@argentum/runtime`. This is the top-level entrypoint that loads configuration, constructs the full dependency graph, starts the runtime, and returns a `RuntimeContext` exposing the supported `runCliTurn()` happy-path seam plus lower-level `orchestrator`, `gateway`, and a shutdown hook.
  - **`RuntimeContext` interface exported** from `@argentum/runtime`:
    ```ts
    interface RuntimeContext {
      runCliTurn: (
        rawInput: string,
        options?: RuntimeCliTurnOptions,
      ) => Promise<RuntimeCliTurnResult>;
      orchestrator: CoreLoopOrchestrator;
      gateway: Gateway;
      shutdown: () => Promise<void>;
    }
    ```
    - `runCliTurn` — the supported public happy-path runtime seam for one CLI turn. It owns CLI normalization, accepted-ingress priming into session memory, orchestrator execution, event rendering, and telemetry persistence.
    - `orchestrator` — the composed session-aware `CoreLoopOrchestrator` facade, available for advanced callers that already have a turn envelope. It is not, by itself, the complete supported CLI happy-path boundary because accepted-ingress priming lives in `runCliTurn()`.
    - `gateway` — the `Gateway` facade instance, available for session lifecycle operations and advanced runtime control. It is not, by itself, the complete supported CLI happy-path boundary because it does not own runtime memory priming, rendering, or telemetry.
    - `shutdown` — async function that gracefully tears down the runtime (releases locks, closes DB connections, flushes telemetry)
  - **Dependency graph construction**: The function constructs every module instance with explicit constructor injection. No service locator, no global registry, no static mutable state. Construction order respects the dependency direction: contracts → environment → gateway → agentic_core/llm_provider/tooling → channel_cli → composition.
  - **Constructor wiring**:
    - **Environment**: loaded via existing `loadRuntimeStartupConfig()` from `@argentum/environment` (slice 0002). The `RuntimeStartupConfigResult` provides workspace paths (`bedrock/`, `working/`, `artifacts/`, `logs/`), governor defaults, tool policy, and telemetry config.
    - **Gateway**: instantiated via the `Gateway` facade class from `@argentum/gateway` (new class created as part of this slice; see Plan). The `Gateway` facade wraps the existing standalone functions (`resolveSession`, `admitIngress`, `claimActiveTurn`, `createGatewayTurnStartHandoffFromAcceptedAdmission`, `createTurnFromHandoff`, `releaseActiveTurnAndDequeue`) into a single orchestrating class. Construction: `new Gateway({ db, governorDefaults, ... })`. The composition root calls `new Gateway(config)` instead of calling 5+ standalone functions directly.
    - **Agentic Core**: instantiated with `EpisodicMemory`, `PromptCompiler`, `ContextSelector`, `CompactionPolicy`, `TurnStateMachine`, `evaluateGovernor`, and `validateAndRepair` from `@argentum/agentic-core` (slices 0024–0030).
      - **EpisodicMemory construction**: `new EpisodicMemory(sessionId: string)` — the constructor takes a `sessionId` string (confirmed from `packages/agentic_core/src/episodic-memory.ts`). The composition root must create one `EpisodicMemory` per session, passing the `session_id` resolved by the gateway's `resolveSession()`.
    - **LLM Provider**: instantiated with a `MockLLMProvider` for E2E testing. The mock returns a fully-formed `LLMInferenceResult` with all required fields (`request_id`, `decision`, `normalization_status`). The `LLMProvider` interface from `@argentum/llm-provider` (slice 0031) is used as the type. The composition root is structured so that swapping the mock for the real DeepSeek adapter (slice 0033) is a one-line change.
    - **Tooling**: instantiated with the `ToolRegistry` from `@argentum/tooling` (slice 0019). For E2E, the registry is populated with zero or one fake tool. A `ToolCallExecutor` bridge wraps the `ToolRegistry`, resolves grants, and executes tools — the bridge implements the `ToolCallExecutor` interface expected by `CoreLoopOrchestrator` (see H-0037-1 resolution). The `RetryPolicyHandler` (slice 0023) is wired to the tool executor.
    - **Channel CLI**: uses `normalizeCliInput` from `@argentum/channel-cli` (slice 0035) for input normalization and `renderStreamEvent` (slice 0036) for output rendering.
    - **Core Loop Orchestrator**: instantiated from `@argentum/agentic-core` (slice 0034) with all required dependencies.
  - **E2E happy-path test**: A focused runtime test in `apps/runtime/tests/` that:
    1. Calls `startRuntime()` with a test config, receives `RuntimeContext`
    2. Simulates a user typing `"Hello, Argentum!"`
    3. Uses `runtimeContext.runCliTurn()` as the supported public seam for the CLI happy path
    4. The input flows through: `normalizeCliInput` → `gateway.resolveSession()` → `gateway.admitIngress()` → runtime-owned accepted-ingress priming into session memory → `gateway.claimActiveTurn()` → `gateway.createTurnStartHandoff()` → `gateway.createTurn()` → `orchestrator.executeTurn(envelope)` → mock LLM provider sees the accepted ingress text in its request context → orchestrator completes turn → `gateway.releaseActiveTurnAndDequeue()` → `renderStreamEvent` produces final output
    5. Asserts the final `TurnEnvelope` is in `completed` state
    6. Asserts the provider request contains the accepted ingress text and the `response.completed` `StreamEvent` plus rendered output contain the expected message
    7. Calls `runtimeContext.shutdown()` and verifies cleanup
  - **Mock LLM Provider**: The composition root creates a `MockLLMProvider` implementing the `LLMProvider` interface from `@argentum/llm-provider`. The mock:
    - Implements `infer(request: LLMInferenceRequest): Promise<LLMInferenceResult>`
    - Returns a fully-formed `LLMInferenceResult` with **all required fields**:
      ```ts
      {
        request_id: request.request_id,  // echo the incoming request_id for traceability
        decision: {
          decision_id: "mock-decision-001",
          kind: "respond",
          message: "Hello! I'm Argentum, your AI assistant.",
        },
        normalization_status: "parsed_text",  // MVP mock uses parsed_text (no native tool calling)
      }
      ```
    - Does NOT make network calls, require API keys, or depend on provider SDKs
    - Exported as `MockLLMProvider` for reuse in other tests
    - The `request_id` field is populated (echoed from the incoming request) — this is required by the `LLMInferenceResult` contract
    - The `normalization_status` field is set to `"parsed_text"` — this is required by the `LLMInferenceResult` contract and reflects the mock's simplistic response generation
  - **`MockLLMProvider` class exported** from `@argentum/runtime` (or a test-helper subpath). Implements `LLMProvider` interface.
  - **Runtime entrypoint module**: The implementation lives in `apps/runtime/src/composition-root.ts` (or extends `apps/runtime/src/index.ts`). The existing `bootstrapRuntime` function remains unchanged — the new `startRuntime` function calls `bootstrapRuntime` internally and then constructs downstream modules.
  - **No circular dependencies**: The dependency graph is a DAG. Package dependencies in `apps/runtime/package.json` include all wired packages: `@argentum/environment`, `@argentum/gateway`, `@argentum/agentic-core`, `@argentum/llm-provider`, `@argentum/tooling`, `@argentum/channel-cli`, `@argentum/contracts`.
  - **Config-driven**: Workspace paths, governor defaults, tool policy, and telemetry settings come from the validated `RuntimeConfigDTO`. No hardcoded paths except a default config path (`./config/runtime.json`).
  - **Error handling**: If config loading fails, `startRuntime` throws. If any module construction fails (missing dependency, invalid config), `startRuntime` throws with a descriptive error. The function does not catch and suppress construction errors.
  - **The module does NOT**:
    - Implement any module's internal logic (gateway, agentic core, etc.) — it only wires instances
    - Own session lifecycle, turn execution, or tool execution
    - Define contracts or interfaces
    - Implement channel protocols beyond calling the CLI functions
    - Manage filesystem paths beyond passing config values to modules
- Inputs crossing the boundary:
  - `configPath?: string` — optional path to runtime JSON config (defaults to `./config/runtime.json`)
  - All upstream package exports consumed via `workspace:*` dependencies
- Outputs crossing the boundary:
  - `startRuntime` function exported from `@argentum/runtime` (returns `Promise<RuntimeContext>`)
  - `RuntimeContext` interface exported from `@argentum/runtime`, including the supported `runCliTurn()` happy-path seam
  - `MockLLMProvider` class exported from `@argentum/runtime`
  - Focused runtime test validating the supported public happy path

## Plan

- First contracts or interfaces to create:
  - `RuntimeContext` interface — return type of `startRuntime`, exposes `runCliTurn`, `orchestrator`, `gateway`, `shutdown`
  - `startRuntime(configPath?: string): Promise<RuntimeContext>` — top-level entrypoint, returns context instead of void
  - `Gateway` facade class — new class in `@argentum/gateway` wrapping standalone functions (see step 3a)
  - `ToolCallExecutor` bridge — adapter wrapping `ToolRegistry` + grant resolver to satisfy the `ToolCallExecutor` interface (see step 3c)
  - `MockLLMProvider` — implements `LLMProvider` from `@argentum/llm-provider`, returns fully-formed `LLMInferenceResult`
- Minimal implementation steps:
  1. **Add all workspace dependencies** to `apps/runtime/package.json`:
     - Add to `dependencies`: `"@argentum/contracts": "workspace:*"`, `"@argentum/gateway": "workspace:*"`, `"@argentum/agentic-core": "workspace:*"`, `"@argentum/llm-provider": "workspace:*"`, `"@argentum/tooling": "workspace:*"`, `"@argentum/channel-cli": "workspace:*"` (all in addition to existing `"@argentum/environment": "workspace:*"`)
  2. **Update `apps/runtime/tsconfig.json`**: Add `"references"` array with paths to all dependent packages: `../packages/contracts`, `../packages/environment`, `../packages/gateway`, `../packages/agentic_core`, `../packages/llm_provider`, `../packages/tooling`, `../packages/channel_cli`.
  3. **Create `Gateway` facade class in `@argentum/gateway`** (part of this slice — no separate gateway slice card):
     - Create `packages/gateway/src/gateway-facade.ts` with class `Gateway`:
       ```ts
       class Gateway {
         constructor(config: GatewayConfig) { ... }
         resolveSession(input: GatewaySessionRoutingInput): Promise<GatewayResolvedSession>;
         admitIngress(input: GatewayIngressInput, defaults: GatewayDefaults): Promise<GatewayAdmissionResult>;
         claimActiveTurn(admission: GatewayAcceptedAdmissionResult): Promise<GatewayActiveTurnClaimResult>;
         createTurnStartHandoff(input: CreateGatewayTurnStartHandoffFromAcceptedAdmissionInput): GatewayTurnStartHandoff;
         createTurn(handoff: GatewayTurnStartHandoff, governorDefaults: GatewayTurnGovernorDefaults): GatewayTurnCreatedResult;
         releaseActiveTurnAndDequeue(input: ReleaseActiveTurnAndDequeueInput): Promise<GatewayReleaseAndDequeueResult>;
       }
       ```
     - The facade encapsulates: SQLite DB handle, ID allocators, store instances (session routing store, active-turn claim store, release-and-dequeue store), and governor defaults
     - The facade methods delegate to the existing standalone functions (`resolveSession`, `admitIngress`, `claimActiveTurn`, `createGatewayTurnStartHandoffFromAcceptedAdmission`, `createTurnFromHandoff`, `releaseActiveTurnAndDequeue`), wiring internal stores and allocators automatically
     - Export `Gateway` and `GatewayConfig` from `packages/gateway/src/index.ts`
     - The composition root instantiates `new Gateway(config)` instead of calling 5+ standalone functions directly
  4. **Create `apps/runtime/src/mock-llm-provider.ts`**:
     - Import `LLMProvider`, `LLMInferenceRequest`, `LLMInferenceResult`, `ActionDecision`, `NormalizationStatus` from `@argentum/llm-provider` and `@argentum/contracts`
     - Define and export `MockLLMProvider` class implementing `LLMProvider`:
       ```ts
       class MockLLMProvider implements LLMProvider {
         async infer(request: LLMInferenceRequest): Promise<LLMInferenceResult> {
           return {
             request_id: request.request_id,   // echo incoming request_id (REQUIRED field)
             decision: {
               decision_id: "mock-decision-001",
               kind: "respond",
               message: "Hello! I'm Argentum, your AI assistant.",
             },
             normalization_status: "parsed_text",  // REQUIRED field — mock emits via parsed_text
           };
         }
       }
       ```
     - **All three required `LLMInferenceResult` fields are present**: `request_id` (echoed), `decision` (canned `ActionDecision` with `decision_id`, `kind`, `message`), `normalization_status` (`"parsed_text"`)
     - The mock is stateless and returns the same response regardless of input
  5. **Create `apps/runtime/src/composition-root.ts`** (or extend `index.ts`):
     - Import all module constructors from their respective packages
     - Define and export `RuntimeContext` interface
     - Define and export `startRuntime(configPath?: string): Promise<RuntimeContext>`:
       a. Call `bootstrapRuntime({ configOverridePath: configPath })` to load config (existing function)
       b. Extract workspace paths, governor defaults, tool policy, and telemetry config from `startupConfig`
       c. **Construct Gateway facade**: `new Gateway({ db, governorDefaults, ... })` — one constructor call replaces 5+ standalone function calls
       d. **Construct ToolCallExecutor bridge** (see H-0037-1):
          - Create a `ToolRegistry` instance and populate with available tools (empty or minimal for E2E)
          - Create a bridge object implementing `ToolCallExecutor` interface:
            ```ts
            const toolExecutor: ToolCallExecutor = {
              async execute(entry: ToolCallEntry, envelope: TurnEnvelope): Promise<ToolResultDTO> {
                // 1. Resolve grant for tool (via grant resolver from environment)
                // 2. Construct ToolCallDTO from entry + grant
                // 3. Dispatch via ToolRegistry.dispatch()
                // 4. Return ToolResultDTO
              }
            };
            ```
          - The bridge wraps `ToolRegistry.dispatch()`, adds grant resolution and `ToolCallDTO` construction that `ToolRegistry` does not natively provide
       e. **Construct EpisodicMemory**: `new EpisodicMemory(sessionId)` — the constructor takes a `sessionId: string` (confirmed from `packages/agentic_core/src/episodic-memory.ts`). One instance per session, created when the session is resolved.
       f. Construct agentic_core instances: `PromptCompiler`, `ContextSelector`, `CompactionPolicy`, `TurnStateMachine`
       g. Construct `MockLLMProvider`
       h. Construct `CoreLoopOrchestrator` with all dependencies (memory, promptCompiler, contextSelector, compactionPolicy, llmProvider, toolExecutor bridge)
       i. Define `shutdown()` async function: release any active locks, close DB connections, flush telemetry
       j. Return `{ orchestrator, gateway, shutdown }` as `RuntimeContext`
     - Export `startRuntime` and `RuntimeContext`
    6. **Create `apps/runtime/tests/e2e-happy-path.test.ts`**:
     - Uses vitest with a test config pointing to `config/runtime.example.json`
      - Test: `const ctx = await startRuntime()` → receive `RuntimeContext` → use `ctx.runCliTurn("Hello")` → assert provider request contains the accepted ingress text → assert envelope state is `completed` → assert rendered output contains the expected message → `await ctx.shutdown()`
     - Uses `MockLLMProvider` injected during construction
     - Verify gateway lock is released after turn completes
  7. Run `pnpm --filter @argentum/runtime test` to validate.
  8. Run `pnpm test` at repo root to ensure no regressions.
- Required tests:
  - **E2E happy path — supported public seam**: Simulate user input `"Hello"` via `runCliTurn()` → accepted ingress is primed into session memory → provider request sees `"Hello"` → turn completes → final response rendered
  - **E2E happy path — TurnEnvelope terminal state**: After `executeTurn`, envelope is in `completed` state
  - **E2E happy path — response content**: The `response.completed` StreamEvent payload contains the mock LLM's message
  - **E2E happy path — `startRuntime` returns `RuntimeContext`**: Verify the returned object has `orchestrator`, `gateway`, and `shutdown` properties
  - **E2E happy path — `shutdown` cleans up**: Call `shutdown()` and verify no resources leak (locks released, DB closed)
  - **Composition — config loading**: `startRuntime()` with valid config succeeds; with invalid path throws
  - **Composition — mock LLM provider**: `MockLLMProvider.infer()` returns a valid `LLMInferenceResult` with all required fields: `request_id`, `decision` (with `decision_id`, `kind`, `message`), `normalization_status` (`"parsed_text"`)
  - **Composition — Gateway facade instantiation**: `new Gateway(config)` succeeds and exposes all expected methods
  - **Composition — ToolCallExecutor bridge**: Bridge correctly wraps `ToolRegistry.dispatch()`, resolves grants, constructs `ToolCallDTO`
  - **Composition — EpisodicMemory construction**: `new EpisodicMemory(sessionId)` succeeds with a valid session ID string
  - **Composition — no circular dependencies**: Verify that `apps/runtime/package.json` dependencies form a DAG (no circular `workspace:*` references)
  - **Gateway lock release**: After turn completes, the gateway's session lock is released (next turn can be created for same session)
  - **Config-driven workspace paths**: Runtime uses paths from `RuntimeConfigDTO.workspace`, not hardcoded values
- Narrow validation step:
  - `pnpm --filter @argentum/runtime test` passes with the new E2E test
  - `pnpm test` at repo root passes (no regressions across existing tests)
  - Manual verification: the composition graph is inspectable — each module's constructor dependencies are explicit

## Execution Strategy

- Autopilot suitability: **CONDITIONAL**. This slice is:
  - A significant integration slice that wires 7 packages together
  - Requires understanding the full dependency graph and constructor signatures of ~10 module classes
  - Depends on multiple upstream slices (0034, 0035, 0036, 0031, 0033) that are planned but not yet implemented
  - Many constructor signatures may still evolve as upstream slices are implemented
  - The mock LLM provider is simple and safe
  - The E2E test is deterministic
  - **Condition**: autopilot is safe ONLY after all upstream slices (0030–0036) are validated and their exports are stable. Before that, the composition root's constructor calls will be against moving targets. Human review of the full dependency graph is recommended before autopilot implementation.
- Parallel subagent opportunities: **One read-only subagent** can audit the dependency graph across all packages to verify no circular dependencies exist before the composition root is wired. This is independent of implementation.
- Out of scope:
  - Implementing any module's internal logic — the composition root only wires existing implementations
  - Real DeepSeek API integration — uses `MockLLMProvider` (real adapter is slice 0033)
  - Real tool implementations — tool registry is empty or minimal
  - Session persistence across restarts — the E2E test uses in-memory or temp persistence
  - Multi-turn conversations — E2E tests a single turn
  - CLI readline loop or REPL — no interactive stdin reading
  - Telemetry persistence — telemetry events are emitted but not durably stored (slice 0038)
  - Production deployment or daemon mode
  - Error recovery paths beyond config loading failures (failure-path E2E tests are future slices)
- Deferred decisions that must remain deferred:
  - "Exact local persistence technology for session and queue state" — the gateway already chose SQLite (implemented in slices 0008–0011); the composition root uses what the gateway provides. This deferred decision is de facto resolved for MVP.
  - "Exact initial tool catalog" — the composition root uses an empty or minimal tool registry. The catalog decision remains deferred.
  - "Exact DeepSeek endpoint and model selection" — deferred; the E2E test uses a mock so endpoint/model are irrelevant.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **CRITICAL C-0037-1 — Gateway orchestration surface: facade vs. standalone functions** (RESOLVED 2026-05-24 by human decision, Option A): The composition root currently plans to call 5+ standalone gateway functions directly (`resolveSession`, `admitIngress`, `claimActiveTurn`, `createGatewayTurnStartHandoffFromAcceptedAdmission`, `createTurnFromHandoff`, `releaseActiveTurnAndDequeue`). This is fragile and exposes internal gateway wiring details to the composition root. **Resolution**: Create a `Gateway` facade class in `@argentum/gateway` that wraps the existing standalone functions. The composition root instantiates `new Gateway(config)` and calls orchestrated methods on the facade. No separate gateway slice card — the facade is part of slice 0037's implementation.
  - **CRITICAL C-0037-2 — `startRuntime` return type: void vs. RuntimeContext** (RESOLVED 2026-05-24 by human decision, Option A): The original signature returned `Promise<void>`, making the composed instances inaccessible to callers (e.g., tests, CLI drivers) and providing no shutdown mechanism. **Resolution**: `startRuntime` returns `Promise<RuntimeContext>` where `RuntimeContext` exposes `orchestrator: CoreLoopOrchestrator`, `gateway: Gateway`, and `shutdown: () => Promise<void>`. This gives callers direct access to drive turns and gracefully tear down.
  - **HIGH H-0037-1 — Missing `ToolCallExecutor` bridge** (RESOLVED 2026-05-24): The `CoreLoopOrchestrator` (slice 0034) expects a `ToolCallExecutor` interface (`execute(entry: ToolCallEntry, envelope: TurnEnvelope): Promise<ToolResultDTO>`), but `ToolRegistry` (slice 0019) does not implement this interface — it exposes `register()` and `dispatch()`. The `ToolCallExecutor` interface requires grant resolution and `ToolCallDTO` construction, neither of which `ToolRegistry` provides. **Resolution**: The composition root creates a `ToolCallExecutor` bridge object that wraps `ToolRegistry.dispatch()`, adds grant resolution (via the grant resolver from `@argentum/environment`), and constructs `ToolCallDTO` before dispatching. Implementation step 5d updated with explicit bridge construction pseudocode.
  - **HIGH H-0037-2 — Gateway wiring step is too vague** (RESOLVED 2026-05-24): The original plan step "Construct gateway instance with persistence path and environment config" is a single vague bullet. Per C-0037-1 resolution, this is replaced with explicit `Gateway` facade construction: `new Gateway({ db, governorDefaults, ... })`. Implementation step 3 now details the facade class creation.
  - **HIGH H-0037-3 — `EpisodicMemory` constructor signature undocumented** (RESOLVED 2026-05-24): The original plan did not specify how to construct `EpisodicMemory`. Inspection of `packages/agentic_core/src/episodic-memory.ts` confirms the constructor is `constructor(sessionId: string)`. **Resolution**: Documented in Scope (constructor wiring) and Plan (step 5e) that `EpisodicMemory` takes a `sessionId: string` and one instance must be created per session.
  - **HIGH H-0037-4 — `MockLLMProvider` return value incomplete** (RESOLVED 2026-05-24): The original mock returned only `{ decision: { kind: "respond", message: "..." } }` with a comment `// ... other LLMInferenceResult fields as required by the contract`. The `LLMInferenceResult` contract (`packages/contracts/src/llm-adapter.ts`) requires three non-optional fields: `request_id: string`, `decision: ActionDecision`, `normalization_status: NormalizationStatus`. **Resolution**: `MockLLMProvider.infer()` now returns a fully-formed object with `request_id` (echoed from the incoming request), `decision` (with `decision_id`, `kind`, `message`), and `normalization_status` (`"parsed_text"`). Implementation step 4 updated with exact return shape. Added test requirement verifying all three required fields.
  - **HIGH H-0037-5 — Happy-path public seam overstated as `gateway + orchestrator.executeTurn()`** (RESOLVED 2026-05-24): The runtime implementation now works through `runCliTurn()`, not `gateway + orchestrator` alone. Accepted ingress must be primed into session memory before `executeTurn()`, and that priming is runtime-owned behavior reached through `runCliTurn()`. **Resolution**: Promote `runCliTurn()` as the supported public happy-path runtime seam, keep `gateway` and `orchestrator` exported as lower-level runtime surfaces, and update the focused runtime test plus slice text to prove the accepted ingress text reaches the provider request and rendered output through `runCliTurn()`.
- Refinements applied:
  - **2026-05-24 audit 0016 remediation — H1 resolved**: Replaced the single placeholder `EpisodicMemory` wiring with a session-aware orchestrator facade in `apps/runtime`. The exported `RuntimeContext.orchestrator` remains callable via `executeTurn(envelope)`, but dispatch now keys to one real `EpisodicMemory` + one real `CoreLoopOrchestrator` per `session_id`. Accepted ingress is committed into the owning session memory before execution so the provider-facing request sees normalized user input and prior session context only.
  - **2026-05-24 audit 0016 remediation — H2 resolved**: Added a runtime-owned `runCliTurn()` path that actually invokes `normalizeCliInput`, drives gateway admission/turn creation, executes the orchestrator, maps emitted lifecycle events into canonical `StreamEvent` values, renders them through `renderStreamEvent`, persists them via `TelemetryWriter`, and flushes telemetry during `shutdown()`.
  - **2026-05-24 adversarial review refinement — happy-path seam narrowed to the real public boundary**: Updated runtime comments, tests, and this slice card so `runCliTurn()` is the supported CLI happy-path public seam. `gateway` and `orchestrator` remain exported for lower-level runtime control, but the card no longer claims they alone form the complete supported CLI boundary.
  - **2026-05-24 audit 0016 remediation — H3 resolved**: Wired a concrete filesystem-backed `ContentResolver` and trace writer in `composition-root.ts`, rooted at the validated workspace `bedrock/`, `working/`, `artifacts/`, and `logs/` areas. `startRuntime()` now accepts an optional provider-factory hook so a resolver-requiring provider double or real provider adapter can consume the wired resolver without changing the default mock happy-path wiring.
  - **2026-05-24 audit 0016 remediation — M2 resolved**: Replaced the partially vacuous E2E proof with focused runtime tests that exercise the real CLI normalization/rendering boundary, verify per-session memory isolation across two sessions, prove telemetry JSONL persistence plus flush-on-shutdown, and prove persisted `ContentRef` resolution on a later provider-facing inference step.
  - `startRuntime` signature changed: `Promise<void>` → `Promise<RuntimeContext>` (C-0037-2)
  - `RuntimeContext` interface added with `orchestrator`, `gateway`, `shutdown` (C-0037-2)
  - `RuntimeContext` refined additively with `runCliTurn(rawInput, options?)` so callers can exercise the real runtime composition path without bypassing CLI normalization, event rendering, or telemetry persistence.
  - Gateway wiring replaced with `Gateway` facade class construction (C-0037-1)
  - `Gateway` facade class creation added as implementation step 3 — no separate gateway slice card
  - `ToolCallExecutor` bridge step added to composition root (H-0037-1)
  - `EpisodicMemory` construction documented: `new EpisodicMemory(sessionId)` — one per session (H-0037-3)
  - `MockLLMProvider` return shape completed with all required `LLMInferenceResult` fields: `request_id`, `decision` (with `decision_id`, `kind`, `message`), `normalization_status` (H-0037-4)
  - E2E/runtime tests now cover `RuntimeContext` compatibility, `runCliTurn()` composition, `shutdown()` telemetry flush, resolver-backed provider reinference, and session isolation.
  - All acceptance criteria remain compatible with the gateway facade + `RuntimeContext` return shape; the additive `runCliTurn()` helper documents the owning runtime seam rather than widening responsibility into adjacent modules.
