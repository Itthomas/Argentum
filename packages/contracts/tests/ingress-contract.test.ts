import { describe, expect, it } from "vitest";

import {
  IngressValidationError,
  MessagePartValidationError,
  parseIngressDTO,
  parseMessagePart,
} from "../src/index.js";

describe("parseMessagePart", () => {
  it("accepts the MVP text message part shape", () => {
    const value = { kind: "text", text: "hello" };

    expect(parseMessagePart(value)).toEqual(value);
  });

  it("rejects unsupported kinds, missing text, unknown keys, and non-object input", () => {
    expectIssuesForMessagePart({ kind: "image", text: "hello" }, [
      { path: "kind", code: "invalid_literal" },
    ]);

    expectIssuesForMessagePart({ kind: "text" }, [
      { path: "text", code: "missing_required" },
    ]);

    expectIssuesForMessagePart({ kind: "text", text: "hello", extra: true }, [
      { path: "extra", code: "unknown_key" },
    ]);

    expectIssuesForMessagePart("hello", [{ path: "$", code: "invalid_type" }]);
  });
});

describe("parseIngressDTO", () => {
  it("accepts canonical ingress input and preserves message part ordering", () => {
    const ingress = makeValidIngress();
    ingress.message_parts = [
      { kind: "text", text: "first" },
      { kind: "text", text: "second" },
    ];

    const parsed = parseIngressDTO(ingress);

    expect(parsed).toEqual(ingress);
    expect(parsed.message_parts.map((part) => part.text)).toEqual(["first", "second"]);
    expect(parsed).not.toHaveProperty("attachments");
  });

  it("accepts optional object metadata and an explicit empty attachments array", () => {
    const ingress = makeValidIngress();
    ingress.metadata = { transport: "terminal", raw_mode: false };
    ingress.attachments = [];

    const parsed = parseIngressDTO(ingress);

    expect(parsed.metadata).toEqual({ transport: "terminal", raw_mode: false });
    expect(parsed.attachments).toEqual([]);
  });

  it("returns immutable detached ingress data after validation", () => {
    const ingress = makeValidIngress() as ReturnType<typeof makeValidIngress> & {
      metadata?: { transport: { mode: string }; tags: string[] };
      attachments?: [];
    };
    ingress.metadata = { transport: { mode: "raw" }, tags: ["cli"] };
    ingress.attachments = [];

    const parsed = parseIngressDTO(ingress);

    ingress.message_parts[0] = { kind: "text", text: "mutated" };
    (ingress.metadata.transport as { mode: string }).mode = "mutated";
    (ingress.metadata.tags as string[]).push("changed");
    (ingress.attachments as unknown[]).push("artifact");

    expect(parsed.message_parts).toEqual([{ kind: "text", text: "hello" }]);
    expect(parsed.metadata).toEqual({ transport: { mode: "raw" }, tags: ["cli"] });
    expect(parsed.attachments).toEqual([]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.message_parts)).toBe(true);
    expect(Object.isFrozen(parsed.message_parts[0])).toBe(true);
    expect(Object.isFrozen(parsed.metadata ?? {})).toBe(true);
    expect(Object.isFrozen((parsed.metadata as Record<string, unknown>).transport as object)).toBe(true);
    expect(Object.isFrozen((parsed.metadata as Record<string, unknown>).tags as object)).toBe(true);
  });

  it("rejects missing required fields, wrong primitive types, and invalid timestamps", () => {
    const ingress = makeValidIngress() as Record<string, unknown>;
    delete ingress.user_id;
    ingress.channel = 42;
    ingress.received_at = "2026-05-22T10:30:00+02:00";

    expectIssuesForIngress(ingress, [
      { path: "user_id", code: "missing_required" },
      { path: "channel", code: "invalid_type" },
      { path: "received_at", code: "invalid_format" },
    ]);
  });

  it("rejects non-object metadata, non-array attachments, non-empty attachments, and unknown top-level fields", () => {
    const ingress = makeValidIngress() as Record<string, unknown>;
    ingress.metadata = ["transport"];
    ingress.attachments = [{ ref: "artifact-1" }];
    ingress.debug = true;

    expectIssuesForIngress(ingress, [
      { path: "metadata", code: "invalid_type" },
      { path: "attachments", code: "invalid_value" },
      { path: "debug", code: "unknown_key" },
    ]);

    ingress.attachments = "not-an-array";

    expectIssuesForIngress(ingress, [
      { path: "attachments", code: "invalid_type" },
    ]);
  });

  it("rejects invalid nested message parts and non-object items inside message_parts", () => {
    const ingress = makeValidIngress();
    ingress.message_parts = [
      { kind: "text", text: "ok" },
      { kind: "image", text: "nope" } as never,
      "raw" as never,
      { kind: "text", text: "still ok", extra: true } as never,
    ];

    expectIssuesForIngress(ingress, [
      { path: "message_parts[1].kind", code: "invalid_literal" },
      { path: "message_parts[2]", code: "invalid_type" },
      { path: "message_parts[3].extra", code: "unknown_key" },
    ]);
  });
});

function expectIssuesForMessagePart(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getMessagePartIssues(value);

  expect(issues).toEqual(
    expect.arrayContaining(expected.map((issue) => expect.objectContaining(issue))),
  );
}

function expectIssuesForIngress(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getIngressIssues(value);

  expect(issues).toEqual(
    expect.arrayContaining(expected.map((issue) => expect.objectContaining(issue))),
  );
}

function getMessagePartIssues(value: unknown) {
  try {
    parseMessagePart(value);
  } catch (error) {
    if (error instanceof MessagePartValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected message part parsing to fail.");
}

function getIngressIssues(value: unknown) {
  try {
    parseIngressDTO(value);
  } catch (error) {
    if (error instanceof IngressValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected ingress parsing to fail.");
}

function makeValidIngress() {
  return {
    ingress_id: "ingress-123",
    session_id: "session-123",
    channel: "terminal_cli",
    user_id: "user-123",
    message_parts: [{ kind: "text" as const, text: "hello" }],
    received_at: "2026-05-22T10:30:00Z",
  };
}