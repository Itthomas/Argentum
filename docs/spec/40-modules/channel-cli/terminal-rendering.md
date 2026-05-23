# Terminal Rendering

## Purpose

This spec defines how user-visible runtime events are presented in the terminal.

## Rules

- The CLI adapter renders from `StreamEvent` values rather than private runtime state.
- User-facing event output must remain readable in a plain terminal.
- Telemetry-only events may be hidden from normal terminal output.
- Final assistant responses must be clearly distinguishable from intermediate progress.

## MVP Constraints

- Plain text and simple structured output only
- No dependency on a complex terminal UI framework

## Acceptance Criteria

- A user can tell when the system is thinking, acting, blocked, or finished by reading terminal output alone.