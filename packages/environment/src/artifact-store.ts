import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ContentRef, ContentRefKind } from "@argentum/contracts";

// ── Constants ───────────────────────────────────────────────────

/** Regex validating callId and suffix values against path-traversal-safe characters. */
export const CALL_ID_PATTERN = /^[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

/** Maps ContentRefKind to the file extension (including leading dot). */
export const ARTIFACT_FILE_EXTENSIONS: Record<ContentRefKind, string> = {
  text: ".txt",
  json: ".json",
  trace: ".log",
  file: ".bin",
  blob: ".blob",
};

/** Maps ContentRefKind to a MIME-like media type. Absent means no media_type set. */
export const ARTIFACT_KIND_MEDIA_TYPES: Partial<Record<ContentRefKind, string>> =
  {
    text: "text/plain",
    json: "application/json",
  };

// ── Internal helpers ────────────────────────────────────────────

/**
 * Validates that a callId or suffix consists only of safe characters.
 * Throws if the value does not match {@link CALL_ID_PATTERN}.
 */
function validateIdPart(value: string, label: string): void {
  if (!CALL_ID_PATTERN.test(value)) {
    throw new Error(
      `${label} "${value}" contains invalid characters. Must match ${CALL_ID_PATTERN}.`,
    );
  }
}

/**
 * Builds the relative locator (bare filename) for a tool artifact.
 * Same callId + kind + suffix always produces the same locator (deterministic).
 */
function artifactLocator(
  callId: string,
  kind: ContentRefKind,
  suffix?: string,
): string {
  const ext = ARTIFACT_FILE_EXTENSIONS[kind];
  if (suffix !== undefined) {
    return `${callId}-${suffix}${ext}`;
  }
  return `${callId}${ext}`;
}

/**
 * Resolves the absolute filesystem path for a tool artifact.
 */
function artifactFilePath(
  artifactsRoot: string,
  callId: string,
  kind: ContentRefKind,
  suffix?: string,
): string {
  return path.join(artifactsRoot, artifactLocator(callId, kind, suffix));
}

/**
 * Returns the MIME-like media type for a ContentRefKind, or undefined.
 */
function mediaTypeForKind(kind: ContentRefKind): string | undefined {
  return ARTIFACT_KIND_MEDIA_TYPES[kind];
}

/**
 * Constructs a ContentRef without spreading optional properties that may be
 * undefined, to satisfy `exactOptionalPropertyTypes`.
 */
function buildContentRef(
  callId: string,
  kind: ContentRefKind,
  suffix?: string,
): ContentRef {
  const base = {
    ref_id: randomUUID(),
    kind,
    storage_area: "artifacts" as const,
    locator: artifactLocator(callId, kind, suffix),
    retention: "session" as const,
  };

  const mt = mediaTypeForKind(kind);
  if (mt !== undefined) {
    return { ...base, media_type: mt };
  }
  return base;
}

// ── Public entrypoint ───────────────────────────────────────────

/**
 * Persists raw tool output to the artifacts area and returns a {@link ContentRef}.
 *
 * The function is a pure I/O utility: it does not depend on session state,
 * episodic memory, the core loop, or any gateway constructs.
 *
 * @param callId      - The tool call identifier (matches `ToolCallDTO.call_id`).
 * @param content     - The raw tool output to persist.
 * @param artifactsRoot - Concrete filesystem path for the artifacts area
 *                        (from `RuntimePolicyDTO.workspace_roots.artifacts`).
 * @param kind        - Content kind, defaults to `"text"`.
 * @param suffix      - Optional suffix to disambiguate multiple artifacts
 *                      for the same callId+kind pair.
 * @returns A validated {@link ContentRef} pointing to the persisted file.
 * @throws {Error} if callId or suffix contains invalid characters.
 */
export async function storeToolArtifact(
  callId: string,
  content: string,
  artifactsRoot: string,
  kind: ContentRefKind = "text",
  suffix?: string,
): Promise<ContentRef> {
  // 1. Validate identifiers
  validateIdPart(callId, "callId");
  if (suffix !== undefined) {
    validateIdPart(suffix, "suffix");
  }

  // 2. Compute file path
  const filePath = artifactFilePath(artifactsRoot, callId, kind, suffix);

  // 3. Ensure parent directories exist
  await mkdir(path.dirname(filePath), { recursive: true });

  // 4. Persist the content
  await writeFile(filePath, content, "utf-8");

  // 5. Build and return a ContentRef
  const ref: ContentRef = Object.freeze(buildContentRef(callId, kind, suffix));

  return ref;
}
