import type { ChannelIngressPayload, MessagePart } from "@argentum/contracts";

/**
 * Error thrown by {@link normalizeCliInput} when the raw CLI input is empty,
 * whitespace-only, or fails structural validation.
 */
export class CliInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliInputError";
  }
}

/**
 * Normalize raw CLI input into a frozen {@link ChannelIngressPayload} suitable
 * for gateway consumption.
 *
 * The gateway is responsible for assigning `ingress_id` and `session_id` and
 * constructing the final `IngressDTO`.  This function therefore returns a
 * partial payload that omits those two fields.
 *
 * @param rawInput - The raw user input string from the terminal.
 * @returns A frozen, validated `ChannelIngressPayload`.
 * @throws {CliInputError} When the trimmed input is empty, whitespace-only,
 *   or when the constructed `message_parts` / `text` fields are invalid.
 */
export function normalizeCliInput(rawInput: string): ChannelIngressPayload {
  const trimmed = rawInput.trim();

  if (trimmed === "") {
    throw new CliInputError(
      "CLI input is empty or contains only whitespace.",
    );
  }

  const messageParts: readonly MessagePart[] = [
    { kind: "text" as const, text: trimmed },
  ];

  // Structural validation — belt-and-suspenders guard for internal consistency.
  if (messageParts.length === 0) {
    throw new CliInputError(
      "CLI normalization produced an empty message_parts array.",
    );
  }

  const firstPart = messageParts[0];
  if (!firstPart || firstPart.text === "") {
    throw new CliInputError(
      "CLI normalization produced a message part with empty text.",
    );
  }

  const payload: ChannelIngressPayload = {
    channel: "terminal_cli",
    user_id: "local",
    message_parts: messageParts,
    received_at: new Date().toISOString(),
  };

  return Object.freeze(payload);
}
