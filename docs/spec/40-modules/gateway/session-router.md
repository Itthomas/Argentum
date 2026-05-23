# Session Router

## Purpose

This spec defines how the gateway resolves session identity.

## Responsibilities

- Map a channel-scoped user key to one internal `session_id`
- Load or initialize session metadata
- Persist session lock and queue state references

## Rules

- The routing key must include channel identity and channel user identity.
- Session resolution must be deterministic for the same routing key.
- The session router must not own turn execution logic.

## MVP Constraints

- One local persistence mechanism
- No cross-host session coordination

## Acceptance Criteria

- The same terminal user key resolves to the same session across multiple inputs until session reset behavior is defined.