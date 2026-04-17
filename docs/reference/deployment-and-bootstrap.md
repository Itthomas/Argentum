# Deployment And Bootstrap

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 4, 21, 24 through 26; `.github/copilot-instructions.md`; `docs/phases/phase-00-environment-bootstrap.md`
> Intended use: deployment and Phase 0 working reference
> Update rule: if deployment assumptions, bootstrap workflow, or filesystem boundary rules change, update this doc in the same change

## Purpose

This document summarizes the deployment boundary and the bootstrap requirements for the Raspberry Pi environment. It is derived and non-normative.

## Deployment Assumptions

- target hardware is Raspberry Pi 5-class
- deployment is Linux-based and headless
- the system is intended to run as a continuously supervised daemon
- PostgreSQL is the primary durable data store
- pgvector backs long-term memory embeddings and semantic retrieval
- outbound connectivity is required for LLM APIs, Slack APIs, and selected external tools
- runtime filesystem access must be limited to explicitly permitted directories

## Operational Principle

All infrastructure for this system should be new and distinct. Do not assume reuse of prior runtime users, service names, directories, schemas, channels, or operational state.

## Access Model

- development, bootstrap, and remote validation initially proceed through the `admin` user
- preferred SSH command currently uses key-based auth through `admin`
- deployed execution should use a dedicated restricted runtime user created during Phase 0
- the runtime user should only be able to write within the intended agent-owned workspace subtree

## Selected Phase 0 Defaults

- remote workspace path: `/srv/argentum`
- restricted runtime username: `argentum`
- planned bootstrap identity path: `/srv/argentum/config/bootstrap/SOUL.md`

## Implemented Phase 0 Result

- `/srv/argentum` exists as the root deployment workspace and remains owned by `root:root` with mode `0755`
- `/srv/argentum/config` is owned by `root:root` with mode `0755`
- `/srv/argentum/config/bootstrap` is owned by `root:argentum` with mode `0750`
- `/srv/argentum/config/bootstrap/SOUL.md` exists as a controlled bootstrap placeholder owned by `root:argentum` with mode `0640`
- `/srv/argentum/var` is the intended runtime-writable subtree owned by `argentum:argentum` with mode `0750`
- `/srv/argentum/var/log`, `/srv/argentum/var/artifacts`, `/srv/argentum/var/memory`, `/srv/argentum/var/tmp`, and `/srv/argentum/var/run` are owned by `argentum:argentum` with mode `0750`
- the `argentum` runtime user exists as a restricted system account with home directory `/srv/argentum/var` and shell `/usr/sbin/nologin`

## Phase 0 Objectives

- choose the remote workspace path on the Pi
- create the remote workspace directory and expected subdirectories
- create the restricted runtime user for deployed execution
- establish filesystem ownership and write-scope boundaries
- verify that admin access remains available for setup and maintenance
- document the resulting path and validation steps

## Filesystem Boundary Principles

- the runtime user should have limited write scope
- destructive or side-effecting operations should remain within governed boundaries
- deployment layout should distinguish application workspace, memory, logs, and artifacts as the system evolves
- bootstrap must reduce ambiguity before implementation phases begin
- bootstrap identity surfaces such as `SOUL.md` should be created, stored, and permissioned under explicit control rather than treated as ad hoc local files
- secret access should remain least-privilege and scoped to the runtime responsibilities that actually need it

## Scheduling And Operational Relevance

- scheduled and heartbeat-driven work depends on a stable deployment boundary
- restart recovery assumes durable storage and operational directories exist
- service supervision and runtime ownership should be explicit, not implied by ad hoc shell access

## Validation Expectations

- verify SSH access through `admin`
- verify the remote workspace path exists
- verify the restricted runtime user exists
- verify the runtime user can write within the intended subtree
- verify the runtime user cannot write outside that subtree

## Validation Outcomes

- SSH access through `admin` was verified with the documented key-based path
- the runtime user `argentum` was verified to write successfully within `/srv/argentum/var/tmp`
- the runtime user `argentum` was verified to fail when attempting to write to `/srv/argentum`
- the runtime user `argentum` was verified to fail when attempting to modify `/srv/argentum/config/bootstrap/SOUL.md`

## Open Bootstrap Items

- replace the placeholder `SOUL.md` content with curated bootstrap identity content before enabling the application runtime
- preserve the current ownership and permission boundary unless a documented deployment change explicitly replaces it
