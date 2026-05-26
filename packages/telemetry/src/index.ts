export { TelemetryWriter } from "./telemetry-writer.js";
export type { TelemetryWriterConfig } from "./telemetry-writer.js";
// Re-export StreamEvent for consumer convenience so callers can import
// both the writer and the event type from a single package.
export type { StreamEvent } from "@argentum/contracts";