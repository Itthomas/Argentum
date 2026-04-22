# Current Phase

## Active Phase

Phase 4: Self-Extension And Hardening

## Goal

Introduce governed self-extension and production hardening without violating the core constraints on approvals, explicit tooling, provider policy, and auditability.

## Immediate Tasks

- Define tool proposal, validation, verification, approval, and activation boundaries.
- Specify bounded initial activation scopes and explicit scope-widening rules.
- Expand provider degradation tracking and fallback visibility.
- Add observability surfaces for autonomous actions, tool use, and cost visibility.
- Harden restart and recovery flows for interrupted high-consequence operations.

## Current Blockers

- No generated-tool lifecycle records or staged activation handling exist yet.
- Provider fallback visibility and high-consequence observability are still minimal.

## Definition Of Done

- Generated tools cannot activate without explicit approval.
- Provider fallback and degradation behavior are visible and policy-driven.
- Phase 4 behavior is covered by deterministic tests where practical.