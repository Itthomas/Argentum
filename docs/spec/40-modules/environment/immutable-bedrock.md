# Immutable Bedrock

## Purpose

This spec defines the runtime policy for operator-authored bootstrap files.

## Bedrock Contents

Bedrock includes persona files, operator policies, static tool manifests, and other operator-controlled bootstrap material.

## Rules

- Bedrock files are read-only during MVP runtime.
- The agent may read bedrock files when granted appropriate path access.
- The agent may not modify, delete, or replace bedrock files during normal MVP operation.
- Proposed future bedrock changes must be expressed as artifacts or patches in mutable workspace areas rather than direct mutation.

## Drift Risks

- Silent persona drift caused by self-editing bootstrap files
- Tool or policy changes occurring without explicit operator review

## Acceptance Criteria

- An implementation can enforce bedrock immutability without changing core-loop contracts.

## Open Questions

- Maintenance-mode write behavior is deferred to post-MVP design.