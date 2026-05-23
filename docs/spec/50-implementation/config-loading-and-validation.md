# Config Loading And Validation

## Purpose

This document defines how the runtime loads and validates the centralized JSON configuration document.

## Rules

- Startup must load one JSON runtime config document before composition completes.
- The document must validate against `RuntimeConfigDTO` before any provider, gateway, tool registry, or execution driver is initialized.
- Invalid configuration must fail startup explicitly rather than falling through to implicit defaults.
- Optional fields may use implementation defaults only when those defaults do not change normative runtime behavior.
- Secret handles referenced by config must be checked against the available secret-loading mechanism during startup or first use, according to the environment-layer implementation.

## Derived Outputs

- `RuntimeConfigDTO.workspace` -> workspace root bindings
- `RuntimeConfigDTO.governor` -> default `TurnEnvelope.budget` values
- `RuntimeConfigDTO.gateway` -> queue-admission defaults
- `RuntimeConfigDTO.tool_policy` -> `RuntimePolicyDTO`
- `RuntimeConfigDTO.provider` -> provider adapter initialization

## Non-Goals

- Defining a secret-value storage backend
- Defining hot-reload behavior for runtime config in MVP

## Acceptance Criteria

- An implementer can boot the runtime from one validated JSON config file without inventing hidden bootstrap settings.