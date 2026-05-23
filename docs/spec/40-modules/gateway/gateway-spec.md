# Gateway Spec

## Purpose

This spec defines the responsibilities of the gateway and I/O coordination layer.

## Responsibilities

- Accept normalized inbound channel payloads
- Resolve or create sessions
- Create `IngressDTO` and `TurnEnvelope` values
- Enforce one active turn per session
- Emit queue and turn lifecycle events

## Non-Responsibilities

- Deciding model actions
- Executing tools
- Formatting provider-native requests

## Inputs

- Channel-originated normalized message data
- Session persistence services

## Outputs

- `IngressDTO`
- `TurnEnvelope`
- `queue.*` and `turn.*` events

## MVP Constraints

- One local persistence-backed implementation
- No distributed queueing
- No multi-process lock coordination

## Acceptance Criteria

- Concurrent messages for one session cannot create overlapping active turns.