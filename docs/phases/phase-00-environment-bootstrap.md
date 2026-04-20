# Phase 0: Environment Bootstrap

> Status: Derived working doc
> Normative source: `docs/System Architecture Specification.md` and `docs/System Technical Appendix.md`
> Derived from: Architecture sections 4, 24 through 26; `.github/copilot-instructions.md`; `docs/reference/deployment-and-bootstrap.md`
> Required reading: `docs/reference/conventions.md`, `docs/reference/deployment-and-bootstrap.md`
> Intended use: implementation packet for establishing the Pi deployment boundary before runtime phases begin

## Objective

Establish the initial Raspberry Pi deployment boundary before implementation begins by creating the remote workspace directory, the restricted runtime user, and the filesystem ownership model for deployment.

## Canonical Requirements Summary

- deployment targets Raspberry Pi 5-class Linux hardware
- the system must run as a continuously supervised daemon
- filesystem access for the runtime user must remain within explicitly permitted directories
- the deployment environment must be new and distinct rather than inherited from any prior system
- the deployed runtime should use a dedicated restricted user rather than the development bootstrap user
- Phase 0 reduces deployment ambiguity and establishes boundaries, but it does not by itself resolve the core application architecture risks owned by later phases

## Required Reading

1. `docs/reference/conventions.md`
2. `docs/reference/deployment-and-bootstrap.md`

## Scope

- create the remote workspace directory on the Pi
- define the agent-owned writable subtree
- create the restricted runtime user for deployed execution
- keep development and bootstrap access on the `admin` user
- document bootstrap verification steps and handoff into Phase 1

## Included Subsystems

- deployment bootstrap
- remote filesystem ownership and permission boundaries
- operator access model for development versus runtime

## Out Of Scope

- application runtime code
- database schema implementation
- LangGraph runtime orchestration
- memory, approval, or subagent implementation

## Durable Schemas Touched

- none

## State Machines Touched

- none

## Implemented Deployment Boundary

- workspace root: `/srv/argentum`, owned by `root:root`, mode `0755`
- protected configuration path: `/srv/argentum/config`, owned by `root:root`, mode `0755`
- protected bootstrap identity path: `/srv/argentum/config/bootstrap/SOUL.md`, owned by `root:argentum`, mode `0640`, under a `root:argentum` directory with mode `0750`
- runtime-writable subtree: `/srv/argentum/var`, owned by `argentum:argentum`, mode `0750`
- initial runtime subdirectories: `/srv/argentum/var/log`, `/srv/argentum/var/artifacts`, `/srv/argentum/var/memory`, `/srv/argentum/var/tmp`, `/srv/argentum/var/run`
- runtime account: `argentum`, system user, home directory `/srv/argentum/var`, shell `/usr/sbin/nologin`

This boundary preserves `admin` for bootstrap and maintenance while restricting deployed runtime writes to the `/srv/argentum/var` subtree.

## Selected Defaults

- remote workspace path: `/srv/argentum`
- restricted runtime username: `argentum`
- planned bootstrap identity path: `/srv/argentum/config/bootstrap/SOUL.md`

These defaults should be used for Phase 0 unless an explicit deployment change is made before remote execution.

## Minimum Phase 0 Artifacts

- the selected remote workspace path
- the restricted runtime username
- the workspace subtree ownership and write-scope policy
- the planned bootstrap identity path and permission model
- the bootstrap validation commands and expected outcomes
- the handoff note that distinguishes deployment-boundary decisions from application-design decisions

## Implementation Tasks

- create `/srv/argentum` and the selected subdirectories on the Pi
- create the restricted runtime user `argentum`
- apply filesystem ownership and write permissions so the runtime user can write only within `/srv/argentum/var`
- create and permission the controlled bootstrap identity location at `/srv/argentum/config/bootstrap/SOUL.md`
- verify that `admin` access remains available for setup, validation, and maintenance
- document the resulting path, ownership model, and validation commands

## Failure Modes And Risks

- selecting an unstable or ad hoc workspace path will create deployment churn later
- granting overly broad write permissions undermines later governance guarantees
- blurring admin and runtime responsibilities weakens the explicit safety boundary the architecture expects

## Verification Tasks

- verify SSH access via `admin` using the documented key
- verify the remote workspace path exists
- verify the restricted runtime user exists
- verify the runtime user cannot write outside the intended workspace subtree
- verify the runtime user can write within the intended workspace subtree
- verify the chosen deployment boundary is documented for later phases

## Verification Outcomes

- SSH access via `admin` was verified
- `/srv/argentum` exists on the Pi
- `argentum` exists as the restricted runtime user
- `argentum` can write within `/srv/argentum/var/tmp`
- `argentum` cannot write to `/srv/argentum`
- `argentum` cannot modify `/srv/argentum/config/bootstrap/SOUL.md`
- the deployment boundary has been written back into the phase and deployment reference docs
- the documented boundary was revalidated from this workspace on 2026-04-20, including `sudo stat` checks for the protected paths and runtime-user write/deny probes

## Exit Criteria

- the Pi workspace directory `/srv/argentum` is created and documented
- the restricted runtime user `argentum` is created
- the runtime user's write permissions are limited to the intended workspace subtree
- admin bootstrap access is verified
- bootstrap identity material has an explicit controlled location and permission model
- Phase 1 can proceed with a defined deployment boundary

## Risks And Open Questions

- the placeholder `SOUL.md` content must be replaced before runtime enablement
- future deployment changes should preserve the same write-boundary semantics unless deliberately revised
