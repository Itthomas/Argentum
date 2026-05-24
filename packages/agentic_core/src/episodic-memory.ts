import {
  type ContextItem,
  type ContextLayer,
  ContextItemValidationError,
  parseContextItem,
} from "@argentum/contracts";

/**
 * Session-scoped in-process episodic memory store.
 *
 * Stores accepted user inputs, committed assistant outputs, compacted tool
 * summaries, artifact references, and repair feedback as `ContextItem` entries.
 *
 * ## Ordering
 *
 * Entries are ordered by insertion (FIFO). {@link getRecent} returns them with
 * the newest entry last (i.e., `getRecent(2)` returns the second-to-last and
 * last entries, in that order).
 *
 * ## Duplicate `context_id`
 *
 * This store does **not** enforce `context_id` uniqueness.  Callers are
 * responsible for supplying unique IDs.  If two entries share the same
 * `context_id` both are stored and can be retrieved independently.
 *
 * ## In-process only
 *
 * Episodic memory is purely in-process — there is no persistence, background
 * summarization worker, or automatic long-term memory writeback in this slice.
 */
export class EpisodicMemory {
  /** Session identifier this store is scoped to. */
  readonly sessionId: string;

  /** Internal array backing the store (insertion order). */
  #entries: ContextItem[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // ── Mutators ─────────────────────────────────────────────────

  /**
   * Validate and store a {@link ContextItem}.
   *
   * Validation is delegated to `parseContextItem` from `@argentum/contracts`,
   * which checks all required fields, literal values, and nested
   * `content_ref` structure.
   *
   * @throws {ContextItemValidationError} if the entry fails validation.
   */
  add(entry: ContextItem): void {
    // parseContextItem returns the validated item or throws
    const validated = parseContextItem(entry);
    this.#entries.push(validated);
  }

  // ── Accessors ─────────────────────────────────────────────────

  /**
   * Return the most recent entries, newest last.
   *
   * @param limit - Maximum number of entries to return.  `0` returns `[]`.
   *   If omitted or greater than the number of entries stored, all entries
   *   are returned.
   * @returns A **shallow copy** of the matching slice — callers cannot mutate
   *   internal state through the returned array.
   */
  getRecent(limit?: number): readonly ContextItem[] {
    if (limit === undefined || limit > this.#entries.length) {
      return [...this.#entries];
    }
    if (limit <= 0) {
      return [];
    }
    return this.#entries.slice(-limit);
  }

  /**
   * Return entries belonging to the given {@link ContextLayer}, ordered by
   * insertion.
   *
   * @returns A **shallow copy** — callers cannot mutate internal state.
   *   Returns `[]` when there are no matches (lenient).
   */
  getByLayer(layer: ContextLayer): readonly ContextItem[] {
    return this.#entries.filter((e) => e.layer === layer);
  }

  /** Total number of entries currently stored. */
  get size(): number {
    return this.#entries.length;
  }
}
