---
name: Bootstrap And Deployment Rules
description: Phase 0 and deployment-boundary rules for bootstrap and operational docs.
applyTo: "docs/phases/phase-00-environment-bootstrap.md,docs/reference/deployment-and-bootstrap.md"
---

# Bootstrap And Deployment Rules

- Treat Raspberry Pi bootstrap and remote validation as the authoritative deployment path.
- Use the `admin` account for bootstrap and validation work unless the deployment docs explicitly change that.
- Preserve the distinction between bootstrap access and the restricted runtime user used for deployed execution.
- Keep runtime write scope limited to the agent-owned workspace subtree.
- Define explicit ownership, location, and permission handling for bootstrap identity material such as `SOUL.md`.
- Prefer least-privilege secret access and explicit filesystem boundaries over convenience shortcuts.
