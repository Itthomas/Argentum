import type { StreamEvent, StreamEventPayload } from "@argentum/contracts";

/**
 * Render a {@link StreamEvent} into a human-readable plain-text string.
 *
 * The function is pure — no I/O, no side effects, no internal state.
 * Callers decide where to write the returned string.
 *
 * Visibility filtering:
 * - `"telemetry"` events always return `""`.
 * - `"system"` events that produce output are prefixed with `[system] `.
 * - `"user"` events are always rendered when the event kind has output.
 *
 * Unknown event kinds return `""` (forward-compatible, no throw).
 *
 * @param event - The stream event to render.
 * @returns A plain-text rendering of the event, or `""` for hidden events.
 */
export function renderStreamEvent(event: StreamEvent): string {
  // Telemetry events are always hidden from terminal output.
  if (event.visibility === "telemetry") {
    return "";
  }

  const { kind, visibility, payload } = event;

  // Helper: conditionally prefix system-visible output.
  const systemPrefix = visibility === "system" ? "[system] " : "";

  // Payload field accessors with graceful fallback.
  const reason = (payload as StreamEventPayload)["reason"] as string | undefined;
  const toolName = (payload as StreamEventPayload)["tool_name"] as string | undefined;
  const fromState = (payload as StreamEventPayload)["from_state"] as string | undefined;
  const toState = (payload as StreamEventPayload)["to_state"] as string | undefined;
  const state = (payload as StreamEventPayload)["state"] as string | undefined;
  const finalOutcome = (payload as StreamEventPayload)["final_outcome"] as string | undefined;
  const repairable = (payload as StreamEventPayload)["repairable"] as boolean | undefined;

  // Event-kind routing via lookup table / switch on string prefix.
  switch (kind) {
    // -- turn.* ----------------------------------------------------------
    case "turn.started": {
      const stateSuffix = state ? ` (${state})` : "";
      return `Turn started${stateSuffix}.`;
    }
    case "turn.state_changed": {
      const from = fromState ?? "unknown";
      const to = toState ?? "unknown";
      return `${systemPrefix}State: ${from} → ${to}`;
    }
    case "turn.completed":
      return "Done.";
    case "turn.aborted":
      return `Turn aborted: ${reason ?? "unknown"}`;

    // -- llm.* -----------------------------------------------------------
    case "llm.started":
      return "Thinking...";
    case "llm.completed":
      // Shown only to system visibility; hidden for user visibility.
      return visibility === "system" ? "[system] Inference complete." : "";
    case "llm.failed":
      return `Inference failed: ${reason ?? "unknown"}`;

    // -- tool.* ----------------------------------------------------------
    case "tool.started":
      return `Using ${toolName ?? "unknown"}...`;
    case "tool.finished":
      return `${toolName ?? "unknown"} completed`;
    case "tool.blocked":
      return `${toolName ?? "unknown"} blocked: ${reason ?? "unknown"}`;

    // -- validation.* ----------------------------------------------------
    case "validation.failed": {
      // Only render unrepairable failures; repairable ones are silent
      // (a subsequent repair event will follow).
      if (repairable !== false) {
        return "";
      }
      return `${systemPrefix}Validation failed: ${reason ?? "unknown"}`;
    }

    // -- response.* ------------------------------------------------------
    case "response.started":
      return "";
    case "response.completed":
      // Extract only final_outcome — the sole spec-guaranteed field.
      return finalOutcome ?? "";

    // -- queue.* ---------------------------------------------------------
    case "queue.rejected":
      return `${systemPrefix}Queue full — input rejected`;
    case "queue.queued":
    case "queue.dequeued":
      return "";

    // -- memory.* --------------------------------------------------------
    case "memory.compaction_started":
    case "memory.compaction_committed":
      return "";

    // -- tool.planned, validation.repair_requested (implementation details)
    case "tool.planned":
    case "validation.repair_requested":
      return "";

    // -- Forward-compatible: unknown kinds produce no output. ------------
    default:
      return "";
  }
}
