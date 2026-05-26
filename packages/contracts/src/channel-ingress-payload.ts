import type { MessagePart } from "./message-part.js";

/**
 * Partial ingress payload produced by a channel adapter before the gateway
 * assigns {@link ingress_id} and {@link session_id} to construct the final
 * {@link IngressDTO}.
 *
 * Structural compatibility: {@link ChannelIngressPayload} is assignable to
 * `Omit<IngressDTO, "ingress_id" | "session_id">` (i.e. `GatewayIngressInput`).
 */
export type ChannelIngressPayload = Readonly<{
  channel: string;
  user_id: string;
  message_parts: readonly MessagePart[];
  received_at: string;
}>;
