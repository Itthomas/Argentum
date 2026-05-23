# Logging Plan

## Purpose

This document defines the MVP logging posture.

## Rules

- Logs are append-only and structured.
- Turn, session, ingress, request, and tool-call identifiers must be preserved for correlation.
- Large payloads are stored by artifact reference rather than repeated inline.
- Logs must be human-inspectable without a specialized observability backend.

## MVP Direction

- Prefer JSON-lines or similarly flat structured logs.
- Emit event records from the canonical `StreamEvent` pipeline.

## Acceptance Criteria

- An implementer can inspect one turn with ordinary local tooling and reconstruct the high-level execution path.