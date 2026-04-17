# System Architecture Specification

> Status: First Draft
> Date: 2026-04-16
> Purpose: Define the architectural specification for a new autonomous agent system to be built from the ground up in a fresh workspace.

## 1. Executive Summary

This system is a long-running autonomous personal agent designed to operate continuously on a Raspberry Pi-hosted environment, interact through Slack, maintain durable memory over time, and execute real work through tools, subagents, and scheduled wake-ups.

The system is designed around five core ideas:

1. A durable task-centric continuity model rather than thread-centric conversational continuity.
2. Curated context assembly before each reasoning turn rather than reliance on a large monolithic graph state.
3. A lean task runtime that uses LangGraph for ephemeral working state, resumability, and approvals.
4. A unified long-term memory system backed by PostgreSQL and pgvector.
5. A governed but first-class self-extension model in which the agent may create new tools subject to validation and approval.

The system must also include an explicit LLM orchestration layer so that different operations can use different reasoning strengths, latency profiles, and provider-fallback behavior.

The system must be treated as a greenfield product. It is not a continuation of any prior implementation. It must assume new infrastructure, new runtime identity, new deployment directories, new database objects, and new operational surfaces from the outset.

## 2. Primary Goals

The system must satisfy the following goals.

### 2.1 Long-running autonomous operation

The system must be capable of working across hours or days, with durable continuity for tasks, summaries, approvals, and memory.

### 2.2 Strong contextual awareness

The system must assemble high-signal context for each reasoning turn using stable identity files, relevant long-term memory, relevant task summaries, and recent session context.

### 2.3 Task-centric continuity

The system must represent ongoing work as durable tasks that can be resumed, revisited, searched, linked, delegated, and continued independently of any single Slack thread.

### 2.4 Governed autonomy

The system should be broadly autonomous, including heartbeat-driven continuation and proactive action, while remaining auditable and controllable.

### 2.5 Tool-based execution

The system must act through explicit tools, not through implicit or hidden execution channels.

### 2.6 First-class self-extension

The system must support creation of new tools as a native capability, with approval, testing, validation, and global registration.

### 2.7 Subagent delegation

The system must support spawning bounded subagents that can call tools directly and return structured results.

### 2.8 Capability-aware LLM usage

The system must route different kinds of language-model work to appropriate model tiers rather than treating all LLM requests as equivalent.

## 3. Non-Goals

The following are explicitly not goals of the initial architecture.

- a GUI-first product
- local model inference as a core requirement
- a thread-bound chat memory model
- a monolithic supervisor graph that routes all work through heavy planning logic by default
- a system in which all durable knowledge is held primarily in graph state
- a system in which self-generated tools become active without human approval

## 4. Deployment Assumptions

The intended deployment target is a Raspberry Pi from the outset.

### 4.1 Target environment

- Raspberry Pi 5-class hardware
- Linux-based headless deployment
- dedicated runtime user account specific to this system
- separate application workspace directory
- separate memory, log, and artifact storage roots
- separate service definition and environment configuration
- separate Slack app or operational surface from any previous system

### 4.2 Infrastructure assumptions

- PostgreSQL is the primary durable data store
- pgvector is used for long-term memory embeddings and semantic retrieval
- the system runs as a continuously supervised daemon
- outbound connectivity is available for LLM APIs, Slack APIs, and selected external tools
- filesystem access is available to the runtime user within explicitly permitted directories

### 4.3 Operational principle

All infrastructure for this system must be new and distinct. The architecture must not assume reuse of runtime users, service names, working directories, database schemas, message channels, or operational state from any earlier system.

## 5. Design Principles

### 5.1 Separate continuity from prompt context

Conversation continuity, task continuity, long-term memory, and prompt context are different concerns and must remain different concerns in the architecture.

### 5.2 Rebuild context deliberately

Each reasoning turn must begin from a curated context packet assembled from durable sources, not from blindly accumulated in-memory state.

### 5.3 Keep the default path lean

Most tasks should follow a lightweight reason-act-reflect loop. Expensive planning modes should be invoked only when task complexity requires them.

### 5.4 Use LangGraph for runtime orchestration, not for total system state

LangGraph should manage ephemeral working state, pause/resume mechanics, and local execution flow. It must not become the canonical home for all durable knowledge, all open tasks, or all system-level memory.

### 5.5 Keep autonomy auditable

Every autonomous action must leave behind clear records of why it happened, what task it served, what tools it used, and what durable state it changed.

### 5.6 Prefer explicit governance over hidden guardrails

The system must rely on explicit approval rules, tool policy, and validation pipelines rather than assuming prompt-only constraints are sufficient.

### 5.7 Treat model selection as policy, not call-site trivia

Model choice, timeout behavior, provider failover, and context-budget handling must be governed through an explicit routing abstraction rather than scattered ad hoc decisions in individual components.

## 6. High-Level Architecture

The system consists of the following major subsystems:

1. Event Ingress Layer
2. Session Layer
3. Task Ledger Layer
4. LLM Orchestration Layer
5. Context Assembly Layer
6. Task Runtime Layer
7. Long-Term Memory Layer
8. Tooling and Execution Layer
9. Subagent Layer
10. Scheduling and Heartbeat Layer
11. Approval and Governance Layer
12. Observability and Reporting Layer

These subsystems must be explicitly separated in both the design and the codebase.

## 7. Identity and Bootstrap Context

The system must have an immutable identity file named `SOUL.md`.

### 7.1 Role of SOUL.md

`SOUL.md` defines the agent's identity, tone, motivation, behavioral disposition, and any high-level invariant rules that are intended to be part of every reasoning turn.

### 7.2 Architectural requirement

`SOUL.md` must be treated as part of the core prompt bootstrap surface, not as ordinary memory and not as editable task state.

### 7.3 Bootstrap control model

The architecture must define the bootstrap identity surface strongly enough that the `SOUL.md` requirement is operationally meaningful.

At minimum, it must specify:

- the logical storage location of the bootstrap identity surface within the deployment workspace
- who may edit it and through what review or operator path
- how runtime read access differs from operator edit access
- whether integrity checking, versioned provenance, or equivalent tamper-evident controls are expected
- how the active bootstrap identity surface is selected when more than one historical version exists

### 7.4 Constraint

The architecture must reference `SOUL.md` as a mandatory input to context assembly, but it must not leave immutability or integrity as a purely philosophical statement. The bootstrap identity surface must be bounded by explicit operational controls even if the final implementation remains flexible.

## 8. Event Ingress Layer

The ingress layer is the entry point for all external and internal triggers.

### 8.1 Supported trigger types

- user messages from Slack
- approval responses from Slack interactive actions
- heartbeat ticks
- scheduled cron triggers
- webhooks
- internal follow-up events
- task resume requests

### 8.2 Responsibilities

- normalize incoming data into internal event objects
- attach source metadata
- extract explicit task references when present
- invoke task-resolution logic
- route into context assembly and runtime execution

### 8.3 Constraints

The ingress layer must not perform deep reasoning about task content. It is a normalization and routing boundary.

Simple ingress parsing, classification, and normalization may use lightweight model tiers when deterministic parsing is insufficient, but the ingress layer must not default to heavyweight reasoning models.

### 8.4 Idempotency and duplicate-event handling

The ingress layer must assume that asynchronous surfaces may deliver the same event more than once.

This includes, but is not limited to:

- Slack retrying webhook deliveries
- duplicate approval payload delivery
- repeated webhook submissions from external systems
- scheduler or heartbeat retries after partial failure

The architecture must therefore support idempotent event handling.

At minimum, the ingress and event model must support:

- event identity or deduplication keys
- duplicate-detection logic before starting a new runtime execution
- safe replay semantics for events that are already fully applied

An event that has already been consumed successfully must not be allowed to start a second competing execution path for the same logical action.

### 8.5 External trust boundary

The ingress layer must distinguish authentication, authorization, replay protection, and idempotency as separate controls.

At minimum, the architecture must define:

- request-authentication requirements for Slack-originated interactions
- request-authentication requirements for external webhook submissions
- operator-authorization requirements for governed approval actions
- how authenticated operator identity is bound to approval application and audit records
- replay-window handling that is distinct from ordinary deduplication
- secret-storage and secret-rotation expectations as policy surfaces
- least-privilege rules for which runtime components, tools, and generated tools may access integration secrets or approval credentials

Idempotency must not be treated as a substitute for authentication or authorization.

### 8.6 Event intake and queue contract

The architecture must define the operational contract for how events move from intake into execution.

The event-processing model may be inline, queued, or hybrid by run class, but the behavior must be explicit.

At minimum, the architecture must define:

- whether each major run class is handled inline, queued, or hybrid
- ownership rules for queued events
- retry and backoff behavior
- dead-letter conditions
- priority handling between user-triggered work, approval resumes, heartbeat work, scheduler work, and recovery work
- fairness and starvation expectations on constrained hardware
- how bounded concurrency is enforced when multiple event classes compete for execution capacity

The queue contract may remain vendor-neutral, but it must be behaviorally specific enough to govern implementation and recovery.

## 9. Session Layer

The session layer represents communication continuity and transcript linkage.

### 9.1 Purpose

Sessions represent the messaging or interaction surface through which events arrive and responses are delivered.

### 9.2 Session responsibilities

- track session identity and channel metadata
- track linked transcript references
- track active thread references
- track current or recent task associations
- track approval-delivery capabilities and routing details

### 9.3 Architectural rule

Sessions are not the primary durable representation of work. They provide communication continuity, not canonical task continuity.

## 10. Task Ledger Layer

The task ledger is the canonical durable model of work in the system.

### 10.1 Purpose

Tasks are the primary units of continuity. A task may outlive a thread, span multiple sessions, be resumed later, and serve as the anchor for summaries, artifacts, approvals, memories, and child work.

### 10.2 Task requirements

Each task must support:

- durable identity
- title and objective
- lifecycle status
- priority and scheduling metadata
- links to origin sessions and threads
- current durable summary
- success criteria
- artifact references
- related memory references
- approval state
- child-task references

### 10.3 Task lifecycle states

At minimum the architecture must support:

- proposed
- active
- waiting_human
- blocked
- scheduled
- completed
- failed
- abandoned

### 10.4 Task continuity behavior

When a new event arrives, the system should be able to:

- attach to a task by explicit ID or reference
- infer likely task association by semantic matching
- auto-attach if confidence is high
- ask the user for confirmation when confidence is meaningful but below the auto-attach threshold
- create a new task when no durable task match is appropriate

### 10.5 Task claiming, locking, and execution ownership

Because the system accepts asynchronous external events while also running autonomous heartbeat and scheduler flows, the task ledger must act as the execution authority for task ownership.

The architecture must guarantee that only one active runtime execution may hold the authoritative claim to a given task at a time.

This requires two mechanisms:

1. atomic database state transitions when a runtime attempts to claim a task
2. durable execution lease semantics for long-running ownership

The task ledger must therefore support a claim protocol with fields or equivalents such as:

- claimed_by
- claimed_at
- claim_run_id
- lease_expires_at
- last_lease_renewal_at

The claim protocol must support:

- exclusive task claiming
- lease renewal by the active runtime
- safe lease expiry and reclamation after runtime failure
- detection of stale claims during restart or maintenance sweeps

The implementation may use PostgreSQL row-level locking such as `SELECT ... FOR UPDATE` as part of atomic claim transactions, but the architecture must not rely on transaction-local row locking alone as the full ownership model.

Long-running task ownership must remain visible durably in the ledger.

### 10.6 Task state-transition rules

The task ledger must define legal state transitions.

Not every task state may transition directly to every other task state. The architecture must treat task lifecycle transitions as a governed state machine rather than a loose set of status labels.

This is required for correctness under concurrent ingress, approval resumes, heartbeat wake-ups, subagent completions, and restart recovery.

## 11. Task Resolution

Task resolution is the process by which an incoming event is associated with an existing task or results in creation of a new task.

### 11.1 Inputs

- explicit task references in the incoming message or payload
- current session-level task association if one exists
- semantic similarity to active or recent tasks
- task status and recency
- source thread and source user context

### 11.2 Outputs

- exact task match
- high-confidence automatic attachment
- ambiguous candidate set requiring confirmation
- no-match result requiring creation of a new task

### 11.3 Constraint

Task resolution is a routing and continuity operation. It should not mutate the full task state beyond association, unless a new task is created or explicit confirmation changes linkage.

## 12. Context Assembly Layer

The context assembly layer is responsible for constructing the bounded context packet that the runtime uses for the next reasoning turn.

### 12.1 Purpose

The context assembler is the primary mechanism by which the system gains situational awareness for each run.

### 12.2 Inputs to context assembly

- the normalized event
- the resolved task, if any
- `SOUL.md`
- other bootstrap context surfaces, if defined
- relevant long-term memories
- relevant open-task summaries when related
- recent session or task summaries
- current runtime facts
- approval constraints and execution constraints

### 12.3 Outputs of context assembly

The output must be a bounded context packet that includes:

- bootstrap identity context
- runtime facts
- task snapshot
- relevant memory digest
- relevant open-task digest when applicable
- recent continuity digest when applicable
- approval and execution constraints

### 12.4 Constraints

The context assembler must not:

- inject the full task ledger
- inject the full memory corpus
- inject raw full transcript history by default
- inject large raw tool outputs unless specifically required

### 12.5 Retrieval model

The architecture must use hybrid memory access:

- automatic first-pass retrieval by the context assembler
- explicit further querying by the runtime when deeper memory access is needed

This ensures the system gains initial situational awareness without relying entirely on self-query behavior, while still avoiding prompt bloat.

### 12.6 Context-budget enforcement

The context assembler must operate under an explicit token and prompt-budget policy.

The architecture must define:

- target prompt budgets by run class
- reserved output budget
- reserved budget for tool schema overhead and runtime scaffolding
- section priority for trimming or summarization
- behavior when assembled context exceeds model limits

The context assembler must treat prompt construction as a bounded packing problem rather than as an unconstrained accumulation of relevant material.

### 12.7 Overflow and truncation behavior

If assembled context exceeds the allowed budget or a provider rejects the prompt as too large, the system must support corrective behavior such as:

- reassembly with stricter section budgets
- summarization of lower-priority context sections
- dropping optional low-priority context sections
- switching to a more appropriate model tier when policy allows it

Prompt overflow must not be treated as an unstructured fatal error when bounded recovery is possible.

## 13. LLM Orchestration Layer

The system must include an explicit LLM orchestration layer responsible for model selection, provider abstraction, retries, failover behavior, and capability-aware routing.

### 13.1 Purpose

Not all language-model operations require the same latency, cost, or reasoning depth.

The orchestration layer exists to ensure that:

- simple tasks do not pay the cost of heavyweight reasoning unnecessarily
- high-consequence tasks are not assigned weak models by default
- provider-specific failures are handled consistently
- model-routing behavior remains policy-driven rather than fragmented across the codebase

### 13.2 Initial provider assumption

The architecture should assume Gemini and DeepSeek as the initial intended providers.

However, provider names are secondary to capability tiers. The architecture must be framed in terms of model classes and routing policy first, with providers mapped into those classes.

### 13.3 Core responsibilities

The orchestration layer must provide:

- provider abstraction
- capability-aware model routing
- timeout and retry policy
- provider failover behavior
- rate-limit handling
- malformed-response handling
- token-budget and overflow integration with context assembly
- cost and latency governance

### 13.4 Tiered model policy

The architecture must support multiple model tiers.

At minimum, the routing policy should distinguish between:

- fast or utility tier for lightweight classification, extraction, short summarization, and low-risk normalization work
- standard execution tier for ordinary task runtime reasoning and tool selection
- deep reasoning tier for complex planning, difficult debugging, nuanced reflection, and ambiguous decision points
- critical tier for high-consequence operations such as tool generation review, safety-sensitive reasoning, or conflict resolution when weaker attempts fail or disagree

### 13.5 Operation-to-tier mapping

The orchestration layer must support operation-aware routing.

Examples include:

- ingress normalization and light classification should default to fast or utility tiers when an LLM is needed at all
- context assembly summarization or compression should prefer cheaper or utility-oriented tiers when safe to do so
- ordinary runtime turns should default to the standard execution tier unless complexity or risk warrants escalation
- optional deep planning modes may require deep reasoning tiers
- tool generation, tool verification, and high-consequence approval-sensitive reasoning must prefer stronger reasoning tiers by default
- subagents may be assigned different model tiers based on delegated role and consequence level

### 13.6 Deterministic-first rule

The architecture should prefer deterministic parsing and policy logic before invoking an LLM where the task is straightforward.

Examples include:

- explicit task ID extraction
- Slack approval payload recognition
- event deduplication checks
- simple command or directive parsing

The orchestration layer exists to route LLM work, not to force LLM usage where deterministic logic is sufficient.

### 13.7 Timeout, retry, and failover behavior

The orchestration layer must define policy for at least the following failure classes:

- request timeout
- provider unavailability
- rate limiting
- malformed or schema-invalid model output
- partial stream interruption
- prompt overflow or token-limit rejection

The architecture must support different responses depending on operation class, including:

- bounded retry against the same provider
- failover to an alternate provider in the same capability tier
- graceful degradation to a cheaper tier for non-critical operations
- escalation to a stronger tier for repair, conflict resolution, or recovery
- context reassembly and retry after prompt overflow
- operator-visible degradation when no safe fallback exists

### 13.8 Cost and latency governance

The orchestration layer must make cost and latency policy explicit.

This includes:

- avoiding expensive models for trivial operations
- preserving stronger reasoning capacity for high-value or high-risk work
- enabling budget-aware degradation for non-critical operations
- ensuring latency-sensitive user-facing flows do not default to slow reasoning paths without need

### 13.9 Structured output support

For operations such as task resolution support, planning contracts, tool generation, tool verification, and other schema-sensitive flows, the orchestration layer should prefer structured outputs with validation rather than freeform text alone.

### 13.10 Provider health awareness

The orchestration layer should track provider health and recent failure modes sufficiently to avoid repeatedly routing traffic into a currently degraded provider when an alternate path is available.

## 14. Task Runtime Layer

The task runtime is the subsystem that performs the current unit of reasoning and execution.

### 13.1 Runtime engine

The runtime must use LangGraph as the orchestration engine for per-run task execution.

The runtime must obtain model access through the LLM orchestration layer rather than calling provider implementations directly.

### 13.2 Runtime responsibilities

- consume the current event and assembled context packet
- maintain small working state for the current run
- decide whether to reason, call a tool, delegate, request approval, continue, schedule follow-up, or complete
- persist task progress through controlled commit operations

Model-tier selection for runtime turns must be based on operation class, current complexity, and consequence level rather than a single fixed model for all turns.

### 13.3 Working-state requirements

The runtime working state must remain intentionally small and must contain only the fields needed for the current run, such as:

- run identity
- task identity
- current objective
- success criteria
- context packet
- optional current plan
- current step
- recent observations
- recent tool-result summaries
- approval request or approval result
- continuation decision
- current error state
- artifact references created during the run

### 13.4 Runtime constraints

The runtime working state must not become the canonical home for:

- all open tasks
- the full long-term memory store
- large transcript history
- all historical planning branches
- system-wide registries

### 13.5 Default execution path

The default task path should be lightweight:

1. consume context packet
2. reason
3. act through tools or delegation when needed
4. reflect lightly on current progress
5. decide whether to continue, pause, schedule follow-up, or complete

### 13.6 Runtime exclusivity and claim enforcement

The task runtime must not begin meaningful execution for a task unless it has successfully acquired the authoritative claim for that task from the task ledger.

If an event arrives for a task that is already claimed, the runtime must not start a competing execution loop.

Instead, the architecture must support one of the following outcomes:

- the event is merged into the currently active task execution path through a safe resume or steering mechanism
- the event is queued for later handling
- the event updates durable task state without launching a second runtime loop

The specific policy may vary by event type, but competing runtimes for the same task must be treated as invalid.

## 15. Optional Planning Modes

The architecture must support richer planning modes, but they must remain optional.

### 14.1 Examples of optional modes

- hypothesis branching
- debate or critique planning
- deeper analysis mode
- exploratory research mode

### 14.2 Constraint

These modes must not be mandatory for ordinary work. The baseline path must remain lightweight.

## 16. Long-Term Memory Layer

Long-term memory must be implemented as a unified store with typed metadata, backed by PostgreSQL and pgvector.

### 15.1 Purpose

Long-term memory stores durable information that may be relevant across tasks, sessions, and time.

### 15.2 Memory record requirements

Each memory must support:

- durable identity
- typed classification
- content and summary
- embedding for semantic retrieval
- source linkage
- confidence or relevance metadata
- timestamps
- arbitrary metadata fields for filtering and future evolution

### 15.3 Minimum memory types

The architecture must support typed distinctions such as:

- user_profile
- operator_preference
- project_knowledge
- environment_fact
- task_outcome
- procedural_pattern
- followup_commitment

### 15.4 Retrieval requirements

The memory layer must support:

- semantic retrieval by embedding similarity
- typed filtering
- source filtering
- recency-aware ranking
- confidence-aware ranking

### 15.5 Memory and context relationship

Memory is not context by default. Memory becomes part of context when the context assembler retrieves it or when the runtime explicitly queries it.

## 17. Artifact Layer

Artifacts are durable outputs produced or referenced by the system.

### 16.1 Examples of artifacts

- generated reports
- created files
- test results
- generated tool bundles
- external links
- message snapshots
- structured output manifests

### 16.2 Requirements

Artifacts must be referenceable from tasks and subagents, and must support provenance back to the run or task that produced them.

### 16.3 Retention and storage governance

Because the target environment is resource-constrained, artifact durability must be governed by explicit retention policy.

At minimum, the architecture must define:

- retention classes or policy categories for artifacts
- pruning, archival, or cleanup expectations
- storage-pressure response behavior
- whether operator-visible artifacts and internal artifacts follow different retention rules
- how artifact lifecycle relates to task completion, generated-tool workflows, and audit requirements

## 18. Tooling and Execution Layer

The system must act through tools.

### 17.1 Tool requirements

Tools must have:

- explicit identity
- explicit schema
- explicit execution policy
- explicit timeout and resource controls where applicable
- explicit output contract

### 17.2 Tool categories

The system may support categories such as:

- filesystem tools
- shell or process tools
- web and retrieval tools
- Slack or messaging tools
- memory access tools
- task-lookup tools
- subagent management tools
- tool-generation and validation tools

### 17.3 Constraint

No meaningful real-world action should occur outside the explicit tooling surface.

## 19. Self-Extending Tool System

The architecture must include self-extension as a first-class subsystem.

### 18.1 Purpose

The agent should be able to identify a capability gap, design a new tool, generate the implementation, validate it, test it, request approval, and register it for future use.

Tool generation and tool verification must route through appropriately strong reasoning tiers rather than lightweight default model paths.

### 18.2 Lifecycle requirements

The self-extending tool pipeline must support:

1. gap identification
2. tool proposal
3. code generation in a controlled workspace
4. schema validation
5. policy validation
6. test and verification execution
7. human approval
8. staged activation into a bounded initial scope
9. explicit scope widening when policy allows it
10. disablement, rollback, archival, or pruning when appropriate

### 18.3 Approval rule

In the initial architecture, all generated tools must require explicit human approval before activation.

### 18.4 Policy extensibility

The architecture may include an environment-level policy switch to relax this in the future, but the default behavior must remain approval-gated.

### 18.5 Activation rule

Approval and verification must not be treated as an automatic global capability grant.

The architecture must support an activation model that defines:

- activation states beyond proposal and approval
- whether newly approved tools enter quarantine, shadow, limited-scope, or globally enabled status
- who or what may widen tool scope after initial approval
- disablement and rollback rules
- versioning and replacement behavior when a tool is regenerated or superseded

The default posture should favor bounded initial activation before broader enablement.

## 20. Subagent Layer

The system must support subagents as bounded delegated workers.

### 19.1 Purpose

Subagents allow the primary runtime to delegate focused work with narrower scope and cleaner contracts.

### 19.2 Subagent requirements

Subagents must support:

- bounded scope
- explicit parent-child linkage
- explicit task or run contract
- tool access
- structured result return
- artifact return
- status reporting

Subagent contracts should include model-tier policy or model capability requirements appropriate to the delegated role.

### 19.3 Constraint

Subagents must not be unbounded miniature copies of the full system. They should be specialized workers with narrower context and clearer boundaries.

### 19.4 Parent-child reliability and failure semantics

The architecture must define explicit parent-child lifecycle behavior.

At minimum, it must account for:

- child completion with structured result
- child failure with structured error
- child timeout
- child lease expiry or loss of heartbeat
- child output that is malformed or incomplete

The parent task must not wait forever for a child that has silently stalled or disappeared.

The system must support a policy by which a stale child transitions into a terminal or recoverable failure state, and the parent is updated durably with one of the following outcomes or equivalents:

- retry child
- escalate to operator
- continue without child
- fail parent
- block parent pending recovery decision

## 21. Scheduling and Heartbeat Layer

The system must support periodic and scheduled wake-up behavior.

### 20.1 Supported scheduling forms

- recurring heartbeat ticks
- cron-based scheduled triggers
- one-shot follow-up scheduling
- task-driven delayed continuation

### 20.2 Heartbeat behavior

Heartbeat-triggered runs must start with fresh working runtime state.

Heartbeat runs may consult:

- open-task summaries
- blocked or waiting tasks
- scheduled commitments
- recent memory relevant to ongoing work

### 20.3 Autonomy behavior

Heartbeat runs must be allowed to take autonomous action when policy and approval state permit it.

### 20.4 Constraint

Heartbeat runs must not depend on reviving a large historical graph-state object directly.

### 20.5 Timeout, TTL, and stale-state policy

The scheduling and heartbeat layer must include lifecycle maintenance for stale or non-progressing work.

The architecture must define timeout or TTL behavior for at least the following conditions:

- tasks waiting on human approval
- blocked tasks awaiting external conditions
- scheduled follow-ups that are missed or no longer relevant
- subagents that fail to report progress or completion within expected bounds
- stale execution leases whose runtime owner has disappeared

The system must not allow tasks to remain indefinitely in limbo without policy.

### 20.6 Reaper and recovery process

The scheduling and heartbeat layer must include a maintenance process responsible for detecting stale states and applying recovery policy.

This process may be implemented as a reaper, sweeper, or maintenance loop, but it must support at minimum:

- inspection of stale tasks and stale leases
- reminder or escalation behavior for waiting-human states
- transition of expired work into terminal or recoverable timeout states
- follow-up notification through the session layer when policy requires it
- reclamation or release of abandoned execution claims

A task in `waiting_human`, `blocked`, or equivalent suspended states must have a defined timeout policy rather than indefinite passive storage.

### 20.7 Timeout outcomes

The architecture should support more than one stale-work outcome.

Depending on policy and task type, stale work may transition to states such as:

- blocked_timeout
- stalled
- expired
- abandoned
- needs_operator_attention
- failed_timeout

The correct outcome must be explicit and durable rather than inferred informally.

## 22. Approval and Governance Layer

The system must include a first-class approval system for risky or governed actions.

### 21.1 Approval scope

At minimum, the architecture must support approval workflows for:

- tool creation and activation
- high-risk shell or process execution
- destructive filesystem actions
- outward-facing side effects when policy requires them
- other governed actions defined by runtime policy

### 21.2 Approval requirements

Approvals must be:

- durable
- resumable
- linked to tasks and runs
- deliverable through Slack
- auditable after the fact

The approval model must also define:

- who is authorized to approve each governed action class
- how authenticated operator identity is verified before approval resolution is applied
- how replay handling differs from ordinary deduplication for approval responses
- how approval decisions are validated before they mutate durable task or tool-governance state

### 21.3 Approval timeout and reminder behavior

Approvals must support reminder and expiry policy.

At minimum, the architecture must support:

- reminder scheduling for unanswered approvals
- maximum waiting thresholds
- durable recording of reminder attempts
- explicit terminal or escalated behavior when approval is not received in time

An approval request must not be allowed to suspend a task forever without policy-defined follow-up.

### 21.4 Constraint

Approval routing, session delivery, task durability, and runtime pause/resume must remain separate concerns even though they cooperate.

## 23. Observability and Reporting

The system must provide strong visibility into what it is doing and why.

### 22.1 Minimum observability surfaces

- structured runtime logging
- task activity records
- approval history
- memory commit history
- tool execution history
- autonomous-action history
- cost and token accounting

Observability should also include generated-tool lifecycle transitions such as proposal, verification, staged activation, scope widening, rollback, disablement, and supersession.

Observability should also include model-routing and provider-fallback visibility sufficient to diagnose cost, latency, and reliability behavior.

### 22.2 Reporting requirements

The system should support multiple summary forms:

- run summary
- task summary
- operator-facing message summary
- heartbeat or scheduler activity summary

These must remain distinct summary surfaces rather than one overloaded text blob.

## 24. Safety and Governance Principles

The architecture must assume that prompt instructions alone are insufficient for hard safety guarantees.

### 23.1 Safety must be enforced through system design

This includes:

- approval gates
- tool allow and deny policy
- execution boundaries
- runtime user permissions
- filesystem path controls
- resource limits
- explicit validation pipelines for generated tools
- least-privilege secret access for runtime components, tools, and generated tools

### 23.2 Autonomous action must remain policy-bound

The system may be broadly autonomous, but autonomy must always flow through governed tools and durable audit records.

## 25. Data and Commit Semantics

Each run must commit durable outputs through a controlled path.

### 24.1 Minimum commit outputs per meaningful run

- updated task status
- refreshed task summary
- artifact references
- memory candidates or committed memories
- approval resolution when applicable
- transcript or message linkage where relevant

### 24.2 Required summary forms

The system should distinguish between:

- what happened in this run
- the durable current state of the task
- what should be communicated externally to the operator

### 24.3 Clock and timeout source of truth

Because the architecture depends on execution leases, TTL behavior, reminders, and stale-state recovery, it must define an authoritative time source for those decisions.

The preferred source of truth for claim expiry and timeout calculations should be durable and consistent across the system, ideally at the database or otherwise centrally authoritative layer.

## 26. Operational Characteristics

### 25.1 Deployment mode

The system is intended to run as an always-on service under system supervision.

### 25.2 Persistence

Critical task, approval, memory, and artifact state must survive restart.

### 25.3 Performance philosophy

The system should optimize for correctness, recoverability, and contextual quality first, while remaining mindful of Raspberry Pi resource limits.

### 25.4 Resource constraints

The Raspberry Pi target requires attention to:

- limited RAM
- limited CPU
- API-centric inference strategy rather than local heavy model inference
- bounded concurrency
- moderate checkpoint overhead
- controlled filesystem and process usage

The Raspberry Pi deployment target also strengthens the need for tier-aware model routing so that lightweight operations do not incur unnecessary latency or cost.

### 25.5 Restart and crash recovery

The system must assume that the runtime process may terminate unexpectedly.

On restart, the architecture must support recovery that reconstructs authoritative operational state from durable records rather than from in-memory assumptions.

This includes:

- detection of stale task claims
- recovery of pending approvals
- recovery or reconciliation of in-flight child tasks
- resumption or reclassification of interrupted scheduled work
- safe handling of events that were delivered but only partially applied

The system must prefer durable correctness over optimistic in-memory continuity during restart behavior.

## 27. Initial Architectural Success Criteria

An initial implementation should be considered architecturally successful when the following can be demonstrated:

1. A Slack message becomes a normalized event.
2. The system resolves or creates a durable task.
3. The context assembler produces a bounded context packet.
4. The task runtime executes a lean reason-act-reflect loop.
5. A governed action can pause for approval and resume cleanly.
6. Task summaries, memory commits, and artifacts are persisted durably.
7. A heartbeat-triggered run can continue or inspect ongoing work using fresh runtime state.
8. A bounded subagent can be spawned and return structured output.
9. A generated tool can move through proposal, validation, testing, approval, and global activation.
10. Competing event and heartbeat triggers cannot start two runtime loops for the same task.
11. Stale waiting tasks and stale child tasks are detected and handled by policy rather than lingering indefinitely.
12. Lightweight operations and heavyweight reasoning operations are routed to appropriate model tiers through an explicit orchestration layer.
13. Provider timeout, failover, and prompt-overflow recovery behaviors are policy-driven rather than ad hoc.

## 28. Recommended Initial Implementation Order

Although this document is an architecture specification rather than an implementation plan, the architecture implies the following order of dependency:

1. event model and ingress
2. session and task durability model
3. LLM orchestration layer
4. context assembly
5. lean runtime loop
6. approval pause/resume
7. memory commits and artifact persistence
8. heartbeat and scheduling
9. subagents
10. self-extending tool pipeline

This order keeps the core spine stable before autonomy and self-modification features become operationally central.

## 29. Final Architectural Position

This system is defined by the following position:

- it is task-centric rather than thread-centric
- it is context-assembled rather than state-bloated
- it is routed through explicit model policy rather than ad hoc provider calls
- it is tool-governed rather than implicitly executable
- it is memory-aware rather than transcript-bound
- it is autonomous but auditable
- it is extensible but approval-governed
- it is designed for Raspberry Pi deployment from the outset

Any implementation that materially violates these positions should be considered architecturally out of scope, even if it appears expedient in the short term.