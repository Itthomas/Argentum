# Context Selection

## Purpose

This spec defines how the agentic layer chooses which context items enter one inference step.

## Selection Order

1. Required system and bedrock items
2. Current ingress and recent episodic items
3. Relevant compacted tool summaries
4. Additional environment context only if needed

## Rules

- Required bedrock context has priority over optional environment context.
- Context selection must prefer compact summaries over raw artifacts.
- The selector must record omitted-but-available context through references rather than silently losing it.
- Selection decisions must respect token and runtime budgets.

## MVP Constraints

- No retrieval over long-term vector memory in MVP unless later added explicitly as a tool
- No learned ranking model for context selection

## Acceptance Criteria

- The selection policy can explain why a given `ContextItem` entered or did not enter the current request.