# Argentum: A Modular Agentic Framework

> Non-normative vision document.
>
> This file captures the high-level roadmap and architectural direction for Argentum, not the authoritative MVP implementation contract.
>
> For implementation work, the authoritative source of truth is `docs/spec/`, starting with:
>
> 1. `docs/spec/00-overview/framework-overview.md`
> 2. `docs/spec/00-overview/mvp-scope.md`
> 3. `docs/spec/20-contracts/canonical-contracts.md`
> 4. `docs/spec/30-core-loop/core-loop-state-machine.md`
>
> Note: this roadmap still discusses post-MVP concepts such as asynchronous shadow-loop behavior. MVP execution semantics are defined only by the formal spec and ADR set.

## Executive Summary: Next-Generation Modular Agentic Architecture

### Overview

The AI agent ecosystem is experiencing an inflection point. While early orchestration frameworks successfully proved that Large Language Models (LLMs) could interact with real-world applications, they have outgrown their initial designs. This document outlines the architecture for a next-generation, agent-first orchestration framework. It is designed to be aggressively stateless, strictly modular, and optimized for local-first, low-latency execution—scaling gracefully from headless server environments to constrained edge hardware.

### **The Inspiration: OpenClaw and Hermes**

This architecture builds upon the proven successes of community-driven systems like OpenClaw and Hermes, which pioneered the transition from isolated chatbots to functional, self-hosted assistants.

* **The OpenClaw Paradigm:** Proved the massive demand for bypassing cloud lock-in by connecting agents directly to the messaging channels people actually use (Discord, Telegram, CLI). It established the value of file-backed personas and local-first execution.  
* **The Hermes Paradigm:** Introduced the concept of functional pillars (Memory, Skills, Soul) and progressive tool loading, demonstrating that token efficiency is paramount for long-running agents.

### **The Problem: Framework Fatigue and Monolithic Entanglement**

Despite their successes, existing frameworks suffer from critical architectural bottlenecks that hinder reliability and developer adoption:

1. **Gateway-Centric Design:** Systems like OpenClaw treat the messaging gateway as the central control plane, rendering the actual agentic loop a "sidecar." This tight coupling makes the system fragile and highly susceptible to prompt injection.  
2. **Global State Corruption:** Heavy frameworks often enforce a shared global state. In parallel workflows, branches overwrite each other, leading to unpredictable loops and corrupted context.  
3. **Black-Box Execution:** Developers suffer from "framework fatigue." Hidden retry loops, opaque routing, and magical abstractions make debugging failing agents nearly impossible without reverse-engineering the framework itself.  
4. **Context Poisoning:** Dumping massive, raw tool outputs (like web scrapes or database reads) directly into the agent’s working memory bloats token counts, destroys latency, and severely degrades the LLM's reasoning capabilities.

### **The Solution: An Agent-First, Layered Architecture**

This new system solves these pain points by inverting the dependencies. The messaging gateway is relegated to a simple I/O interface, elevating the **Agentic Loop** to the core of the application. The architecture relies on explicit contracts, immutable state passing, and localized environments.  
**Key Architectural Pillars:**

* **Strict Dependency Injection & DTOs:** The system abandons global state. The I/O layer, Agentic Loop, and Tool Registry communicate exclusively via strictly typed Data Transfer Objects (DTOs) and standardized JSON payloads. If a component fails, the blast radius is entirely contained.  
* **Bifurcated Context Management (The Shadow Loop):** To solve context poisoning, the architecture decouples execution from memory maintenance. A "Primary Actor" executes ReAct turns at maximum speed, while an asynchronous "Shadow Manager" runs in the background—intercepting massive tool outputs, compressing them into relevant summaries, and silently pruning the rolling conversation transcript.  
* **The File-Backed Semantic Environment:** Memory is no longer a monolithic, abstracted database. "Semantic Memory" is treated as the agent's physical environment—a local workspace directory of markdown files, configurations, and tool schemas parsed instantly at boot. Long-term memory is relegated to a passive vector archive, accessed only via explicit tool calls.  
* **Decoupled LLM Providers:** The core loop generates a semantic "Context Array" rather than a raw string. A swappable LLM Provider Layer translates this array into provider-specific API calls, automatically managing complex prefix-caching requirements whether routing to cloud endpoints or accelerating local inference.

### **Strategic Advantages**

By treating AI engineering as traditional systems engineering, this framework delivers:

1. **Absolute Observability:** Every internal monologue, node transition, and tool execution yields a discrete event. Developers can trace execution via plain-text, flat JSON logs without wrestling with abstract framework logic.  
2. **Predictability and Safety:** Strict schema validation and a deterministic ReAct state machine prevent infinite loops and unauthorized actions.  
3. **Hardware Efficiency:** By aggressively pruning context, progressively discovering tools, and separating the core loop from I/O overhead, the system runs exceptionally lean, enabling complex autonomous workflows on highly accessible infrastructure.

## MVP

Here is the comprehensive MVP architecture map for the reframed, layered agentic framework. This blueprint abandons monolithic entanglement in favor of strict data contracts, Dependency Injection (DI), and localized state management. It is designed to be highly modular, allowing developers to deploy it anywhere from a high-powered cloud cluster to a headless Linux server running a Raspberry Pi 5 or a scavenged Tesla P40 GPU.

### **High-Level Architectural Flow**

\`\`\`plaintext  
\[User\] \<--\> \[1. Channel Modules\]   
                 |  
           (Platform Events)  
                 |  
                 v  
\[2. Gateway & I/O Layer\] \<--- (Reads/Writes) \---\> \[Session KV Store\]  
                 |  
      (Yields StreamEvents) ^  | (Passes IngressDTO)  
                            |  v  
\[3. Agentic Layer (Core Loop State Machine)\] \<--- (Parses at Boot) \---\> \[6. Environment Layer (Files)\]  
                 |  
   \+-------------+-------------+  
   |             |             |  
(DI Contract) (DI Contract) (Background Task)  
   |             |             |  
   v             v             v  
\[4. LLM\]     \[5. Tool\]     \[Long-Term Memory\]  
\[Layer \]     \[Layer  \]     \[Archival Engine \]  
\`\`\`

### **1\. Channel Modules (The Periphery)**

**Purpose:** Dumb listeners that normalize platform-specific webhooks, websockets, or stdin streams into the framework's universal language.

* **Sub-modules:** CLIAdapter, DiscordAdapter, SlackAdapter, etc.  
* **Responsibilities:** Handle platform authentication, catch incoming messages, and translate outgoing StreamEvents into platform-appropriate UI updates (e.g., turning a thinking event into a Discord typing indicator, or rendering a markdown block in the terminal).  
* **Contract out:** Passes normalized data to the Gateway.

### **2\. Gateway & I/O Layer (The Router)**

**Purpose:** Manages traffic, sessions, and observability. It isolates the messy reality of asynchronous users from the clean logic of the Agentic Loop.

* **Sub-modules:**  
  * **Session Router:** Uses a fast, local Key-Value store (e.g., Redis or SQLite) to map a composite\_key (channel \+ user) to an internal session\_id. Manages the mutex lock (status: idle/locked) to prevent duplicate loops from concurrent user messages.  
  * **Ingress Queue Buffer:** If a session is locked, it buffers incoming messages here until the agent finishes its current ReAct turn.  
  * **Observability/Telemetry Engine:** Subscribes to the StreamEvent yield pipeline. It writes every state transition, tool execution latency, and token count to a flat JSON-lines log file for dead-simple plaintext debugging.  
* **Contract:**  
  * **Input:** Normalized user text.  
  * **Output to Agent:** IngressDTO(session\_id, user\_id, content, timestamp)  
  * **Receives from Agent:** AsyncGenerator\[StreamEvent\]

### **3\. Agentic Layer (The Core State Machine)**

**Purpose:** The deterministic orchestrator. It holds the ReAct loop and manages the active **Episodic Memory** (the working transcript). It interacts with the outside world purely through injected dependencies (ILLMAdapter, IToolRegistry).

* **Sub-modules:**  
  * **Prompt Compiler:** Assembles the Context Array. It pulls the static bedrock (soul.md), the slow-moving semantic environment (tool schemas, workspace index), and the highly dynamic episodic transcript into a stratified array.  
  * **JSON Parser & Validator:** A strict Pydantic-backed parser that extracts LLM outputs, strips markdown, and enforces the schema. If validation fails, it generates an explicit error string and loops back to the LLM without user intervention.  
  * **Internal Context Manager (The Shadow Loop):** A lightweight background process. When a tool returns a massive payload, this sub-module intercepts it, optionally fires a fast compression prompt to the LLM Adapter, and appends only the condensed summary to the Episodic Memory to preserve the token window.  
  * **Execution Governor:** Enforces the max\_turns circuit breaker.  
* **Contract:**  
  * async def execute\_turn(ingress: IngressDTO, llm: ILLMAdapter, tools: IToolRegistry) \-\> AsyncGenerator\[StreamEvent\]

### **4\. LLM Provider Layer (The Model Adapter)**

**Purpose:** Abstracts away the specific model APIs, SDKs, and context-caching quirks. This guarantees the Agentic Layer never has to care whether it's talking to a massive cloud model or a quantized local model.

* **Sub-modules:** OpenAIAdapter, AnthropicAdapter, LocalvLLMAdapter, etc.  
* **Responsibilities:** Translates the Semantic Context Array into provider-specific API calls. Handles rate limiting, retry logic (for API timeouts, not ReAct logic), and applies provider-specific cache breakpoints (e.g., Anthropic's ephemeral tags).  
* **Contract:**  
  * **Input:** SemanticContextArray (a list of layered dictionaries defining static vs. append-only memory).  
  * **Output:** LLMResponseDTO(raw\_text, usage\_metrics)

### **5\. Tool Layer (The Capabilities Registry)**

**Purpose:** The router for agentic action. It registers available functions, enforces input schemas, and provides progressive discovery to the LLM.

* **Sub-modules:**  
  * **Hierarchical Router:** Exposes top-level namespaces (system.*, file\_system.*) and manages the registry.explore tool to save tokens.  
  * **Long-Term Memory Search:** Functionally, querying cold storage is just a tool. This sub-module exposes system.memory\_search to hit the local vector database.  
* **Contract:**  
  * **Input from Agent:** ToolCallDTO(namespace, arguments)  
  * **Output to Agent:** Stringified execution results or captured tracebacks.

### **6\. Environment Layer (The Sandbox & Semantic State)**

**Purpose:** The physical reality where the agent lives and executes tools. This completely absorbs the old concept of "Semantic Memory."

* **Sub-modules:**  
  * **The Workspace (Filesystem):** The static directory containing soul.md, AGENTS.md, and the tools/ directory. The Agentic Layer parses these at boot to define its persona and capabilities.  
  * **Execution Sandbox:** The runtime environment for the tools. Depending on the deployment profile, this could be a NativeExecutionDriver (running Python directly on the host) or a DockerSandboxDriver (spinning up a container to isolate dangerous code).  
  * **Vector Cold Storage (Background):** A local SQLite/vss or Chroma instance. It is queried actively by the Tool Layer, but written to passively by a background archiver hook that runs after the Agentic Layer yields a final response.

