import { describe, expect, it } from "vitest";

import {
  ContentRefValidationError,
  parseContentRef,
  parseIngressDTO,
  parseMessagePart,
  parseTurnEnvelope,
  TurnEnvelopeValidationError,
} from "@argentum/contracts";

describe("@argentum/contracts package entrypoint", () => {
  it("resolves ingress and turn contracts through the published package surface", () => {
    expect(parseMessagePart({ kind: "text", text: "hello" })).toEqual({
      kind: "text",
      text: "hello",
    });

    expect(
      parseIngressDTO({
        ingress_id: "ingress-123",
        session_id: "session-123",
        channel: "terminal_cli",
        user_id: "user-123",
        message_parts: [{ kind: "text", text: "hello" }],
        received_at: "2026-05-22T10:30:00Z",
      }),
    ).toMatchObject({
      ingress_id: "ingress-123",
      session_id: "session-123",
      channel: "terminal_cli",
      user_id: "user-123",
      message_parts: [{ kind: "text", text: "hello" }],
      received_at: "2026-05-22T10:30:00Z",
    });

    expect(
      parseContentRef({
        ref_id: "ref-123",
        kind: "file",
        storage_area: "artifacts",
        locator: "turns/turn-123/output.md",
        retention: "persistent",
      }),
    ).toMatchObject({
      ref_id: "ref-123",
      kind: "file",
      storage_area: "artifacts",
      locator: "turns/turn-123/output.md",
      retention: "persistent",
    });

    expect(
      parseTurnEnvelope({
        turn_id: "turn-123",
        session_id: "session-123",
        ingress_id: "ingress-123",
        state: "accepted",
        step_count: 0,
        budget: {
          max_inference_steps: 12,
          max_repair_attempts: 3,
          max_wall_clock_ms: 600000,
          repair_attempts_used: 0,
        },
        context_refs: [
          {
            ref_id: "ref-123",
            kind: "file",
            storage_area: "artifacts",
            locator: "turns/turn-123/output.md",
            retention: "persistent",
          },
        ],
        compaction_revision: 0,
        created_at: "2026-05-22T10:30:00+00:00",
        updated_at: "Fri, 22 May 2026 10:30:00 GMT",
      }),
    ).toMatchObject({
      turn_id: "turn-123",
      session_id: "session-123",
      ingress_id: "ingress-123",
      state: "accepted",
      step_count: 0,
      compaction_revision: 0,
      created_at: "2026-05-22T10:30:00+00:00",
      updated_at: "Fri, 22 May 2026 10:30:00 GMT",
    });
  });

  it("exports validation errors for downstream callers", () => {
    expect(() => parseContentRef({})).toThrow(ContentRefValidationError);
    expect(() => parseTurnEnvelope({})).toThrow(TurnEnvelopeValidationError);
  });
});