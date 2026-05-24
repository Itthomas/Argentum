# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (via orchestrator delegation)
- Approval date: 2026-05-24
- Phase: 3
- Owner: environment
- Execution readiness: implemented-and-validated. Slice 0014 (`ToolCallDTO`/`ToolResultDTO`) and slice 0015 (`ExecutionGrantDTO`) are validated and available as upstream contract boundaries. Slice 0020 (grant resolution) is not a hard dependency — the `ExecutionDriver` interface reads execution permissions from `call.grant` (an embedded `ExecutionGrantDTO`), not from a separately resolved runtime artifact. The driver interface can be defined and stubbed without grant resolution being implemented.

## Scope

- Slice name: Native execution driver interface and no-op stub
- Target package or boundary: `environment`
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md) — sole authority for MVP execution model, driver abstraction requirement, and acceptance criteria
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — `ExecutionGrantDTO` consumed by the driver as the canonical source of execution permissions
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md) — `ToolCallDTO` input shape, `ToolResultDTO` output shape
  - [docs/spec/20-contracts/canonical-contracts.md](../../spec/20-contracts/canonical-contracts.md) — `ExecutionGrantDTO` is the scoped permission surface for one tool execution
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - **Driver abstraction exists**: The `@argentum/environment` package exports an `ExecutionDriver` interface defining the single seam through which tools execute. The core loop calls `execute(call)` and receives a `ToolResultDTO` — it never spawns subprocesses or performs direct tool invocation.
  - **Interface shape**: `ExecutionDriver` exports a single async method:
    - `execute(call: ToolCallDTO): Promise<ToolResultDTO>`
  - **Contract consumption**: The driver interface reads all execution permissions from `call.grant` (an embedded `ExecutionGrantDTO`). Callers must materialize a complete `ToolCallDTO` with a resolved grant before invoking the driver; the driver must not assume or derive its own permissions.
  - **Grant-driven execution model**: The interface contract documents that implementations must honor `call.grant.cwd` (working directory), `call.grant.path_permissions` (allowed roots and capabilities), `call.grant.network_policy` (network posture — `deny` or `inherit`), and `call.grant.env_secret_handles` (secret names available for injection). The interface does not enforce these at the type level — it documents the behavioral contract that implementations must satisfy.
  - **Container-ready abstraction**: The `ExecutionDriver` interface is defined as a TypeScript interface (not a concrete class), so a future container driver can implement the same contract without any changes to the interface or its callers.
  - **No-op stub implementation**: The `environment` package exports a `NativeExecutionDriver` class implementing `ExecutionDriver`. The stub:
    - Accepts any `ToolCallDTO` (with embedded grant).
    - Returns `ToolResultDTO` with `status = "blocked"`, a descriptive `human_summary` indicating the no-op stub is active, `call_id` matching the inbound `ToolCallDTO.call_id`, `duration_ms = 0`, `truncated = false`, `retryable = false`, and a stable `error_code` of `"NOOP_DRIVER_STUB"`.
    - Performs no subprocess spawning, no filesystem access, and no side effects.
    - **Stub contract caveat** (documented in JSDoc): `NativeExecutionDriver` is a no-op placeholder that does NOT satisfy the full behavioral contract of `ExecutionDriver`. Unimplemented obligations include honoring `cwd`, `path_permissions`, `network_policy`, `env_secret_handles`, `max_runtime_ms` enforcement, and `approval_mode`-based blocking. All calls return `status = "blocked"` regardless of grant contents.
  - **Package exports**: The `environment` package exports `ExecutionDriver` (interface), `NativeExecutionDriver` (class), and `NOOP_DRIVER_STUB` (constant error code) from its public entrypoint.
  - The slice does NOT implement grant resolution, subprocess spawning, container isolation, artifact storage, secret resolution, or actual tool execution.
- Inputs crossing the boundary:
  - `ToolCallDTO` values (canonical contract from slice 0014) — the tool execution request, carrying an embedded `ExecutionGrantDTO` in its `grant` field.
- Outputs crossing the boundary:
  - `ExecutionDriver` interface exported from `@argentum/environment`.
  - `NativeExecutionDriver` class exported from `@argentum/environment`.
  - `NOOP_DRIVER_STUB` constant exported from `@argentum/environment`.
  - `ToolResultDTO` values returned from `execute()` — currently always `status = "blocked"` with the no-op code.

## Plan

- First contracts or interfaces to create:
  - `ExecutionDriver` interface with a single method:
    - `execute(call: ToolCallDTO): Promise<ToolResultDTO>`
    - JSDoc documents that implementations read all execution permissions from `call.grant`, and must honor `call.grant.cwd`, `call.grant.path_permissions`, `call.grant.network_policy`, `call.grant.env_secret_handles`, `call.grant.max_runtime_ms`, and `call.grant.approval_mode`.
  - `NativeExecutionDriver` class implementing `ExecutionDriver`:
    - Constructor takes no parameters (no-op stub needs no configuration).
    - `execute(call)` returns a `ToolResultDTO` with `status = "blocked"`, `call_id = call.call_id`, `duration_ms = 0`, `truncated = false`, `retryable = false`, `error_code = "NOOP_DRIVER_STUB"`, and a descriptive `human_summary`.
    - Grant fields on `call.grant` (`cwd`, `path_permissions`, `network_policy`, `env_secret_handles`, `max_runtime_ms`, `approval_mode`) are intentionally ignored by the stub. JSDoc explicitly states this is a no-op placeholder that does NOT satisfy the full behavioral contract and lists the unimplemented obligations.
  - Stable error code constant `NOOP_DRIVER_STUB = "NOOP_DRIVER_STUB"` exported for tests and future consumers.
- Minimal implementation steps:
  - Create `packages/environment/src/execution-driver.ts`:
    1. Import `ToolCallDTO`, `ToolResultDTO` from `@argentum/contracts`. (`ExecutionGrantDTO` is accessed via `call.grant` — no separate import needed for the interface signature.)
    2. Define and export `ExecutionDriver` interface with `execute(call: ToolCallDTO): Promise<ToolResultDTO>`.
    3. Add JSDoc to the interface documenting:
       - Implementations read all execution permissions from `call.grant` (the embedded `ExecutionGrantDTO`).
       - Implementations must honor `call.grant.cwd` as the working directory for execution.
       - Implementations must honor `call.grant.path_permissions` to restrict filesystem access.
       - Implementations must honor `call.grant.network_policy` — `deny` must prevent all network access; `inherit` allows host network inheritance in MVP.
       - Implementations must honor `call.grant.env_secret_handles` — secret values are resolved from handles at execution time and must not be serialized into turn memory.
       - Implementations must use `call.grant.max_runtime_ms` as the execution time ceiling.
       - Implementations must respect `call.grant.approval_mode` — a `deny` grant must result in `ToolResultDTO.status = "blocked"`.
       - The interface is designed to support both native host execution (MVP) and future container-based execution without contract changes.
    4. Define and export `NativeExecutionDriver` class implementing `ExecutionDriver`.
       - JSDoc explicitly states: "NativeExecutionDriver is a no-op placeholder that does NOT satisfy the full behavioral contract of ExecutionDriver. Unimplemented obligations: honoring cwd, path_permissions, network_policy, env_secret_handles resolution, max_runtime_ms enforcement, and approval_mode-based blocking. All calls return status='blocked' regardless of grant contents."
    5. Implement `execute(call)` method:
       - Reads `call.call_id` for the mirrored result.
       - Does NOT read or enforce any `call.grant` fields (intentionally — documented gap).
       - Returns a frozen `ToolResultDTO` object with:
         - `call_id: call.call_id`
         - `status: "blocked"`
         - `human_summary: "Native execution driver is not yet implemented (no-op stub). Tool calls are blocked until the real subprocess driver is available."`
         - `duration_ms: 0`
         - `truncated: false`
         - `retryable: false`
         - `error_code: NOOP_DRIVER_STUB`
    6. Export `NOOP_DRIVER_STUB` constant.
  - Update `packages/environment/src/index.ts`:
    - Add barrel exports for `ExecutionDriver`, `NativeExecutionDriver`, and `NOOP_DRIVER_STUB` from the new module.
    - Preserve existing exports (`loadRuntimeStartupConfig`, `RuntimeStartupConfigError`, and associated types).
  - The `environment` package already depends on `@argentum/contracts` at `workspace:*` — no dependency changes needed.
  - No new configuration, scaffolding, or tooling changes required.
- Required tests:
  - **Interface usability tests** (prove the `ExecutionDriver` interface can be implemented and called):
    - A test creates a `NativeExecutionDriver` instance and verifies it satisfies the `ExecutionDriver` interface at the type level (TypeScript structural compatibility — no runtime `instanceof` needed; a simple assignment `const driver: ExecutionDriver = new NativeExecutionDriver()` compiles).
    - A test calls `execute()` with a minimal valid `ToolCallDTO` (with embedded `ExecutionGrantDTO` in `call.grant`) — verifies the returned `ToolResultDTO` has:
      - `status = "blocked"`
      - `call_id` matching the inbound `ToolCallDTO.call_id`
      - `duration_ms = 0`
      - `truncated = false`
      - `retryable = false`
      - `error_code = "NOOP_DRIVER_STUB"`
    - A test calls `execute()` with varying `ToolCallDTO` values (different `call_id`, different `tool_name`, different `arguments`, different embedded grant configurations) — verifies `call_id` is correctly mirrored and no other fields are coupled to input.
  - **Grant-agnostic stub behavior tests** (prove the stub ignores all grant fields and always returns blocked):
    - A test calls `execute()` with an auto-allow grant — stub returns `blocked` (stub ignores approval).
    - A test calls `execute()` with a deny grant — stub returns `blocked` (stub ignores approval; the real implementation will block).
    - A test calls `execute()` with various `path_permissions`, `network_policy`, and `env_secret_handles` configurations — stub always returns `blocked` with the no-op error code, proving grant shape doesn't affect stub behavior.
  - **Retryable and truncated field assertions** (dedicated assertions that these boolean fields are explicitly false):
    - A dedicated test verifies `retryable === false` for every grant configuration tested (auto-allow, deny, varied path_permissions).
    - A dedicated test verifies `truncated === false` for every grant configuration tested.
    - The assertions are explicit per-field (not implicit via object shape matching) to ensure the stub contract is unambiguous.
  - **Exported surface tests**:
    - `NOOP_DRIVER_STUB` constant is exported and equals `"NOOP_DRIVER_STUB"`.
    - `NativeExecutionDriver` is constructable with no arguments.
    - `ExecutionDriver` interface is importable (TypeScript-only; verify via barrel export presence).
  - **Package entrypoint smoke test**:
    - Verify `@argentum/environment` exports `ExecutionDriver`, `NativeExecutionDriver`, and `NOOP_DRIVER_STUB` (import and type-check).
- Narrow validation step:
  - `pnpm --filter @argentum/environment test` passes with real (non-vacuous) execution-driver tests.
  - `pnpm --filter @argentum/environment build` succeeds (TypeScript compilation).
  - `pnpm --filter @argentum/environment lint` passes.

## Execution Strategy

- Autopilot suitability: **safe**. This slice is:
  - Fully bounded: one interface, one stub class, one constant, tests.
  - Contract-consumer only: consumes existing validated `ToolCallDTO`, `ToolResultDTO`, `ExecutionGrantDTO` from `@argentum/contracts`.
  - No external dependencies, no side effects, no filesystem or network access.
  - No deferred decisions to resolve — container isolation is explicitly out of scope and the interface is designed to accommodate it later.
  - Clear acceptance criteria with deterministic test assertions.
- Parallel subagent opportunities: **none**. The slice is a single module in one package. No independent read-only tasks (spec harvesting, risk review) would benefit from parallel execution at this scope.
- Out of scope:
  - Grant resolution (planned for slice 0020).
  - Actual subprocess spawning (`child_process.spawn` / `exec`).
  - Container isolation or any container driver.
  - Artifact storage, artifact path derivation, or `ContentRef` creation for tool outputs.
  - Secret resolution from `env_secret_handles`.
  - Working-directory enforcement or chroot-like path restrictions.
  - Network policy enforcement (`deny` / `inherit`).
  - Execution timeout enforcement (`max_runtime_ms` ceiling).
  - `ToolResultDTO` compaction or output truncation.
  - Integration with the core loop or tool registry dispatch.
- Deferred decisions that must remain deferred:
  - Container isolation technology and driver implementation (explicitly deferred in spec: "Container isolation in MVP" is a non-goal; "The later addition of a container driver would not require contract changes" is satisfied by the interface design).
  - Exact initial tool catalog included in MVP (deferred decision — no tool implementations are wired here).

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1 (HIGH) — Redundant grant parameter in execute() signature creates coordination hazard**: The proposed signature `execute(call: ToolCallDTO, grant: ExecutionGrantDTO)` passes the grant twice since `ToolCallDTO.grant` already embeds `ExecutionGrantDTO`. This creates a coordination hazard where the two grants could diverge.
  - **M1 (MEDIUM) — Stub violates its own interface contract**: `NativeExecutionDriver` advertises `implements ExecutionDriver` but ignores all grant-driven behavioral obligations without documenting this gap.
  - **M2 (MEDIUM) — JSDoc omits grant.network_policy and grant.env_secret_handles**: The interface JSDoc only documented `cwd` and `path_permissions` but omitted two required grant fields.
  - **M3 (MEDIUM) — Test coverage for retryable and truncated is implicit**: The tests relied on object-shape matching rather than explicit per-field assertions for `retryable=false` and `truncated=false`.
- Refinements applied:
  - **H1 fix**: Changed interface signature to `execute(call: ToolCallDTO): Promise<ToolResultDTO>` — removed the freestanding `grant` parameter. JSDoc documents that implementations read all execution permissions from `call.grant`. All test descriptions updated to construct `ToolCallDTO` with embedded grant. Removed "Grant parameter reception tests" category; replaced with "Grant-agnostic stub behavior tests" that construct `ToolCallDTO` values with varied embedded grants.
  - **M1 fix**: Added JSDoc to `NativeExecutionDriver` explicitly stating it is a no-op placeholder that does NOT satisfy the full behavioral contract. Listed all unimplemented obligations: `cwd`, `path_permissions`, `network_policy`, `env_secret_handles` resolution, `max_runtime_ms` enforcement, and `approval_mode`-based blocking.
  - **M2 fix**: Added `call.grant.network_policy` and `call.grant.env_secret_handles` to the interface JSDoc behavioral contract. Documented that `network_policy = "deny"` must prevent all network access and `env_secret_handles` values must be resolved at execution time without serialization into turn memory.
  - **M3 fix**: Added dedicated "Retryable and truncated field assertions" test category with explicit per-field assertions verifying `retryable === false` and `truncated === false` for all grant configurations, rather than relying on implicit object-shape matching.
- Post-implementation adversarial review (2026-05-24):
  - **No CRITICAL or HIGH severity findings.** The implementation is faithful to the slice card acceptance criteria.
  - **L1 (LOW) — Unused type import `ToolResultDTO` in test file**: The test file imports `ToolResultDTO` as a type but never references it in explicit type annotations within assertions. Type-only imports have zero runtime cost and are harmless, but could be removed for tidiness. **Verdict**: Note and proceed.
  - **L2 (LOW) — `expect(ExecutionDriver).toBeUndefined()` assertion is unconventional**: The test correctly documents that TypeScript interfaces do not exist at runtime, and the assertion `toBeUndefined()` validates the import doesn't crash. The intent is clearly commented. **Verdict**: Note and proceed.
  - **Implementation validation summary**:
    - `pnpm --filter @argentum/environment test`: **74 passed** (38 execution-driver tests, 25 grant-resolver tests, 11 runtime-startup-config tests). Zero regressions.
    - `pnpm typecheck`: **passed** (zero errors across all packages).
    - `pnpm --filter @argentum/environment lint`: **passed** (zero warnings/errors after fixing `require-await`).
    - `pnpm --filter @argentum/environment build`: **passed** (clean tsc -b output).
  - **Acceptance criteria coverage**:
    - ✅ Driver abstraction exists — `ExecutionDriver` interface exported from `@argentum/environment`
    - ✅ Interface shape — `execute(call: ToolCallDTO): Promise<ToolResultDTO>`
    - ✅ Contract consumption — interface JSDoc documents all grant fields (`cwd`, `path_permissions`, `network_policy`, `env_secret_handles`, `max_runtime_ms`, `approval_mode`)
    - ✅ Grant-driven execution model — behavioral contract documented in JSDoc
    - ✅ Container-ready abstraction — TypeScript interface, not concrete class
    - ✅ No-op stub — `NativeExecutionDriver` returns `status="blocked"` with all specified fields
    - ✅ Stub contract caveat — JSDoc lists all unimplemented obligations
    - ✅ Package exports — `ExecutionDriver`, `NativeExecutionDriver`, `NOOP_DRIVER_STUB` all in barrel
    - ✅ All required test categories present (interface usability, mirroring, grant-agnostic, retryable/truncated per-field, construction, barrel exports)
    - ✅ `tsconfig.json` already had `"references": [{ "path": "../contracts" }]` — no changes needed
