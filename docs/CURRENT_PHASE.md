# Current Phase

## Active Phase

Phase 0: Environment bootstrap

## Goal

Establish the Raspberry Pi deployment boundary before implementation phases begin by creating the remote workspace directory, the restricted runtime user, and the initial ownership and write-permission model.

## Immediate Tasks

- Define the remote workspace path on the Pi.
- Create the restricted runtime user for the deployed agent.
- Limit runtime write permissions to the agent-owned workspace subtree.
- Define the controlled bootstrap location and ownership model for identity material such as `SOUL.md`.
- Document bootstrap validation steps and handoff criteria into Phase 1.

## Current Blockers

- The remote workspace path has not been selected yet.
- The restricted runtime user has not been created yet.

## Definition Of Done

- The Pi workspace path exists and is documented.
- The restricted runtime user exists and has limited write scope.
- Admin-based bootstrap access is verified.
- Bootstrap identity material has an explicit controlled location and permission model.
- Phase 1 can begin without ambiguity about deployment filesystem boundaries.