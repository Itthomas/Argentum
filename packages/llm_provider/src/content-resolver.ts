import type { ContentRef } from "@argentum/contracts";

/**
 * Resolves a canonical {@link ContentRef} to its text content.
 *
 * This keeps the adapter decoupled from storage I/O. The composition
 * root wires the resolver (e.g., to the artifact store). In tests, a
 * simple in-memory map suffices.
 *
 * @param ref - The content reference to resolve.
 * @returns The resolved text content.
 */
export type ContentResolver = (ref: ContentRef) => Promise<string>;

/**
 * Persists a trace payload keyed by a {@link ContentRef}.
 *
 * Optional constructor dependency. When not configured, trace capture
 * is gracefully degraded — `raw_trace_ref` will be `undefined` in the
 * result, but no error is thrown.
 *
 * @param ref - The content reference describing the trace artifact.
 * @param payload - The payload to persist (typically `{ request, response }`).
 */
export type TraceWriter = (ref: ContentRef, payload: unknown) => Promise<void>;
