# Design Principles

## Purpose

This document defines the principles that all Argentum specs must preserve.

## Principles

### Agent-First Control Plane

The deterministic turn loop is the center of the system. Channels and gateways exist to feed and observe that loop rather than define runtime behavior.

### Explicit State Ownership

Argentum does not attempt to be stateless. Instead, each layer owns its own mutable state and communicates through explicit contracts.

### Provider-Neutral Core

The core loop must not depend on provider-native tool-call semantics, message shapes, or SDK abstractions. Provider adapters normalize those behaviors before crossing the boundary.

### Tool Registry As Canonical Schema Source

Tool definitions originate in the tool layer and are projected outward to providers. Provider adapters must not invent or mutate tool schema truth.

### Narrow MVP First

When design ambiguity exists, the chosen MVP behavior must preserve clean boundaries, minimize context load, and keep one implementation per modular boundary.

### Observability Before Magic

Argentum prefers explicit state transitions, typed events, and inspectable artifacts over hidden retries or opaque framework behavior.

### Compaction Over Transcript Sprawl

Raw tool output is not working memory. Large artifacts must be summarized and referenced rather than appended directly into the episodic transcript.

### Immutable Bedrock

Operator-authored bootstrap files are immutable during MVP runtime. Agent-authored state belongs in mutable working areas defined by the environment model.

## Spec Authoring Rules

- Normative behavior belongs in specs, not ADRs.
- Shared concepts are defined once and referenced elsewhere.
- Open questions are recorded explicitly instead of being resolved opportunistically.
- Leaf specs may narrow implementation details but may not widen MVP scope.