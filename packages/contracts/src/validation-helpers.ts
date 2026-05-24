// ── Shared validation helpers ──────────────────────────────────
// Extracted from content-ref.ts, context-item.ts, execution-grant.ts,
// turn-envelope.ts, stream-event.ts, ingress-contract.ts, message-part.ts,
// action-decision.ts, runtime-config.ts, llm-adapter.ts.
//
// These four functions were byte-identical across all modules.
// parseRequiredString / parseOptionalString / parseRequiredLiteral are
// intentionally NOT extracted — they have different behaviors across modules.

type UnknownRecord = Record<string, unknown>;

/**
 * Returns `true` when `value` is a plain object (not null, not an array,
 * and its prototype is `Object.prototype` or `null`).  Class instances,
 * arrays, and primitives all return `false`.
 */
export function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Joins a parent path and a child key with `"."`.
 *
 * @example joinPath("grant", "max_runtime_ms") → "grant.max_runtime_ms"
 * @example joinPath("", "call_id") → "call_id"
 */
export function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/**
 * Validates that `value` is a plain object.  Calls `addIssue` with an
 * `invalid_type` issue when it is not.
 *
 * The generic `TIssue` parameter allows every module to use its own
 * validation-issue type while sharing the same guard logic.
 */
export function expectRecord<
  TIssue extends { path: string; code: string; message: string },
>(
  value: unknown,
  path: string,
  addIssue: (issue: TIssue) => void,
): UnknownRecord | undefined {
  if (!isPlainObject(value)) {
    addIssue({
      path: path || "$",
      code: "invalid_type",
      message: `Expected "${path || "$"}" to be an object.`,
    } as TIssue);
    return undefined;
  }

  return value;
}

/**
 * Emits `unknown_key` issues for every key in `record` that is not in
 * `allowedKeys`.  Unknown keys are iterated in insertion order.
 *
 * The generic `TIssue` parameter allows every module to use its own
 * validation-issue type while sharing the same iteration logic.
 */
export function pushUnknownKeys<
  TIssue extends { path: string; code: string; message: string },
>(
  record: UnknownRecord,
  allowedKeys: ReadonlySet<string>,
  path: string,
  addIssue: (issue: TIssue) => void,
): void {
  for (const key of Object.keys(record)) {
    if (allowedKeys.has(key)) {
      continue;
    }

    const fieldPath = joinPath(path, key);
    addIssue({
      path: fieldPath,
      code: "unknown_key",
      message: `Unknown field "${fieldPath}".`,
    } as TIssue);
  }
}
