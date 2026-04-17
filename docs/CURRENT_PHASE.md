# Current Phase

## Active Phase

Phase 0: Environment bootstrap

## Goal

Establish the Raspberry Pi deployment boundary before implementation phases begin by creating the remote workspace directory, the restricted runtime user, and the initial ownership and write-permission model.

## Immediate Tasks

- Create the remote workspace path `/srv/argentum` on the Pi.
- Create the restricted runtime user `argentum` for the deployed agent.
- Limit runtime write permissions to the agent-owned workspace subtree.
- Create the controlled bootstrap location and ownership model for identity material at `/srv/argentum/config/bootstrap/SOUL.md`.
- Document bootstrap validation steps and handoff criteria into Phase 1.

## Current Blockers

- The selected workspace path `/srv/argentum` has not been created yet on the Pi.
- The restricted runtime user `argentum` has not been created yet.

## Definition Of Done

- The Pi workspace path `/srv/argentum` exists and is documented.
- The restricted runtime user `argentum` exists and has limited write scope.
- Admin-based bootstrap access is verified.
- Bootstrap identity material exists at a controlled path with an explicit permission model.
- Phase 1 can begin without ambiguity about deployment filesystem boundaries.