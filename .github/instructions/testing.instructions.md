---
name: Testing Rules
description: Pytest and verification guidance for unit and integration tests.
applyTo: "tests/**/*.py"
---

# Testing Rules

- Use pytest for all tests.
- Prefer deterministic tests over timing-sensitive or environment-sensitive behavior.
- Start with focused unit tests for policy, schema, and state-machine behavior before broad integration coverage.
- Align verification with the active phase doc when a phase packet defines specific gates or exit criteria.
- Test names should describe the architectural behavior or invariant being verified.
- Use fixtures to clarify setup boundaries rather than hiding key lifecycle assumptions inside test bodies.
