---
name: Python Architecture Rules
description: Core Python and runtime architecture rules for application code.
applyTo: "src/argentum/**/*.py,pyproject.toml"
---

# Python Architecture Rules

- Use `from __future__ import annotations` in Python source files.
- Add full type hints on public and internal function signatures unless a file already establishes a different local pattern.
- Prefer Pydantic models for durable schemas and structured payloads unless the canonical docs explicitly allow another shape.
- Prefer `async def` for orchestration and external I/O paths.
- Route model access through policy and orchestration layers; do not add ad hoc provider calls at leaf call sites.
- Keep LangGraph working state narrow and ephemeral; durable truth belongs in the database-backed system of record.
- Avoid hidden lifecycle mutations; task, claim, and approval changes should flow through explicit policy-aware helpers.
