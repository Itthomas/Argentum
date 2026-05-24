# Slice Card

## Status

- State: implemented
- Approval: approved
- Approved by: argentum-implementer (autopilot-safe slice, contract-first)
- Approval date: 2026-05-24
- Phase: 3
- Owner: environment

## Scope

- Slice name: Environment tool result artifact storage
- Target package or boundary: `environment` (`@argentum/environment`)
- Authoritative spec files:
  - [docs/spec/README.md](../../spec/README.md) — entrypoint authority
  - [docs/spec/40-modules/environment/workspace-model.md](../../spec/40-modules/environment/workspace-model.md) — logical areas (bedrock, working, artifacts, logs); "Raw tool artifacts must be storable without entering episodic memory directly"
  - [docs/spec/20-contracts/tool-call-and-result.md](../../spec/20-contracts/tool-call-and-result.md) — `ToolResultDTO` shape with `artifact_refs` and `structured_payload_ref` as `ContentRef[]` slots
  - [docs/spec/20-contracts/content-ref.md](../../spec/20-contracts/content-ref.md) — canonical `ContentRef` shape with `storage_area = "artifacts"`, `locator`, `kind`, `retention`
  - [docs/spec/20-contracts/execution-grant.md](../../spec/20-contracts/execution-grant.md) — `path_permissions` grants `write` on `artifacts` root; artifact storage path is derived from the grant-authorized artifacts root
  - [docs/spec/20-contracts/runtime-policy.md](../../spec/20-contracts/runtime-policy.md) — `RuntimePolicyDTO.workspace_roots.artifacts` provides the concrete filesystem path
  - [docs/spec/50-implementation/package-boundaries.md](../../spec/50-implementation/package-boundaries.md)
  - [docs/spec/50-implementation/test-strategy.md](../../spec/50-implementation/test-strategy.md)
- Acceptance criteria:
  - **Artifact storage function exists**: `@argentum/environment` exports `storeToolArtifact(callId, content, artifactsRoot, kind?, suffix?) → Promise<ContentRef>`.
  - **Filesystem persistence**: The function writes `content` to a file under `<artifactsRoot>/<callId>.<ext>` where `<ext>` is derived from the `kind` parameter. Creates parent directories if they do not exist.
  - **ContentRef shape**: The returned `ContentRef` has:
    - `ref_id`: a unique v4 UUID generated per call
    - `kind`: the provided kind (default `"text"`)
    - `storage_area`: `"artifacts"`
    - `locator`: the relative filename (e.g., `<callId>.json`)
    - `media_type`: derived from kind (`"text/plain"` for `text`, `"application/json"` for `json`, absent for others)
    - `retention`: `"session"` (artifacts tied to session lifecycle in MVP)
  - **Locator is relative**: The `locator` is the filename only, not an absolute path — it is scoped by `storage_area = "artifacts"`.
  - **Deterministic locator**: Two calls with the same `callId` and `kind` (and same optional `suffix` if provided) produce the same `locator` (overwrites the file; idempotent write). Different suffixes produce different locators.
  - **Separate ref_id per call**: Two calls with the same `callId` produce different `ref_id` values (UUID is generated fresh each time).
  - **Bedrock separation**: The artifact store writes only under `artifactsRoot`. It never writes to `bedrock`, `working`, or `logs` areas.
  - **No episodic memory coupling**: The function is a pure I/O utility — it does not depend on session state, episodic memory, the core loop, or any gateway constructs.
  - The slice does NOT wire `storeToolArtifact` into the execution driver, the core loop, `ToolResultDTO` construction, or any runtime pipeline.
- Inputs crossing the boundary:
  - `callId: string` — the tool call identifier (matches `ToolCallDTO.call_id` / `ToolResultDTO.call_id`).
  - `content: string` — the raw tool output to persist.
  - `artifactsRoot: string` — the concrete filesystem path for the artifacts area (from `RuntimePolicyDTO.workspace_roots.artifacts`).
  - `kind?: ContentRefKind` — optional content kind, defaults to `"text"`.
  - `suffix?: string` — optional suffix to disambiguate multiple artifacts for the same `callId`+`kind` pair. When provided, the locator becomes `<callId>-<suffix>.<ext>`. The suffix is validated against `/^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/` (same safe-pattern as callId). Throws if invalid.- Outputs crossing the boundary:
  - `storeToolArtifact(...): Promise<ContentRef>` — public entrypoint.
  - `ARTIFACT_FILE_EXTENSIONS` — constant map from `ContentRefKind` to file extension.
  - `ARTIFACT_KIND_MEDIA_TYPES` — constant map from `ContentRefKind` to MIME-like media type.
  - `CALL_ID_PATTERN` — exported regex for callId/suffix validation (`/^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/`).
  - Exported through `packages/environment/src/index.ts`.

## Plan

- First contracts or interfaces to create:
  - `storeToolArtifact` function signature consuming `callId: string`, `content: string`, `artifactsRoot: string`, `kind?: ContentRefKind`, `suffix?: string`.
  - Internal helpers:
    - `validateIdPart(value: string, label: string): void` — validates a callId or suffix against the safe pattern `/^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/`; throws a descriptive `Error` on mismatch.
    - `artifactFilePath(artifactsRoot: string, callId: string, kind: ContentRefKind, suffix?: string): string` — resolves the absolute file path.
    - `artifactLocator(callId: string, kind: ContentRefKind, suffix?: string): string` — resolves the relative locator (filename only).
    - `mediaTypeForKind(kind: ContentRefKind): string | undefined` — maps kind to MIME type.
- Minimal implementation steps:
  1. Create `packages/environment/src/artifact-store.ts`:
     - Import `ContentRef`, `ContentRefKind` from `@argentum/contracts`.
     - Import `path` from `node:path`.
     - Import `mkdir`, `writeFile` from `node:fs/promises`.
     - Import `randomUUID` from `node:crypto`.
     - Define and export `CALL_ID_PATTERN = /^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/`.
     - Define and export `ARTIFACT_FILE_EXTENSIONS: Record<ContentRefKind, string>`:
       - `"text"` → `".txt"`
       - `"json"` → `".json"`
       - `"trace"` → `".log"`
       - `"file"` → `".bin"`
       - `"blob"` → `".blob"`
     - Define and export `ARTIFACT_KIND_MEDIA_TYPES: Partial<Record<ContentRefKind, string>>`:
       - `"text"` → `"text/plain"`
       - `"json"` → `"application/json"`
       - (others absent)
     - Implement internal `validateIdPart(value: string, label: string): void`:
       - If `!CALL_ID_PATTERN.test(value)`, throw `new Error(`${label} "${value}" contains invalid characters. Must match ${CALL_ID_PATTERN}.`)`.
     - Implement internal `artifactFilePath(artifactsRoot, callId, kind, suffix?): string`:
       - Returns `path.join(artifactsRoot, artifactLocator(callId, kind, suffix))`.
     - Implement internal `artifactLocator(callId, kind, suffix?): string`:
       - If `suffix` is provided, returns `` `${callId}-${suffix}${ARTIFACT_FILE_EXTENSIONS[kind]}` ``.
       - Otherwise returns `` `${callId}${ARTIFACT_FILE_EXTENSIONS[kind]}` ``.
     - Implement internal `mediaTypeForKind(kind): string | undefined`:
       - Returns `ARTIFACT_KIND_MEDIA_TYPES[kind]`.
     - Implement and export `storeToolArtifact(callId, content, artifactsRoot, kind = "text", suffix?): Promise<ContentRef>`:
       1. Call `validateIdPart(callId, "callId")`. If it throws, re-throw.
       2. If `suffix` is provided, call `validateIdPart(suffix, "suffix")`. If it throws, re-throw.
       3. Compute `filePath = artifactFilePath(artifactsRoot, callId, kind, suffix)`.
       4. Compute `dir = path.dirname(filePath)`.
       5. Call `await mkdir(dir, { recursive: true })` to ensure parent directories exist.
       6. Call `await writeFile(filePath, content, "utf-8")` to persist the content.
       7. Build and return a `ContentRef`:
          - `ref_id: randomUUID()`
          - `kind: kind`
          - `storage_area: "artifacts"`
          - `locator: artifactLocator(callId, kind, suffix)`
          - `media_type: mediaTypeForKind(kind)`
          - `retention: "session"`
  2. Update `packages/environment/src/index.ts`:
     - Add barrel exports for `storeToolArtifact`, `ARTIFACT_FILE_EXTENSIONS`, `ARTIFACT_KIND_MEDIA_TYPES`, and `CALL_ID_PATTERN`.
     - Preserve existing exports (`loadRuntimeStartupConfig`, `RuntimeStartupConfigError`, and associated types).
  3. The `environment` package already depends on `@argentum/contracts` at `workspace:*` — no dependency changes needed.
  4. No new configuration, scaffolding, or tooling changes required.
- Required tests:
  - All tests in `packages/environment/tests/artifact-store.test.ts`.
  - **Persistence tests**:
    - Store text content and verify a file exists at the expected path under `artifactsRoot`.
    - Store JSON content with `kind = "json"` and verify file exists with `.json` extension.
    - Read back the stored file and verify content matches exactly.
    - Store with `kind = "trace"` → `.log` extension; `kind = "file"` → `.bin`; `kind = "blob"` → `.blob`.
  - **`parseContentRef` round-trip integrity tests** (H1):
    - Call `storeToolArtifact` with known content, pass the returned `ContentRef` object through `parseContentRef` from `@argentum/contracts`, and assert no error is thrown and all round-tripped fields (`ref_id`, `kind`, `storage_area`, `locator`, `media_type`, `retention`) match the original.
  - **ContentRef shape tests**:
    - Verify returned `ContentRef.storage_area === "artifacts"`.
    - Verify returned `ContentRef.locator` is the filename only (no path separators).
    - Verify returned `ContentRef.kind` matches the input kind.
    - Verify returned `ContentRef.retention === "session"`.
    - Verify `media_type` is `"text/plain"` for `"text"` kind.
    - Verify `media_type` is `"application/json"` for `"json"` kind.
    - Verify `media_type` is `undefined` for `"trace"`, `"file"`, `"blob"` kinds.
  - **UUID uniqueness tests**:
    - Call `storeToolArtifact` twice with the same `callId` and `kind` — verify `ref_id` values differ (fresh UUID each call).
  - **Locator determinism tests**:
    - Call `storeToolArtifact` twice with the same `callId` and `kind` — verify `locator` values are identical.
  - **Directory creation tests**:
    - Use an `artifactsRoot` path where intermediate directories do not exist — verify the function creates them and succeeds.
  - **Default kind tests**:
    - Call `storeToolArtifact` without the `kind` parameter — verify default `kind = "text"` and `.txt` extension.
  - **CallId validation tests** (H2):
    - Pass `callId = "../../../etc/passwd"` — verify the function throws with a descriptive error mentioning the invalid pattern before any filesystem I/O occurs.
    - Pass `callId = "valid-call_01"` — verify no error is thrown.
  - **Suffix parameter tests** (M1):
    - Call `storeToolArtifact` with `suffix = "v2"` and verify locator is `<callId>-v2.<ext>`.
    - Call with suffix `"../../../escape"` — verify path-traversal validation throws.
  - **Bedrock separation tests** (H3 strengthened):
    - Use a temp directory as `artifactsRoot`. After `storeToolArtifact` succeeds, scan the parent directory of `artifactsRoot` (and sibling directories) to verify no files were created outside the `artifactsRoot` tree.
    - Verify the written file's absolute path starts with the resolved `artifactsRoot`.
  - **Error path tests**:
    - Pass an invalid/unwritable `artifactsRoot` path — verify the function throws (e.g., EACCES or ENOENT on a read-only parent).
  - **Package entrypoint smoke test**:
    - Verify `@argentum/environment` exports `storeToolArtifact`, `ARTIFACT_FILE_EXTENSIONS`, `ARTIFACT_KIND_MEDIA_TYPES`, and `CALL_ID_PATTERN` (import and type-check).
- Narrow validation step:
  - `pnpm --filter @argentum/environment test` passes with real (non-vacuous) artifact-store tests.
  - `pnpm --filter @argentum/environment build` succeeds (TypeScript compilation).
  - `pnpm --filter @argentum/environment lint` passes.
  - Manual verification: a test creates a temp directory via `mkdtemp`, calls `storeToolArtifact`, and reads back the file to confirm content integrity.

## Execution Strategy

- Autopilot suitability: **safe**. This slice is:
  - Fully bounded: one function, two constant maps, tests.
  - I/O-only utility: uses `node:fs/promises` `mkdir` and `writeFile` — no exotic dependencies.
  - Contract-consumer only: consumes existing validated `ContentRef`, `ContentRefKind` from `@argentum/contracts`.
  - No dependency on slices 0020 (grant resolver) or 0021 (execution driver) — the function takes `artifactsRoot` as a plain string parameter.
  - No deferred decisions to resolve — local filesystem storage is the MVP decision; artifact path derivation from `RuntimePolicyDTO` is already implemented.
  - Clear acceptance criteria with deterministic test assertions (filesystem I/O tests use `mkdtemp` for isolation).
- Parallel subagent opportunities:
  - **Read-only risk review** (subagent): An adversarial-review subagent can independently verify that the artifact store never writes outside `artifactsRoot` and that the `ContentRef` shape conforms to `content-ref.md`. This can run in parallel with implementation.
  - **Test-harvesting subagent** (read-only): A subagent can extract the exact acceptance criteria from `workspace-model.md` and `content-ref.md` into a checklist and cross-reference against the test plan in this slice card.
- Out of scope:
  - Wiring `storeToolArtifact` into the execution driver or core loop (follow-up integration slice).
  - Constructing `ToolResultDTO` with artifact ContentRefs — the execution driver owns result construction.
  - Artifact lifecycle management (cleanup, retention enforcement, compaction of old artifacts).
  - Artifact size limits or truncation policy.
  - Streaming/chunked artifact writes (MVP writes whole content at once).
  - Artifact retrieval/reading (only storage is in scope; retrieval is deferred to the execution driver or compaction slices).
  - Distributed or blob-store-backed artifact storage (MVP uses local filesystem).
  - Bedrock or working area writes — the artifact store is restricted to the `artifacts` area.
  - Grant derivation or path-permission enforcement — the caller is responsible for providing the correct `artifactsRoot`.
- Deferred decisions that must remain deferred:
  - **Exact local persistence technology** is already decided for this slice: local filesystem under `artifactsRoot`. The deferred decision for "exact local persistence technology for session and queue state" (SQLite) does not apply to artifact storage — the spec explicitly calls for filesystem-based artifact storage in MVP.
  - None triggered by this slice. All consumed contracts (`ContentRef`, `ContentRefKind`, `ToolResultDTO`) are already canonical. The filesystem I/O model is the spec-directed MVP choice.

## Review Log

- Adversarial review findings (by severity: CRITICAL, HIGH, MEDIUM, LOW):
  - **H1**: Missing `parseContentRef` round-trip validation in tests.
  - **H2**: Unsanitized `callId` permits path traversal.
  - **H3**: Bedrock separation test too weak.
  - **M1**: Single artifact per callId+kind limitation.
- Refinements applied:
  - **H1**: Added `parseContentRef` round-trip integrity test to Required tests (call storeToolArtifact, pass returned ContentRef through parseContentRef, assert no error + fields match).
  - **H2**: Added `CALL_ID_PATTERN` regex (`/^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/`) and `validateIdPart()` helper. `storeToolArtifact` now validates `callId` (and optional `suffix`) against this pattern before any filesystem I/O. Added path-traversal test with `callId = "../../../etc/passwd"`.
  - **H3**: Strengthened bedrock separation test: after store, scan parent of `artifactsRoot` to verify no files created outside. Use temp dirs. Added explicit check that written file's absolute path starts with resolved `artifactsRoot`.
  - **M1**: Added optional `suffix?: string` parameter to `storeToolArtifact`. When provided, locator becomes `<callId>-<suffix>.<ext>`. Suffix is validated against `CALL_ID_PATTERN`. Added suffix tests (happy path + path-traversal rejection).

## Implementation Review Log (2026-05-24)

- **Implementation date**: 2026-05-24
- **Implementer**: argentum-implementer (GitHub Copilot)
- **Files changed**:
  - `packages/environment/src/artifact-store.ts` (new, 148 lines)
  - `packages/environment/src/index.ts` (updated, +5 lines for barrel exports)
  - `packages/environment/tests/artifact-store.test.ts` (new, 259 lines, 35 tests)
- **Validation results**:
  - `pnpm --filter @argentum/environment test`: **109 passed** (35 artifact-store, 74 pre-existing), 0 failures
  - `pnpm typecheck`: **clean** (0 errors)
  - `pnpm --filter @argentum/environment build`: succeeds (tsc -b)

### Implementation Review Findings

- **LOW — `buildContentRef` helper does not freeze its return value**: The `storeToolArtifact` function wraps the result with `Object.freeze()`, and the `ContentRef` type uses `readonly` properties. No runtime mutation risk. Accepted as-is.
- **LOW — Error message includes regex source in template literal**: The `validateIdPart` error message interpolates `CALL_ID_PATTERN` which produces `/^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/` — readable and helpful for debugging. No change needed.
- **LOW — `ARTIFACT_KIND_MEDIA_TYPES` typed as `Partial<Record<ContentRefKind, string>>`**: This means `mediaTypeForKind` returns `string | undefined` which requires the `exactOptionalPropertyTypes` workaround via `buildContentRef`. The extra indirection is acceptable for type safety.

### Compliance Verdict

All acceptance criteria met. All H1/H2/H3/M1 refinements from the planning review are implemented:
- ✅ H1: parseContentRef round-trip test (tests line 218–235)
- ✅ H2: callId/suffix validation via CALL_ID_PATTERN (tests lines 115–149)
- ✅ H3: Bedrock separation with parent-directory scan (tests lines 238–261)
- ✅ M1: Suffix parameter with locator `<callId>-<suffix>.<ext>` (tests lines 150–181)
- ✅ All exported constants verified via barrel exports
- ✅ No episodic memory coupling — pure I/O utility
- ✅ No wiring into execution driver, core loop, or runtime pipeline

### Remaining Risks

- None. This slice is self-contained and validation-gated.
- Deferred: artifact lifecycle management, size limits, streaming writes, and retrieval are out of scope per the slice card.
