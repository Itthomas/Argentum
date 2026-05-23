# Episodic Memory

## Purpose

This spec defines the working-memory surface owned by the agentic layer.

## Contents

- Accepted user inputs for the session
- Committed assistant outputs
- Compacted tool summaries and artifact references
- Repair feedback added during validation recovery

## Rules

- Episodic memory is session-scoped.
- Raw tool artifacts must be referenced rather than stored inline when compaction rules require externalization.
- Bedrock content is not copied into episodic memory merely because it was read.
- Memory commits happen only at defined turn boundaries such as accepted ingress, compaction, and final response.

## MVP Constraints

- No background summarization worker
- No automatic long-term memory writeback during active turn execution

## Acceptance Criteria

- The next inference step can rely on compacted summaries without re-reading every raw tool artifact.