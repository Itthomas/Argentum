# Argentum Operator Guide

This guide describes how to configure, launch, and troubleshoot the Argentum MVP runtime. It is written for operators who deploy and maintain Argentum but are not contributors to the codebase.

For normative rules and design rationale, follow the links to the spec tree. This guide focuses on operational how-to.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Runtime Config Reference](#runtime-config-reference)
   - [Top-Level Sections](#top-level-sections)
   - [`workspace`](#workspace)
   - [`provider`](#provider)
   - [`governor`](#governor)
   - [`gateway`](#gateway)
   - [`tool_policy`](#tool_policy)
   - [`telemetry`](#telemetry)
   - [`features`](#features)
3. [Workspace Layout](#workspace-layout)
   - [Logical Areas](#logical-areas)
   - [Root Distinctness Constraint](#root-distinctness-constraint)
   - [Path Resolution](#path-resolution)
4. [Session Lifecycle](#session-lifecycle)
5. [Provider Configuration: DeepSeek](#provider-configuration-deepseek)
6. [Tool Management](#tool-management)
   - [`trusted_local_mode`](#trusted_local_mode)
   - [`enabled_tools`](#enabled_tools)
   - [`enabled_secret_handles`](#enabled_secret_handles)
   - [`max_tool_runtime_ms`](#max_tool_runtime_ms)
7. [Secret Handles](#secret-handles)
8. [Governor Tuning](#governor-tuning)
9. [Feature Flags](#feature-flags)
10. [Telemetry Configuration](#telemetry-configuration)
11. [Startup Errors and Troubleshooting](#startup-errors-and-troubleshooting)

---

## Quick Start

1. Copy `config/runtime.example.json` to `config/runtime.json`.
2. Edit `config/runtime.json` for your environment.
3. Set the `ARGENTUM_SECRET_HANDLES` environment variable if any tools require secrets (see [Secret Handles](#secret-handles)).
4. Launch the runtime. The process reads `config/runtime.json` from the working directory by default.

The canonical starting point is [`config/runtime.example.json`](../config/runtime.example.json). All fields in that file represent a valid minimal configuration.

---

## Runtime Config Reference

Argentum MVP reads one JSON configuration document at startup. The document must validate against the `RuntimeConfigDTO` contract defined in [`docs/spec/20-contracts/runtime-config.md`](spec/20-contracts/runtime-config.md).

### Top-Level Sections

| Section | Required | Purpose |
| --- | --- | --- |
| `workspace` | **yes** | Binds logical storage roots |
| `provider` | **yes** | Selects and configures the LLM provider |
| `governor` | **yes** | Supplies default turn-governor limits |
| `gateway` | **yes** | Supplies queue and session-admission defaults |
| `tool_policy` | **yes** | Supplies runtime tool and secret policy inputs |
| `telemetry` | **yes** | Supplies log and event persistence settings |
| `features` | **no** | Supplies explicit MVP feature toggles |

If a required section is missing, startup fails with `config_invalid_shape`. Unknown top-level keys are rejected.

---

### `workspace`

Defines the four logical filesystem roots. All four fields are **required** strings.

| Field | Type | Purpose |
| --- | --- | --- |
| `bedrock_root` | string | Path to immutable operator-authored bootstrap files (personas, policies, manifests) |
| `working_root` | string | Path to agent-writable scratch space (notes, plans, transient outputs) |
| `artifacts_root` | string | Path where raw tool outputs and traces are stored |
| `logs_root` | string | Path where append-only telemetry and diagnostics are written |

**Example** (from `runtime.example.json`):

```json
"workspace": {
  "bedrock_root": "./runtime/bedrock",
  "working_root": "./runtime/working",
  "artifacts_root": "./runtime/artifacts",
  "logs_root": "./runtime/logs"
}
```

Paths may be relative (resolved from the runtime working directory) or absolute. All four resolved roots must be distinct and non-nested (see [Root Distinctness Constraint](#root-distinctness-constraint)).

---

### `provider`

Configures the LLM provider. Three fields are **required**; two are **optional**.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `name` | string | **yes** | Provider identifier. MVP supports only `"deepseek"`. |
| `model_id` | string | **yes** | Concrete model identifier (e.g., `"deepseek-chat"`). |
| `endpoint` | string | **yes** | Provider API endpoint or local gateway URL. |
| `temperature` | number | **no** | Default inference temperature. Omit to use the adapter default (`0`). |
| `max_output_tokens` | integer | **no** | Default output token budget. Omit to use the adapter default (`4096`). |

**Example**:

```json
"provider": {
  "name": "deepseek",
  "model_id": "deepseek-chat",
  "endpoint": "https://api.deepseek.com",
  "temperature": 0,
  "max_output_tokens": 4096
}
```

See [Provider Configuration: DeepSeek](#provider-configuration-deepseek) for operational guidance.

---

### `governor`

Supplies the default turn-governor limits stamped into every turn budget. All three fields are **required** integers.

| Field | Type | Purpose |
| --- | --- | --- |
| `max_inference_steps` | integer | Maximum inference steps (LLM calls) per turn |
| `max_repair_attempts` | integer | Maximum canonical repair attempts per turn |
| `max_wall_clock_ms` | integer | Maximum wall-clock time per turn, in milliseconds |

**Example** (defaults from `runtime.example.json`):

```json
"governor": {
  "max_inference_steps": 12,
  "max_repair_attempts": 3,
  "max_wall_clock_ms": 600000
}
```

See [Governor Tuning](#governor-tuning) for guidance on adjusting these values.

---

### `gateway`

Controls session admission and queue behavior. Both fields are **required**, and both values are **frozen in MVP**.

| Field | Type | Frozen Value | Purpose |
| --- | --- | --- | --- |
| `max_queued_ingress_per_session` | integer | **`8`** | Maximum queued ingress items per session. **MVP-frozen.** |
| `queue_overflow_policy` | string | **`"reject_newest"`** | Overflow behavior when the queue is full. **MVP-frozen.** |

**Example** (must match exactly):

```json
"gateway": {
  "max_queued_ingress_per_session": 8,
  "queue_overflow_policy": "reject_newest"
}
```

- Setting `max_queued_ingress_per_session` to any value other than `8` causes startup to fail with `config_invalid_runtime_rules`.
- Setting `queue_overflow_policy` to any value other than `"reject_newest"` causes startup to fail with `config_invalid_shape`.
- These constraints are frozen per [`docs/spec/00-overview/mvp-scope.md`](spec/00-overview/mvp-scope.md). Do not change them.

For the normative session lifecycle rules, see [`docs/spec/40-modules/gateway/queueing-and-locking.md`](spec/40-modules/gateway/queueing-and-locking.md).

---

### `tool_policy`

Controls which tools are available, which secrets they may access, and how tool grants are resolved. All four fields are **required**.

| Field | Type | Purpose |
| --- | --- | --- |
| `enabled_tools` | array of strings | Namespace-qualified tool names allowed at runtime |
| `enabled_secret_handles` | array of strings | Secret handles the runtime expects to be available |
| `max_tool_runtime_ms` | integer | Global maximum tool execution time, in milliseconds |
| `trusted_local_mode` | boolean | Controls automatic tool-approval behavior |

**Example**:

```json
"tool_policy": {
  "enabled_tools": [],
  "enabled_secret_handles": [],
  "max_tool_runtime_ms": 30000,
  "trusted_local_mode": true
}
```

See [Tool Management](#tool-management) for detailed operational guidance, and [`docs/spec/40-modules/environment/grant-resolution.md`](spec/40-modules/environment/grant-resolution.md) for the normative grant-resolution rules.

---

### `telemetry`

Controls event logging and persistence. Both fields are **required**.

| Field | Type | Valid Values | Purpose |
| --- | --- | --- | --- |
| `format` | string | `"jsonl"` (only) | Output format for telemetry events |
| `persist_events` | boolean | `true` or `false` | Whether events are written durably to disk |

**Example**:

```json
"telemetry": {
  "format": "jsonl",
  "persist_events": true
}
```

Telemetry output is written to the `logs_root` workspace area. Each session produces one file named `<session_id>.jsonl`. See [Telemetry Configuration](#telemetry-configuration).

---

### `features`

Feature toggles for MVP. This entire section is **optional**. If present, it contains one **optional** field.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `enable_native_tool_calling` | boolean | **no** | Whether the LLM adapter uses provider-native tool-calling APIs |

**Example**:

```json
"features": {
  "enable_native_tool_calling": true
}
```

Omitting the `features` section entirely is valid. Omitting `enable_native_tool_calling` within the section is also valid. See [Feature Flags](#feature-flags).

---

## Workspace Layout

### Logical Areas

Argentum uses four logical workspace areas, defined in [`docs/spec/40-modules/environment/workspace-model.md`](spec/40-modules/environment/workspace-model.md):

| Area | Config Field | Purpose | Agent Access |
| --- | --- | --- | --- |
| **bedrock** | `workspace.bedrock_root` | Operator-authored immutable bootstrap files (personas, policies, static tool manifests) | **Read-only**. The agent may read bedrock files but cannot modify, delete, or replace them during normal MVP operation. |
| **working** | `workspace.working_root` | Agent-writable scratch space for notes, plans, and transient outputs | Read + write. |
| **artifacts** | `workspace.artifacts_root` | Raw tool outputs and traces referenced by contracts | Read + write. |
| **logs** | `workspace.logs_root` | Append-only runtime telemetry and diagnostics | Append-only. |

Bedrock immutability is a frozen MVP rule (see [`docs/spec/40-modules/environment/immutable-bedrock.md`](spec/40-modules/environment/immutable-bedrock.md)). Do not place files the agent needs to modify into `bedrock_root`. Proposed future bedrock changes must be expressed as artifacts or patches in the `working` or `artifacts` areas.

### Root Distinctness Constraint

All four resolved workspace roots must be **distinct and non-nested**. No root may equal or be a subdirectory of another root after path resolution and normalization.

**Invalid examples:**

- `bedrock_root` = `./runtime/bedrock` and `working_root` = `./runtime/bedrock/working` — nesting violation (`working` is inside `bedrock`)
- `bedrock_root` = `./data` and `artifacts_root` = `./data` — equality violation

**Valid example** (from `runtime.example.json`):

```
bedrock_root:   ./runtime/bedrock
working_root:   ./runtime/working
artifacts_root: ./runtime/artifacts
logs_root:      ./runtime/logs
```

If roots overlap or are identical, startup fails with `workspace_roots_not_distinct`.

### Path Resolution

Relative paths in `workspace.*_root` are resolved from the runtime process's working directory at startup. Absolute paths are used as-is. On Windows, path comparison is case-insensitive.

The lexical authorization step (which enforces path containment for tool grants) treats both `/` and `\` as separators and rejects absolute POSIX paths, Windows drive-qualified paths, UNC paths, and other non-relative forms. See [`docs/spec/40-modules/environment/workspace-model.md`](spec/40-modules/environment/workspace-model.md) for the full lexical rules.

---

## Session Lifecycle

Session admission and queue behavior are defined in [`docs/spec/40-modules/gateway/queueing-and-locking.md`](spec/40-modules/gateway/queueing-and-locking.md). Key operational points:

- **One active turn per session.** At most one turn executes at a time for a given session.
- **FIFO queuing.** When a session is locked (a turn is in progress), new ingress is queued in first-in-first-out order.
- **Queue capacity: 8 items (MVP-frozen).** The maximum number of queued ingress items per session is 8.
- **Overflow policy: `reject_newest` (MVP-frozen).** When the queue is full, the newest (ninth) ingress item is rejected. Earlier queued items are preserved.
- **Lock release.** The session lock is released during the `finalizing` phase, before archival work begins.
- **Queue events.** Queue state changes emit `queue.*` events. Overflow emits `queue.rejected` with the rejected ingress and session identifiers.

Both `max_queued_ingress_per_session` (8) and `queue_overflow_policy` (`"reject_newest"`) are frozen in MVP. Changing them causes startup to fail — see [Startup Errors](#startup-errors-and-troubleshooting).

---

## Provider Configuration: DeepSeek

Argentum MVP ships with a DeepSeek provider adapter. To configure it:

1. Set `provider.name` to `"deepseek"` (the only supported value in MVP).
2. Set `provider.model_id` to your chosen DeepSeek model. `"deepseek-chat"` is the canonical example.
3. Set `provider.endpoint` to the API endpoint. The default DeepSeek API endpoint is `https://api.deepseek.com`. You may point this at a local gateway or proxy if your deployment routes through one.
4. Optionally set `temperature` (a number, typically 0.0–2.0) to control response determinism. `0` gives deterministic outputs.
5. Optionally set `max_output_tokens` (an integer) to cap the LLM response length per call.

**Note:** `features.enable_native_tool_calling` is parsed and validated by the contracts layer but is not yet wired to the DeepSeek adapter in the current MVP release. The adapter always uses its own internal normalization-mode default. Setting this flag has no operational effect. See [Feature Flags](#feature-flags) for details.

API keys and other credentials are handled through the secret-handle system — never place raw secrets in `runtime.json`. See [Secret Handles](#secret-handles).

---

## Tool Management

Tool behavior is governed by the `tool_policy` section and the grant resolver defined in [`docs/spec/40-modules/environment/grant-resolution.md`](spec/40-modules/environment/grant-resolution.md).

### `trusted_local_mode`

Controls whether tool grants are automatically approved or unconditionally denied.

- **`true` (auto-approve):** Tools that are present in `enabled_tools`, whose required secrets are available, and whose path/network constraints fit within policy are granted with `approval_mode = auto_allow`. The grant carries full path permissions, secret handles, and runtime budget.
- **`false` (deny with cascading codes):** Grants are denied in evaluation order: tools not listed in `enabled_tools` receive `tool_disabled`; tools whose required secrets are unavailable receive `secret_unavailable`; tools that pass both checks receive `policy_denied`. No tool execution is permitted regardless.

This behavior is implemented in `resolveGrant()` in `packages/environment/src/grant-resolver.ts`. When `trusted_local_mode` is `true`, the resolver proceeds through the full grant-derivation pipeline (enabled-tool check → secret-intersection check → path-permission derivation → network-policy mapping → runtime ceiling) and then auto-approves. When `false`, the resolver evaluates steps 1–6 normally (deriving path permissions, network policy, and runtime ceiling) and then returns `policy_denied` at step 8 — but only for tools that passed the enabled-tool check (step 1) and secret check (step 2).

In MVP, `trusted_local_mode: true` is the typical operational mode. Set it to `false` only when you want to completely disable tool execution (e.g., for dry-run inspection or pure chat-only operation).

### `enabled_tools`

An array of namespace-qualified tool names (e.g., `"fs.read"`, `"shell.exec"`) that the runtime is allowed to execute.

- Tools not listed here receive denied grants with code `tool_disabled`.
- An empty array `[]` means no tools are enabled.
- Tool names must match exactly the names defined in the tool registry.

### `enabled_secret_handles`

An array of secret handle names that the runtime **expects** to be available. This is the **config-side** declaration. The actual secrets are supplied at the **host level** through the `ARGENTUM_SECRET_HANDLES` environment variable.

- The intersection of a tool's `required_secret_handles` and this list determines which handles are passed to the tool at runtime.
- If a tool requires a handle not present in this list, the grant is denied with code `secret_unavailable`.
- An empty array `[]` means no secrets are expected.

See [Secret Handles](#secret-handles) for the full two-layer interaction.

### `max_tool_runtime_ms`

The global ceiling on tool execution time, in milliseconds. Each tool's individual `default_timeout_ms` is capped by this value. The effective timeout for a granted tool is `min(tool.default_timeout_ms, max_tool_runtime_ms)`.

**Example:** If `max_tool_runtime_ms` is `30000` (30 seconds) and a tool declares `default_timeout_ms: 60000`, the tool will be granted `max_runtime_ms: 30000`.

---

## Secret Handles

Argentum uses a **two-layer secret-handle system** to keep raw secrets out of configuration files.

### Layer 1: Config declaration (`tool_policy.enabled_secret_handles`)

The `enabled_secret_handles` array in `runtime.json` declares which secret **handles** (names) the runtime expects. This is a list of identifiers like `"DEEPSEEK_API_KEY"`, `"GITHUB_TOKEN"`, etc. These are **not** the secret values themselves — only human-readable names.

### Layer 2: Host supply (`ARGENTUM_SECRET_HANDLES` environment variable)

The actual available handles are read from the `ARGENTUM_SECRET_HANDLES` environment variable at startup. This variable contains a list of handle names separated by **newlines**, **commas**, or **semicolons** (any mixture). The runtime splits on the regex pattern `/[\n,;]+/` and trims whitespace from each entry.

**Example:**

```powershell
# PowerShell — semicolon-separated
$env:ARGENTUM_SECRET_HANDLES = "DEEPSEEK_API_KEY;GITHUB_TOKEN"
```

```bash
# Bash — newline-separated via a heredoc or file
export ARGENTUM_SECRET_HANDLES=$'DEEPSEEK_API_KEY\nGITHUB_TOKEN'
```

```bash
# Bash — comma-separated
export ARGENTUM_SECRET_HANDLES="DEEPSEEK_API_KEY,GITHUB_TOKEN"
```

All three delimiters are recognized and can be mixed. Empty entries are ignored. Whitespace around entries is trimmed.

> **Note:** `ARGENTUM_SECRET_HANDLES` is an MVP-specific mechanism. The secret-handle supply path may evolve in future releases.

### Startup Validation

At startup, the runtime checks that every handle listed in `tool_policy.enabled_secret_handles` appears in the `ARGENTUM_SECRET_HANDLES` environment variable. If any expected handle is missing, startup fails with `secret_handles_unavailable`.

If `enabled_secret_handles` is empty, no environment-variable check is performed and `ARGENTUM_SECRET_HANDLES` may be unset.

### Grant-Time Behavior

At grant-resolution time, the effective handles available to a tool are the **intersection** of the tool's `required_secret_handles` and `enabled_secret_handles`. A tool that requires a handle not declared in `enabled_secret_handles` receives a denied grant with code `secret_unavailable`.

---

## Governor Tuning

The `governor` section supplies the default limits stamped into every turn's budget. These are defaults — individual turns may receive overrides through programmatic interfaces, but no such overrides exist in MVP.

| Field | Example Default | Guidance |
| --- | --- | --- |
| `max_inference_steps` | `12` | Maximum LLM calls per turn. Each tool-call round that requires a follow-up inference counts as one step. Increase for complex multi-step tasks; decrease to limit cost. |
| `max_repair_attempts` | `3` | Maximum repair attempts when a tool or inference error is recoverable. Repair attempts are tracked independently from inference steps. |
| `max_wall_clock_ms` | `600000` | Hard wall-clock limit per turn in milliseconds. `600000` = 10 minutes. When exceeded, the turn is terminated. Set lower for tighter latency bounds; set higher for long-running tool sequences. |

**To adjust defaults:** Edit the values in `config/runtime.json`. All three fields are required — you cannot omit them, but you can set them to values appropriate for your workload.

**Relationship between limits:** `max_inference_steps`, `max_repair_attempts`, and `max_wall_clock_ms` are independent limits. `step_count` tracks inference cycles and `repair_attempts_used` tracks repair loops — they use separate counters and do not share a budget. A turn ends when **any** of the three limits (steps, repairs, wall clock) is reached.

The governor uses fixed MVP defaults as described in [`docs/spec/00-overview/mvp-scope.md`](spec/00-overview/mvp-scope.md). These defaults are loose but finite to prevent runaway turns.

---

## Feature Flags

### `features.enable_native_tool_calling`

- **Type:** boolean (optional)
- **Default when omitted:** `false` (the adapter does not use provider-native tool-calling APIs)

When `true`, the DeepSeek provider adapter may pass tool definitions through the provider's native function-calling API rather than relying solely on prompt-engineering or post-processing. The agentic layer always receives normalized internal decisions (`ActionDecisionDTO`) regardless of this setting. The flag only controls the **adapter's internal strategy** for communicating tool options to the model.

When `false` or omitted, the adapter uses an alternative tool-declaration strategy that does not depend on provider-native tool-calling support.

**Operational guidance:**
- Set to `true` for better tool-calling reliability with DeepSeek models that support native function calling.
- Set to `false` if your provider endpoint or model version does not reliably support native tool calling.
- The flag has no effect if `trusted_local_mode` is `false` (all tools are denied regardless).

> **MVP note:** This flag is parsed and validated by the contracts layer but is not yet wired to the DeepSeek adapter at runtime. The adapter always uses its own internal normalization-mode default. Setting this flag has no operational effect in the current MVP release.

The entire `features` section may be omitted from `runtime.json`. If the section is present but `enable_native_tool_calling` is omitted, it defaults to `false`.

---

## Telemetry Configuration

The `telemetry` section controls how runtime events are logged.

| Field | Valid Values | Behavior |
| --- | --- | --- |
| `format` | `"jsonl"` (only) | Events are serialized as newline-delimited JSON. |
| `persist_events` | `true` / `false` | When `true`, events are written durably to disk. When `false`, events are held in memory only (useful for testing or when disk I/O must be minimized). |

### Output Location

Telemetry output files are written to the **`logs_root`** workspace area (the resolved path of `workspace.logs_root`). Each session produces one file named:

```
<session_id>.jsonl
```

For example, if `logs_root` resolves to `./runtime/logs` and the session ID is `a1b2c3d4-e5f6-7890-abcd-ef1234567890`, the telemetry file is:

```
./runtime/logs/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl
```

### Format

Each line is a complete JSON object representing one telemetry event. The JSONL format allows line-by-line streaming, append-only writes, and straightforward post-processing with tools like `jq` or log aggregators.

---

## Startup Errors and Troubleshooting

When the runtime fails to start, it emits an error with one of the following codes. Each code maps to a specific cause and remediation.

### `config_not_found`

**Cause:** The runtime config file does not exist at the expected path.

**Default path:** `./config/runtime.json` (relative to the process working directory).

**Remediation:**
1. Verify that `config/runtime.json` exists.
2. If you placed the config elsewhere, pass the override path when launching the runtime.
3. Copy `config/runtime.example.json` to `config/runtime.json` as a starting point.

### `config_unreadable`

**Cause:** The config file exists but cannot be read (permissions, filesystem error, or the path is a directory).

**Remediation:**
1. Check file permissions — the runtime process needs read access.
2. Verify the path points to a regular file, not a directory.
3. Check for filesystem-level issues (disk full, mount problems).

### `config_invalid_json`

**Cause:** The config file contains text that is not valid JSON.

**Remediation:**
1. Validate the file with a JSON linter or `JSON.parse()`.
2. Common issues: trailing commas, unquoted keys, comments (JSON does not support comments), mismatched braces.
3. Compare against `config/runtime.example.json` for structural reference.

### `config_invalid_shape`

**Cause:** The JSON is valid but does not conform to the `RuntimeConfigDTO` contract.

**Common triggers:**
- Missing a required section (e.g., `workspace`, `provider`, `governor`, `gateway`, `tool_policy`, or `telemetry`).
- Missing a required field within a section.
- A field has the wrong type (e.g., string where an integer is expected).
- A literal field has an unsupported value (e.g., `provider.name` is not `"deepseek"`, `telemetry.format` is not `"jsonl"`, `gateway.queue_overflow_policy` is not `"reject_newest"`).
- Unknown keys are present in any section.

**Remediation:**
1. Review the error details (the runtime reports the specific validation issues with field paths).
2. Compare against the [Runtime Config Reference](#runtime-config-reference) tables above.
3. Use `config/runtime.example.json` as the canonical structural template.

### `config_invalid_runtime_rules`

**Cause:** A frozen MVP rule is violated. Currently, this means `gateway.max_queued_ingress_per_session` is set to a value other than `8`.

**Remediation:**
- Set `gateway.max_queued_ingress_per_session` to `8`. This value is frozen in MVP and cannot be changed.

**Note:** `gateway.queue_overflow_policy` set to anything other than `"reject_newest"` produces `config_invalid_shape` (not `config_invalid_runtime_rules`) because it is enforced by the contract literal-type validator.

### `workspace_roots_not_distinct`

**Cause:** Two or more resolved workspace roots are identical, or one root is a subdirectory of another.

**Remediation:**
1. Check all four `workspace.*_root` paths for overlap.
2. Remember that relative paths are resolved from the process working directory — verify the resolved absolute paths, not just the configured strings.
3. On Windows, path comparison is case-insensitive — `./RUNTIME/bedrock` and `./runtime/bedrock` are considered the same.
4. Ensure the four directories are truly separate (e.g., `./runtime/bedrock`, `./runtime/working`, `./runtime/artifacts`, `./runtime/logs`).

### `secret_handles_unavailable`

**Cause:** One or more handles listed in `tool_policy.enabled_secret_handles` are not present in the `ARGENTUM_SECRET_HANDLES` environment variable.

**Remediation:**
1. Review the error message — it lists the specific missing handles.
2. Set the `ARGENTUM_SECRET_HANDLES` environment variable to include all expected handles.
3. Remember that handles can be separated by newlines, commas, or semicolons.
4. If no secrets are needed, set `enabled_secret_handles` to `[]` — no environment variable check is performed when the list is empty.
5. Verify that handle names match exactly (case-sensitive).

---

## References

- **Config contract:** [`docs/spec/20-contracts/runtime-config.md`](spec/20-contracts/runtime-config.md)
- **Policy contract:** [`docs/spec/20-contracts/runtime-policy.md`](spec/20-contracts/runtime-policy.md)
- **MVP scope (frozen decisions):** [`docs/spec/00-overview/mvp-scope.md`](spec/00-overview/mvp-scope.md)
- **Workspace model:** [`docs/spec/40-modules/environment/workspace-model.md`](spec/40-modules/environment/workspace-model.md)
- **Bedrock immutability:** [`docs/spec/40-modules/environment/immutable-bedrock.md`](spec/40-modules/environment/immutable-bedrock.md)
- **Grant resolution:** [`docs/spec/40-modules/environment/grant-resolution.md`](spec/40-modules/environment/grant-resolution.md)
- **Queueing and locking:** [`docs/spec/40-modules/gateway/queueing-and-locking.md`](spec/40-modules/gateway/queueing-and-locking.md)
- **Canonical example config:** [`config/runtime.example.json`](../config/runtime.example.json)

---

*Guide generated from the validated implementation state as of slices 0001–0049 (2026-05-26).*
