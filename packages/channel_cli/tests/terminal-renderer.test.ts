import { describe, expect, it } from "vitest";

import type { StreamEvent, StreamEventPayload } from "@argentum/contracts";

import { renderStreamEvent } from "../src/index.js";

// ---------------------------------------------------------------------------
// Test helper: build a minimal valid StreamEvent with overridable fields.
// ---------------------------------------------------------------------------

interface BuildEventOverrides {
  kind?: string;
  visibility?: "user" | "system" | "telemetry";
  scope?: "session" | "turn";
  payload?: StreamEventPayload;
  turn_id?: string;
}

function buildEvent(overrides: BuildEventOverrides = {}): StreamEvent {
  const {
    kind = "turn.started",
    visibility = "user",
    scope = "turn",
    payload = {},
    turn_id = "turn-001",
  } = overrides;

  return {
    event_id: "evt-001",
    session_id: "sess-001",
    sequence: 1,
    kind,
    timestamp: new Date().toISOString(),
    visibility,
    scope,
    turn_id,
    payload,
  } as StreamEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderStreamEvent", () => {
  // =========================================================================
  // Thinking state — llm.*
  // =========================================================================

  describe("llm.started", () => {
    it('returns "Thinking..."', () => {
      const event = buildEvent({ kind: "llm.started" });
      expect(renderStreamEvent(event)).toBe("Thinking...");
    });
  });

  describe("llm.completed", () => {
    it('returns "[system] Inference complete." for system visibility', () => {
      const event = buildEvent({
        kind: "llm.completed",
        visibility: "system",
      });
      expect(renderStreamEvent(event)).toBe("[system] Inference complete.");
    });

    it('returns "" for user visibility', () => {
      const event = buildEvent({
        kind: "llm.completed",
        visibility: "user",
      });
      expect(renderStreamEvent(event)).toBe("");
    });

    it('returns "" for telemetry visibility (telemetry always hidden)', () => {
      const event = buildEvent({
        kind: "llm.completed",
        visibility: "telemetry",
      });
      expect(renderStreamEvent(event)).toBe("");
    });

    it("boundary test: full sequence produces visually distinguishable output", () => {
      const thinking = renderStreamEvent(
        buildEvent({ kind: "llm.started", visibility: "user" }),
      );
      const complete = renderStreamEvent(
        buildEvent({ kind: "llm.completed", visibility: "system" }),
      );
      const response = renderStreamEvent(
        buildEvent({
          kind: "response.completed",
          visibility: "user",
          payload: { final_outcome: "The answer is 42." },
        }),
      );

      // Thinking → inference complete → response text
      expect(thinking).toBe("Thinking...");
      expect(complete).toBe("[system] Inference complete.");
      expect(response).toBe("The answer is 42.");
    });
  });

  describe("llm.failed", () => {
    it("returns formatted failure with reason", () => {
      const event = buildEvent({
        kind: "llm.failed",
        payload: { reason: "rate limit exceeded" },
      });
      expect(renderStreamEvent(event)).toBe(
        "Inference failed: rate limit exceeded",
      );
    });

    it('falls back to "unknown" when reason is missing', () => {
      const event = buildEvent({ kind: "llm.failed", payload: {} });
      expect(renderStreamEvent(event)).toBe("Inference failed: unknown");
    });
  });

  // =========================================================================
  // Acting state — tool.*
  // =========================================================================

  describe("tool.started", () => {
    it("returns formatted tool usage with tool_name", () => {
      const event = buildEvent({
        kind: "tool.started",
        payload: { tool_name: "read_file" },
      });
      expect(renderStreamEvent(event)).toBe("Using read_file...");
    });

    it('falls back to "unknown" when tool_name is missing', () => {
      const event = buildEvent({ kind: "tool.started", payload: {} });
      expect(renderStreamEvent(event)).toBe("Using unknown...");
    });
  });

  describe("tool.finished", () => {
    it("returns formatted completion with tool_name", () => {
      const event = buildEvent({
        kind: "tool.finished",
        payload: { tool_name: "read_file" },
      });
      expect(renderStreamEvent(event)).toBe("read_file completed");
    });

    it('falls back to "unknown" when tool_name is missing', () => {
      const event = buildEvent({ kind: "tool.finished", payload: {} });
      expect(renderStreamEvent(event)).toBe("unknown completed");
    });
  });

  // =========================================================================
  // Blocked state — tool.blocked, turn.aborted, validation.failed
  // =========================================================================

  describe("tool.blocked", () => {
    it("returns formatted blocked message with tool_name and reason", () => {
      const event = buildEvent({
        kind: "tool.blocked",
        payload: { tool_name: "write_file", reason: "permission denied" },
      });
      expect(renderStreamEvent(event)).toBe(
        "write_file blocked: permission denied",
      );
    });

    it('falls back to "unknown" for missing fields', () => {
      const event = buildEvent({ kind: "tool.blocked", payload: {} });
      expect(renderStreamEvent(event)).toBe("unknown blocked: unknown");
    });
  });

  describe("turn.aborted", () => {
    it("returns formatted abort message with reason", () => {
      const event = buildEvent({
        kind: "turn.aborted",
        payload: { reason: "max steps exceeded" },
      });
      expect(renderStreamEvent(event)).toBe(
        "Turn aborted: max steps exceeded",
      );
    });

    it('falls back to "unknown" when reason is missing', () => {
      const event = buildEvent({ kind: "turn.aborted", payload: {} });
      expect(renderStreamEvent(event)).toBe("Turn aborted: unknown");
    });
  });

  // =========================================================================
  // Finished state — turn.completed, response.completed
  // =========================================================================

  describe("turn.completed", () => {
    it('returns "Done."', () => {
      const event = buildEvent({ kind: "turn.completed" });
      expect(renderStreamEvent(event)).toBe("Done.");
    });
  });

  describe("response.completed", () => {
    it("returns final_outcome directly (no prefix, no message fallback)", () => {
      const event = buildEvent({
        kind: "response.completed",
        payload: { final_outcome: "Here is the result." },
      });
      expect(renderStreamEvent(event)).toBe("Here is the result.");
    });

    it('returns "" when final_outcome is missing (no message fallback)', () => {
      const event = buildEvent({
        kind: "response.completed",
        payload: {},
      });
      expect(renderStreamEvent(event)).toBe("");
    });

    it("does NOT use message field even if present (spec: final_outcome only)", () => {
      const event = buildEvent({
        kind: "response.completed",
        payload: {
          final_outcome: "spec-guaranteed outcome",
          message: "legacy fallback — must be ignored",
        },
      });
      expect(renderStreamEvent(event)).toBe("spec-guaranteed outcome");
    });
  });

  // =========================================================================
  // State transition — turn.state_changed
  // =========================================================================

  describe("turn.state_changed", () => {
    it("renders with [system] prefix for system visibility", () => {
      const event = buildEvent({
        kind: "turn.state_changed",
        visibility: "system",
        payload: { from_state: "inferring", to_state: "acting" },
      });
      expect(renderStreamEvent(event)).toBe("[system] State: inferring → acting");
    });

    it("renders without [system] prefix for user visibility", () => {
      const event = buildEvent({
        kind: "turn.state_changed",
        visibility: "user",
        payload: { from_state: "acting", to_state: "finished" },
      });
      expect(renderStreamEvent(event)).toBe("State: acting → finished");
    });

    it('falls back to "unknown" for missing state fields', () => {
      const event = buildEvent({
        kind: "turn.state_changed",
        visibility: "system",
        payload: {},
      });
      expect(renderStreamEvent(event)).toBe("[system] State: unknown → unknown");
    });
  });

  // =========================================================================
  // Turn start — turn.started
  // =========================================================================

  describe("turn.started", () => {
    it("includes payload.state when present", () => {
      const event = buildEvent({
        kind: "turn.started",
        payload: { state: "inferring" },
      });
      expect(renderStreamEvent(event)).toBe("Turn started (inferring).");
    });

    it("omits state parenthetical when payload.state is missing", () => {
      const event = buildEvent({ kind: "turn.started", payload: {} });
      expect(renderStreamEvent(event)).toBe("Turn started.");
    });
  });

  // =========================================================================
  // Validation — validation.failed (repairable vs unrepairable)
  // =========================================================================

  describe("validation.failed", () => {
    it('returns "" when repairable is true (silent; repair follows)', () => {
      const event = buildEvent({
        kind: "validation.failed",
        payload: { reason: "schema mismatch", repairable: true },
      });
      expect(renderStreamEvent(event)).toBe("");
    });

    it("renders with [system] prefix for unrepairable + system visibility", () => {
      const event = buildEvent({
        kind: "validation.failed",
        visibility: "system",
        payload: { reason: "fatal error", repairable: false },
      });
      expect(renderStreamEvent(event)).toBe(
        "[system] Validation failed: fatal error",
      );
    });

    it("renders without [system] prefix for unrepairable + user visibility", () => {
      const event = buildEvent({
        kind: "validation.failed",
        visibility: "user",
        payload: { reason: "fatal error", repairable: false },
      });
      expect(renderStreamEvent(event)).toBe(
        "Validation failed: fatal error",
      );
    });

    it('falls back to "unknown" reason when missing', () => {
      const event = buildEvent({
        kind: "validation.failed",
        visibility: "system",
        payload: { repairable: false },
      });
      expect(renderStreamEvent(event)).toBe(
        "[system] Validation failed: unknown",
      );
    });

    it('returns "" when repairable is absent (defaults to repairable/truthy)', () => {
      // repairable not set → undefined → not strictly false → silent
      const event = buildEvent({
        kind: "validation.failed",
        payload: { reason: "some issue" },
      });
      expect(renderStreamEvent(event)).toBe("");
    });
  });

  // =========================================================================
  // Queue — queue.rejected
  // =========================================================================

  describe("queue.rejected", () => {
    it("renders with [system] prefix for system visibility", () => {
      const event = buildEvent({
        kind: "queue.rejected",
        visibility: "system",
        scope: "session",
        turn_id: undefined,
      } as Partial<BuildEventOverrides> as BuildEventOverrides);
      expect(renderStreamEvent(event)).toBe(
        "[system] Queue full — input rejected",
      );
    });

    it("renders without [system] prefix for user visibility", () => {
      const event = buildEvent({
        kind: "queue.rejected",
        visibility: "user",
        scope: "session",
        turn_id: undefined,
      } as Partial<BuildEventOverrides> as BuildEventOverrides);
      expect(renderStreamEvent(event)).toBe("Queue full — input rejected");
    });

    it("returns empty string for telemetry visibility", () => {
      const event = buildEvent({
        kind: "queue.rejected",
        visibility: "telemetry",
        scope: "session",
        turn_id: undefined,
      } as Partial<BuildEventOverrides> as BuildEventOverrides);
      expect(renderStreamEvent(event)).toBe("");
    });
  });

  // =========================================================================
  // Visibility filtering
  // =========================================================================

  describe("visibility filtering", () => {
    it("returns empty string for any telemetry event", () => {
      const event = buildEvent({
        kind: "llm.started",
        visibility: "telemetry",
      });
      expect(renderStreamEvent(event)).toBe("");
    });

    it("renders user events that have output", () => {
      const event = buildEvent({
        kind: "turn.completed",
        visibility: "user",
      });
      expect(renderStreamEvent(event)).toBe("Done.");
    });

    it("applies [system] prefix for system events with output", () => {
      const event = buildEvent({
        kind: "turn.state_changed",
        visibility: "system",
        payload: { from_state: "idle", to_state: "inferring" },
      });
      expect(renderStreamEvent(event)).toBe("[system] State: idle → inferring");
    });
  });

  // =========================================================================
  // Hidden events — must return ""
  // =========================================================================

  describe("hidden events", () => {
    const hiddenKinds = [
      "memory.compaction_started",
      "memory.compaction_committed",
      "queue.queued",
      "queue.dequeued",
      "response.started",
      "validation.repair_requested",
      "tool.planned",
    ];

    for (const kind of hiddenKinds) {
      it(`returns "" for ${kind}`, () => {
        const event = buildEvent({ kind, visibility: "user" });
        expect(renderStreamEvent(event)).toBe("");
      });

      it(`returns "" for ${kind} with system visibility`, () => {
        const event = buildEvent({ kind, visibility: "system" });
        expect(renderStreamEvent(event)).toBe("");
      });

      it(`returns "" for ${kind} with telemetry visibility`, () => {
        const event = buildEvent({ kind, visibility: "telemetry" });
        expect(renderStreamEvent(event)).toBe("");
      });
    }
  });

  // =========================================================================
  // Unknown event kind — forward-compatible, no throw
  // =========================================================================

  describe("unknown event kind", () => {
    it('returns "" for completely unknown kind', () => {
      const event = buildEvent({ kind: "future.unknown_event" });
      expect(renderStreamEvent(event)).toBe("");
    });

    it("does not throw for unknown kind", () => {
      const event = buildEvent({ kind: "bogus.event" });
      expect(() => renderStreamEvent(event)).not.toThrow();
    });
  });

  // =========================================================================
  // Payload safety — missing fields across all rendered kinds
  // =========================================================================

  describe("payload safety — missing fields", () => {
    const kindsThatRender = [
      "turn.started",
      "turn.state_changed",
      "turn.completed",
      "turn.aborted",
      "llm.started",
      "llm.completed",
      "llm.failed",
      "tool.started",
      "tool.finished",
      "tool.blocked",
    ];

    for (const kind of kindsThatRender) {
      it(`does not throw and emits no "undefined" for ${kind} with empty payload`, () => {
        const event = buildEvent({ kind, payload: {} });
        // Must not throw
        const result = renderStreamEvent(event);
        // Must not contain literal "undefined"
        expect(result).not.toContain("undefined");
        // Must be a string
        expect(typeof result).toBe("string");
      });
    }

    it("does not throw for response.completed with empty payload", () => {
      const event = buildEvent({ kind: "response.completed", payload: {} });
      expect(renderStreamEvent(event)).toBe("");
    });

    it("does not throw for validation.failed with empty payload", () => {
      const event = buildEvent({ kind: "validation.failed", payload: {} });
      expect(renderStreamEvent(event)).toBe("");
    });
  });

  // =========================================================================
  // Plain text output — no ANSI escapes, no bare \r
  // =========================================================================

  describe("plain text output", () => {
    it("contains no ANSI escape sequences", () => {
      const events: StreamEvent[] = [
        buildEvent({
          kind: "llm.started",
          visibility: "user",
        }),
        buildEvent({
          kind: "llm.completed",
          visibility: "system",
        }),
        buildEvent({
          kind: "tool.started",
          payload: { tool_name: "search" },
        }),
        buildEvent({
          kind: "response.completed",
          payload: { final_outcome: "Done." },
        }),
      ];

      for (const event of events) {
        expect(renderStreamEvent(event)).not.toMatch(/\x1b\[/);
      }
    });

    it("contains no bare carriage returns without newlines", () => {
      const events: StreamEvent[] = [
        buildEvent({ kind: "llm.started" }),
        buildEvent({
          kind: "turn.started",
          payload: { state: "inferring" },
        }),
      ];

      for (const event of events) {
        const result = renderStreamEvent(event);
        if (result.includes("\r")) {
          expect(result).toMatch(/\r\n/);
        }
      }
    });
  });

  // =========================================================================
  // Pure function — same input → same output
  // =========================================================================

  describe("purity", () => {
    it("returns identical results for the same event (no internal state)", () => {
      const event = buildEvent({
        kind: "llm.started",
        visibility: "user",
      });

      const first = renderStreamEvent(event);
      const second = renderStreamEvent(event);

      expect(first).toBe(second);
    });

    it("returns identical results for different event instances with same values", () => {
      const e1 = buildEvent({
        kind: "tool.started",
        payload: { tool_name: "bash" },
      });
      const e2 = buildEvent({
        kind: "tool.started",
        payload: { tool_name: "bash" },
      });

      expect(renderStreamEvent(e1)).toBe(renderStreamEvent(e2));
    });
  });
});
