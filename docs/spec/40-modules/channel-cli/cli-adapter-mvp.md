# CLI Adapter MVP

## Purpose

This spec defines the terminal CLI channel module for MVP.

## Responsibilities

- Read terminal input from the local operator session
- Normalize user input for the gateway
- Render user-visible `StreamEvent` values back to the terminal

## Non-Responsibilities

- Maintaining session routing logic
- Executing the turn state machine
- Formatting provider-native requests

## MVP Constraints

- One local interactive terminal channel
- No multi-user terminal multiplexing
- No rich TUI requirement
- Each accepted terminal input is normalized into one `ChannelIngressPayload` containing exactly one `MessagePart` with `kind = text`. The gateway owns full `IngressDTO` construction — it adds `ingress_id` and `session_id` to the normalized payload.

## Acceptance Criteria

- A user can submit input and observe turn progress and final output through the terminal alone.