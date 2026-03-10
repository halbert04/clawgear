# ClawGear: Technical Design Document

**Version:** 0.2.0-draft
**Date:** 2026-03-09
**Status:** Draft - Pending Review (updated with OpenFang repo deep-dive)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Source Analysis: What We Take From Each Project](#2-source-analysis)
3. [Vision & Problem Statement](#3-vision--problem-statement)
4. [Architecture Overview](#4-architecture-overview)
5. [Core Systems Design](#5-core-systems-design)
6. [Organizational Model](#6-organizational-model)
7. [Agent Runtime & Execution](#7-agent-runtime--execution)
7B. [Workflow Engine & Trigger System](#7b-workflow-engine--trigger-system)
8. [Communication & Protocol Stack](#8-communication--protocol-stack)
9. [Memory & Knowledge Architecture](#9-memory--knowledge-architecture)
10. [Security Model](#10-security-model)
11. [Autonomous Operations (Hands)](#11-autonomous-operations-hands)
12. [Multi-Channel Integration](#12-multi-channel-integration)
13. [Skills & Marketplace](#13-skills--marketplace)
14. [Observability & Governance](#14-observability--governance)
15. [Desktop & Device Integration](#15-desktop--device-integration)
16. [Tech Stack Decisions](#16-tech-stack-decisions)
17. [Monorepo Structure](#17-monorepo-structure)
18. [Database Schema Design](#18-database-schema-design)
19. [API Design](#19-api-design)
20. [Migration & Compatibility](#20-migration--compatibility)
21. [Development Phases](#21-development-phases)
22. [Open Questions](#22-open-questions)

---

## 1. Executive Summary

**ClawGear** is an open-source CEO Agent Operating System that combines the best architectural decisions from three leading agent platforms:

| Feature Domain | Best-in-Class Source | What We Take |
|---|---|---|
| Performance & Security | **OpenFang** (Rust, 16 security layers, 180ms cold start) | WASM sandbox, Merkle audit trails, security-first design |
| Business Orchestration | **Paperclip** (org charts, budgets, atomic checkout) | Corporate hierarchy, governance, budget enforcement, goal alignment |
| Personal Agent UX | **OpenClaw** (290K stars, 20+ channels, device integration) | Multi-channel routing, device nodes, skills ecosystem, session management |

**The thesis:** No existing project does all three well. OpenFang has the best runtime but no business orchestration. Paperclip has the best business model but limited runtime and no channels. OpenClaw has the best UX and ecosystem but no corporate hierarchy or budget controls.

ClawGear is the CEO agent that runs a business -- it orchestrates teams of specialized agents, enforces budgets, aligns work to goals, communicates across every channel, and does it all with production-grade security and performance.

---

## 2. Source Analysis

### From OpenFang (Rust Agent OS)

**ADOPT:**
- Rust kernel for the core runtime (performance, safety, single binary)
- WASM dual-metered sandbox (fuel + epoch) for tool execution isolation
- 16-layer defense-in-depth security model
- Merkle hash-chain audit trail (cryptographic tamper evidence)
- Ed25519 manifest signing for agent/skill integrity
- OFP-style P2P mutual authentication (HMAC-SHA256)
- 4-tier model routing (frontier/smart/fast/lightweight)
- "Hands" concept -- autonomous background operations with SOPs
- Taint tracking for information flow control
- GCRA rate limiting
- Secret zeroization
- SQLite + sqlite-vec hybrid search (vector + BM25)
- Context compaction with pre-compaction memory flush

**ADAPT:**
- Tauri desktop app -> adopt but with a richer dashboard (Paperclip-style)
- 40 channel adapters -> start with OpenClaw's mature adapters, expand later
- FangHub marketplace -> merge with ClawHub model, unified registry

**ADOPT (additional from repo deep-dive):**
- Workflow engine with sequential, fan-out, collect, conditional, and loop execution modes
- Variable substitution system (`{{input}}`, `{{named_var}}`) for step chaining
- Error handling modes per step: fail, skip, retry (with max_retries)
- Trigger engine with event-driven automation (pattern matching on kernel event bus)
- 10 trigger patterns: All, Lifecycle, AgentSpawned, AgentTerminated, System, SystemKeyword, MemoryUpdate, MemoryKeyPattern, ContentMatch
- `agent.toml` template format for declarative agent configuration (30 bundled templates)
- Multi-runtime skill system: Python, WASM, Node.js, PromptOnly, Builtin
- `skill.toml` manifest with JSON Schema input validation for tool definitions
- Python SDK (`SkillHandler`) for easy skill development
- Capability-based security with enum patterns: `FileRead("/data/*")`, `NetConnect("*.openai.com:443")`, `ToolInvoke(tool_id)`
- Child agent capability inheritance (no privilege escalation)
- `KernelHandle` trait pattern to avoid circular deps between runtime and kernel
- `AppState` bridge pattern between kernel and API routes
- Alpine.js SPA dashboard in static HTML (lightweight, no build step for dashboard)
- Config via TOML with `#[serde(default)]` pattern for zero-config defaults
- Per-agent hourly token quota via `UsageTracker` with rolling 1-hour window
- 10-phase graceful shutdown sequence
- JavaScript and Python SDKs for external integrations

**SKIP:**
- Proprietary OFP protocol as the primary protocol -> use A2A + MCP as primary, OFP as optional P2P layer
- 14-crate structure -> simplify to fewer, more focused crates
- Alpine.js dashboard -> use React for richer interactivity (Paperclip-style)

### From Paperclip (Business Orchestration)

**ADOPT:**
- Company/team/agent org chart hierarchy with reporting lines
- Atomic task checkout with database-level concurrency control
- Heartbeat execution model (agents wake, check, act, sleep)
- Three-tier budget enforcement (company -> agent -> project) with auto-pause
- Goal ancestry alignment (company mission -> team goals -> agent goals -> tasks)
- Governance controls (approval gates, config versioning, rollback)
- Board authority model with human-in-the-loop escalation
- Ticket/conversation threading for work tracking
- "Bring your own agent" adapter pattern
- Multi-company isolation with portable company templates
- Immutable append-only activity log
- Per-agent runtime state persistence across heartbeats
- Issue status state machine with side effects
- Cost event tracking with billing codes

**ADAPT:**
- PostgreSQL schema -> keep for the orchestration layer but pair with SQLite for agent-local memory
- TypeScript services -> rewrite critical paths in Rust, keep TypeScript for API/UI layers
- Drizzle ORM patterns -> adopt the schema patterns, implement in our stack
- Adapter registry -> extend with OpenClaw's richer adapter model

**SKIP:**
- Express.js API server -> use Axum (Rust) for the core API
- PGlite embedded mode -> SQLite for embedded, Postgres for production orchestration

### From OpenClaw (Personal Agent Platform)

**ADOPT:**
- WebSocket Gateway protocol (v3) with typed JSON-RPC
- Multi-channel routing with deterministic binding rules
- Device node architecture (camera, screen, location, notifications)
- Canvas + A2UI agent-driven visual workspace
- Browser automation via CDP (Playwright layer)
- Skills as SKILL.md files with frontmatter metadata
- ClawHub-style community marketplace (13K+ skills)
- Session management with hierarchical session keys
- Model failover with auth profile rotation and backoff
- Hot-reload configuration pipeline (JSON5 + Zod validation)
- DM/group policies with pairing-based access control
- Context pruning strategies (FIFO, relevance, hybrid, cache-ttl)
- Operator/Node role separation
- Per-session Docker sandboxing for non-main sessions
- JSONL transcript persistence

**ADAPT:**
- Pi Agent runtime -> support as one adapter among many, not the only runtime
- Single-user architecture -> extend to multi-company multi-user (Paperclip model)
- 127.0.0.1 loopback binding -> add production-grade auth for remote deployments
- Companion apps -> integrate with Tauri desktop, add mobile companion nodes

**SKIP:**
- Tight coupling to Pi Agent SDK -> abstract the agent runtime interface
- CalVer versioning -> use SemVer for clarity

---

## 3. Vision & Problem Statement

### Problem

Running a business with AI agents today requires stitching together:
- An agent framework (LangGraph, CrewAI, AutoGen) for agent execution
- A project manager (Linear, Jira) for task tracking
- A communication layer (Slack bots, Discord bots) for channels
- A monitoring stack (custom dashboards) for observability
- Manual budget tracking and no real governance

None of these integrate natively. There is no system where a CEO agent can:
1. Understand the company mission and decompose it into goals
2. Hire and manage a team of specialized agents
3. Assign work aligned to goals with budget constraints
4. Monitor execution with cryptographic audit trails
5. Communicate across every channel the business uses
6. Operate autonomously on schedules while respecting human approval gates

### Vision

ClawGear is the operating system for AI-run businesses. A single deployment provides:
- **CEO Agent**: Strategic planning, goal decomposition, team management
- **Org Chart**: Hierarchical agent teams with roles, reporting lines, permissions
- **Work System**: Tickets, conversations, atomic checkout, heartbeat execution
- **Budget Control**: Per-agent and per-company spending limits with auto-enforcement
- **Goal Alignment**: Every task traces to the company mission
- **Governance**: Approval gates, config versioning, board oversight
- **Multi-Channel**: 20+ messaging platforms, unified inbox
- **Device Integration**: Camera, screen, browser, mobile companion nodes
- **Security**: 16-layer defense-in-depth, WASM sandboxing, Merkle audits
- **Performance**: Sub-200ms cold start, <50MB idle memory, single binary core

---

## 4. Architecture Overview

```
+-----------------------------------------------------------------------+
|                          ClawGear System                               |
|                                                                        |
|  +------------------+  +-------------------+  +---------------------+  |
|  |   Tauri Desktop  |  |   Web Dashboard   |  |   Mobile Nodes      |  |
|  |   (Native App)   |  |   (React UI)      |  |   (iOS/Android)     |  |
|  +--------+---------+  +---------+---------+  +----------+----------+  |
|           |                      |                       |             |
|           +----------------------+-----------------------+             |
|                                  |                                     |
|                          WebSocket Gateway                             |
|                     (Typed JSON-RPC Protocol)                          |
|                                  |                                     |
|  +-------------------------------+-------------------------------+     |
|  |                                                               |     |
|  |                      Rust Kernel (Axum)                       |     |
|  |                                                               |     |
|  |  +-------------+  +--------------+  +----------------------+  |     |
|  |  | Orchestrator|  | Agent Runtime|  | Security Engine      |  |     |
|  |  | - Org Chart |  | - WASM Sbox  |  | - 16 Layers          |  |     |
|  |  | - Goals     |  | - Heartbeat  |  | - Merkle Audit       |  |     |
|  |  | - Budgets   |  | - Adapters   |  | - Taint Tracking     |  |     |
|  |  | - Governance|  | - Model Tier |  | - RBAC               |  |     |
|  |  +-------------+  +--------------+  +----------------------+  |     |
|  |                                                               |     |
|  |  +-------------+  +--------------+  +----------------------+  |     |
|  |  | Work System |  | Memory       |  | Communication        |  |     |
|  |  | - Issues    |  | - SQLite+Vec |  | - 20+ Channels       |  |     |
|  |  | - Checkout  |  | - Embeddings |  | - A2A Protocol       |  |     |
|  |  | - Threads   |  | - Compaction |  | - MCP Client/Server  |  |     |
|  |  | - State     |  | - KV Store   |  | - P2P (OFP)          |  |     |
|  |  +-------------+  +--------------+  +----------------------+  |     |
|  |                                                               |     |
|  +---------------------------------------------------------------+     |
|                                  |                                     |
|          +-------------------+---+---+-------------------+             |
|          |                   |       |                   |             |
|  +-------+------+  +--------+---+  ++-------+  +-------+--------+    |
|  | PostgreSQL   |  | SQLite     |  | Canvas |  | Browser        |    |
|  | (Orchestr.)  |  | (Agent Mem)|  | (A2UI) |  | (CDP/Playwright)|   |
|  +--------------+  +------------+  +--------+  +----------------+    |
+-----------------------------------------------------------------------+
```

### Dual-Database Strategy

| Database | Purpose | Rationale |
|---|---|---|
| **PostgreSQL** | Orchestration data: companies, agents, issues, goals, budgets, approvals, audit logs, cost events | ACID transactions for atomic checkout, multi-company isolation, relational integrity for org charts and goal hierarchies |
| **SQLite + sqlite-vec** | Per-agent memory: embeddings, session transcripts, knowledge graphs, KV store | Agent-local, zero-config, portable, fast hybrid search (vector + BM25), no network overhead |

This mirrors how a real company works: the corporate systems (ERP, HR, PM) run on a central database, while each employee keeps their own notes, files, and knowledge locally.

---

## 5. Core Systems Design

### 5.1 The Kernel

The kernel is the central coordinator, written in Rust. Inspired by OpenFang's 18-step boot sequence, it owns:

- **Agent Lifecycle**: spawn, configure, heartbeat, pause, resume, terminate
- **Work Distribution**: atomic issue checkout, assignment, delegation
- **Budget Metering**: cost event ingestion, threshold checks, auto-pause
- **Model Routing**: 4-tier selection, provider failover, auth profile rotation
- **Security Enforcement**: RBAC capability gates, taint propagation, rate limiting
- **Event Bus**: typed internal events for cross-system coordination (lifecycle, system, memory, content events)
- **Scheduler**: cron-based heartbeat triggers with skip conditions
- **Workflow Engine**: multi-step agent pipelines with fan-out, conditional, loop support
- **Trigger Engine**: event-driven automation via pattern matching on the event bus
- **Usage Tracker**: per-agent rolling 1-hour token quotas with `QuotaExceeded` enforcement

The kernel uses the `KernelHandle` trait pattern (from OpenFang) to avoid circular dependencies between runtime and kernel crates. An `AppState` struct bridges the kernel to API routes.

### 5.2 The Gateway

WebSocket-based control plane (adapted from OpenClaw's v3 protocol):

- **Typed JSON-RPC**: All messages validated against schemas
- **Role-Based Connections**: Operator (human/CLI), Node (device), Agent (internal)
- **Hot-Reload Config**: JSON5 + Zod validation, hybrid hot-apply/restart modes
- **Presence Tracking**: Connected clients, agent status, session metadata
- **Event Streaming**: Real-time events for dashboard, CLI, mobile clients

### 5.3 The API Layer

REST + WebSocket + SSE via Axum:

- **REST**: CRUD for all orchestration entities (companies, agents, issues, goals, etc.)
- **WebSocket**: Bidirectional agent communication, dashboard live updates
- **SSE**: Streaming agent responses for web clients
- **OpenAI-Compatible**: `/v1/chat/completions` and `/v1/models` for interop
- **MCP Server**: Expose ClawGear tools to external MCP clients
- **A2A Server**: Agent Card discovery and task delegation

---

## 6. Organizational Model

Adopted from Paperclip, enhanced with OpenFang's security model.

### 6.1 Company

```
Company
  - name, description, status (active|paused|archived)
  - issuePrefix (e.g., "CG"), issueCounter (auto-increment)
  - budgetMonthlyCents, spentMonthlyCents
  - requireBoardApprovalForNewAgents (default: true)
  - missionGoalId -> Goal (root company goal)
```

### 6.2 Agent Hierarchy

```
CEO Agent (role: ceo)
  |-- CTO Agent (role: cto, reportsTo: CEO)
  |     |-- Engineer Agent (role: engineer, reportsTo: CTO)
  |     |-- DevOps Agent (role: devops, reportsTo: CTO)
  |-- CMO Agent (role: cmo, reportsTo: CEO)
  |     |-- Social Media Agent (role: social, reportsTo: CMO)
  |     |-- Content Agent (role: content, reportsTo: CMO)
  |-- CFO Agent (role: cfo, reportsTo: CEO)
        |-- Analyst Agent (role: analyst, reportsTo: CFO)
```

Each agent has:
- **Identity**: id, name, title, role, icon, company scope
- **Hierarchy**: reportsTo (self-referencing FK), reporting tree
- **Capabilities**: declared tool set (immutable after creation, RBAC-enforced)
- **Budget**: individual budgetMonthlyCents, spentMonthlyCents
- **Adapter**: which runtime executes this agent (Claude Code, Codex, process, HTTP, etc.)
- **Model Tier**: preferred model tier (frontier/smart/fast/lightweight)
- **Status**: idle -> running -> idle | error -> idle | paused | terminated (irreversible)
- **Permissions**: canCreateAgents, canApproveStrategy, canDelegateWork, etc.
- **Ed25519 Manifest**: signed capability declaration for tamper-proof identity

### 6.3 Goal Alignment

```
Company Mission (level: company)
  |-- Team Goal: "Ship v2.0" (level: team, owner: CTO)
  |     |-- Agent Goal: "Build auth system" (level: agent, owner: Engineer)
  |     |     |-- Task Goal: "Implement JWT middleware" (level: task)
  |     |-- Agent Goal: "Set up CI/CD" (level: agent, owner: DevOps)
  |-- Team Goal: "Grow audience 10x" (level: team, owner: CMO)
        |-- Agent Goal: "Launch Twitter campaign" (level: agent, owner: Social)
```

Every issue links to a goal. Agents always see the full ancestry chain when picking up work, providing strategic context for tactical decisions.

### 6.4 Projects

Projects group related issues under a goal with:
- Lead agent assignment
- Target date
- Status tracking
- Color coding for dashboard visualization

---

## 7. Agent Runtime & Execution

### 7.1 Heartbeat Model (from Paperclip)

Agents do not run continuously. They execute in heartbeats:

```
Trigger (schedule | assignment | mention | manual)
  -> Wake agent
  -> Load runtime state (session, context snapshot)
  -> Execute heartbeat procedure:
       1. Identify self (read agent config, role, permissions)
       2. Check assignments (GET /issues?assignee=me&status=in_progress)
       3. Checkout new work if idle (POST /issues/:id/checkout)
       4. Read issue thread (full goal ancestry + comments)
       5. Execute work (tool calls, code generation, research)
       6. Post status updates (comments on the issue)
       7. Delegate if needed (create child issues, assign to reports)
       8. Report costs (POST /cost-events)
       9. Transition issue status
  -> Persist runtime state
  -> Sleep
```

### 7.2 Atomic Task Checkout (from Paperclip)

```sql
UPDATE issues
SET assignee_agent_id = $agent_id,
    status = 'in_progress',
    started_at = NOW(),
    checkout_run_id = $run_id
WHERE id = $issue_id
  AND status IN ('todo', 'backlog')
  AND (assignee_agent_id IS NULL OR assignee_agent_id = $agent_id);
-- 0 rows updated = 409 Conflict
```

- Idempotent: self-checkout returns success
- Stale run adoption: terminated runs release locks
- Wakeup logic: only wake assignee when checkout is by another agent

### 7.3 WASM Sandbox (from OpenFang)

All tool execution runs inside a Wasmtime WASM sandbox:

- **Fuel metering**: deterministic instruction counting, prevents compute abuse
- **Epoch metering**: wall-clock timeout, catches blocking/stalling
- **Watchdog thread**: kills runaway executions
- **Workspace confinement**: file I/O restricted to agent's workspace directory
- **Subprocess isolation**: `env_clear()` + selective passthrough, process tree kill
- **Direct argv execution**: `shlex` parsing, no shell interpreter (prevents injection)

### 7.4 Adapter System (from Paperclip + OpenClaw)

"Bring your own agent" -- ClawGear orchestrates, agents execute:

| Adapter | Description | Session Support |
|---|---|---|
| `claude_code` | Claude Code CLI | Yes (resume sessions) |
| `codex` | OpenAI Codex CLI | Yes |
| `cursor` | Cursor IDE CLI | Yes |
| `openclaw` | OpenClaw gateway webhook | Yes |
| `openfang` | OpenFang A2A delegation | Yes |
| `process` | Generic process spawner | No |
| `http` | Generic HTTP webhook | No |
| `custom` | User-defined adapter | Configurable |

Each adapter implements:
```
execute(ctx: AdapterContext) -> AdapterResult
testEnvironment(ctx) -> EnvironmentTestResult
sessionCodec? -> serialize/deserialize session state
```

### 7.5 Model Routing (from OpenFang + OpenClaw)

4-tier intelligent routing with failover:

| Tier | Use Case | Examples |
|---|---|---|
| Frontier | CEO strategy, complex reasoning | Claude Opus, GPT-5 |
| Smart | General tasks, coding, analysis | Claude Sonnet, Gemini 2.5 Flash |
| Fast | Quick responses, high throughput | Llama 3.3 70B, Gemini Flash |
| Lightweight | Simple queries, cost-sensitive | Small models via Groq/DeepSeek |

Failover chain: auth profile rotation -> provider fallback -> tier downgrade.
Backoff: rate-limit errors get short cooldowns, billing errors get exponential backoff (5h -> 10h -> 20h -> 24h cap).

---

## 7B. Workflow Engine & Trigger System

Adopted from OpenFang, integrated with ClawGear's organizational model.

### 7B.1 Workflow Engine

The workflow engine enables multi-step agent pipelines -- orchestrated sequences where each step routes work to a specific agent. Workflows compose complex behaviors without requiring code changes.

**Workflow Definition:**
```toml
name = "quarterly-report-pipeline"
description = "Generate quarterly business report"

[[steps]]
name = "gather-metrics"
agent_role = "analyst"           # resolved via org chart
prompt = "Pull Q4 metrics for: {{input}}"
timeout_secs = 300
output_var = "metrics"

[[steps]]
name = "market-research"
agent_role = "researcher"
mode = "fan_out"                 # runs in parallel with next fan_out
prompt = "Research market trends for: {{input}}"
output_var = "market"

[[steps]]
name = "competitor-analysis"
agent_role = "researcher"
mode = "fan_out"
prompt = "Analyze competitor activity for: {{input}}"
output_var = "competitors"

[[steps]]
name = "collect"
mode = "collect"                 # joins all fan_out outputs

[[steps]]
name = "draft-report"
agent_role = "writer"
prompt = "Draft Q4 report.\nMetrics: {{metrics}}\nMarket: {{market}}\nCompetitors: {{competitors}}"
output_var = "draft"

[[steps]]
name = "review-loop"
agent_role = "ceo"
mode = "loop"
max_iterations = 3
until = "APPROVED"
prompt = "Review report. Respond APPROVED if ready, else provide revision notes:\n\n{{input}}"
error_mode = "retry"
max_retries = 2
```

**Execution Modes:**

| Mode | Behavior |
|---|---|
| `sequential` | Default. Previous output becomes `{{input}}` |
| `fan_out` | Consecutive fan_out steps run in parallel via `join_all` |
| `collect` | Joins all preceding fan_out outputs with separator |
| `conditional` | Executes only if previous output contains `condition` substring |
| `loop` | Repeats up to `max_iterations`, stops early on `until` match |

**Error Handling (per step):**

| Mode | Behavior |
|---|---|
| `fail` | Abort workflow immediately |
| `skip` | Silently skip, continue with unchanged `{{input}}` |
| `retry` | Retry up to `max_retries` times with fresh timeout per attempt |

**ClawGear Enhancement over OpenFang:** Workflows resolve agents via org chart roles, not just agent IDs. The CEO can define a workflow that uses "the analyst" and "the researcher" -- if those agents are replaced, the workflow still works. Cost events from workflow runs are attributed to the workflow's parent goal.

### 7B.2 Trigger Engine

Event-driven automation via pattern matching on the kernel's internal event bus.

**Trigger Definition:**
```toml
agent_id = "<ceo-agent-uuid>"
pattern = { agent_terminated = {} }     # any agent crash/termination
prompt_template = "ALERT: {{event}}. Assess impact and reassign work."
max_fires = 0                            # unlimited
enabled = true
```

**Event Patterns:**

| Pattern | Matches |
|---|---|
| `all` | Every event on the bus |
| `lifecycle` | Any agent lifecycle event |
| `agent_spawned { name_pattern }` | Agent creation matching pattern |
| `agent_terminated` | Any agent termination or crash |
| `system` | Health checks, quotas, system events |
| `system_keyword { keyword }` | System events containing keyword |
| `memory_update` | Any memory change |
| `memory_key_pattern { key_pattern }` | Memory updates by key pattern |
| `content_match { substring }` | Event descriptions containing substring |
| `budget_threshold { percent }` | Budget utilization crosses threshold (ClawGear addition) |
| `approval_pending { type }` | New approval request of specified type (ClawGear addition) |
| `issue_status_change { from, to }` | Issue transitions (ClawGear addition) |

**ClawGear Additions over OpenFang:** Three new trigger patterns (`budget_threshold`, `approval_pending`, `issue_status_change`) integrate with the organizational model. The CEO agent can set up triggers like:
- "Alert me when any agent hits 80% budget"
- "Notify me when a strategy approval is pending"
- "Escalate when any issue moves to blocked"

When a trigger fires, `{{event}}` in the prompt template is replaced with a human-readable event description. Triggers with `max_fires > 0` auto-disable after reaching the count.

---

## 8. Communication & Protocol Stack

### 8.1 Three-Protocol Architecture (from OpenFang)

| Protocol | Purpose | Transport |
|---|---|---|
| **MCP** | Tool interoperability | JSON-RPC 2.0 over HTTP |
| **A2A** | Inter-agent task delegation | HTTP + SSE (Google standard) |
| **P2P** | Direct instance-to-instance | HMAC-SHA256 authenticated frames |

### 8.2 MCP (Model Context Protocol)

- **Client mode**: Connect to external MCP servers to use their tools
- **Server mode**: Expose ClawGear tools to other MCP-compatible systems
- Tools namespaced as `mcp_{server}_{tool}` to prevent collisions

### 8.3 A2A (Agent-to-Agent)

- `GET /.well-known/agent.json` -- Agent Card discovery
- `POST /a2a/tasks/send` -- Delegate tasks to external agents
- `GET /a2a/tasks/{id}` -- Poll task status
- `POST /a2a/tasks/{id}/cancel` -- Abort delegated tasks
- Used for cross-deployment agent coordination

### 8.4 Internal Agent-to-Agent (from OpenClaw)

Within a ClawGear deployment, agents coordinate via session tools:
- `sessions_list` -- discover active agents
- `sessions_history` -- fetch transcripts
- `sessions_send` -- inter-agent messaging
- `sessions_spawn` -- create subagent instances

These map to the org chart: an agent can message its reports, its manager, or peers.

---

## 9. Memory & Knowledge Architecture

### 9.1 Dual-Store Design

**PostgreSQL (Orchestration Memory)**:
- Company state, org charts, issues, goals, budgets
- Cost events, audit logs, approval history
- Config revisions for rollback
- Shared across all agents in a company

**SQLite + sqlite-vec (Agent Memory)**:
- Per-agent knowledge base with vector embeddings
- Session transcripts (JSONL)
- Hybrid search: cosine similarity (70%) + BM25 keyword (30%)
- Agent-scoped KV store for persistent state
- Workspace-confined file index with delta tracking

### 9.2 Context Management (from OpenClaw + OpenFang)

**Compaction**: When context approaches the model's window limit:
1. Pre-compaction memory flush -- agent writes durable memories before truncation
2. LLM-based summarization of older messages
3. High-relevance messages preserved (hybrid pruning)

**Pruning strategies** (per-session configurable):
- `fifo` -- remove oldest messages first
- `relevance` -- use embeddings to keep most relevant
- `hybrid` -- FIFO but protect high-relevance messages
- `cache-ttl` -- prune expired cached tool outputs

**Knowledge graphs**: Built incrementally by autonomous Hands (Collector, Lead, Researcher). Graph-based fact linking across agent interactions.

### 9.3 Session Persistence

- Session keys follow OpenClaw's hierarchical model:
  `agent:{agentId}:main`, `agent:{agentId}:{channel}:dm:{peer}`, etc.
- Runtime state persisted across heartbeats (Paperclip model)
- JSONL transcript mirroring for durability and debugging
- Cross-channel canonical sessions (OpenFang) -- same conversation context regardless of channel

---

## 10. Security Model

16-layer defense-in-depth combining the strongest elements from all three projects:

| # | Layer | Source | Description |
|---|---|---|---|
| 1 | WASM Dual-Metered Sandbox | OpenFang | Fuel + epoch metering with watchdog thread |
| 2 | Merkle Hash-Chain Audit | OpenFang | Cryptographically linked, tamper-evident action log |
| 3 | Taint Tracking | OpenFang | Information flow labels propagated source-to-sink |
| 4 | Ed25519 Manifest Signing | OpenFang | Signed agent identity and capability declarations |
| 5 | SSRF Protection | OpenFang | Block private IPs, cloud metadata, DNS rebinding |
| 6 | Secret Zeroization | OpenFang | `Zeroizing<String>` auto-wipes secrets from memory |
| 7 | P2P Mutual Auth | OpenFang | HMAC-SHA256 nonce-based, constant-time verification |
| 8 | RBAC Capability Gates | OpenFang | Immutable capability sets, enforced regardless of prompt |
| 9 | Security Headers | OpenFang | CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| 10 | Subprocess Sandbox | OpenFang | env_clear(), process tree isolation, direct argv exec |
| 11 | Prompt Injection Scanner | OpenFang | Detects override attempts, exfiltration patterns |
| 12 | Loop Guard | OpenFang | SHA256 tool call dedup with circuit breaker |
| 13 | Budget Enforcement | Paperclip | Auto-pause agents at 100% budget, warn at 80% |
| 14 | Approval Gates | Paperclip | Human-in-the-loop for hiring, strategy, purchases |
| 15 | DM/Group Policies | OpenClaw | Pairing-based access control, allowlists |
| 16 | Per-Session Docker Sandbox | OpenClaw | Non-main sessions run in isolated containers |

### Human-in-the-Loop Escalation

ClawGear enforces mandatory human approval for:
- Hiring new agents (when `requireBoardApprovalForNewAgents` is on)
- CEO strategy proposals before execution
- Financial transactions and purchases (Browser Hand approval gate)
- Social media posts (Twitter Hand approval queue)
- Budget increases
- Agent termination

### Secret Management

- Agent API keys stored as SHA-256 hashes only (plaintext shown once)
- Company secrets versioned with SHA-256 verification and revocation
- Encrypted at rest via AES-256-GCM with per-instance master key
- Secret redaction in all logs, API responses, and exports

---

## 11. Autonomous Operations (Hands)

Adopted from OpenFang, integrated with Paperclip's governance model.

Hands are self-contained autonomous capability packages that run on schedules without user prompting. Each Hand bundles:
1. **HAND.toml** -- declarative config (tools, settings, metrics, requirements)
2. **System Prompt** -- multi-phase operational runbook with decision trees
3. **SKILL.md** -- domain expertise and methodology
4. **Execution Engine** -- background process with SOPs, knowledge graphs, dashboard reporting

### Built-in Hands (Phase 1)

| Hand | Domain | Governance Integration |
|---|---|---|
| **Researcher** | Deep research with CRAAP methodology | Reports findings as issue comments |
| **Lead** | ICP-based lead generation and scoring | Creates issues for high-score leads, tracks costs |
| **Collector** | OSINT intelligence monitoring | Critical alerts escalate to CEO agent |
| **Clip** | Video-to-short-form content pipeline | Content enters approval queue before publishing |
| **Twitter** | X/Twitter account management | All posts require approval gate |
| **Browser** | Web automation and workflows | Purchases require explicit human approval |
| **Predictor** | Forecasting with Brier score calibration | Predictions attached to strategic goals |

### Hands + Governance

Unlike standalone OpenFang, ClawGear Hands operate within the organizational model:
- Every Hand action is logged to the Merkle audit trail
- Hands respect agent budget limits
- Hand outputs create issues in the work system
- Approval gates are enforced by the kernel, not by the Hand itself
- Hand costs are attributed to the owning agent's budget

---

## 12. Multi-Channel Integration

Adopted from OpenClaw's mature adapter system, extended with Paperclip's multi-company routing.

### Channel Adapters (Phase 1)

| Channel | Library | Priority |
|---|---|---|
| Slack | @slack/bolt | P0 (launch) |
| Discord | discord.js | P0 (launch) |
| Telegram | grammY | P0 (launch) |
| WhatsApp | @whiskeysockets/baileys | P1 |
| Microsoft Teams | Bot Framework | P1 |
| WebChat | Built-in | P0 (launch) |
| Email | IMAP/SMTP | P1 |
| Matrix | matrix-js-sdk | P2 |
| IRC | irc-framework | P2 |

### Routing Model

```
Inbound message
  -> Channel adapter normalizes to internal format
  -> Company resolution (multi-tenant: which company?)
  -> Binding lookup: (channel, account, peer/group) -> agentId
  -> DM/Group policy enforcement
  -> Session resolution (hierarchical session key)
  -> Agent heartbeat trigger
  -> Response routed back to originating channel
```

Bindings are deterministic (no LLM reasoning for routing). Most specific binding wins.

### Multi-Company Channel Isolation

Each company has its own set of channel bindings. A Slack workspace binds to one company. Cross-company message routing is impossible by design.

---

## 13. Skills & Marketplace

### 13.1 Skill Format (Dual Format)

ClawGear supports two skill formats to cover all use cases:

**Format A: SKILL.md (Expert Knowledge / Prompt-Only)**

For injecting domain expertise and procedures into agent context:

```markdown
---
name: customer-onboarding
version: 1.0.0
triggers:
  - "onboard new customer"
  - "customer setup"
permissions:
  tools: [browser, email]
  filesystem: [read, write]
sha256: <hash for integrity verification>
---

# Customer Onboarding

## When to Use
When a new customer signs up and needs account setup...

## Procedure
1. Verify customer details via CRM API
2. Create account in the system
3. Send welcome email
4. Schedule onboarding call
...
```

**Format B: skill.toml (Executable Tools)**

For skills that provide new tool capabilities with code execution:

```toml
[skill]
name = "crm-integration"
version = "0.1.0"
description = "CRM operations for customer management"
author = "clawgear-community"
license = "MIT"
tags = ["crm", "customers", "sales"]

[runtime]
type = "python"              # python | wasm | node | prompt_only | builtin
entry = "src/main.py"

[[tools.provided]]
name = "crm_create_customer"
description = "Create a new customer record in the CRM"
input_schema = { type = "object", properties = { name = { type = "string" }, email = { type = "string" } }, required = ["name", "email"] }

[[tools.provided]]
name = "crm_lookup_customer"
description = "Look up customer by email or ID"
input_schema = { type = "object", properties = { query = { type = "string" } }, required = ["query"] }

[requirements]
tools = ["web_fetch"]
capabilities = ["NetConnect(*.salesforce.com:443)"]
```

### 13.1B Multi-Runtime Skill Execution (from OpenFang)

| Runtime | Language | Sandboxing | Best For |
|---|---|---|---|
| `python` | Python 3.8+ | Subprocess isolation (env_clear) | Easy implementation, data processing |
| `wasm` | Rust, C, Go (compiled) | Wasmtime sandbox (fuel + epoch) | Security-critical tools, untrusted code |
| `node` | JavaScript/TypeScript | Subprocess isolation | OpenClaw skill compatibility |
| `prompt_only` | Markdown (SKILL.md) | N/A | Expert knowledge injection |
| `builtin` | Rust | N/A (compiled into binary) | Core tools, performance-critical |

Skills communicate via JSON over stdin/stdout (Python/Node) or WASM host calls. The skill receives `{ "tool": "name", "input": {...}, "agent_id": "...", "agent_name": "..." }` and returns `{ "result": "..." }` or `{ "error": "..." }`.

### 13.1C Agent Template Format (from OpenFang)

Declarative `agent.toml` for reusable agent definitions:

```toml
[agent]
name = "sales-assistant"
version = "0.1.0"
description = "Handles prospect outreach and pipeline management"
module = "builtin:chat"

[model]
tier = "smart"                      # frontier | smart | fast | lightweight
max_tokens = 8192
temperature = 0.3

[fallback]
tier = "fast"

[schedule]
enabled = true
interval_secs = 120

[resources]
max_llm_tokens_per_hour = 500000

[capabilities]
tools = ["email_send", "crm_lookup_customer", "crm_create_customer", "memory_store", "memory_recall"]
memory_read = ["self.*", "shared.leads.*"]
memory_write = ["self.*"]
agent_messaging = ["ceo", "cmo"]    # can message these agents
skills = ["crm-integration", "email-templates"]
```

30 bundled templates cover common roles: analyst, architect, coder, customer-support, debugger, devops-lead, doc-writer, email-assistant, ops, orchestrator, researcher, sales-assistant, security-auditor, social-media, test-engineer, writer, and more.

### 13.2 Skill Injection (from Paperclip)

During each heartbeat, the adapter injects relevant skills into the agent's context:
1. Skills directory is resolved (workspace > user > bundled)
2. A manifest (names, descriptions, paths) is injected into the system prompt
3. The agent reads full SKILL.md on-demand when relevant
4. Environment variables auto-injected: `CLAWGEAR_AGENT_ID`, `CLAWGEAR_COMPANY_ID`, `CLAWGEAR_API_URL`, `CLAWGEAR_RUN_ID`

### 13.3 GearHub Marketplace

Unified marketplace combining OpenFang's FangHub and OpenClaw's ClawHub concepts:

- **Publishing**: Ed25519 signing + SHA-256 verification
- **Discovery**: Search, browse by category, featured/trending
- **Installation**: `clawgear skill install <name>` with integrity verification
- **Security**: Automated scanning for malicious patterns (addressing ClawHub's CVE-2026-25253 and the ClawHavoc incident)
- **Compatibility**: Import from FangHub and ClawHub registries

---

## 14. Observability & Governance

### 14.1 Dashboard (React + Vite)

| View | Description |
|---|---|
| **Org Chart** | Visual hierarchy with agent status indicators |
| **Goal Tree** | Company mission -> team -> agent -> task decomposition |
| **Issue Board** | Kanban/list view with filters, search, assignment |
| **Agent Detail** | Heartbeat history, cost breakdown, session transcripts |
| **Budget Monitor** | Per-agent and per-company spend vs. limits |
| **Audit Trail** | Searchable Merkle-verified action log |
| **Approval Queue** | Pending approvals for board review |
| **Channel Status** | Connected channels, message throughput, errors |
| **Hand Dashboard** | Autonomous operation metrics, outputs, schedules |
| **System Health** | API latency, memory usage, provider status |

### 14.2 Audit Trail (from OpenFang + Paperclip)

Every action is double-logged:
1. **Activity Log** (PostgreSQL): append-only table with actor, action, entity, details (sanitized). Real-time events via WebSocket.
2. **Merkle Hash-Chain** (Rust kernel): cryptographically linked entries. Tampering breaks the chain. Verifiable via `GET /api/audit/verify`.

### 14.3 Cost Tracking

```
Cost Event:
  - provider, model, inputTokens, outputTokens
  - costCents (computed from model pricing)
  - companyId, agentId, issueId, projectId, goalId
  - billingCode (optional attribution tag)
  - occurredAt timestamp
```

Atomic increment of agent and company `spentMonthlyCents` on every cost event. Auto-pause at 100%, warning at 80%. Board can override.

### 14.4 Governance Controls

| Control | Description |
|---|---|
| **Approval Gates** | Configurable gates for hiring, strategy, purchases, publishing |
| **Config Versioning** | Every agent config change creates a revision with before/after snapshots |
| **Rollback** | Restore any prior agent configuration revision |
| **Board Override** | Pause/resume/terminate any agent, reassign any task, edit any budget |
| **Company Portability** | Export/import company templates with secret scrubbing and collision handling |

---

## 15. Desktop & Device Integration

### 15.1 Tauri 2.0 Desktop App (from OpenFang)

- **Dual-thread model**: main thread (WebView + system tray) + background server thread (full kernel)
- **System tray**: show window, open in browser, status indicator, quit
- **Close-to-tray**: window close hides instead of quitting
- **Notifications**: kernel events forwarded as native OS notifications
- **Single instance**: prevents multiple concurrent instances

### 15.2 Device Nodes (from OpenClaw)

Mobile and desktop companion apps connect as Node clients to the Gateway:

| Capability | Methods |
|---|---|
| Camera | snap, record clip |
| Screen | record, screenshot |
| Location | get current position |
| Notifications | system.notify with priority levels |
| Canvas | A2UI rendering surface |
| Voice | push-to-talk, wake word |

**Node pairing**: device sends pair request -> operator approves -> JWT token issued -> token rotatable/revocable.

### 15.3 Browser Automation (from OpenClaw)

Three-layer architecture:
1. **Browser Layer**: isolated Chromium instance (separate from personal browser)
2. **Control Layer**: HTTP API using Playwright on top of CDP
3. **Agent Layer**: tool interface for AI model access

Extension Relay mode enables controlling existing browser tabs with logged-in sessions.

### 15.4 Canvas + A2UI (from OpenClaw)

Agent-driven visual workspace:
1. Agent generates HTML with A2UI attributes
2. Canvas server pushes to connected clients
3. User interactions on A2UI elements become tool calls back to the agent
4. Agent processes actions and updates the display

Runs as a separate process for crash isolation.

---

## 16. Tech Stack Decisions

| Layer | Technology | Rationale |
|---|---|---|
| **Core Kernel** | Rust | Performance (180ms cold start, 40MB idle), memory safety, single binary deployment |
| **HTTP Framework** | Axum 0.8 | Async Rust, tower middleware ecosystem, proven in OpenFang |
| **WASM Runtime** | Wasmtime | Mature, dual-metering support, OpenFang-proven |
| **Orchestration DB** | PostgreSQL 17+ | ACID for atomic checkout, relational integrity, multi-tenant |
| **Agent Memory DB** | SQLite + sqlite-vec | Zero-config, fast hybrid search, agent-local |
| **Desktop App** | Tauri 2.0 | Native performance, small binary, Rust backend |
| **Web Dashboard** | React + Vite | Ecosystem, component libraries, fast dev cycle |
| **API Types** | TypeScript (shared) | Type safety between API server and dashboard |
| **CLI** | Rust (clap) | Same binary as kernel, fast startup |
| **Schema Validation** | Zod (TypeScript) + serde (Rust) | Runtime validation for configs and API payloads |
| **Messaging** | Platform-specific SDKs | grammY, @slack/bolt, discord.js, baileys |
| **Testing** | Rust: cargo test / TS: Vitest | Native test runners for each language |
| **Build** | Cargo workspaces + pnpm | Monorepo management for Rust + TypeScript |

### Language Boundary

- **Rust**: kernel, runtime, security, memory, CLI, desktop shell
- **TypeScript**: web dashboard, channel adapters (wrapping platform SDKs), shared API types, skill processing
- **Bridge**: The Rust kernel exposes a REST/WebSocket API. TypeScript code communicates via HTTP/WS, never through FFI. Clean process boundary.

---

## 17. Monorepo Structure

```
clawgear/
  crates/
    clawgear-kernel/        # Core orchestrator, scheduler, budget, RBAC
    clawgear-runtime/       # Agent execution, WASM sandbox, adapters, tools
    clawgear-api/           # Axum HTTP/WS/SSE server, OpenAI-compat, MCP, A2A
    clawgear-memory/        # SQLite + sqlite-vec, embeddings, compaction, KV
    clawgear-security/      # Merkle audit, taint tracking, Ed25519 signing
    clawgear-channels/      # Channel adapter bridge (Rust side)
    clawgear-wire/          # P2P protocol, HMAC-SHA256 mutual auth
    clawgear-hands/         # Autonomous Hands, HAND.toml parser, lifecycle
    clawgear-cli/           # CLI with TUI dashboard
    clawgear-desktop/       # Tauri 2.0 app shell
    clawgear-migrate/       # Migration from OpenFang/OpenClaw/Paperclip
  packages/
    @clawgear/db/           # Drizzle ORM schema + migrations (PostgreSQL)
    @clawgear/shared/       # API types, validators, constants (TypeScript)
    @clawgear/adapters/     # Agent adapters (Claude Code, Codex, etc.)
      claude-code/
      codex/
      openclaw-gateway/
      openfang-a2a/
      process/
      http/
    @clawgear/channels/     # Channel adapters (TypeScript side)
      slack/
      discord/
      telegram/
      whatsapp/
      webchat/
  apps/
    dashboard/              # React + Vite web UI
    macos/                  # Tauri macOS specifics
    ios/                    # Mobile companion (Swift)
    android/                # Mobile companion (Kotlin)
  skills/
    clawgear/               # Core heartbeat skill
    create-agent/           # Agent hiring skill
    memory-management/      # Memory/knowledge skill
  hands/
    researcher/             # HAND.toml + SKILL.md + system prompt
    lead/
    collector/
    clip/
    twitter/
    browser/
    predictor/
  docs/                     # Documentation (Mintlify)
  docker/                   # Dockerfiles (main, sandbox, browser)
  TDD.md                    # This document
```

---

## 18. Database Schema Design

### PostgreSQL (Orchestration)

Key tables (Drizzle ORM, UUIDs, company-scoped):

```
companies
  id, name, description, status, issuePrefix, issueCounter,
  budgetMonthlyCents, spentMonthlyCents,
  requireBoardApprovalForNewAgents, createdAt, updatedAt

agents
  id, companyId, name, title, role, icon, status,
  reportsTo -> agents.id (self-ref),
  capabilities (JSONB), permissions (JSONB),
  adapterType, adapterConfig (JSONB),
  modelTier, modelOverride,
  budgetMonthlyCents, spentMonthlyCents,
  manifestSignature (Ed25519),
  createdAt, updatedAt

goals
  id, companyId, parentId -> goals.id (self-ref),
  level (company|team|agent|task), status,
  ownerAgentId, title, description,
  createdAt, updatedAt

projects
  id, companyId, goalId, leadAgentId,
  name, description, status, targetDate, color,
  createdAt, updatedAt

issues
  id, companyId, projectId, goalId, parentId -> issues.id,
  issueNumber, identifier (computed: prefix + number),
  title, description, status, priority,
  assigneeAgentId, checkoutRunId, executionLockedAt,
  billingCode, requestDepth,
  startedAt, completedAt, cancelledAt,
  createdAt, updatedAt

issue_comments
  id, companyId, issueId, authorAgentId, authorUserId,
  body, createdAt

heartbeat_runs
  id, companyId, agentId, invocationSource,
  status (queued|running|succeeded|failed|cancelled|timed_out),
  sessionIdBefore, sessionIdAfter, contextSnapshot (JSONB),
  logSha256, usageJson, resultJson,
  startedAt, finishedAt

cost_events
  id, companyId, agentId, issueId, projectId, goalId,
  provider, model, inputTokens, outputTokens, costCents,
  billingCode, occurredAt

approvals
  id, companyId, type, status (pending|approved|rejected|cancelled),
  requestedByAgentId, payload (JSONB),
  decidedByUserId, decisionNote, decidedAt,
  createdAt

agent_config_revisions
  id, companyId, agentId, beforeConfig (JSONB), afterConfig (JSONB),
  changedKeys (text[]), source (patch|rollback),
  rolledBackFromRevisionId, createdAt

activity_log (append-only)
  id, companyId, actorType, actorId, action,
  entityType, entityId, agentId, runId,
  details (JSONB, sanitized), createdAt

company_secrets
  id, companyId, name, currentVersionId, createdAt

company_secret_versions
  id, secretId, version (monotonic), encryptedValue,
  sha256, revokedAt, createdAt

agent_wakeup_requests
  id, companyId, agentId, source, triggerDetail,
  coalescedCount, idempotencyKey,
  requestedAt, claimedAt, finishedAt

agent_runtime_state
  agentId (PK), sessionId, stateJson (JSONB),
  lastRunId, lastRunStatus,
  cumulativeTokens, cumulativeCostCents, updatedAt

workflows
  id, companyId, name, description,
  steps (JSONB -- array of WorkflowStep),
  createdByAgentId, goalId,
  createdAt, updatedAt

workflow_runs
  id, companyId, workflowId,
  state (pending|running|completed|failed),
  input, output,
  stepResults (JSONB -- array of StepResult),
  triggeredByAgentId, costCents,
  startedAt, finishedAt

triggers
  id, companyId, agentId,
  pattern (JSONB -- TriggerPattern enum),
  promptTemplate, enabled,
  fireCount, maxFires,
  createdAt

skills
  id, companyId, name, version, description,
  runtimeType (python|wasm|node|prompt_only|builtin),
  entryPath, manifestHash (SHA-256),
  signatureEd25519, installedFrom (local|gearhub|fanghub|clawhub),
  createdAt
```

### SQLite (Per-Agent Memory)

```
files
  path, sourceType, contentHash, indexedAt

chunks
  id, fileId, text, lineStart, lineEnd, contentHash,
  embeddingModel, embedding (BLOB)

chunks_vec (virtual, sqlite-vec)
  rowid, embedding (float vector)

chunks_fts (virtual, FTS5)
  text

kv_store
  key, value, updatedAt

sessions
  key, transcript (JSONL path), lastActiveAt, pruneAfter
```

---

## 19. API Design

### REST Endpoints (grouped)

**System**
- `GET /api/health` -- public health check (minimal)
- `GET /api/health/detail` -- authenticated detailed diagnostics
- `GET /api/status` -- system status, agent count, uptime
- `POST /api/shutdown` -- graceful shutdown

**Companies**
- `GET/POST /api/companies` -- list/create
- `GET/PATCH/DELETE /api/companies/:id` -- read/update/delete
- `GET /api/companies/:id/costs/summary` -- budget utilization
- `GET /api/companies/:id/costs/by-agent` -- per-agent costs
- `POST /api/companies/:id/export` -- export company template
- `POST /api/companies/import` -- import company template

**Agents**
- `GET/POST /api/companies/:cid/agents` -- list/create
- `GET/PATCH /api/companies/:cid/agents/:id` -- read/update
- `POST /api/companies/:cid/agents/:id/terminate` -- irreversible termination
- `POST /api/companies/:cid/agents/:id/pause` -- pause agent
- `POST /api/companies/:cid/agents/:id/resume` -- resume agent
- `GET /api/companies/:cid/agents/:id/config-revisions` -- config history
- `POST /api/companies/:cid/agents/:id/config-revisions/:rid/rollback` -- rollback

**Issues**
- `GET/POST /api/companies/:cid/issues` -- list/create
- `GET/PATCH /api/companies/:cid/issues/:id` -- read/update
- `POST /api/companies/:cid/issues/:id/checkout` -- atomic checkout
- `POST /api/companies/:cid/issues/:id/release` -- release assignment
- `GET/POST /api/companies/:cid/issues/:id/comments` -- thread

**Goals**
- `GET/POST /api/companies/:cid/goals` -- list/create
- `GET/PATCH /api/companies/:cid/goals/:id` -- read/update

**Approvals**
- `GET /api/companies/:cid/approvals` -- list pending
- `POST /api/companies/:cid/approvals/:id/approve` -- approve
- `POST /api/companies/:cid/approvals/:id/reject` -- reject

**Heartbeats**
- `POST /api/companies/:cid/agents/:id/heartbeat` -- trigger heartbeat
- `GET /api/companies/:cid/agents/:id/runs` -- run history
- `GET /api/companies/:cid/agents/:id/runs/:rid` -- run detail
- `POST /api/companies/:cid/agents/:id/runs/:rid/cancel` -- cancel run

**Workflows**
- `GET/POST /api/companies/:cid/workflows` -- list/create workflow definitions
- `POST /api/companies/:cid/workflows/:id/run` -- execute workflow (sync, blocks until complete)
- `GET /api/companies/:cid/workflows/:id/runs` -- list execution history
- `GET /api/companies/:cid/workflows/:id/runs/:rid` -- run detail with step results

**Triggers**
- `GET/POST /api/companies/:cid/triggers` -- list/create triggers
- `PUT /api/companies/:cid/triggers/:id` -- enable/disable trigger
- `DELETE /api/companies/:cid/triggers/:id` -- remove trigger

**Hands**
- `POST /api/hands/:name/activate` -- start autonomous execution
- `POST /api/hands/:name/deactivate` -- stop
- `GET /api/hands/:name/status` -- current status and metrics
- `GET /api/hands` -- list all hands

**Skills & Marketplace**
- `GET /api/skills` -- list installed skills
- `POST /api/skills/install` -- install from GearHub
- `GET /api/gearhub/search` -- search marketplace
- `GET /api/gearhub/browse` -- browse categories

**Audit**
- `GET /api/audit/recent` -- recent audit entries
- `GET /api/audit/verify` -- Merkle chain verification

**MCP**
- `POST /mcp` -- JSON-RPC 2.0 MCP endpoint

**A2A**
- `GET /.well-known/agent.json` -- Agent Card
- `POST /a2a/tasks/send` -- delegate task
- `GET /a2a/tasks/:id` -- poll task
- `POST /a2a/tasks/:id/cancel` -- cancel task

**OpenAI-Compatible**
- `POST /v1/chat/completions` -- chat completions
- `GET /v1/models` -- model list

### WebSocket

`GET /api/agents/:id/ws` -- bidirectional agent communication

Events: `connected`, `thinking`, `text_delta`, `tool_start`, `tool_result`, `response`, `agents_updated`, `error`, `pong`

Commands: `/new`, `/compact`, `/model`, `/stop`, `/usage`, `/think`, `/models`

### SSE

`POST /api/agents/:id/message/stream` -- streaming responses

Events: `chunk`, `tool_use`, `tool_result`, `done` (with usage stats)

### CLI Commands

```bash
# Core
clawgear init                                    # Interactive setup
clawgear start                                   # Launch kernel + dashboard
clawgear status                                  # System status

# Company management
clawgear company create <name>                   # Create company
clawgear company list                            # List companies

# Agent management
clawgear agent spawn <template> --company <id>   # Create from template
clawgear agent list --company <id>               # List agents
clawgear agent chat <name>                       # Interactive chat session
clawgear agent pause <name>                      # Pause agent
clawgear agent resume <name>                     # Resume agent

# Work management
clawgear issue create <title> --company <id>     # Create issue
clawgear issue list --company <id>               # List issues
clawgear issue assign <id> --agent <name>        # Assign to agent

# Workflows
clawgear workflow list --company <id>            # List workflows
clawgear workflow create <file> --company <id>   # Create from TOML file
clawgear workflow run <id> <input>               # Execute workflow

# Triggers
clawgear trigger list --company <id>             # List triggers
clawgear trigger create <agent> <pattern_json>   # Create trigger
clawgear trigger delete <id>                     # Remove trigger

# Hands
clawgear hand activate <name>                    # Start autonomous execution
clawgear hand deactivate <name>                  # Stop
clawgear hand status <name>                      # Check progress
clawgear hand list                               # Show all Hands

# Skills
clawgear skill install <name>                    # Install from GearHub
clawgear skill create                            # Scaffold new skill
clawgear skill list                              # List installed
clawgear skill publish                           # Publish to GearHub
clawgear skill search <query>                    # Search GearHub

# Migration
clawgear migrate --from openfang                 # Migrate from OpenFang
clawgear migrate --from openclaw                 # Migrate from OpenClaw
clawgear migrate --from paperclip                # Migrate from Paperclip
clawgear migrate --dry-run                       # Preview changes
```

---

## 20. Migration & Compatibility

ClawGear provides one-command migration from all three source projects:

```bash
clawgear migrate --from openfang    # Migrate agents, memory, skills
clawgear migrate --from openclaw    # Migrate config, sessions, skills
clawgear migrate --from paperclip   # Migrate companies, agents, issues
```

| Source | What Migrates |
|---|---|
| OpenFang | Agent configs, memory DBs, skills, Hands, FangHub installs |
| OpenClaw | Config.yml, sessions, memory files, ClawHub skills, channel configs |
| Paperclip | Companies, org charts, issues, goals, budgets, adapters, skills |

### Marketplace Compatibility

GearHub can install skills from:
- GearHub native registry
- FangHub (OpenFang compatibility layer)
- ClawHub (OpenClaw compatibility layer)

---

## 21. Development Phases

### Phase 0: Foundation
- Rust workspace setup with core crates
- PostgreSQL schema (Drizzle) for orchestration entities
- SQLite memory store with sqlite-vec
- Basic Axum API server with auth
- CLI skeleton (`clawgear init`, `clawgear start`)

### Phase 1: Orchestration Core
- Company/agent/goal/project CRUD
- Org chart with reporting hierarchy
- Issue system with atomic checkout
- Heartbeat execution engine
- Budget enforcement with auto-pause
- Activity log (append-only)
- Basic web dashboard (React + Vite)

### Phase 2: Agent Runtime
- WASM sandbox with dual metering
- Adapter system (Claude Code, process, HTTP)
- Model routing with 4-tier selection
- Provider failover with auth profile rotation
- Session persistence across heartbeats
- Skill injection system
- Agent-to-agent internal messaging

### Phase 3: Security Hardening
- Merkle hash-chain audit trail
- Ed25519 manifest signing
- Taint tracking
- SSRF protection + secret zeroization
- Prompt injection scanner
- Loop guard + session repair
- RBAC capability gates
- GCRA rate limiting

### Phase 4: Communication
- WebSocket Gateway (typed JSON-RPC)
- Channel adapters: Slack, Discord, Telegram, WebChat
- Multi-company channel routing
- DM/group policies with pairing
- SSE streaming for web clients

### Phase 5: Autonomous Operations
- Hands framework (HAND.toml, lifecycle management)
- Researcher, Lead, Collector Hands
- Browser Hand with approval gates
- Twitter Hand with approval queue
- Hand dashboard with metrics

### Phase 6: Desktop & Devices
- Tauri 2.0 desktop app
- Device node pairing protocol
- Camera, screen, location integration
- Canvas + A2UI visual workspace
- Browser automation (CDP/Playwright)

### Phase 7: Ecosystem
- GearHub marketplace
- Skill publishing with Ed25519 signing
- FangHub/ClawHub import compatibility
- Migration engine (OpenFang, OpenClaw, Paperclip)
- Company template export/import

### Phase 8: Scale & Polish
- Additional channel adapters (WhatsApp, Teams, Matrix, etc.)
- Mobile companion apps (iOS, Android)
- Performance optimization pass
- Documentation (Mintlify)
- Community infrastructure

---

## 22. Open Questions

These need to be resolved before or during implementation:

| # | Question | Options | Impact |
|---|---|---|---|
| 1 | **Should the TypeScript layer be a separate process or embedded via wasm-bindgen?** | A) Separate process (REST/WS bridge) B) Embedded via wasm-bindgen C) Neon (Rust<->Node.js) | Architecture, deployment complexity |
| 2 | **Which embedded DB for development mode?** | A) PGlite (Paperclip approach) B) SQLite with a Postgres-compat layer C) Always require Postgres | Developer experience vs. production parity |
| 3 | **Should Hands be compiled into the binary or loaded dynamically?** | A) Compiled (OpenFang approach) B) Dynamic plugins C) Hybrid (core compiled, custom dynamic) | Extensibility vs. security vs. binary size |
| 4 | **How should the CEO agent's strategic planning work?** | A) Predefined strategy templates B) LLM-driven goal decomposition C) Human-defined goals, AI-optimized execution | Autonomy level |
| 5 | **What is the licensing model?** | A) MIT B) Apache-2.0 C) Dual MIT/Apache (OpenFang approach) D) AGPL-3.0 | Community adoption vs. protection |
| 6 | **Should we support OpenClaw's Pi Agent as a first-class runtime or only via the adapter?** | A) First-class (embed Pi Agent) B) Adapter only (webhook) | Complexity vs. ecosystem compatibility |
| 7 | **How do we handle the ClawHub security problem (12-20% malicious skills)?** | A) Manual review + automated scanning B) Reputation system + sandboxed execution C) Curated registry only | Ecosystem openness vs. safety |
| 8 | **Multi-tenancy model for SaaS deployment?** | A) Database-per-company B) Schema-per-company C) Row-level isolation (current design) D) Not a goal (self-hosted only) | Scale, isolation, operational complexity |

---

## Appendix A: Competitive Comparison

| Feature | ClawGear | OpenFang | Paperclip | OpenClaw |
|---|---|---|---|---|
| Language | Rust + TypeScript | Rust | TypeScript | TypeScript |
| Org Chart | Yes | No | Yes | No |
| Goal Alignment | Yes | No | Yes | No |
| Budget Enforcement | Yes | No | Yes | No |
| Approval Gates | Yes | Partial (Hands) | Yes | No |
| WASM Sandbox | Yes | Yes | No | No |
| Merkle Audit | Yes | Yes | No | No |
| Multi-Channel | Yes (20+) | Yes (40) | No | Yes (20+) |
| Device Nodes | Yes | No | No | Yes |
| Browser Automation | Yes | Yes | No | Yes |
| Canvas/A2UI | Yes | No | No | Yes |
| Autonomous Hands | Yes | Yes | No | No |
| Atomic Checkout | Yes | No | Yes | No |
| Heartbeat Model | Yes | No | Yes | No |
| Model Routing | 4-tier | 4-tier | Via adapter | Failover chains |
| Agent Adapters | 8+ | N/A (native) | 8 | N/A (Pi native) |
| Skills Marketplace | GearHub | FangHub | Directory | ClawHub (13K+) |
| MCP Support | Client + Server | Client + Server | No | Client |
| A2A Protocol | Yes | Yes | No | No |
| Desktop App | Tauri 2.0 | Tauri 2.0 | No | Native (Swift) |
| Mobile App | iOS + Android | No | No | iOS + Android |
| Security Layers | 16 | 16 | ~5 | ~8 |
| Cold Start | <200ms target | 180ms | ~2s | ~1s |
| Idle Memory | <50MB target | 40MB | ~150MB | ~100MB |

---

## Appendix B: Key Design Principles

1. **Business-first**: Every technical decision serves the goal of running a business autonomously.
2. **Defense-in-depth**: Security is not a feature, it's 16 layers that are always on.
3. **Human-in-the-loop**: Autonomy within guardrails. Humans approve strategy, hiring, and spending.
4. **Goal alignment**: Work without purpose is waste. Every task traces to the mission.
5. **Budget discipline**: Agents that overspend get paused. No exceptions.
6. **Adapter agnostic**: The best agent for the job might be Claude, GPT, or a shell script. ClawGear doesn't care.
7. **Channel native**: A business communicates everywhere. One inbox to rule them all.
8. **Audit everything**: If it happened, it's in the Merkle chain. Cryptographically.
9. **Single binary core**: The kernel is one binary. No dependency hell.
10. **Composable autonomy**: Hands operate independently but within the governance framework.
