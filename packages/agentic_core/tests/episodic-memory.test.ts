import type { ContentRef, ContextItem, ContextLayer } from "@argentum/contracts";
import { ContextItemValidationError } from "@argentum/contracts";
import { describe, expect, it } from "vitest";

import { EpisodicMemory } from "../src/index.js";

// ── Factory helpers ──────────────────────────────────────────────

function makeContentRef(overrides: Partial<ContentRef> = {}): ContentRef {
  return {
    ref_id: "ref-001",
    kind: "text",
    storage_area: "working",
    locator: "data/example.txt",
    retention: "session",
    ...overrides,
  };
}

function makeContextItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    context_id: "ctx-001",
    layer: "episodic",
    role: "user",
    content_ref: makeContentRef(),
    origin: "test",
    retention: "rolling",
    ...overrides,
  };
}

// ── Construction ─────────────────────────────────────────────────

describe("EpisodicMemory construction", () => {
  it("stores the sessionId provided at construction", () => {
    const mem = new EpisodicMemory("session-abc");
    expect(mem.sessionId).toBe("session-abc");
  });

  it("sessionId is immutable after construction", () => {
    const mem = new EpisodicMemory("s1");
    // Readonly check via TypeScript — runtime immutability is enforced
    // by the `readonly` modifier.  We verify the value stays intact.
    expect(mem.sessionId).toBe("s1");
    // Attempting assignment would be a compile error, which is the
    // intended guard.
  });
});

// ── add() & getRecent() ──────────────────────────────────────────

describe("add() and getRecent()", () => {
  it("add() stores a valid ContextItem; getRecent() retrieves it", () => {
    const mem = new EpisodicMemory("s");
    const item = makeContextItem({ context_id: "a" });
    mem.add(item);
    const result = mem.getRecent();
    expect(result).toHaveLength(1);
    expect(result[0]!.context_id).toBe("a");
  });

  it("getRecent() returns empty array for empty store", () => {
    const mem = new EpisodicMemory("s");
    expect(mem.getRecent()).toEqual([]);
  });

  it("getRecent(limit) returns at most limit entries", () => {
    const mem = new EpisodicMemory("s");
    for (let i = 0; i < 5; i++) {
      mem.add(makeContextItem({ context_id: `ctx-${i}` }));
    }
    const result = mem.getRecent(3);
    expect(result).toHaveLength(3);
    // Should be the 3 most recent (index 2, 3, 4)
    expect(result[0]!.context_id).toBe("ctx-2");
    expect(result[1]!.context_id).toBe("ctx-3");
    expect(result[2]!.context_id).toBe("ctx-4");
  });

  it("getRecent(100) on store with 3 entries returns all 3 (limit exceeds size)", () => {
    const mem = new EpisodicMemory("s");
    for (let i = 0; i < 3; i++) {
      mem.add(makeContextItem({ context_id: `ctx-${i}` }));
    }
    expect(mem.getRecent(100)).toHaveLength(3);
  });

  it("getRecent(0) returns []", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "a" }));
    expect(mem.getRecent(0)).toEqual([]);
  });

  it("getRecent() returns entries in insertion order (newest last)", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "first" }));
    mem.add(makeContextItem({ context_id: "second" }));
    mem.add(makeContextItem({ context_id: "third" }));
    const result = mem.getRecent();
    expect(result).toHaveLength(3);
    expect(result[0]!.context_id).toBe("first");
    expect(result[1]!.context_id).toBe("second");
    expect(result[2]!.context_id).toBe("third");
  });

  it("getRecent(2) returns the 2 most recent with correct ordering", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "first" }));
    mem.add(makeContextItem({ context_id: "second" }));
    mem.add(makeContextItem({ context_id: "third" }));
    const result = mem.getRecent(2);
    expect(result).toHaveLength(2);
    expect(result[0]!.context_id).toBe("second");
    expect(result[1]!.context_id).toBe("third");
  });
});

// ── add() validation ─────────────────────────────────────────────

describe("add() validation", () => {
  it("throws ContextItemValidationError on missing required fields", () => {
    const mem = new EpisodicMemory("s");
    // missing context_id, layer, role, content_ref, origin, retention
    expect(() => mem.add({} as ContextItem)).toThrow(ContextItemValidationError);
  });

  it("throws ContextItemValidationError on wrong types", () => {
    const mem = new EpisodicMemory("s");
    expect(() =>
      mem.add({
        context_id: 123, // should be string
        layer: "episodic",
        role: "user",
        content_ref: makeContentRef(),
        origin: "test",
        retention: "rolling",
      } as unknown as ContextItem),
    ).toThrow(ContextItemValidationError);
  });

  it("throws ContextItemValidationError on structurally invalid content_ref (proves parseContextItem delegation)", () => {
    const mem = new EpisodicMemory("s");
    // Top-level fields are valid, but content_ref is missing required
    // sub-fields (ref_id, storage_area, locator, retention).
    const invalid: unknown = {
      context_id: "ctx-001",
      layer: "episodic",
      role: "user",
      content_ref: {
        kind: "text",
        // missing ref_id, storage_area, locator, retention
      },
      origin: "test",
      retention: "rolling",
    };
    expect(() => mem.add(invalid as ContextItem)).toThrow(
      ContextItemValidationError,
    );
  });

  it("add() succeeds with fully populated optional fields", () => {
    const mem = new EpisodicMemory("s");
    const item: ContextItem = {
      context_id: "ctx-full",
      layer: "tool_summary",
      role: "assistant",
      content_ref: makeContentRef({ storage_area: "artifacts" }),
      origin: "compactor",
      retention: "ephemeral",
      version: "v2",
      token_estimate: 1500,
    };
    expect(() => mem.add(item)).not.toThrow();
    expect(mem.size).toBe(1);
  });
});

// ── size ─────────────────────────────────────────────────────────

describe("size", () => {
  it("starts at 0 for a new store", () => {
    expect(new EpisodicMemory("s").size).toBe(0);
  });

  it("tracks correctly through multiple adds", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "a" }));
    expect(mem.size).toBe(1);
    mem.add(makeContextItem({ context_id: "b" }));
    expect(mem.size).toBe(2);
    mem.add(makeContextItem({ context_id: "c" }));
    expect(mem.size).toBe(3);
  });
});

// ── getByLayer ───────────────────────────────────────────────────

describe("getByLayer()", () => {
  it("filters by layer correctly", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "e1", layer: "episodic" }));
    mem.add(makeContextItem({ context_id: "ts1", layer: "tool_summary" }));
    mem.add(makeContextItem({ context_id: "e2", layer: "episodic" }));

    const episodics = mem.getByLayer("episodic");
    expect(episodics).toHaveLength(2);
    expect(episodics[0]!.context_id).toBe("e1");
    expect(episodics[1]!.context_id).toBe("e2");

    const summaries = mem.getByLayer("tool_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.context_id).toBe("ts1");
  });

  it("getByLayer('nonexistent') returns [] (lenient)", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "a", layer: "episodic" }));
    // Use a valid layer literal that has no entries
    const result = mem.getByLayer("system" as ContextLayer);
    expect(result).toEqual([]);
  });

  it("getByLayer() returns [] for empty store", () => {
    const mem = new EpisodicMemory("s");
    expect(mem.getByLayer("episodic")).toEqual([]);
  });
});

// ── Returned array independence ──────────────────────────────────

describe("returned array independence", () => {
  it("getRecent() returns a shallow copy (mutating does not affect store)", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "a" }));
    const result = mem.getRecent();
    result.push(makeContextItem({ context_id: "intruder" }));
    // The store should be unaffected
    expect(mem.getRecent()).toHaveLength(1);
    expect(mem.getRecent()[0]!.context_id).toBe("a");
  });

  it("getByLayer() returns a shallow copy (mutating does not affect store)", () => {
    const mem = new EpisodicMemory("s");
    mem.add(makeContextItem({ context_id: "e1", layer: "episodic" }));
    const layerEntries = mem.getByLayer("episodic");
    layerEntries.push(makeContextItem({ context_id: "intruder", layer: "episodic" }));
    // The store should still have only 1 entry
    expect(mem.getByLayer("episodic")).toHaveLength(1);
  });
});

// ── Multiple adds maintain FIFO order ────────────────────────────

describe("ordering", () => {
  it("multiple adds maintain FIFO order across layers", () => {
    const mem = new EpisodicMemory("s");
    const items: ContextItem[] = [];
    for (let i = 0; i < 10; i++) {
      const layer: ContextLayer = i % 2 === 0 ? "episodic" : "tool_summary";
      const item = makeContextItem({ context_id: `ctx-${i}`, layer });
      mem.add(item);
      items.push(item);
    }
    const all = mem.getRecent();
    expect(all).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(all[i]!.context_id).toBe(`ctx-${i}`);
    }
  });
});

// ── ContentRef round-trip integrity ──────────────────────────────

describe("ContentRef round-trip integrity", () => {
  it("round-trips fully populated ContentRef via getRecent()", () => {
    const mem = new EpisodicMemory("s");
    const contentRef: ContentRef = {
      ref_id: "ref-full",
      kind: "json",
      storage_area: "artifacts",
      locator: "calls/call-001.json",
      media_type: "application/json",
      retention: "persistent",
    };
    const item: ContextItem = {
      context_id: "ctx-cr",
      layer: "tool_summary",
      role: "assistant",
      content_ref: contentRef,
      origin: "tool",
      retention: "rolling",
    };
    mem.add(item);
    const [retrieved] = mem.getRecent();
    expect(retrieved).toBeDefined();
    expect(retrieved!.content_ref).toEqual(contentRef);
  });

  it("round-trips ContentRef with storage_area='artifacts' via getByLayer()", () => {
    const mem = new EpisodicMemory("s");
    const item: ContextItem = {
      context_id: "ctx-art",
      layer: "tool_summary",
      role: "assistant",
      content_ref: {
        ref_id: "ref-art",
        kind: "json",
        storage_area: "artifacts",
        locator: "some-call-id.json",
        retention: "session",
      },
      origin: "tool",
      retention: "rolling",
    };
    mem.add(item);
    const results = mem.getByLayer("tool_summary");
    expect(results).toHaveLength(1);
    expect(results[0]!.content_ref.storage_area).toBe("artifacts");
    expect(results[0]!.content_ref.locator).toBe("some-call-id.json");
  });
});

// ── Optional fields survive round-trip ───────────────────────────

describe("optional fields round-trip", () => {
  it("version and token_estimate survive add() → retrieval", () => {
    const mem = new EpisodicMemory("s");
    const item: ContextItem = {
      context_id: "ctx-opt",
      layer: "episodic",
      role: "user",
      content_ref: makeContentRef(),
      origin: "test",
      retention: "sticky",
      version: "v3.1",
      token_estimate: 420,
    };
    mem.add(item);
    const [retrieved] = mem.getRecent();
    expect(retrieved).toBeDefined();
    expect(retrieved!.version).toBe("v3.1");
    expect(retrieved!.token_estimate).toBe(420);
  });
});
