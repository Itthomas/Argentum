# Orchestrator hooks are defined inline in the agent frontmatter:
#   .github/agents/argentum-orchestrator.agent.md
#
# The guard script lives at:
#   .github/hooks/scripts/orchestrator-edit-guard.ps1
#
# Inline hooks are scoped to the orchestrator agent only.
# Standalone .json hooks in this directory would apply to ALL agents,
# which is not desired for the orchestrator edit guard.
#
# See: .github/agents/argentum-orchestrator.agent.md (hooks frontmatter)
# See: .github/hooks/scripts/orchestrator-edit-guard.ps1 (guard script)
