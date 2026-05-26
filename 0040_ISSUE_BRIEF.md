# 0040 Issue Brief

## Summary

The active 0040 issue is a planning and boundary-drift problem, not a known runtime failure.

The approved 0040 slice says per-step tool exposure should be owned by the prompt-compiler path in `@argentum/agentic_core`, while the shipped implementation still decides tool exposure in runtime composition. That leaves the repo in a `ready-with-risks` state rather than a blocked state.

## What The Docs Currently Say

- The approved slice assigns current-step `ToolExposureRequest` construction and `LLMInferenceRequest.available_tools` attachment to the prompt-compiler path: [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](docs/implementation/slices/0040-tooling-tool-discovery-planner.md)
- The prompt-compiler spec says the agentic layer attaches provider-neutral tool schemas for the current step: [docs/spec/40-modules/agentic-layer/prompt-compiler.md](docs/spec/40-modules/agentic-layer/prompt-compiler.md)
- The tool-discovery spec says narrowed tool exposure is a prompt-compiler selection decision, not a schema mutation or runtime-owned policy shortcut: [docs/spec/40-modules/tool-layer/tool-discovery.md](docs/spec/40-modules/tool-layer/tool-discovery.md)
- The package-boundary guidance places prompt compilation in `agentic_core` and registry/discovery primitives in `tooling`: [docs/spec/50-implementation/package-boundaries.md](docs/spec/50-implementation/package-boundaries.md)

## Why It Is Still Open

- Audit 0019 records that shipped behavior still decides exposure in runtime composition, so the approved ownership split is not yet reflected in code: [docs/implementation/audits/0019-slices-0043-0045-and-pipeline-state.md](docs/implementation/audits/0019-slices-0043-0045-and-pipeline-state.md)
- The backlog carries this as the only active medium repo risk after validating slices 0043 through 0045: [docs/implementation/backlog.md](docs/implementation/backlog.md)

## Practical Impact

- Safe to defer for slices that do not depend on curated or prompt-compiler-owned per-step exposure.
- Not safe to defer once new work assumes 0040's approved ownership split is already true in code.
- The clean next decision is either:
  - implement the approved ownership split from 0040, or
  - re-baseline 0040 and adjacent planning docs to the shipped runtime-owned design.

## Relevant Documentation

- [docs/spec/README.md](docs/spec/README.md)
- [docs/implementation/slices/0040-tooling-tool-discovery-planner.md](docs/implementation/slices/0040-tooling-tool-discovery-planner.md)
- [docs/spec/40-modules/agentic-layer/prompt-compiler.md](docs/spec/40-modules/agentic-layer/prompt-compiler.md)
- [docs/spec/40-modules/tool-layer/tool-discovery.md](docs/spec/40-modules/tool-layer/tool-discovery.md)
- [docs/spec/50-implementation/package-boundaries.md](docs/spec/50-implementation/package-boundaries.md)
- [docs/implementation/backlog.md](docs/implementation/backlog.md)
- [docs/implementation/audits/0019-slices-0043-0045-and-pipeline-state.md](docs/implementation/audits/0019-slices-0043-0045-and-pipeline-state.md)