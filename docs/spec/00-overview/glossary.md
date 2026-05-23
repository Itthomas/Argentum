# Glossary

## Action Decision

The normalized result of one model inference step. It is the only decision object consumed by the core loop.

## Bedrock

Operator-controlled files that define persona, policies, and static runtime configuration. Bedrock is immutable during MVP execution.

## Compaction

The process of replacing a large raw tool output in working memory with a concise summary plus artifact references.

## Context Item

One provider-neutral unit of context selected for a model inference step.

## Episodic Memory

The current session transcript and related working-memory references used by the core loop.

## Execution Grant

The scoped permissions attached to a tool execution, including path, environment, and runtime limits.

## Ingress

Normalized user-originated input entering the system through the gateway.

## Provider Normalization

The adapter process that converts provider-native model behavior into canonical internal contracts.

## Session

The isolated runtime context for one user interaction stream, including queue state, episodic memory, and lock ownership.

## Stream Event

An append-only event emitted by the runtime for rendering, telemetry, or replay.

## Tool Result Artifact

An externalized record of raw tool output that is referenced from memory instead of stored inline.

## Turn Envelope

The canonical unit of work created for one accepted ingress and carried through execution until finalization.