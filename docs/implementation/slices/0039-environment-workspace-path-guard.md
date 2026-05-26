# Slice Card

## Status

- State: validated
- Approval: approved
- Approved by: GitHub Copilot
- Approval date: 2026-05-25
- Phase: 7 (Hardening)
- Owner: environment
- Execution readiness: implemented-and-validated. Slice 0002 (runtime startup config), slice 0015 (`ExecutionGrantDTO`), slice 0020 (grant resolution), and slice 0021 (execution-driver interface) are validated upstream. This slice now adds a validated internal environment workspace-path authorization helper seam that consumes canonical runtime workspace roots already owned by environment and that the native execution driver can consume later without widening the `@argentum/environment` package root.

## Scope

- Slice name: Environment internal workspace path guard
- Target package or boundary: `environment` internal workspace-path authorization helper seam for the native execution driver
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority for module leaf specs and frozen MVP rules
  - [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md) — logical workspace roots remain distinct, and granted paths are authorized by host-independent lexical containment before host-native rendering
  - [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md) — workspace-path authorization is an environment-internal helper or internal admission seam used by the native execution driver in MVP, not a required exported public boundary
  - [docs/spec/40-modules/environment/immutable-bedrock.md](../../spec/40-modules/environment/immutable-bedrock.md) — upstream frozen-MVP invariant; bedrock remains read-only through grant shaping rather than helper-specific denial logic
  - [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md) — `path_scope` to `path_permissions` mapping; denied grants prevent execution entirely; bedrock immutability is enforced upstream through read-only `bedrock` permissions
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — canonical `ExecutionGrantDTO`, `path_permissions`, `root`, and `capabilities` vocabularies
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md) — canonical `WorkspaceRootsDTO` contract consumed by environment-owned runtime policy and workspace authorization logic
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md) — environment owns workspace topology and execution-driver configuration
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md) — requires deterministic module-boundary tests and deterministic outputs for MVP slices
- Acceptance criteria:
  - **Internal seam only**: `authorizeWorkspacePath(workspaceRoots, grant, request)` is implemented in an internal environment helper module such as `packages/environment/src/workspace-path-guard.ts`, or an equivalently scoped internal admission seam. MVP does not require this function or its helper-local types to be re-exported from `packages/environment/src/index.ts`.
  - **Helper inputs use the canonical workspace-roots contract**: The helper receives canonical runtime workspace roots owned by environment as `WorkspaceRootsDTO` directly, carrying concrete roots for `bedrock`, `working`, `artifacts`, and `logs` without introducing a parallel environment-owned equivalent shape.
  - **Helper-local request shape**: The helper accepts `ExecutionGrantDTO` plus a helper-local request containing:
    - `root: PathRoot` — one of `"bedrock" | "working" | "artifacts" | "logs"`
    - `relativePath: string` — caller-supplied path fragment scoped to the requested logical root
    - `capability: Capability` — one of `"read" | "write" | "append"`
  - **Helper-local deterministic result shape**: The helper returns a deterministic allow-or-deny result for the later native execution-driver seam. If the implementation uses explicit denial literals, they remain helper-local to the environment package rather than a published package-root contract.
  - **Grant deny short-circuit**: If `grant.approval_mode === "deny"`, the helper returns a denied result without evaluating any path fields. Forbidden `request.relativePath` values and malformed matching grant roots must not preempt this outcome.
  - **Permission-root lookup semantics**: The helper inspects `grant.path_permissions` for entries matching `request.root` before authorization proceeds. Zero matches are denied as ordinary policy, not malformed input. More than one match for the same logical root is malformed helper input and returns a deterministic invalid-grant denial so duplicate-root behavior does not depend on later driver code.
  - **Grant root validity**: Immediately after unique-root selection and before capability matching, the helper validates the matched `grant.path_permissions[i].path`. A matching permission entry with a relative, Windows drive-relative (`C:temp\\root`), Windows current-drive-rooted (`\\temp\\root`), or otherwise non-absolute or malformed root is denied as invalid grant before any path rendering so results never depend on ambient process cwd. This malformed-grant classification wins even when the requested capability is absent.
  - **Logical-area alignment against canonical roots is segment-aware**: Before capability approval, the helper lexically verifies that the uniquely matched `grant.path_permissions[i].path` is contained within the configured canonical runtime root for `request.root` using segment-aware containment, not a raw string-prefix comparison. Sibling-prefix paths such as a canonical `working` root versus a grant rooted under `working-copy` must not be treated as aligned. A mismatched pair such as `root = "working"` with a grant path under the canonical `bedrock` root, or `root = "bedrock"` with a grant path under the canonical `working` root, is denied as invalid grant. This alignment check remains host-independent and does not consult the filesystem.
  - **Authorization ignores unrelated secret and ambient environment noise**: When `workspaceRoots`, the matched `grant.path_permissions` entry, and `request` are held constant, the helper must return the same authorization result regardless of unrelated `grant.env_secret_handles` contents or unrelated ambient `process.env` values. Authorization remains a pure workspace-path decision rather than a secret-resolution or environment-variable decision.
  - **Capability matching**: Once a unique permission-root match exists, its root path is validated, and its logical-area alignment against the canonical runtime root for `request.root` succeeds, the requested `request.capability` must be present in `entry.capabilities`; otherwise the helper returns ordinary policy denial.
  - **Relative-path enforcement**: `request.relativePath` must be relative to the granted root. The helper denies:
    - absolute POSIX-style paths (`/tmp/x`)
    - absolute Windows-style paths (`C:\\tmp\\x`)
    - Windows drive-relative paths (`C:temp\\file`, `c:..\\escape.txt`) before lexical normalization
    - Windows single-leading-backslash root-relative paths (`\\temp\\x`)
    - UNC-style paths (`\\server\\share`)
    - extended Windows namespace forms (`\\?\C:\foo`, and the same bounded treatment for other `\\?\` or `\\.\` namespace-prefixed inputs)
    - any path whose lexical normalization would escape above the granted root via either `/` or `\\` traversal segments
  - **Host-independent lexical containment is segment-aware**: The helper classifies and normalizes containment lexically before any host-specific path API call. It treats both `/` and `\\` as separators for `request.relativePath`, rejects POSIX absolute, Windows drive-qualified absolute, Windows drive-relative, Windows single-leading-backslash root-relative, UNC, and extended Windows namespace forms by string inspection, and does so before collapsing `.` or processing `..`. After that pre-classification step, it collapses `.` segments and processes `..` segments lexically. If a `..` segment would move above the root, the helper returns path escape. Final resolved-path containment under the granted root must also be segment-aware rather than raw string-prefix-based, so normalized escapes like `../working-copy/file` or `..\\working-copy\\file` are denied even if the rendered absolute string would start with the same characters as the granted root. Host `path` APIs may only be used after this lexical containment decision to render the final absolute path under the already-authorized grant root.
  - **Resolved path shape**: An allowed result returns a normalized absolute path rooted under the uniquely matched `grant.path_permissions[i].path` after segment-aware containment has already succeeded. Empty `relativePath` is allowed and resolves to the granted root itself.
  - **No filesystem I/O**: The helper does not stat, read, write, create, delete, or probe files. It authorizes paths only.
  - **Behavioral proof over lint proof**: Authoritative proof that the helper is independent of ambient host state lives in deterministic behavioral tests, not in slice-specific ESLint payload assertions. If the implementation keeps or adds a narrow lint restriction for the guarded module, that lint is defense in depth only and does not replace the behavioral proof requirement.
  - **No secret or network behavior**: The helper does not resolve secret handles, inspect environment variables, or inspect `network_policy` at all.
  - **Internal seam ownership only**: This slice proves the internal environment seam consumed later by the native execution driver. It does not require package-root exports and does not by itself satisfy execution-time admission wiring.
  - The slice does NOT implement subprocess spawning, tool execution, execution-driver admission wiring, artifact storage, `tool.blocked` event emission, maintenance-mode bedrock writes, or secret injection.
- Inputs crossing the boundary:
  - canonical runtime `WorkspaceRootsDTO`
  - `ExecutionGrantDTO` from `@argentum/contracts`
  - helper-local request data describing the requested logical root, relative path, and capability
- Outputs crossing the boundary:
  - helper-local allow-or-deny authorization result consumed by the later native execution-driver seam
  - an internal environment helper module or internal admission seam; no package-root export requirement

## Plan

- First contracts or interfaces to create:
  - helper entrypoint parameter that carries canonical `WorkspaceRootsDTO` plus grant and request inputs
  - helper-local request interface or equivalent internal parameter shape
  - helper-local denial code union or equivalent deterministic denied-result shape
  - helper-local allow-or-deny result union
  - internal `authorizeWorkspacePath(workspaceRoots, grant, request)` entrypoint for the environment package to consume later
- Minimal implementation shape:
  1. Create `packages/environment/src/workspace-path-guard.ts` or an equivalent internal helper module under `packages/environment/src/`.
  2. Import `ExecutionGrantDTO`, `WorkspaceRootsDTO`, `PathRoot`, and `Capability` from `@argentum/contracts`, plus `path` from `node:path`.
  3. Define the helper-local request and result shapes in that internal module, plus the internal seam shape that receives canonical runtime workspace roots. If exported from the module for local testability, keep them internal to the environment package and do not widen `packages/environment/src/index.ts`.
    4. Add a small internal lexical containment helper for `request.relativePath` that:
      - recognizes POSIX absolute, Windows drive-qualified absolute, Windows drive-relative, Windows single-leading-backslash root-relative, UNC, and extended Windows namespace forms without consulting host path semantics
      - treats both `/` and `\\` as separators
      - rejects drive-relative inputs such as `C:temp\\file` and `c:..\\escape.txt` before any dot-segment normalization
      - collapses `.` segments and processes `..` segments lexically
      - enforces segment-aware containment instead of raw string-prefix checks so sibling-prefix paths never count as in-root
      - returns either normalized relative segments or a stable denied result before any host `path` API is called
    5. Implement `authorizeWorkspacePath(workspaceRoots, grant, request)`:
      - Return denied immediately when `grant.approval_mode === "deny"`.
      - Find all `grant.path_permissions` entries matching `request.root`; if none exist, return ordinary policy denial, and if more than one exists, return deterministic invalid-grant denial.
      - Validate the uniquely matched permission entry immediately after unique-root selection and before capability matching. Reject relative, Windows drive-relative, Windows current-drive-rooted single-leading-backslash, or otherwise non-absolute or malformed `entry.path` values as invalid grant so malformed-grant classification wins over any would-be capability denial.
      - Lexically verify that the validated `entry.path` is contained within `workspaceRoots[request.root]` before capability approval using segment-aware containment rather than raw string-prefix matching. If it is rooted under a different logical-area root, or only shares a sibling-prefix such as `working` versus `working-copy`, return invalid grant.
      - Check the requested capability against the validated and aligned entry's `capabilities`; if absent, return ordinary policy denial.
      - Run the host-independent lexical containment helper before any host `path` call; reject absolute, drive-qualified, drive-relative, single-leading-backslash root-relative, UNC-style, and extended Windows namespace filesystem forms before host-native rendering, and reject lexical escapes via either separator form.
      - Render the absolute path only after lexical containment succeeds, using the absolute grant root plus the normalized relative segments so host APIs do not participate in the allow-or-deny decision.
      - Return the allowed branch with the resolved absolute path.
  6. Add any small internal helpers needed for containment checks, keeping the module self-contained and side-effect-free.
  7. Keep any slice-specific lint restriction narrow and optional. If such a lint rule exists, treat it as defense in depth only; do not add a slice-specific config-assertion script or negative lint fixture as the primary proof of host independence.
  8. Create `packages/environment/tests/workspace-path-guard.test.ts` with focused environment-layer tests that import the internal helper seam directly from the owning environment source path, including host-independent denied-form coverage, explicit positive and negative canonical-root alignment cases in both slash styles, duplicate-root malformed-grant handling, direct dot-segment normalization, lexical separator normalization, explicit proof that `network_policy`, `env_secret_handles`, and unrelated ambient `process.env` values are not consulted, and cwd-independence checks that restore the original cwd inside each test.
  9. Run cwd-mutating cases under `describe.sequential(...)` or an equivalent isolated harness, following the existing environment precedent in `packages/environment/tests/runtime-startup-config.test.ts`.
  10. Leave execution-driver admission wiring to a later environment-owned native-driver slice once the helper contract is validated.
- Required tests:
  - **Grant deny short-circuit beats forbidden request paths**: `approval_mode = "deny"` returns deny-first even when `request.relativePath` is a forbidden absolute or drive-relative form.
  - **Grant deny short-circuit beats malformed grant roots**: `approval_mode = "deny"` returns deny-first even when the matching permission entry uses a malformed root path.
  - **Grant deny short-circuit beats duplicate matching roots**: `approval_mode = "deny"` returns deny-first even when `grant.path_permissions` contains duplicate entries for the requested root.
  - **Bedrock read allowed**: a `bedrock` plus `read` request with a matching permission returns allowed and the absolute path remains under the granted bedrock root.
  - **Bedrock capability matching stays ordinary**: a `bedrock` plus `write` request against the canonical upstream `bedrock` permission shape returns ordinary capability denial, not a helper-specific bedrock rule.
  - **Working write allowed**: a `working` plus `write` request with matching permission returns allowed.
  - **Artifacts write allowed**: an `artifacts` plus `write` request with matching permission returns allowed.
  - **Logs append allowed**: a `logs` plus `append` request with matching permission returns allowed.
  - **Logs write denied when only append is granted**: returns ordinary capability denial.
  - **Missing root permission denied as ordinary policy**: zero matching permission entries for the requested root returns ordinary policy denial, not invalid grant.
  - **Duplicate root permission denied as malformed grant**: more than one matching permission entry for the same logical root returns invalid grant.
  - **Relative grant root denied as malformed input**: a uniquely matched permission entry with a relative `path` returns invalid grant.
  - **Windows drive-relative grant root denied as malformed input**: a uniquely matched permission entry with `path = "C:temp\\root"` returns invalid grant.
  - **Windows current-drive-rooted grant root denied as malformed input**: a uniquely matched permission entry with `path = "\\temp\\root"` returns invalid grant.
  - **Working root mislabeled into bedrock is denied as invalid grant**: a `request.root = "working"` permission entry whose `path` is lexically contained by the canonical `bedrock` root and not the canonical `working` root returns invalid grant before capability approval.
  - **Bedrock root mislabeled into working is denied as invalid grant**: a `request.root = "bedrock"` permission entry whose `path` is lexically contained by the canonical `working` root and not the canonical `bedrock` root returns invalid grant before capability approval.
  - **Canonical-root descendant alignment is allowed in a POSIX-style nested-root case**: a canonical root such as `/workspace/working` and a matched grant root such as `/workspace/working/project-a` are treated as aligned descendants rather than mismatches, so authorization can proceed to capability and relative-path checks.
  - **Canonical-root descendant alignment is allowed in a Windows-style nested-root case**: a canonical root such as `C:\\workspace\\working` and a matched grant root such as `C:\\workspace\\working\\project-a` are treated as aligned descendants rather than mismatches, so authorization can proceed to capability and relative-path checks.
  - **Canonical-root sibling-prefix collision is denied in POSIX-style paths**: a canonical `working` root such as `/workspace/working` must not treat a matched grant path under `/workspace/working-copy/...` as aligned; the helper returns invalid grant rather than accepting a raw prefix match.
  - **Canonical-root sibling-prefix collision is denied in Windows-style paths**: a canonical `working` root such as `C:\\workspace\\working` must not treat a matched grant path under `C:\\workspace\\working-copy\\...` as aligned; the helper returns invalid grant rather than accepting a raw prefix match.
  - **Logical-area mislabel classification wins before capability matching**: a mismatched canonical-root pairing returns invalid grant even when `request.capability` is absent from `entry.capabilities`.
  - **Malformed grant classification wins before capability matching**: a uniquely matched malformed permission root returns invalid grant even when `request.capability` is absent from `entry.capabilities`.
  - **Missing capability**: request for an ungranted capability on a granted root returns ordinary capability denial.
  - **POSIX absolute path rejected host-independently**: `relativePath = "/tmp/x"` is denied even on non-POSIX hosts.
  - **Windows drive-qualified path rejected host-independently**: `relativePath = "C:\temp\x"` is denied even on non-Windows hosts.
  - **Uppercase Windows drive-relative path rejected before normalization**: `relativePath = "C:temp\file"` is denied before any lexical dot-segment handling.
  - **Lowercase Windows drive-relative path rejected before normalization**: `relativePath = "c:..\escape.txt"` is denied before any lexical traversal handling.
  - **Windows single-leading-backslash root-relative path rejected host-independently**: `relativePath = "\\temp\\x"` is denied.
  - **UNC path rejected host-independently**: `relativePath = "\\\\server\\share\\x"` is denied.
  - **Extended Windows `\\?\\` namespace path rejected host-independently**: `relativePath = "\\\\?\\C:\\foo"` is denied.
  - **Extended Windows `\\.\\` namespace path rejected host-independently**: `relativePath = "\\\\.\\COM1"` or an equivalent `\\.\\`-prefixed filesystem-form request is denied.
  - **Path traversal rejected**: `relativePath = "../escape.txt"` returns path escape.
  - **Windows-style path traversal rejected host-independently**: `relativePath = "..\\escape.txt"` returns path escape even on non-Windows hosts.
  - **Normalized sibling-prefix escape rejected with slash separators**: `relativePath = "../working-copy/file"` returns path escape because segment-aware containment must not treat the normalized result as still under the granted `working` root.
  - **Normalized sibling-prefix escape rejected with backslash separators**: `relativePath = "..\\working-copy\\file"` returns path escape because segment-aware containment must not treat the normalized result as still under the granted `working` root.
  - **Single dot resolves to the granted root**: `relativePath = "."` returns allowed and resolves to the granted root path.
  - **Nested dot segments normalize lexically**: `relativePath = "./nested/./file.txt"` returns the same allowed path as `nested/file.txt`.
  - **Lexical separator normalization is host-independent**: equivalent paths such as `subdir/../file.txt` and `subdir\\..\\file.txt` normalize to the same allowed result under the granted root.
  - **Empty relative path allowed**: `relativePath = ""` resolves to the granted root path.
  - **Determinism**: repeated calls with identical `grant` plus `request` return structurally identical results.
  - **Network policy is ignored by the helper**: identical requests with different `grant.network_policy` values return the same authorization result because this helper does not inspect network posture.
  - **Secret handles are ignored by the helper**: identical `workspaceRoots`, matching `path_permissions`, and `request` with different `grant.env_secret_handles` arrays return the same authorization result because this helper does not resolve or inspect secret handles.
  - **Ambient `process.env` noise is ignored by the helper**: identical `workspaceRoots`, matching `path_permissions`, and `request` still return the same authorization result when unrelated environment variables are added, removed, or changed around the call, and the test restores the original variable state before completion.
  - **Ambient host-state proof is behavioral**: changing cwd between calls does not change allow-or-deny outcomes for valid grants, malformed grant roots, or logical-area-mislabeled grant roots when `workspaceRoots`, `grant`, and `request` are otherwise identical.
  - **Cwd independence for valid grants**: the test captures the original cwd, changes `process.cwd()` within an isolated restore block, restores the original cwd before completion, and still gets the same result when the matching grant root is absolute.
  - **Cwd independence for invalid grants**: the test captures the original cwd, changes `process.cwd()` within an isolated restore block, restores the original cwd before completion, and still returns invalid grant for a relative grant root.
  - **Cwd-mutating tests run sequentially or equivalently isolated**: cwd-mutating cases use `describe.sequential(...)` or an equivalent isolation harness, following the precedent in `packages/environment/tests/runtime-startup-config.test.ts`, and restore the original cwd in test-local cleanup so repeated or reordered execution cannot leak process state across cases.
  - **Root separation**: the same `relativePath` resolves under different granted roots to different absolute paths rooted in those respective logical areas.
  - **Internal seam coverage proves the owning module**: focused environment tests import the internal helper seam directly rather than proving a package-root export surface.
- Narrow validation step:
  - `pnpm exec eslint packages/environment/src/workspace-path-guard.ts packages/environment/tests/workspace-path-guard.test.ts`
  - `pnpm --filter @argentum/environment test -- workspace-path-guard` with explicit assertions covering positive descendant alignment, sibling-prefix rejection, and invariance to `network_policy`, `env_secret_handles`, unrelated ambient `process.env` noise, and cwd changes
  - `pnpm --filter @argentum/environment build`

## Execution Strategy

- Autopilot suitability: **safe**. The slice has one clear owner (`environment`), one bounded internal seam, deterministic inputs and outputs, no filesystem I/O, and a focused validation target that does not depend on package-root publication.
- Parallel subagent recommendation:
  - **Read-only risk review**: independently verify that canonical-root alignment, denied-form classification, and malformed-grant precedence still map cleanly to [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md), [docs/spec/40-modules/environment/sandbox-model.md](../../spec/40-modules/environment/sandbox-model.md), [docs/spec/40-modules/environment/grant-resolution.md](../../spec/40-modules/environment/grant-resolution.md), and the canonical `workspace_roots` contract.
- Planning artifact paths:
  - [docs/implementation/slices/0039-environment-workspace-path-guard.md](./0039-environment-workspace-path-guard.md)
  - [docs/implementation/backlog.md](../backlog.md)
- Risks and out-of-scope items:
  - Real subprocess or host-tool execution
  - Container isolation
  - Secret-handle resolution or injection
  - Network-policy enforcement inside a process
  - `tool.blocked` event emission
  - Artifact persistence or retrieval
  - Environment-owned execution-driver or environment-owned admission-seam integration wiring, including call-site admission enforcement
  - Maintenance-mode bedrock mutation
  - Risk: a later environment-owned native-driver slice must consume this seam without widening it into an unnecessary public package boundary
- Deferred decisions that must remain deferred:
  - Maintenance-mode semantics for bedrock mutation
  - Exact host execution-driver implementation strategy beyond this guard seam
  - Exact initial tool catalog included in MVP

## Review Log

- 2026-05-25 approval review: No CRITICAL, HIGH, MEDIUM, or LOW findings remained. The card is approval-ready as written.
- 2026-05-25 implementation refinement: Added `packages/environment/src/workspace-path-guard.ts` as an internal environment helper seam with helper-local request and result shapes, host-independent lexical request-path classification, deterministic invalid-grant handling, and segment-aware canonical-root alignment before capability checks.
- 2026-05-25 implementation refinement: Added `packages/environment/tests/workspace-path-guard.test.ts` with focused environment-boundary coverage for deny-first precedence, malformed and duplicate grant roots, canonical-root descendant and sibling-prefix cases in POSIX and Windows forms, lexical traversal rejection, deterministic separator normalization, and invariance to `network_policy`, `env_secret_handles`, ambient `process.env` noise, and cwd changes.
- 2026-05-25 validation refinement: Added `packages/environment/tests/tsconfig.json` so the required ESLint project-service command can type-check the focused test file without widening the package build output.
- 2026-05-25 validation refinement: Tightened the unique matched-entry narrowing in `authorizeWorkspacePath(...)` after the package build surfaced a strict TypeScript undefined check on the selected permission entry.
- 2026-05-25 adversarial review: A read-only subagent review did not surface any concrete HIGH, MEDIUM, or LOW findings against the implemented helper or its focused tests.
- 2026-05-25 refinement: The authoritative spec now places workspace-path authorization in an environment-internal helper or internal admission seam used by the native execution driver. The card removes all requirements to re-export `authorizeWorkspacePath` or helper-local types from the `@argentum/environment` package root.
- 2026-05-25 refinement: The card now anchors lexical containment directly to the approved spec rule that authorization happens by host-independent lexical inspection before any host-native path rendering. Deterministic denied-form coverage and lexical traversal handling remain required.
- 2026-05-25 refinement: Acceptance criteria, outputs, required tests, and validation now prove the internal environment seam through focused module tests and deterministic build or lint gates instead of package-entrypoint smoke tests or type re-export checks.
- 2026-05-25 review refinement: The helper seam now receives canonical runtime workspace roots owned by environment and must lexically verify that the matched grant path aligns with the configured canonical root for the requested logical area before capability approval. Focused negative coverage now includes mislabeled pairs such as `working -> bedrock` and `bedrock -> working`.
- 2026-05-25 review refinement: The helper seam now consumes canonical `WorkspaceRootsDTO` directly rather than an equivalent environment-owned shape, keeping the planning boundary pinned to the canonical workspace-roots contract.
- 2026-05-25 review refinement: Canonical-root alignment and final resolved-path containment are now explicitly specified as segment-aware lexical checks rather than raw string-prefix comparisons. Focused negative coverage now includes sibling-prefix collisions in both slash styles, including `working` versus `working-copy` and normalized escapes such as `../working-copy/file` and `..\\working-copy\\file`.
- 2026-05-25 review refinement: Canonical-root alignment coverage now also requires explicit positive descendant-under-root proofs in both slash styles, so aligned nested grant roots are proven rather than inferred from the negative mismatch cases.
- 2026-05-25 review refinement: Slice-specific lint is now defense in depth only. The authoritative proof that the guarded module does not depend on ambient host state moved into deterministic behavioral tests rather than exact ESLint payload assertions or negative lint fixtures.
- 2026-05-25 review refinement: Required denied-form coverage now pins both Windows namespace-prefixed request forms, `\\?\\` and `\\.\\`, instead of treating `\\.\\` as implied.
- 2026-05-25 review refinement: Cwd-independence coverage now requires `describe.sequential(...)` or equivalent isolation for cwd-mutating cases, citing the existing environment precedent in `packages/environment/tests/runtime-startup-config.test.ts`, plus test-local cwd restoration so the cases stay isolated and non-order-dependent.
- 2026-05-25 review refinement: The helper is now explicitly specified to ignore `network_policy` entirely; network posture remains downstream execution-driver behavior rather than workspace-path authorization input.
- 2026-05-25 review refinement: Behavioral invariance coverage now explicitly includes unrelated `env_secret_handles` values and unrelated ambient `process.env` noise, with `workspaceRoots`, matching `path_permissions`, and `request` held constant so authorization purity is proven against secret and environment-variable noise.
- 2026-05-25 retained hardening: Duplicate logical-root entries and malformed granted roots remain deterministic invalid-grant cases, while missing requested roots remain ordinary policy denial.
- 2026-05-25 retained hardening: The slice stays helper-only. Execution-driver admission wiring, blocked result mapping, and any broader published boundary remain downstream environment work.