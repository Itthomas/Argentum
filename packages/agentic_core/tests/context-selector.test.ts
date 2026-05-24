import { describe, expect, it } from "vitest";
import type { ContextItem, ContentRef, TurnBudget } from "@argentum/contracts";
import { parseContextItemArray } from "@argentum/contracts";
import {
  ContextSelector,
  type OmissionRecord,
  type SelectionResult,
} from "../src/context-selector.js";

// ── Test helpers ───────────────────────────────────────────────

/** Shortcut to build a minimal `ContentRef`. */
function ref(refId: string): ContentRef {
  return {
    ref_id: refId,
    kind: "text",
    storage_area: "working",
    locator: `ctx/${refId}`,
    retention: "session",
  };
}

interface ItemOpts {
  contextId?: string;
  layer?: string;
  role?: string;
  refId?: string;
  origin?: string;
  tokenEstimate?: number;
  retention?: string;
}

/** Build a `ContextItem`-shaped plain object with sensible defaults. */
function item(opts: ItemOpts = {}): ContextItem {
  return {
    context_id: opts.contextId ?? opts.refId ?? `item-${counter++}`,
    layer: (opts.layer ?? "episodic") as ContextItem["layer"],
    role: opts.role ?? "user",
    content_ref: ref(opts.refId ?? opts.contextId ?? "r"),
    origin: opts.origin ?? "test",
    retention: (opts.retention ?? "rolling") as ContextItem["retention"],
    ...(opts.tokenEstimate !== undefined ? { token_estimate: opts.tokenEstimate } : {}),
  };
}

let counter = 0;

/** Reset the auto-increment counter between tests. */
function resetCounter(): void {
  counter = 0;
}

/** A default budget with a generous token limit. */
function budget(overrides: Partial<TurnBudget> = {}): TurnBudget {
  return {
    max_inference_steps: 10,
    max_repair_attempts: 3,
    max_wall_clock_ms: 300_000,
    repair_attempts_used: 0,
    max_tokens_per_step: 1000,
    ...overrides,
  };
}

// ── Shared selector instance ───────────────────────────────────

const selector = new ContextSelector();

// ── Tests ──────────────────────────────────────────────────────

describe("ContextSelector", () => {
  // ── Mandatory items ──────────────────────────────────────

  describe("mandatory items (bedrock + system)", () => {
    it("places mandatory items first regardless of input order", () => {
      resetCounter();
      const env = item({ layer: "environment", contextId: "env-1" });
      const ep = item({ layer: "episodic", contextId: "ep-1" });
      const bed = item({ layer: "bedrock", contextId: "bed-1" });
      const sys = item({ layer: "system", contextId: "sys-1" });

      const result = selector.select([env, ep, bed, sys], budget());

      expect(result.selected[0]!.context_id).toBe("bed-1");
      expect(result.selected[1]!.context_id).toBe("sys-1");
    });

    it("never omits mandatory items even when they exceed budget", () => {
      resetCounter();
      const mandatoryItems = [
        item({ layer: "bedrock", contextId: "bed-1", tokenEstimate: 500 }),
        item({ layer: "system", contextId: "sys-1", tokenEstimate: 500 }),
      ];

      const result = selector.select(
        mandatoryItems,
        budget({ max_tokens_per_step: 100 }),
      );

      expect(result.selected).toHaveLength(2);
      expect(result.budgetExhausted).toBe(true);
      // No bedrock/system items in omitted
      const omittedMandatory = result.omitted.filter(
        (o) => o.contextId === "bed-1" || o.contextId === "sys-1",
      );
      expect(omittedMandatory).toHaveLength(0);
    });

    it("sets budgetExhausted when mandatory items alone exceed budget", () => {
      resetCounter();
      const items = [
        item({ layer: "bedrock", contextId: "bed-1", tokenEstimate: 600 }),
        item({ layer: "system", contextId: "sys-1", tokenEstimate: 600 }),
        // No other items to omit
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 100 }),
      );

      expect(result.budgetExhausted).toBe(true);
      expect(result.selected).toHaveLength(2);
    });
  });

  // ── Episodic ordering ────────────────────────────────────

  describe("episodic ordering", () => {
    it("selects episodic items newest first", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1" }), // oldest
        item({ layer: "episodic", contextId: "ep-2" }),
        item({ layer: "episodic", contextId: "ep-3" }), // newest
      ];

      const result = selector.select(items, budget());

      const epIds = result.selected.map((i) => i.context_id);
      expect(epIds).toEqual(["ep-3", "ep-2", "ep-1"]);
    });

    // H2: Current ingress prioritization
    it("prioritises ingress-origin episodic items before other episodic items", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", origin: "tool" }),
        item({ layer: "episodic", contextId: "ingress-1", origin: "ingress" }),
        item({ layer: "episodic", contextId: "ep-2", origin: "tool" }),
        item({ layer: "episodic", contextId: "ingress-2", origin: "gateway.ingress" }),
      ];

      const result = selector.select(items, budget());

      const epIds = result.selected.map((i) => i.context_id);
      // Ingress items first (newest first: ingress-2 before ingress-1),
      // then non-ingress (newest first: ep-2 before ep-1)
      expect(epIds).toEqual(["ingress-2", "ingress-1", "ep-2", "ep-1"]);
    });
  });

  // ── Compact summary preference ───────────────────────────

  describe("compact summary preference", () => {
    it("prefers tool_summary over raw episodic with same ref_id", () => {
      resetCounter();
      const rawEp = item({
        layer: "episodic",
        contextId: "raw-1",
        refId: "tool-output-42",
      });
      const summary = item({
        layer: "tool_summary",
        contextId: "summary-1",
        refId: "tool-output-42",
      });

      const result = selector.select([rawEp, summary], budget());

      const selectedIds = result.selected.map((i) => i.context_id);
      expect(selectedIds).toContain("summary-1");
      expect(selectedIds).not.toContain("raw-1");

      const omittedRaw = result.omitted.find((o) => o.contextId === "raw-1");
      expect(omittedRaw).toBeDefined();
      expect(omittedRaw!.reason).toBe("priority_filtered");
    });

    it("selects tool_summary with unique ref_id normally", () => {
      resetCounter();
      const summary = item({
        layer: "tool_summary",
        contextId: "summary-1",
        refId: "unique-ref",
      });

      const result = selector.select([summary], budget());

      expect(result.selected.map((i) => i.context_id)).toContain("summary-1");
      expect(result.omitted).toHaveLength(0);
    });

    it("omits multiple raw episodic items matching the same tool_summary ref_id", () => {
      resetCounter();
      const raw1 = item({
        layer: "episodic",
        contextId: "raw-1",
        refId: "shared-ref",
      });
      const raw2 = item({
        layer: "episodic",
        contextId: "raw-2",
        refId: "shared-ref",
      });
      const summary = item({
        layer: "tool_summary",
        contextId: "summary-1",
        refId: "shared-ref",
      });

      const result = selector.select([raw1, raw2, summary], budget());

      expect(result.omitted.filter((o) => o.reason === "priority_filtered")).toHaveLength(2);
      expect(result.selected.map((i) => i.context_id)).toContain("summary-1");
    });
  });

  // ── Environment context ──────────────────────────────────

  describe("environment context", () => {
    it("places environment items last in selection order", () => {
      resetCounter();
      const items = [
        item({ layer: "environment", contextId: "env-1" }),
        item({ layer: "episodic", contextId: "ep-1" }),
        item({ layer: "bedrock", contextId: "bed-1" }),
        item({ layer: "tool_summary", contextId: "ts-1" }),
      ];

      const result = selector.select(items, budget());

      const ids = result.selected.map((i) => i.context_id);
      const envIndex = ids.indexOf("env-1");
      const epIndex = ids.indexOf("ep-1");
      const tsIndex = ids.indexOf("ts-1");
      // Environment should be after all non-environment items
      expect(envIndex).toBeGreaterThan(epIndex);
      expect(envIndex).toBeGreaterThan(tsIndex);
    });

    it("fills remaining budget with environment items", () => {
      resetCounter();
      const items = [
        item({ layer: "bedrock", contextId: "bed-1", tokenEstimate: 10 }),
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 50 }),
        item({ layer: "environment", contextId: "env-1", tokenEstimate: 20 }),
        item({ layer: "environment", contextId: "env-2", tokenEstimate: 30 }),
        item({ layer: "environment", contextId: "env-3", tokenEstimate: 40 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 100 }),
      );

      // bed (10) + ep (50) = 60; env-1 (20) = 80; env-2 (30) would exceed → omitted
      const selectedIds = result.selected.map((i) => i.context_id);
      expect(selectedIds).toContain("env-1");
      expect(selectedIds).not.toContain("env-2");
      expect(selectedIds).not.toContain("env-3");

      const omittedEnv = result.omitted.filter((o) => o.contextId === "env-2" || o.contextId === "env-3");
      expect(omittedEnv).toHaveLength(2);
      expect(omittedEnv.every((o) => o.reason === "budget_exceeded")).toBe(true);
    });
  });

  // ── Budget respect ───────────────────────────────────────

  describe("budget respect", () => {
    it("stops selecting when cumulative token estimate exceeds budget", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 20 }),
        item({ layer: "episodic", contextId: "ep-2", tokenEstimate: 20 }),
        item({ layer: "episodic", contextId: "ep-3", tokenEstimate: 20 }),
        item({ layer: "episodic", contextId: "ep-4", tokenEstimate: 20 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 50 }),
      );

      // 20+20=40 fits; 20+20+20=60 exceeds → only 2 selected (newest first: ep-4, ep-3)
      expect(result.selected).toHaveLength(2);
      expect(result.selected[0]!.context_id).toBe("ep-4");
      expect(result.selected[1]!.context_id).toBe("ep-3");
      expect(result.budgetExhausted).toBe(true);
    });

    it("selects all items when no budget is configured", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 999 }),
        item({ layer: "episodic", contextId: "ep-2", tokenEstimate: 999 }),
        item({ layer: "environment", contextId: "env-1", tokenEstimate: 999 }),
      ];

      const b = budget();
      delete (b as Record<string, unknown>).max_tokens_per_step;

      const result = selector.select(items, b);

      expect(result.selected).toHaveLength(3);
      expect(result.budgetExhausted).toBe(false);
      expect(result.omitted).toHaveLength(0);
    });

    it("accepts maxTokens option override", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 30 }),
        item({ layer: "episodic", contextId: "ep-2", tokenEstimate: 30 }),
      ];

      // Budget has max_tokens_per_step=1000 but we override with 20
      const result = selector.select(items, budget(), { maxTokens: 20 });

      // Only 1 fits (30 > 20), but newest first so ep-2 tried first → doesn't fit → omitted
      // Wait: newest first: ep-2 (30 > 20) → omitted, ep-1 (30 > 20) → omitted
      expect(result.selected).toHaveLength(0);
      expect(result.omitted).toHaveLength(2);
    });

    it("handles exactly-matched budget", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 25 }),
        item({ layer: "episodic", contextId: "ep-2", tokenEstimate: 25 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 50 }),
      );

      // 25+25=50 exactly fits → both selected (newest first: ep-2, ep-1)
      expect(result.selected).toHaveLength(2);
      expect(result.totalTokens).toBe(50);
      expect(result.budgetExhausted).toBe(false);
    });

    it("handles maxTokens=0 (only zero-estimate items selected)", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 10 }),
        item({ layer: "episodic", contextId: "ep-0", tokenEstimate: 0 }),
      ];

      const result = selector.select(items, budget(), { maxTokens: 0 });

      // ep-0 (zero estimate) selected, ep-1 omitted
      expect(result.selected.map((i) => i.context_id)).toEqual(["ep-0"]);
      expect(result.omitted).toHaveLength(1);
      expect(result.omitted[0]!.reason).toBe("budget_exceeded");
    });
  });

  // ── Zero-estimate items ──────────────────────────────────

  describe("zero-estimate items", () => {
    it("always selects items with token_estimate: 0", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-zero", tokenEstimate: 0 }),
        item({ layer: "episodic", contextId: "ep-pos", tokenEstimate: 1 }),
      ];

      const result = selector.select(items, budget(), { maxTokens: 0 });

      // Zero-estimate item should be selected even with maxTokens=0
      expect(result.selected.map((i) => i.context_id)).toContain("ep-zero");
      expect(result.selected.map((i) => i.context_id)).not.toContain("ep-pos");
    });

    it("always selects items with missing token_estimate", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-no-est" }), // no token_estimate
        item({ layer: "episodic", contextId: "ep-pos", tokenEstimate: 1 }),
      ];

      const result = selector.select(items, budget(), { maxTokens: 0 });

      expect(result.selected.map((i) => i.context_id)).toContain("ep-no-est");
    });

    it("does not count zero-estimate items against budget", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-zero", tokenEstimate: 0 }),
        item({ layer: "episodic", contextId: "ep-30", tokenEstimate: 30 }),
        item({ layer: "episodic", contextId: "ep-40", tokenEstimate: 40 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 70 }),
      );

      // Newest first: ep-40 (40 ≤ 70), ep-30 (40+30=70 ≤ 70), ep-zero (always in)
      expect(result.selected).toHaveLength(3);
      expect(result.totalTokens).toBe(70); // zero doesn't add
    });
  });

  // ── Omission recording ───────────────────────────────────

  describe("omission recording", () => {
    it("records budget_exceeded for items omitted due to budget", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 100 }),
        item({ layer: "episodic", contextId: "ep-2", tokenEstimate: 100 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 50 }),
      );

      const omitted = result.omitted.filter((o) => o.reason === "budget_exceeded");
      expect(omitted.length).toBeGreaterThan(0);
      expect(omitted.every((o) => o.layer === "episodic")).toBe(true);
    });

    it("records priority_filtered for raw items displaced by summaries", () => {
      resetCounter();
      const raw = item({
        layer: "episodic",
        contextId: "raw-1",
        refId: "dup",
      });
      const summary = item({
        layer: "tool_summary",
        contextId: "summary-1",
        refId: "dup",
      });

      const result = selector.select([raw, summary], budget());

      const omitted = result.omitted.find((o) => o.contextId === "raw-1");
      expect(omitted).toBeDefined();
      expect(omitted!.reason).toBe("priority_filtered");
    });

    it("returns empty omitted array when includeOmitted is false", () => {
      resetCounter();
      const items = [
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 999 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 10 }),
        { includeOmitted: false },
      );

      expect(result.omitted).toHaveLength(0);
    });
  });

  // ── Empty input ──────────────────────────────────────────

  describe("empty input", () => {
    it("returns empty result with no errors", () => {
      const result = selector.select([], budget());

      expect(result.selected).toHaveLength(0);
      expect(result.omitted).toHaveLength(0);
      expect(result.totalTokens).toBe(0);
      expect(result.budgetExhausted).toBe(false);
    });
  });

  // ── All items fit ────────────────────────────────────────

  describe("all items fit", () => {
    it("selects all items and reports no budget exhaustion", () => {
      resetCounter();
      const items = [
        item({ layer: "bedrock", contextId: "bed-1", tokenEstimate: 5 }),
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 5 }),
        item({ layer: "tool_summary", contextId: "ts-1", tokenEstimate: 5 }),
        item({ layer: "environment", contextId: "env-1", tokenEstimate: 5 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 100 }),
      );

      expect(result.selected).toHaveLength(4);
      expect(result.budgetExhausted).toBe(false);
      expect(result.omitted).toHaveLength(0);
    });
  });

  // ── Immutability ─────────────────────────────────────────

  describe("immutability", () => {
    it("does not mutate input array or items", () => {
      resetCounter();
      const items = [
        item({ layer: "bedrock", contextId: "bed-1" }),
        item({ layer: "episodic", contextId: "ep-1" }),
      ];
      const frozen = Object.freeze([...items]);

      // Should not throw due to mutation attempts
      expect(() => selector.select(frozen, budget())).not.toThrow();

      // Verify items are unchanged
      expect(items[0]!.context_id).toBe("bed-1");
      expect(items[1]!.context_id).toBe("ep-1");
      expect(items).toHaveLength(2);
    });
  });

  // ── Deterministic output ─────────────────────────────────

  describe("deterministic output", () => {
    it("produces identical results for identical inputs", () => {
      resetCounter();
      const makeItems = (): ContextItem[] => [
        item({ layer: "bedrock", contextId: "bed-1", tokenEstimate: 10 }),
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 20 }),
        item({ layer: "episodic", contextId: "ep-2", tokenEstimate: 20 }),
        item({ layer: "environment", contextId: "env-1", tokenEstimate: 30 }),
      ];

      const result1 = selector.select(makeItems(), budget({ max_tokens_per_step: 50 }));
      const result2 = selector.select(makeItems(), budget({ max_tokens_per_step: 50 }));

      expect(result1.selected.map((i) => i.context_id)).toEqual(
        result2.selected.map((i) => i.context_id),
      );
      expect(result1.totalTokens).toBe(result2.totalTokens);
      expect(result1.budgetExhausted).toBe(result2.budgetExhausted);
      expect(result1.omitted).toEqual(result2.omitted);
    });
  });

  // ── Layer filtering (H1) ─────────────────────────────────

  describe("layer filtering", () => {
    it("omits items with unrecognised layer with reason layer_filtered", () => {
      resetCounter();
      const unknown = item({
        layer: "custom_unknown" as ContextItem["layer"],
        contextId: "unk-1",
      });
      const valid = item({ layer: "episodic", contextId: "ep-1" });

      const result = selector.select([unknown, valid], budget());

      // Unknown item omitted
      const omitted = result.omitted.find((o) => o.contextId === "unk-1");
      expect(omitted).toBeDefined();
      expect(omitted!.reason).toBe("layer_filtered");
      expect(omitted!.layer).toBe("custom_unknown");

      // Valid item selected
      expect(result.selected.map((i) => i.context_id)).toContain("ep-1");
    });
  });

  // ── parseContextItemArray round-trip (H3) ─────────────────

  describe("parseContextItemArray round-trip", () => {
    it("produces selected items that survive a parseContextItemArray round-trip", () => {
      resetCounter();
      const items: ContextItem[] = [
        item({ layer: "bedrock", contextId: "bed-1", tokenEstimate: 5 }),
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 10 }),
        item({ layer: "tool_summary", contextId: "ts-1", tokenEstimate: 5 }),
      ];

      const result = selector.select(items, budget());

      // The selected items should be valid ContextItem[] per parseContextItemArray
      expect(() => parseContextItemArray(result.selected)).not.toThrow();

      const parsed = parseContextItemArray(result.selected);
      expect(parsed).toHaveLength(result.selected.length);
      expect(parsed.map((i) => i.context_id)).toEqual(
        result.selected.map((i) => i.context_id),
      );
    });
  });

  // ── Edge cases ───────────────────────────────────────────

  describe("edge cases", () => {
    it("handles single item input", () => {
      resetCounter();
      const single = item({ layer: "episodic", contextId: "only" });

      const result = selector.select([single], budget());

      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.context_id).toBe("only");
    });

    it("handles only mandatory items", () => {
      resetCounter();
      const items = [
        item({ layer: "bedrock", contextId: "bed-1" }),
        item({ layer: "system", contextId: "sys-1" }),
      ];

      const result = selector.select(items, budget());

      expect(result.selected).toHaveLength(2);
      expect(result.omitted).toHaveLength(0);
    });

    it("handles only environment items", () => {
      resetCounter();
      const items = [
        item({ layer: "environment", contextId: "env-1", tokenEstimate: 10 }),
        item({ layer: "environment", contextId: "env-2", tokenEstimate: 60 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 50 }),
      );

      // env-1 (10) fits; env-2 (60) doesn't
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.context_id).toBe("env-1");
    });

    it("prioritises mandatory items even when all items have zero estimate", () => {
      resetCounter();
      const items = [
        item({ layer: "environment", contextId: "env-1", tokenEstimate: 0 }),
        item({ layer: "bedrock", contextId: "bed-1", tokenEstimate: 0 }),
        item({ layer: "episodic", contextId: "ep-1", tokenEstimate: 0 }),
      ];

      const result = selector.select(items, budget());

      // Bedrock first
      expect(result.selected[0]!.context_id).toBe("bed-1");
      expect(result.selected).toHaveLength(3);
    });

    it("does not double-count tool_summary items that also appear in episodic filtering", () => {
      resetCounter();
      // A tool_summary item with the same ref_id as itself shouldn't be filtered
      const ts = item({
        layer: "tool_summary",
        contextId: "ts-1",
        refId: "ref-x",
      });

      const result = selector.select([ts], budget());

      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.context_id).toBe("ts-1");
      expect(result.omitted).toHaveLength(0);
    });

    it("selects tool_summary items subject to budget", () => {
      resetCounter();
      const items = [
        item({ layer: "tool_summary", contextId: "ts-1", tokenEstimate: 100 }),
        item({ layer: "tool_summary", contextId: "ts-2", tokenEstimate: 100 }),
      ];

      const result = selector.select(
        items,
        budget({ max_tokens_per_step: 150 }),
      );

      // ts-2 first (newest? no, tool summaries aren't sorted by insertion; they keep input order... Actually wait)
      // Tool summaries are NOT reversed — only episodic items are reversed.
      // ts-1 is first in input, so it gets first chance at budget.
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]!.context_id).toBe("ts-1");
      expect(result.omitted).toHaveLength(1);
      expect(result.omitted[0]!.contextId).toBe("ts-2");
      expect(result.omitted[0]!.reason).toBe("budget_exceeded");
    });
  });
});
