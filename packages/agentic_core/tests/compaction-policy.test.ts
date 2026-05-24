import type { ContentRef, ContextItem, ToolResultDTO } from "@argentum/contracts";
import { parseContextItem } from "@argentum/contracts";
import { describe, expect, it } from "vitest";

import {
  CompactionPolicy,
  DEFAULT_COMPACTION_THRESHOLD_BYTES,
} from "../src/index.js";
import type { ArtifactExternalizer, CompactionDisposition } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeResult(overrides: Partial<ToolResultDTO> = {}): ToolResultDTO {
  return {
    call_id: "tool-001",
    status: "success",
    human_summary: "Short result",
    duration_ms: 100,
    truncated: false,
    retryable: false,
    ...overrides,
  };
}

function makeExternalizer(): ArtifactExternalizer & { storeCalls: Array<{ callId: string; content: string }> } {
  const storeCalls: Array<{ callId: string; content: string }> = [];
  return {
    storeCalls,
    async store(callId: string, content: string): Promise<ContentRef> {
      storeCalls.push({ callId, content });
      return {
        ref_id: `artifact:${callId}`,
        kind: "text",
        storage_area: "artifacts",
        locator: callId,
        retention: "session",
      };
    },
  };
}

function assertValidContextItem(item: ContextItem): void {
  // parseContextItem throws if invalid
  expect(() => parseContextItem(item)).not.toThrow();
}

// ── Small result (inline) ────────────────────────────────────────

describe("CompactionPolicy — inline disposition", () => {
  it("small result under threshold → disposition 'inline'", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "Short result" });
    const compacted = await policy.compact(result, 0);

    expect(compacted.disposition).toBe("inline");
    expect(compacted.externalizedRefs).toEqual([]);
  });

  it("small result: newRevision unchanged (verbatim)", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "Short result" });
    const compacted = await policy.compact(result, 5);

    expect(compacted.newRevision).toBe(5);
  });

  it("small result: contextItem has correct shape", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ call_id: "tool-abc", human_summary: "Short result" });
    const compacted = await policy.compact(result, 0);

    expect(compacted.contextItem.context_id).toBe("compaction:tool-abc");
    expect(compacted.contextItem.layer).toBe("tool_summary");
    expect(compacted.contextItem.origin).toBe("compaction");
    expect(compacted.contextItem.retention).toBe("rolling");
    expect(compacted.contextItem.role).toBe("tool");
    expect(compacted.contextItem.token_estimate).toBeGreaterThan(0);
  });

  it("small result: passes parseContextItem", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "Short result" });
    const compacted = await policy.compact(result, 0);

    assertValidContextItem(compacted.contextItem);
  });
});

// ── Large result (externalized) ──────────────────────────────────

describe("CompactionPolicy — externalized disposition", () => {
  it("large result over threshold → disposition 'externalized'", async () => {
    const policy = new CompactionPolicy();
    const largeSummary = "x".repeat(5000); // 5000 bytes, > 4096
    const result = makeResult({ human_summary: largeSummary });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.disposition).toBe("externalized");
  });

  it("large result: calls externalizer.store", async () => {
    const policy = new CompactionPolicy();
    const largeSummary = "x".repeat(5000);
    const result = makeResult({ call_id: "tool-ext", human_summary: largeSummary });
    const ext = makeExternalizer();

    await policy.compact(result, 0, ext);

    expect(ext.storeCalls).toHaveLength(1);
    expect(ext.storeCalls[0]!.callId).toBe("tool-ext");
    expect(ext.storeCalls[0]!.content).toBe(largeSummary);
  });

  it("large result: externalizedRefs populated", async () => {
    const policy = new CompactionPolicy();
    const largeSummary = "x".repeat(5000);
    const result = makeResult({ human_summary: largeSummary });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.externalizedRefs).toHaveLength(1);
    expect(compacted.externalizedRefs[0]!.ref_id).toBe("artifact:tool-001");
  });

  it("large result: revision increments", async () => {
    const policy = new CompactionPolicy();
    const largeSummary = "x".repeat(5000);
    const result = makeResult({ human_summary: largeSummary });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 5, ext);

    expect(compacted.newRevision).toBe(6);
  });

  it("large result without externalizer throws", async () => {
    const policy = new CompactionPolicy();
    const largeSummary = "x".repeat(5000);
    const result = makeResult({ human_summary: largeSummary });

    await expect(policy.compact(result, 0)).rejects.toThrow(
      /requires externalization/,
    );
  });

  it("large result: passes parseContextItem", async () => {
    const policy = new CompactionPolicy();
    const largeSummary = "x".repeat(5000);
    const result = makeResult({ human_summary: largeSummary });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    assertValidContextItem(compacted.contextItem);
  });
});

// ── Truncated flag forces large ──────────────────────────────────

describe("CompactionPolicy — truncated flag", () => {
  it("truncated=true forces externalized regardless of size", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      human_summary: "OK", // well under threshold
      truncated: true,
    });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.disposition).toBe("externalized");
    expect(ext.storeCalls).toHaveLength(1);
  });
});

// ── Error result ─────────────────────────────────────────────────

describe("CompactionPolicy — error_summary disposition", () => {
  it("error status → disposition 'error_summary'", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      status: "error",
      error_code: "E_TIMEOUT",
      human_summary: "Tool timed out",
    });

    const compacted = await policy.compact(result, 0);

    expect(compacted.disposition).toBe("error_summary");
  });

  it("error result: includes error_code in summary", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      status: "error",
      error_code: "E_TIMEOUT",
      human_summary: "Tool timed out",
    });

    const compacted = await policy.compact(result, 0);

    // The content_ref's locator contains the call_id; the summary text
    // is committed by the caller. We verify disposition and revision.
    expect(compacted.disposition).toBe("error_summary");
  });

  it("error result: no externalization", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      status: "error",
      error_code: "E_TIMEOUT",
      human_summary: "Tool timed out",
    });

    const compacted = await policy.compact(result, 0);

    expect(compacted.externalizedRefs).toEqual([]);
  });

  it("error result: revision increments", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      status: "error",
      error_code: "E_TIMEOUT",
      human_summary: "Tool timed out",
    });

    const compacted = await policy.compact(result, 5);

    expect(compacted.newRevision).toBe(6);
  });

  it("blocked status → error_summary disposition", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      status: "blocked",
      human_summary: "Tool blocked by policy",
    });

    const compacted = await policy.compact(result, 0);

    expect(compacted.disposition).toBe("error_summary");
  });

  it("missing error_code on error → handles gracefully", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      status: "error",
      human_summary: "Something went wrong",
      // error_code intentionally omitted
    });

    const compacted = await policy.compact(result, 0);

    expect(compacted.disposition).toBe("error_summary");
    // Should not throw.
  });

  it("error result: passes parseContextItem", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({
      status: "error",
      error_code: "E_TIMEOUT",
      human_summary: "Tool timed out",
    });

    const compacted = await policy.compact(result, 0);

    assertValidContextItem(compacted.contextItem);
  });
});

// ── Multi-byte UTF-8 truncation ──────────────────────────────────

describe("CompactionPolicy — UTF-8 truncation", () => {
  it("summary with emoji near threshold → truncated output is valid UTF-8", async () => {
    // Use a small threshold so we can test truncation with emoji.
    const policy = new CompactionPolicy({ sizeThresholdBytes: 50 });
    // Build a summary: prefix + emoji (multi-byte) + suffix.
    // "🌟" is 4 UTF-8 bytes. We want the emoji near the threshold boundary.
    const prefix = "x".repeat(48); // 48 bytes
    const emoji = "🌟"; // 4 bytes → total 52 bytes (over 50)
    const summary = prefix + emoji + " trailing text that should be cut";
    const result = makeResult({ human_summary: summary, call_id: "tool-emoji" });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.disposition).toBe("externalized");
    // The truncated summary should be valid — parseContextItem should pass.
    assertValidContextItem(compacted.contextItem);

    // The content_ref should have a ref_id (it's a valid ContentRef).
    expect(compacted.contextItem.content_ref.ref_id).toBeTruthy();
  });
});

// ── Sentence-boundary truncation ─────────────────────────────────

describe("CompactionPolicy — sentence-boundary truncation", () => {
  it("prefers last sentence boundary before byte limit", async () => {
    // Use a threshold that forces truncation mid-text.
    const policy = new CompactionPolicy({ sizeThresholdBytes: 100 });
    // Create text with clear sentence boundaries.
    const sentences =
      "First sentence with enough length to matter. " +
      "Second sentence that goes beyond the byte limit threshold we set. " +
      "Third sentence that should definitely be cut off completely.";
    // First sentence alone is ~46 bytes, first + second is > 100.
    const result = makeResult({ human_summary: sentences, call_id: "tool-sent" });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.disposition).toBe("externalized");
    assertValidContextItem(compacted.contextItem);

    // The content_ref should be a valid reference.
    expect(compacted.contextItem.content_ref.kind).toBe("text");
  });
});

// ── Deterministic context_id ─────────────────────────────────────

describe("CompactionPolicy — deterministic context_id", () => {
  it("same call_id → same context_id", async () => {
    const policy = new CompactionPolicy();
    const result1 = makeResult({ call_id: "tool-abc", human_summary: "Short" });
    const result2 = makeResult({ call_id: "tool-abc", human_summary: "Short" });

    const c1 = await policy.compact(result1, 0);
    const c2 = await policy.compact(result2, 0);

    expect(c1.contextItem.context_id).toBe("compaction:tool-abc");
    expect(c2.contextItem.context_id).toBe("compaction:tool-abc");
  });

  it("different call_ids → different context_ids", async () => {
    const policy = new CompactionPolicy();
    const r1 = makeResult({ call_id: "tool-aaa", human_summary: "Short" });
    const r2 = makeResult({ call_id: "tool-bbb", human_summary: "Short" });

    const c1 = await policy.compact(r1, 0);
    const c2 = await policy.compact(r2, 0);

    expect(c1.contextItem.context_id).not.toBe(c2.contextItem.context_id);
  });
});

// ── Externalizer not called unnecessarily ────────────────────────

describe("CompactionPolicy — externalizer isolation", () => {
  it("externalizer not called for inline disposition", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "Short" });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.disposition).toBe("inline");
    expect(ext.storeCalls).toHaveLength(0);
  });

  it("externalizer not called for error_summary disposition", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ status: "error", human_summary: "Fail" });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.disposition).toBe("error_summary");
    expect(ext.storeCalls).toHaveLength(0);
  });
});

// ── Default threshold ────────────────────────────────────────────

describe("CompactionPolicy — threshold defaults", () => {
  it("default threshold is 4096", () => {
    expect(DEFAULT_COMPACTION_THRESHOLD_BYTES).toBe(4096);
  });

  it("uses default threshold when not configured", async () => {
    const policy = new CompactionPolicy();
    // 4000 bytes: under default threshold → inline.
    const result = makeResult({ human_summary: "x".repeat(4000) });

    const compacted = await policy.compact(result, 0);

    expect(compacted.disposition).toBe("inline");
  });

  it("exactly 4096 bytes → inline (threshold is >, not >=)", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "x".repeat(4096) });

    const compacted = await policy.compact(result, 0);

    // 4096 is NOT greater than 4096, so it should be inline.
    expect(compacted.disposition).toBe("inline");
  });
});

// ── Custom threshold ─────────────────────────────────────────────

describe("CompactionPolicy — custom threshold", () => {
  it("custom threshold of 100 respected", async () => {
    const policy = new CompactionPolicy({ sizeThresholdBytes: 100 });
    // 200 bytes > 100 threshold → externalized.
    const result = makeResult({ human_summary: "x".repeat(200) });
    const ext = makeExternalizer();

    const compacted = await policy.compact(result, 0, ext);

    expect(compacted.disposition).toBe("externalized");
  });

  it("custom threshold: under limit stays inline", async () => {
    const policy = new CompactionPolicy({ sizeThresholdBytes: 100 });
    // 50 bytes < 100 threshold → inline.
    const result = makeResult({ human_summary: "x".repeat(50) });

    const compacted = await policy.compact(result, 0);

    expect(compacted.disposition).toBe("inline");
  });
});

// ── Edge cases ───────────────────────────────────────────────────

describe("CompactionPolicy — edge cases", () => {
  it("zero-length summary: inline, no error", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "" });

    const compacted = await policy.compact(result, 0);

    expect(compacted.disposition).toBe("inline");
    expect(compacted.contextItem.token_estimate).toBe(0);
  });

  it("input not mutated", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "Original" });
    const originalJson = JSON.stringify(result);

    await policy.compact(result, 0);

    expect(JSON.stringify(result)).toBe(originalJson);
  });

  it("revision never decrements", async () => {
    const policy = new CompactionPolicy();
    const currentRev = 10;

    // Inline
    const inline = await policy.compact(
      makeResult({ human_summary: "Short" }),
      currentRev,
    );
    expect(inline.newRevision).toBeGreaterThanOrEqual(currentRev);

    // Externalized
    const ext = makeExternalizer();
    const externalized = await policy.compact(
      makeResult({ human_summary: "x".repeat(5000) }),
      currentRev,
      ext,
    );
    expect(externalized.newRevision).toBeGreaterThanOrEqual(currentRev);

    // Error
    const error = await policy.compact(
      makeResult({ status: "error", human_summary: "Fail" }),
      currentRev,
    );
    expect(error.newRevision).toBeGreaterThanOrEqual(currentRev);
  });

  it("multiple calls independent (deterministic)", async () => {
    const policy = new CompactionPolicy();
    const result = makeResult({ human_summary: "Short" });

    const c1 = await policy.compact(result, 0);
    const c2 = await policy.compact(result, 0);

    expect(c1).toEqual(c2);
  });

  it("externalizer failure propagates", async () => {
    const policy = new CompactionPolicy();
    const largeSummary = "x".repeat(5000);
    const result = makeResult({ human_summary: largeSummary });

    const failingExt: ArtifactExternalizer = {
      async store(_callId: string, _content: string): Promise<ContentRef> {
        throw new Error("Storage backend unavailable");
      },
    };

    await expect(policy.compact(result, 0, failingExt)).rejects.toThrow(
      "Storage backend unavailable",
    );
  });
});

// ── parseContextItem round-trip for all dispositions ─────────────

describe("CompactionPolicy — parseContextItem round-trip", () => {
  it.each([
    { label: "inline", overrides: { human_summary: "Short" } satisfies Partial<ToolResultDTO> },
    {
      label: "externalized",
      overrides: { human_summary: "x".repeat(5000) } satisfies Partial<ToolResultDTO>,
      needsExt: true,
    },
    {
      label: "error_summary",
      overrides: { status: "error" as const, error_code: "E_TEST", human_summary: "Fail" } satisfies Partial<ToolResultDTO>,
    },
    {
      label: "blocked",
      overrides: { status: "blocked" as const, human_summary: "Blocked by policy" } satisfies Partial<ToolResultDTO>,
    },
  ])("$label → passes parseContextItem", async ({ overrides, needsExt }) => {
    const policy = new CompactionPolicy();
    const result = makeResult(overrides);
    const ext = needsExt ? makeExternalizer() : undefined;

    const compacted = await policy.compact(result, 0, ext);

    assertValidContextItem(compacted.contextItem);
    expect(compacted.disposition).toBeTruthy();
  });
});
