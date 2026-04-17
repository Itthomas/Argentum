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

## Implementation Details To Resolve

- choose the exact remote workspace path on the Pi
- define the workspace subtree that the restricted runtime user may write to
- decide any initial log, artifact, and memory directory boundaries needed during bootstrap
- document the relationship between bootstrap access and deployed execution access

## Minimum Phase 0 Artifacts

- the selected remote workspace path
- the restricted runtime username
- the workspace subtree ownership and write-scope policy
- the bootstrap validation commands and expected outcomes
- the handoff note that distinguishes deployment-boundary decisions from application-design decisions

## Implementation Tasks

- choose the remote workspace path on the Pi
- create the workspace directory and expected subdirectories
- create the restricted runtime user for the deployed agent
- apply filesystem ownership and write permissions so the runtime user can write only within the intended workspace subtree
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

## Exit Criteria

- the Pi workspace directory is created and documented
- the restricted runtime user is created
- the runtime user's write permissions are limited to the intended workspace subtree
- admin bootstrap access is verified
- Phase 1 can proceed with a defined deployment boundary

## Risks And Open Questions

- the exact remote workspace path is still undecided
- the exact runtime username is still undecided
