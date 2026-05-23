# Telemetry

## Purpose

This spec defines how the gateway exposes runtime observability.

## Responsibilities

- Subscribe to emitted `StreamEvent` values
- Persist append-only telemetry records
- Preserve event ordering per turn
- Attach correlation identifiers for turn, session, and tool call flows

## Rules

- Telemetry storage is append-only in MVP.
- Large payloads must be stored by reference rather than duplicated in logs.
- Telemetry must not become a hidden control channel.

## MVP Constraints

- Flat structured logs suitable for plaintext debugging
- No centralized metrics backend required

## Acceptance Criteria

- An implementer can replay one turn's high-level state transitions from telemetry records alone.