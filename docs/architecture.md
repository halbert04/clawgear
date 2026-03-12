# Architecture

## Overview

ClawGear follows a modular monorepo architecture where each concern is isolated into its own package. All packages are TypeScript ESM modules that communicate through well-defined interfaces exported from `@clawgear/shared`.

## Package Dependency Graph

```
@clawgear/shared          (zero deps -- types, validators, events)
    |
    +-- @clawgear/db      (Drizzle ORM schema + queries)
    |       |
    |       +-- @clawgear/kernel    (scheduling, event dispatch)
    |       |       |
    |       |       +-- @clawgear/runtime   (execution, TOML config)
    |       |               |
    |       |               +-- adapters/*  (hand, http, claude-code, process)
    |       |
    |       +-- @clawgear/api       (Hono REST routes)
    |       |       |
    |       |       +-- @clawgear/kernel
    |       |       +-- @clawgear/runtime
    |       |       +-- @clawgear/security
    |       |
    |       +-- @clawgear/memory    (agent memory management)
    |       +-- @clawgear/learning  (agent training)
    |       +-- @clawgear/quality   (quality gate evaluation)
    |       +-- @clawgear/marketplace (skill registry)
    |       +-- @clawgear/migration (data migration)
    |
    +-- @clawgear/security          (SSRF, capabilities, secrets)
    |       |
    |       +-- @clawgear/wasm-sandbox (WASM execution)
    |
    +-- @clawgear/signing           (Ed25519 identity)
    +-- @clawgear/audit             (Merkle hash-chain)
    +-- @clawgear/taint-tracking    (information flow)
    +-- @clawgear/p2p-auth          (mutual authentication)
    +-- @clawgear/multi-tenancy     (isolation, rate limiting)
    +-- @clawgear/cli               (Commander.js CLI)
    +-- channels/*                  (Slack, Discord, etc.)
```

## Core Concepts

### Heartbeat

A heartbeat is the atomic unit of agent execution. The kernel schedules heartbeats based on each agent's cron expression. During a heartbeat:

1. The kernel fires a heartbeat event
2. The runtime loads the agent's HAND.toml configuration
3. The system prompt is assembled (persona + context + skill injections)
4. An adapter dispatches the execution (e.g., Claude Code, HTTP webhook)
5. The agent produces structured output
6. Output passes through quality gates
7. Results persist to the database and fire completion events

### Flat Orchestration

ClawGear uses a flat orchestrator model rather than hierarchical agent trees. A single kernel dispatches work to agents based on capability matching. This avoids the coordination overhead and failure cascading of deep agent hierarchies.

### Hands

A "hand" is a reusable agent definition. Each hand directory contains:

- `HAND.toml` -- configuration (name, schedule, adapter type, settings, metrics)
- `system-prompt.md` -- the agent's persona and instructions
- Optional `src/` -- custom logic or tool implementations

Hands are resolved in priority order: workspace > company > bundled.

### Channels

Channels are messaging integrations that allow agents to communicate with users and external systems. Each channel implements a common interface for sending/receiving messages. Channels are intentionally thin -- they adapt external protocols to ClawGear's internal event model.

### Adapters

Adapters bridge the runtime to different execution environments:

- **hand** -- direct in-process agent execution
- **http** -- webhook-based execution for remote agents
- **claude-code** -- integration with Claude Code for AI-powered execution
- **process** -- system process spawning for arbitrary executables

## Database

PostgreSQL 17 with pgvector for embedding storage. The schema uses Drizzle ORM with the following key tables:

- `companies` -- tenant/organization records
- `agents` -- agent definitions with configuration and identity keys
- `goals`, `projects`, `issues` -- work hierarchy
- `activity_log` -- structured event log
- `facts` -- knowledge graph (subject-predicate-object triples)
- `memory_entries` -- agent memory with vector embeddings
- `conversations`, `messages` -- agent interaction history
- `marketplace_skills` -- published skill registry
- `audit_chain` -- Merkle hash-chain audit entries
- `agent_capability_declarations` -- signed capability grants
- `triggers`, `workflows`, `workflow_steps` -- automation engine

All tenant-scoped tables include a `company_id` foreign key with cascading deletes.

## Security Model

Security is implemented as composable layers:

1. **API Auth** -- Bearer token authentication at the gateway
2. **Company Scope** -- PostgreSQL session variable `app.company_id` for row-level filtering
3. **Rate Limiting** -- per-tenant token bucket with tiered limits
4. **Capability Enforcement** -- agents operate within declared capability boundaries
5. **SSRF Guard** -- blocks private IP access from agent-initiated requests
6. **Secret Management** -- encrypted credential storage with scoped access
7. **Ed25519 Identity** -- cryptographic agent identity verification
8. **Audit Chain** -- tamper-evident logging with Merkle proof generation
9. **Taint Tracking** -- sensitivity labels propagate through data flows
10. **WASM Sandbox** -- untrusted code runs in WebAssembly isolation

## Multi-Tenancy

Three isolation strategies based on tenant tier:

- **Shared database** (free through enterprise) -- all tenants share one PostgreSQL instance with `company_id` scoping
- **Dedicated database** (whale tier) -- the DB router directs whale tenant queries to their own PostgreSQL instance
- **Migration support** -- tenants can be migrated between shared and dedicated databases without downtime

The isolation tester framework runs automated cross-tenant data leak detection across all API endpoints.

## Event System

The kernel dispatches typed events through an internal event bus. Events follow the schema defined in `@clawgear/shared`:

- Heartbeat lifecycle (scheduled, started, completed, failed)
- Agent state transitions
- Quality gate results
- Approval requests and decisions
- Trigger/workflow execution events
