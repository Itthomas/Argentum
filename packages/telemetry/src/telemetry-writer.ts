import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { StreamEvent } from "@argentum/contracts";

/**
 * Configuration for a {@link TelemetryWriter} instance.
 *
 * Consumers should obtain the `logDir` from the workspace model's `logs/`
 * area. All other fields are supplied by the runtime composition root from
 * validated {@link RuntimeConfigDTO.telemetry}.
 */
export interface TelemetryWriterConfig {
  /** Absolute path to the log output directory (workspace `logs/` area). */
  logDir: string;
  /** Output format — only `"jsonl"` is supported in MVP. */
  format: "jsonl";
  /**
   * When `false`, {@link TelemetryWriter.writeEvent} is a no-op and no
   * log files are created or written.
   */
  persistEvents: boolean;
}

/**
 * Appends {@link StreamEvent} values to a JSONL log file on disk.
 *
 * ## Ordering guarantee
 *
 * Concurrent calls to {@link writeEvent} are serialized via an internal
 * promise chain so that JSONL line order matches call order.  Callers do
 * not need to coordinate externally.
 *
 * ## Re-validation of deserialized events
 *
 * This writer serializes the full `StreamEvent` object via
 * `JSON.stringify`.  When reading events back from a JSONL log,
 * consumers **should** pass each parsed line through
 * {@link parseStreamEvent} (exported from `@argentum/contracts`) to
 * re-validate the deserialized shape — it guards against malformed or
 * tampered log lines that `JSON.parse` alone would accept.
 *
 * ## MVP limitations
 *
 * - No log rotation, size limits, or retention policies.
 * - No structured query interface, indexing, or search.
 * - One log file per session (`<session_id>.jsonl`).
 */
export class TelemetryWriter {
  readonly #config: TelemetryWriterConfig;
  #dirEnsured = false;
  /**
   * Promise chain used to serialize concurrent `writeEvent` calls.
   * Each call chains onto the previous one so that JSONL line order
   * is guaranteed to match call order across concurrent producers.
   *
   * Initialized to a resolved promise so the first write does not need
   * a special case.
   */
  #writeChain: Promise<void> = Promise.resolve();

  constructor(config: TelemetryWriterConfig) {
    this.#config = { ...config };
  }

  /**
   * Appends a single `StreamEvent` as one JSON line to the per-session
   * log file.
   *
   * When `persistEvents` is `false` this is a no-op that returns
   * immediately.
   *
   * @throws The underlying filesystem error if the append fails (disk
   *   full, permission denied, directory creation failure, etc.).
   */
  async writeEvent(event: StreamEvent): Promise<void> {
    if (!this.#config.persistEvents) {
      return;
    }

    // Chain onto the previous write so concurrent callers are
    // serialized and JSONL line order is deterministic.
    const writePromise = this.#writeChain.then(() => this.#doWrite(event));
    // Prevent a single failure from breaking the entire chain —
    // subsequent writes must still be attempted.
    this.#writeChain = writePromise.catch(() => {});
    return writePromise;
  }

  /**
   * Ensures all pending writes are durably persisted.
   *
   * In MVP each `writeEvent` call flushes immediately, so this is a
   * no-op that returns a resolved promise.
   */
  async flush(): Promise<void> {
    // MVP: writes are immediate; nothing to flush.
  }

  // ── private helpers ──────────────────────────────────────────

  async #doWrite(event: StreamEvent): Promise<void> {
    await this.#ensureLogDir();
    const filePath = path.join(this.#config.logDir, `${event.session_id}.jsonl`);
    const line = JSON.stringify(event) + "\n";
    await appendFile(filePath, line, "utf-8");
  }

  async #ensureLogDir(): Promise<void> {
    if (this.#dirEnsured) {
      return;
    }
    await mkdir(this.#config.logDir, { recursive: true });
    this.#dirEnsured = true;
  }
}
