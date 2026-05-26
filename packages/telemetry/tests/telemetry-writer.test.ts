import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseStreamEvent } from "@argentum/contracts";
import type { StreamEvent } from "@argentum/contracts";

import { TelemetryWriter } from "../src/index.js";
import type { TelemetryWriterConfig } from "../src/index.js";

// ── Helpers ─────────────────────────────────────────────────────

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "argentum-telemetry-test-"));
}

async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Build a minimal valid turn-scoped StreamEvent for testing. */
function makeEvent(overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    event_id: randomUUID(),
    session_id: "sess-test",
    scope: "turn",
    turn_id: "turn-001",
    sequence: 1,
    kind: "turn.started",
    timestamp: new Date().toISOString(),
    visibility: "telemetry",
    payload: { session_id: "sess-test", ingress_id: "ing-001", state: "active" },
    ...overrides,
  } as StreamEvent;
}

/** Read a JSONL file and return parsed objects. */
async function readJsonlLines(filePath: string): Promise<unknown[]> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

// ── Tests ───────────────────────────────────────────────────────

describe("TelemetryWriter", () => {
  // ── Basic write ────────────────────────────────────────────

  it("writes a single event as one JSONL line", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const event = makeEvent();
      await writer.writeEvent(event);

      const filePath = path.join(logDir, `${event.session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual(event);
    } finally {
      await removeDir(logDir);
    }
  });

  it("writes each event as exactly one JSONL line", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const events = [makeEvent({ sequence: 1 }), makeEvent({ sequence: 2 }), makeEvent({ sequence: 3 })];

      for (const e of events) {
        await writer.writeEvent(e);
      }

      const filePath = path.join(logDir, `${events[0].session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(3);
    } finally {
      await removeDir(logDir);
    }
  });

  // ── JSONL format ───────────────────────────────────────────

  it("produces valid JSON per line parseable by JSON.parse", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const event = makeEvent({ payload: { key: "value", nested: { a: 1 } } });
      await writer.writeEvent(event);

      const filePath = path.join(logDir, `${event.session_id}.jsonl`);
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.trim().split("\n");

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Event ordering ─────────────────────────────────────────

  it("preserves event order for sequential writes", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const events = [
        makeEvent({ sequence: 1, kind: "turn.started" }),
        makeEvent({ sequence: 2, kind: "llm.started" }),
        makeEvent({ sequence: 3, kind: "llm.completed" }),
      ];

      for (const e of events) {
        await writer.writeEvent(e);
      }

      const filePath = path.join(logDir, `${events[0].session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(3);
      expect((lines[0] as StreamEvent).sequence).toBe(1);
      expect((lines[1] as StreamEvent).sequence).toBe(2);
      expect((lines[2] as StreamEvent).sequence).toBe(3);
    } finally {
      await removeDir(logDir);
    }
  });

  // ── H-0038-1: Concurrent write ordering ────────────────────

  it("preserves call order when writeEvent is called concurrently (promise-chain serialization)", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const events = [
        makeEvent({ sequence: 1, kind: "turn.started" }),
        makeEvent({ sequence: 2, kind: "llm.started" }),
        makeEvent({ sequence: 3, kind: "tool.started" }),
        makeEvent({ sequence: 4, kind: "tool.finished" }),
        makeEvent({ sequence: 5, kind: "response.started" }),
        makeEvent({ sequence: 6, kind: "response.completed" }),
        makeEvent({ sequence: 7, kind: "turn.completed" }),
      ];

      // Fire all writes concurrently — the internal #writeChain must
      // serialize them so line order matches the array order.
      await Promise.all(events.map((e) => writer.writeEvent(e)));

      const filePath = path.join(logDir, `${events[0].session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(events.length);

      for (let i = 0; i < events.length; i++) {
        expect((lines[i] as StreamEvent).sequence).toBe(i + 1);
        expect((lines[i] as StreamEvent).kind).toBe(events[i].kind);
      }
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Full event serialization ───────────────────────────────

  it("serializes all StreamEvent fields in the written JSON", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const event = makeEvent({
        event_id: "evt-full-001",
        session_id: "sess-full",
        scope: "turn",
        turn_id: "turn-full",
        sequence: 42,
        kind: "tool.finished",
        timestamp: "2026-01-15T10:30:00.000Z",
        visibility: "system",
        payload: { call_id: "call-xyz", tool_name: "read", status: "ok", duration_ms: 150 },
      });
      await writer.writeEvent(event);

      const filePath = path.join(logDir, `${event.session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      const parsed = lines[0] as StreamEvent;

      expect(parsed.event_id).toBe("evt-full-001");
      expect(parsed.session_id).toBe("sess-full");
      expect(parsed.scope).toBe("turn");
      expect(parsed.turn_id).toBe("turn-full");
      expect(parsed.sequence).toBe(42);
      expect(parsed.kind).toBe("tool.finished");
      expect(parsed.timestamp).toBe("2026-01-15T10:30:00.000Z");
      expect(parsed.visibility).toBe("system");
      expect(parsed.payload).toEqual({ call_id: "call-xyz", tool_name: "read", status: "ok", duration_ms: 150 });
    } finally {
      await removeDir(logDir);
    }
  });

  // ── One log file per session ───────────────────────────────

  it("writes events with different session_id to different files", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const e1 = makeEvent({ session_id: "sess-a", event_id: "evt-a" });
      const e2 = makeEvent({ session_id: "sess-b", event_id: "evt-b" });

      await writer.writeEvent(e1);
      await writer.writeEvent(e2);

      const fileA = path.join(logDir, "sess-a.jsonl");
      const fileB = path.join(logDir, "sess-b.jsonl");

      const linesA = await readJsonlLines(fileA);
      const linesB = await readJsonlLines(fileB);

      expect(linesA).toHaveLength(1);
      expect(linesB).toHaveLength(1);
      expect((linesA[0] as StreamEvent).event_id).toBe("evt-a");
      expect((linesB[0] as StreamEvent).event_id).toBe("evt-b");
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Append to existing file ────────────────────────────────

  it("appends to an existing log file instead of overwriting", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const sessionId = "sess-append";

      await writer.writeEvent(makeEvent({ session_id: sessionId, sequence: 1 }));
      await writer.writeEvent(makeEvent({ session_id: sessionId, sequence: 2 }));

      const filePath = path.join(logDir, `${sessionId}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(2);
      expect((lines[0] as StreamEvent).sequence).toBe(1);
      expect((lines[1] as StreamEvent).sequence).toBe(2);
    } finally {
      await removeDir(logDir);
    }
  });

  // ── persistEvents: false ───────────────────────────────────

  it("is a no-op when persistEvents is false", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: false });
      const event = makeEvent({ session_id: "sess-noop" });

      await writer.writeEvent(event);
      await writer.writeEvent(makeEvent({ session_id: "sess-noop", sequence: 2 }));

      const filePath = path.join(logDir, "sess-noop.jsonl");
      await expect(readFile(filePath, "utf-8")).rejects.toThrow();
    } finally {
      await removeDir(logDir);
    }
  });

  it("flush() is a no-op when persistEvents is false", async () => {
    const writer = new TelemetryWriter({ logDir: "/nonexistent", format: "jsonl", persistEvents: false });
    await expect(writer.flush()).resolves.toBeUndefined();
  });

  // ── Directory auto-creation ────────────────────────────────

  it("creates the log directory recursively on first write", async () => {
    const baseDir = await tempDir();
    const logDir = path.join(baseDir, "nested", "logs");
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const event = makeEvent();
      await writer.writeEvent(event);

      const filePath = path.join(logDir, `${event.session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(1);
    } finally {
      await removeDir(baseDir);
    }
  });

  // ── Directory creation failure ─────────────────────────────

  it("throws when logDir path is a file, not a directory", async () => {
    const baseDir = await tempDir();
    try {
      // Create a file where the directory should be
      const filePath = path.join(baseDir, "blocker");
      await writeFile(filePath, "blocked");

      const writer = new TelemetryWriter({ logDir: filePath, format: "jsonl", persistEvents: true });
      await expect(writer.writeEvent(makeEvent())).rejects.toThrow();
    } finally {
      await removeDir(baseDir);
    }
  });

  // ── flush() no-op ──────────────────────────────────────────

  it("flush() resolves without error after writes", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      await writer.writeEvent(makeEvent());
      await expect(writer.flush()).resolves.toBeUndefined();
    } finally {
      await removeDir(logDir);
    }
  });

  it("flush() resolves without error with no prior writes", async () => {
    const writer = new TelemetryWriter({ logDir: "/nonexistent", format: "jsonl", persistEvents: true });
    await expect(writer.flush()).resolves.toBeUndefined();
  });

  // ── Immutability of input ──────────────────────────────────

  it("does not mutate the StreamEvent passed to writeEvent", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const event = makeEvent();
      const snapshot = JSON.parse(JSON.stringify(event));

      await writer.writeEvent(event);

      expect(event).toEqual(snapshot);
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Special characters in payload ──────────────────────────

  it("handles payloads with Unicode, newlines, quotes, and backslashes", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const specialPayload = {
        unicode: "こんにちは 🌍",
        nested: { quote: 'he said "hello"', backslash: "C:\\path\\to\\file" },
        multiline: "line1\nline2\r\nline3",
        slash: "forward/slash",
      };
      const event = makeEvent({ payload: specialPayload });
      await writer.writeEvent(event);

      const filePath = path.join(logDir, `${event.session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(1);
      expect((lines[0] as StreamEvent).payload).toEqual(specialPayload);
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Minimum payload presence per event family ──────────────

  it("writes events from all required MVP event families with payload intact", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });

      const turnEvent = makeEvent({ kind: "turn.started", payload: { session_id: "s", ingress_id: "i", state: "active" } });
      const validationEvent = makeEvent({ kind: "validation.failed", payload: { phase: "parse", reason: "bad json", repairable: false } });
      const llmEvent = makeEvent({ kind: "llm.started", payload: { request_id: "req-1", tool_count: 3 } });
      const toolEvent = makeEvent({ kind: "tool.finished", payload: { call_id: "call-1", tool_name: "read", status: "ok", duration_ms: 100 } });
      const memoryEvent = makeEvent({ kind: "memory.compaction_started", payload: { call_id: "call-2", compaction_revision: 1 } });
      const responseEvent = makeEvent({ kind: "response.completed", payload: { response_kind: "text", final_outcome: "sent" } });
      const queueEvent = makeEvent({ kind: "queue.queued", scope: "session", payload: { session_id: "s", ingress_id: "i", queue_length: 3 } });

      const allEvents = [turnEvent, validationEvent, llmEvent, toolEvent, memoryEvent, responseEvent, queueEvent];
      for (const e of allEvents) {
        await writer.writeEvent(e);
      }

      const filePath = path.join(logDir, `${turnEvent.session_id}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(allEvents.length);

      const kinds = lines.map((l) => (l as StreamEvent).kind);
      expect(kinds).toContain("turn.started");
      expect(kinds).toContain("validation.failed");
      expect(kinds).toContain("llm.started");
      expect(kinds).toContain("tool.finished");
      expect(kinds).toContain("memory.compaction_started");
      expect(kinds).toContain("response.completed");
      expect(kinds).toContain("queue.queued");
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Telemetry replay ───────────────────────────────────────

  it("supports replay of a full turn lifecycle from telemetry records", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const sessionId = "sess-replay";
      const turnId = "turn-replay";

      const lifecycle: StreamEvent[] = [
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 1, kind: "turn.started", payload: { session_id: sessionId, ingress_id: "ing-r", state: "active" } }),
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 2, kind: "llm.started", payload: { request_id: "req-r", tool_count: 2 } }),
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 3, kind: "llm.completed", payload: { request_id: "req-r", normalization_status: "ok" } }),
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 4, kind: "tool.started", payload: { call_id: "call-r", tool_name: "read" } }),
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 5, kind: "tool.finished", payload: { call_id: "call-r", tool_name: "read", status: "ok", duration_ms: 50 } }),
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 6, kind: "response.started", payload: { response_kind: "text" } }),
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 7, kind: "response.completed", payload: { response_kind: "text", final_outcome: "sent" } }),
        makeEvent({ session_id: sessionId, turn_id: turnId, sequence: 8, kind: "turn.completed", payload: { final_outcome: "success", step_count: 3 } }),
      ];

      for (const e of lifecycle) {
        await writer.writeEvent(e);
      }

      const filePath = path.join(logDir, `${sessionId}.jsonl`);
      const lines = await readJsonlLines(filePath);
      expect(lines).toHaveLength(lifecycle.length);

      // Verify order and structure
      const parsed = lines as StreamEvent[];
      const kinds = parsed.map((e) => e.kind);
      expect(kinds).toEqual([
        "turn.started",
        "llm.started",
        "llm.completed",
        "tool.started",
        "tool.finished",
        "response.started",
        "response.completed",
        "turn.completed",
      ]);

      for (const e of parsed) {
        expect(e.session_id).toBe(sessionId);
        expect(e.turn_id).toBe(turnId);
        expect(e.payload).toBeDefined();
      }
    } finally {
      await removeDir(logDir);
    }
  });

  // ── H-0038-2: JSONL round-trip through parseStreamEvent() ──

  it("round-trips: write → read JSONL → JSON.parse → parseStreamEvent → assert deep equality", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const original = makeEvent({
        event_id: "evt-roundtrip",
        session_id: "sess-rt",
        scope: "turn",
        turn_id: "turn-rt",
        sequence: 99,
        kind: "tool.finished",
        timestamp: "2026-05-24T12:00:00.000Z",
        visibility: "system",
        payload: { call_id: "call-rt", tool_name: "grep", status: "ok", duration_ms: 230 },
      });

      await writer.writeEvent(original);

      // Read back the raw JSONL line
      const filePath = path.join(logDir, `${original.session_id}.jsonl`);
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(1);

      // JSON.parse the line...
      const parsed = JSON.parse(lines[0]);

      // ...then re-validate through parseStreamEvent
      const validated = parseStreamEvent(parsed);

      // The validated event must be deeply equal to the original
      expect(validated).toEqual(original);
    } finally {
      await removeDir(logDir);
    }
  });

  it("round-trip works for session-scoped events (queue.*)", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const original = makeEvent({
        event_id: "evt-queue-rt",
        session_id: "sess-queue-rt",
        scope: "session",
        turn_id: undefined, // session-scoped events have no turn_id
        sequence: 1,
        kind: "queue.queued",
        timestamp: "2026-05-24T12:00:00.000Z",
        visibility: "telemetry",
        payload: { session_id: "sess-queue-rt", ingress_id: "ing-rt", queue_length: 5 },
      });

      await writer.writeEvent(original);

      const filePath = path.join(logDir, `${original.session_id}.jsonl`);
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      const validated = parseStreamEvent(parsed);

      expect(validated).toEqual(original);
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Write error propagation ─────────────────────────────────

  it("throws when appendFile fails (e.g., read-only directory)", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const event = makeEvent();

      // Write once to ensure the directory exists
      await writer.writeEvent(event);

      // Make the log file read-only to force a write error
      const filePath = path.join(logDir, `${event.session_id}.jsonl`);
      await writeFile(filePath, "", { mode: 0o444 });

      await expect(writer.writeEvent(makeEvent({ sequence: 2 }))).rejects.toThrow();
    } finally {
      await removeDir(logDir);
    }
  });

  // ── Write chain resilience ──────────────────────────────────

  // On Windows, chmod-style file permissions (mode: 0o444 / 0o644) do not
  // behave like POSIX. After setting a file read-only, `writeFile(..., { mode:
  // 0o644 })` fails with EPERM because the file is still read-only — there is
  // no direct POSIX-equivalent way to restore write permission atomically.
  // The chain-resilience logic is already validated on other platforms, so we
  // skip this test on win32 rather than introducing a mock-based alternative.
  const itWin32Skip = process.platform === "win32" ? it.skip : it;

  itWin32Skip("continues accepting writes after a failed write (chain not broken)", async () => {
    const logDir = await tempDir();
    try {
      const writer = new TelemetryWriter({ logDir, format: "jsonl", persistEvents: true });
      const event = makeEvent();

      // First write succeeds (creates directory + file)
      await writer.writeEvent(event);

      // Make the file read-only to force the next write to fail
      const filePath = path.join(logDir, `${event.session_id}.jsonl`);
      await writeFile(filePath, "", { mode: 0o444 });

      // This write should fail
      await expect(writer.writeEvent(makeEvent({ event_id: "evt-fail", sequence: 2 }))).rejects.toThrow();

      // Make the file writable again so the next write can succeed
      await writeFile(filePath, "", { mode: 0o644 });

      // This write should succeed — the chain must not be broken
      const recoveryEvent = makeEvent({ event_id: "evt-recovery", sequence: 3 });
      await writer.writeEvent(recoveryEvent);

      // Verify the recovery event was written
      const lines = await readJsonlLines(filePath);
      const lastLine = lines[lines.length - 1] as StreamEvent;
      expect(lastLine.event_id).toBe("evt-recovery");
    } finally {
      await removeDir(logDir);
    }
  });
});
