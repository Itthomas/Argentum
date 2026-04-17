---
name: pi-bootstrap
description: Use this skill when performing or validating Phase 0 Raspberry Pi bootstrap work, including workspace creation, restricted runtime-user setup, permission boundaries, and bootstrap identity handling.
argument-hint: Optional remote host details or the specific bootstrap step to perform.
---

# Pi Bootstrap

Use this skill for concrete Phase 0 bootstrap work on the Raspberry Pi deployment target.

## Steps

1. Read [docs/CURRENT_PHASE.md](../../../docs/CURRENT_PHASE.md) and [docs/phases/phase-00-environment-bootstrap.md](../../../docs/phases/phase-00-environment-bootstrap.md).
2. Read [docs/reference/deployment-and-bootstrap.md](../../../docs/reference/deployment-and-bootstrap.md).
3. Confirm the current bootstrap objective: workspace path, restricted runtime user, ownership boundaries, or identity-material handling.
4. Treat `admin` as the bootstrap and validation account unless the docs explicitly change that.
5. Verify or establish:
   - remote workspace path
   - restricted runtime user
   - limited write scope for the runtime subtree
   - explicit location and permissions for bootstrap identity material such as `SOUL.md`
6. Record any deployment facts that must be reflected back into the docs.

## Output

- bootstrap action checklist
- validation checklist
- documented facts that must be written back to repo docs
- blockers preventing Phase 0 completion

Prefer explicit permission and boundary verification over assumptions based on command success alone.
