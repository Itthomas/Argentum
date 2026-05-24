import { describe, expect, it } from "vitest";

import {
  ContentRefValidationError,
  TurnEnvelopeValidationError,
  parseContentRef,
  parseTurnEnvelope,
} from "../src/index.js";

describe("parseContentRef", () => {
  it("accepts canonical content references across allowed literal combinations", () => {
    expect(
      parseContentRef({
        ref_id: "ref-text-1",
        kind: "text",
        storage_area: "working",
        locator: "sessions/session-123/context/intro.txt",
        retention: "session",
      }),
    ).toEqual({
      ref_id: "ref-text-1",
      kind: "text",
      storage_area: "working",
      locator: "sessions/session-123/context/intro.txt",
      retention: "session",
    });

    expect(
      parseContentRef({
        ref_id: "ref-json-1",
        kind: "json",
        storage_area: "artifacts",
        locator: "turns/turn-123/result.json",
        media_type: "application/json",
        retention: "persistent",
      }),
    ).toEqual({
      ref_id: "ref-json-1",
      kind: "json",
      storage_area: "artifacts",
      locator: "turns/turn-123/result.json",
      media_type: "application/json",
      retention: "persistent",
    });
  });

  it("rejects missing required fields, invalid literals, wrong types, and unknown keys", () => {
    expectContentRefIssues(
      {
        kind: "xml",
        storage_area: 42,
        locator: "logs/trace.ndjson",
        retention: "forever",
        extra: true,
      },
      [
        { path: "ref_id", code: "missing_required" },
        { path: "kind", code: "invalid_literal" },
        { path: "storage_area", code: "invalid_type" },
        { path: "retention", code: "invalid_literal" },
        { path: "extra", code: "unknown_key" },
      ],
    );
  });

  it("rejects locators that are not relative to the declared storage area", () => {
    expectContentRefIssues(
      {
        ref_id: "ref-absolute-1",
        kind: "file",
        storage_area: "working",
        locator: "C:/temp/output.txt",
        retention: "session",
      },
      [{ path: "locator", code: "invalid_value" }],
    );

    expectContentRefIssues(
      {
        ref_id: "ref-absolute-2",
        kind: "file",
        storage_area: "working",
        locator: "/tmp/output.txt",
        retention: "session",
      },
      [{ path: "locator", code: "invalid_value" }],
    );

    expectContentRefIssues(
      {
        ref_id: "ref-absolute-3",
        kind: "file",
        storage_area: "working",
        locator: "file://runtime/output.txt",
        retention: "session",
      },
      [{ path: "locator", code: "invalid_value" }],
    );
  });
});

describe("parseTurnEnvelope", () => {
  it("accepts a valid newly accepted turn envelope", () => {
    const turnEnvelope = makeValidTurnEnvelope();

    expect(parseTurnEnvelope(turnEnvelope)).toEqual(turnEnvelope);
  });

  it("accepts a finalized turn envelope with optional final_outcome", () => {
    const turnEnvelope = makeValidTurnEnvelope();
    turnEnvelope.state = "completed";
    turnEnvelope.final_outcome = "completed";

    const parsed = parseTurnEnvelope(turnEnvelope);

    expect(parsed.state).toBe("completed");
    expect(parsed.final_outcome).toBe("completed");
  });

  it("accepts explicit UTC timestamp variants without requiring only Z suffixes", () => {
    const turnEnvelope = makeValidTurnEnvelope();
    turnEnvelope.created_at = "2026-05-22T10:30:00+00:00";
    turnEnvelope.updated_at = "Fri, 22 May 2026 10:30:00 GMT";

    const parsed = parseTurnEnvelope(turnEnvelope);

    expect(parsed.created_at).toBe("2026-05-22T10:30:00+00:00");
    expect(parsed.updated_at).toBe("Fri, 22 May 2026 10:30:00 GMT");
  });

  it("preserves nested content refs through context_refs", () => {
    const turnEnvelope = makeValidTurnEnvelope();
    turnEnvelope.context_refs = [
      makeValidContentRef(),
      {
        ref_id: "ref-trace-1",
        kind: "trace",
        storage_area: "logs",
        locator: "turns/turn-123/trace.ndjson",
        retention: "session",
      },
    ];

    const parsed = parseTurnEnvelope(turnEnvelope);

    expect(parsed.context_refs).toEqual(turnEnvelope.context_refs);
  });

  it("rejects missing required top-level fields", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;

    delete turnEnvelope.turn_id;
    delete turnEnvelope.session_id;
    delete turnEnvelope.ingress_id;
    delete turnEnvelope.state;
    delete turnEnvelope.step_count;
    delete turnEnvelope.budget;
    delete turnEnvelope.context_refs;
    delete turnEnvelope.compaction_revision;
    delete turnEnvelope.created_at;
    delete turnEnvelope.updated_at;

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "turn_id", code: "missing_required" },
      { path: "session_id", code: "missing_required" },
      { path: "ingress_id", code: "missing_required" },
      { path: "state", code: "missing_required" },
      { path: "step_count", code: "missing_required" },
      { path: "budget", code: "missing_required" },
      { path: "context_refs", code: "missing_required" },
      { path: "compaction_revision", code: "missing_required" },
      { path: "created_at", code: "missing_required" },
      { path: "updated_at", code: "missing_required" },
    ]);
  });

  it("rejects missing required budget fields and unknown budget keys", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.budget = {
      max_inference_steps: 12,
      extra_budget_field: true,
    };

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "budget.max_repair_attempts", code: "missing_required" },
      { path: "budget.max_wall_clock_ms", code: "missing_required" },
      { path: "budget.repair_attempts_used", code: "missing_required" },
      { path: "budget.extra_budget_field", code: "unknown_key" },
    ]);
  });

  it("rejects invalid states, timestamps, non-arrays, negative counters, and invalid nested refs", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.state = "queued";
    turnEnvelope.step_count = -1;
    turnEnvelope.compaction_revision = -2;
    turnEnvelope.created_at = "2026-05-22T10:30:00+02:00";
    turnEnvelope.updated_at = "not-a-timestamp";
    turnEnvelope.context_refs = [
      makeValidContentRef(),
      {
        ref_id: "ref-bad-1",
        kind: "bad",
        storage_area: "working",
        locator: "ctx/item",
        retention: "session",
      },
    ];

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "state", code: "invalid_literal" },
      { path: "step_count", code: "invalid_value" },
      { path: "compaction_revision", code: "invalid_value" },
      { path: "created_at", code: "invalid_format" },
      { path: "updated_at", code: "invalid_format" },
      { path: "context_refs[1].kind", code: "invalid_literal" },
    ]);

    turnEnvelope.context_refs = "not-an-array";

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "context_refs", code: "invalid_type" },
    ]);
  });

  it("rejects textual timestamps that still encode a non-zero offset", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.created_at = "Fri, 22 May 2026 10:30:00 GMT-0500";
    turnEnvelope.updated_at = "Fri, 22 May 2026 10:30:00 UTC+01:00";

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "created_at", code: "invalid_format" },
      { path: "updated_at", code: "invalid_format" },
    ]);
  });

  it("rejects nested content refs with missing required fields and unknown keys", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.context_refs = [
      {
        kind: "file",
        storage_area: "artifacts",
        locator: "turns/turn-123/output.md",
        retention: "persistent",
        extra: true,
      },
    ];

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "context_refs[0].ref_id", code: "missing_required" },
      { path: "context_refs[0].extra", code: "unknown_key" },
    ]);
  });

  it("rejects wrong primitive types and unknown top-level fields", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.turn_id = 123;
    turnEnvelope.final_outcome = 456;
    turnEnvelope.budget = "nope";
    turnEnvelope.debug = true;

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "turn_id", code: "invalid_type" },
      { path: "final_outcome", code: "invalid_type" },
      { path: "budget", code: "invalid_type" },
      { path: "debug", code: "unknown_key" },
    ]);
  });

  it("accepts TurnBudget with optional max_tokens_per_step present and valid", () => {
    const turnEnvelope = makeValidTurnEnvelope();
    turnEnvelope.budget = {
      ...turnEnvelope.budget,
      max_tokens_per_step: 4096,
    };

    const parsed = parseTurnEnvelope(turnEnvelope);

    expect(parsed.budget.max_tokens_per_step).toBe(4096);
  });

  it("accepts TurnBudget without max_tokens_per_step (optional field)", () => {
    const turnEnvelope = makeValidTurnEnvelope();
    // budget does not include max_tokens_per_step

    const parsed = parseTurnEnvelope(turnEnvelope);

    expect(parsed.budget).not.toHaveProperty("max_tokens_per_step");
  });

  it("rejects TurnBudget with max_tokens_per_step = 0 (must be >= 1)", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.budget = {
      ...makeValidTurnEnvelope().budget,
      max_tokens_per_step: 0,
    };

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "budget.max_tokens_per_step", code: "invalid_value" },
    ]);
  });

  it("rejects TurnBudget with max_tokens_per_step = -1 (must be >= 1)", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.budget = {
      ...makeValidTurnEnvelope().budget,
      max_tokens_per_step: -1,
    };

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "budget.max_tokens_per_step", code: "invalid_value" },
    ]);
  });

  it("rejects TurnBudget with max_tokens_per_step as float", () => {
    const turnEnvelope = makeValidTurnEnvelope() as Record<string, unknown>;
    turnEnvelope.budget = {
      ...makeValidTurnEnvelope().budget,
      max_tokens_per_step: 4096.5,
    };

    expectTurnEnvelopeIssues(turnEnvelope, [
      { path: "budget.max_tokens_per_step", code: "invalid_integer" },
    ]);
  });
});

function expectContentRefIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getContentRefIssues(value);

  expect(issues).toEqual(
    expect.arrayContaining(expected.map((issue) => expect.objectContaining(issue))),
  );
}

function expectTurnEnvelopeIssues(
  value: unknown,
  expected: Array<{ path: string; code: string }>,
): void {
  const issues = getTurnEnvelopeIssues(value);

  expect(issues).toEqual(
    expect.arrayContaining(expected.map((issue) => expect.objectContaining(issue))),
  );
}

function getContentRefIssues(value: unknown) {
  try {
    parseContentRef(value);
  } catch (error) {
    if (error instanceof ContentRefValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected content ref parsing to fail.");
}

function getTurnEnvelopeIssues(value: unknown) {
  try {
    parseTurnEnvelope(value);
  } catch (error) {
    if (error instanceof TurnEnvelopeValidationError) {
      return error.issues;
    }

    throw error;
  }

  throw new Error("Expected turn envelope parsing to fail.");
}

function makeValidContentRef() {
  return {
    ref_id: "ref-123",
    kind: "file" as const,
    storage_area: "artifacts" as const,
    locator: "turns/turn-123/output.md",
    media_type: "text/markdown",
    retention: "persistent" as const,
  };
}

function makeValidTurnEnvelope() {
  return {
    turn_id: "turn-123",
    session_id: "session-123",
    ingress_id: "ingress-123",
    state: "accepted" as const,
    step_count: 0,
    budget: {
      max_inference_steps: 12,
      max_repair_attempts: 3,
      max_wall_clock_ms: 600000,
      repair_attempts_used: 0,
    },
    context_refs: [makeValidContentRef()],
    compaction_revision: 0,
    created_at: "2026-05-22T10:30:00Z",
    updated_at: "2026-05-22T10:30:00Z",
  };
}