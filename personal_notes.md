## What The Workflow Looks Like For You

### On your side, the workflow is not “start coding and let Copilot improvise.” It is a controlled loop:

1. Open chat in this workspace.
2. Use the /spec-to-slice skill to plan the next slice.
    This should create or update a slice card under slices using the workflow in copilot-workflow.md:16.
3. Review that slice.
    You can use /review-argentum-slice or the argentum-adversarial-review agent. If the slice is sound, mark its Approval field approved in the slice card.
4. Update backlog.md so the queue reflects the approved slice.
5. Start implementation with /implement-argentum-slice or the argentum-implementer agent.
    That is what “autopilot” means in this repo: handing one approved, bounded slice to the implementation agent, as defined in copilot-workflow.md:28.
6. Let the agent work the slice end to end.
    It should stay inside one owning boundary, validate after the first substantive edit, and only widen scope if the validation forces an adjacent fix.
7. Review the result before moving on.
    Run adversarial review again if the slice is non-trivial, then mark the slice validated and move to the next one.
    
## What This Feels Like Practically

### A typical session for you would look like this:

1. “Plan the first Phase 1 slice from the package boundaries and test strategy.”
2. Review the resulting slice card in slices.
3. Mark it approved.
4. “Implement this approved slice.”
    Watch the agent edit files, run narrow validation, and summarize what changed.
5. Review the result and either accept it or send it back through review/refinement.

### So the workflow on your end is:

plan
approve
implement
review
advance