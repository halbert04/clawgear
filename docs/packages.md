# Package Reference

Detailed reference for each package in the ClawGear monorepo.

## Core Infrastructure

### @clawgear/shared

Shared types, validators, events, and constants used across all packages.

- **Types**: Agent, Company, Goal, Project, Issue, Fact, Conversation, Message, etc.
- **Validators**: Zod schemas for all domain objects
- **Events**: Typed event definitions for the internal event bus
- **Constants**: Enums for status fields, tier levels, capability types

Zero external dependencies (except Zod). Every other package depends on this.

### @clawgear/db

Database layer using Drizzle ORM with PostgreSQL and pgvector.

- Schema definitions for all tables (companies, agents, goals, projects, issues, activity_log, facts, memory_entries, conversations, messages, marketplace_skills, audit_chain, triggers, workflows, etc.)
- Migration generation and execution
- Seed data for development
- Supports both PostgreSQL and SQLite variants

**Key commands:**
```bash
pnpm db:generate   # Generate migrations from schema changes
pnpm db:migrate    # Apply pending migrations
pnpm db:seed       # Insert sample data
```

### @clawgear/kernel

Orchestration engine responsible for scheduling and dispatching agent heartbeats.

- Cron-based scheduling via `cron-parser`
- Event dispatch to the runtime
- Agent lifecycle management
- Capability-based task routing

### @clawgear/runtime

Execution runtime that bridges the kernel to adapters.

- HAND.toml configuration parsing (via `smol-toml`)
- System prompt assembly
- Adapter selection and dispatch
- Execution context management

### @clawgear/api

REST API built on Hono, exposing all ClawGear functionality over HTTP.

- Company-scoped routes (`/api/companies/:companyId/...`)
- Middleware: authentication, rate limiting, company scope, security headers, logging, error handling
- Route modules: agents, goals, projects, issues, activity, facts, memory, conversations, audit, marketplace, triggers, workflows, approvals

### @clawgear/cli

Command-line interface built with Commander.js.

- `clawgear skill publish` -- publish a hand to the marketplace
- `clawgear skill install <name>` -- install a skill from the marketplace
- `clawgear skill search <query>` -- search available skills
- `clawgear migrate` -- run database migrations

Binary entry point: `clawgear`

---

## Security

### @clawgear/security

Core security primitives.

- **SSRF Guard**: Blocks HTTP requests to private IP ranges (10.x, 172.16-31.x, 192.168.x, localhost, link-local)
- **Capability Enforcement**: Validates agent actions against declared capabilities
- **Secret Management**: Encrypted credential storage with scoped access controls

### @clawgear/signing

Ed25519 cryptographic signing for agent identity and capability management.

- `generateKeyPair()` -- DER-encoded Ed25519 key pair generation
- `signData()` / `verifySignature()` -- sign and verify arbitrary data
- `createSignedIdentity()` / `verifyIdentity()` -- agent identity manifests
- `createSignedDeclaration()` / `verifyDeclaration()` -- capability declarations with expiration
- `canonicalize()` -- deterministic JSON serialization for signature stability

### @clawgear/audit

Tamper-evident audit logging using Merkle hash-chains.

- `AuditChain` -- append-only chain with SHA-256 hashing
- `computeEntryHash()` -- canonical hash of audit entry content
- `computeChainHash()` -- links each entry to its predecessor (genesis-aware)
- `computeMerkleRoot()` -- binary tree root over all entries
- `generateProof()` / `verifyMerkleProof()` -- inclusion proofs
- `verifyChain()` -- full chain integrity verification (sequence, hashes, links)

### @clawgear/wasm-sandbox

WebAssembly sandboxed execution environment.

- Compile and instantiate WASM modules with resource limits
- Memory and CPU quota enforcement
- Import restrictions (controlled host function exposure)
- Designed for running untrusted skill code safely

### @clawgear/taint-tracking

Information flow control with sensitivity labels.

- **Sensitivity levels**: public < internal < confidential < secret
- `TaintTracker` -- tracks taint labels on data values by ID
- `TaintPolicy` -- defines sink policies (what sensitivity levels and categories can flow where)
- Label propagation: when data combines, the highest sensitivity wins
- Fail-closed: unknown sinks block data flow by default

### @clawgear/p2p-auth

Mutual authentication for multi-instance ClawGear deployments.

- HMAC-SHA256 challenge-response handshake (3-step)
- Timestamp window validation to prevent replay attacks
- Constant-time HMAC comparison
- Delegation tokens with permission sets and expiration
- Wildcard permission matching

### @clawgear/multi-tenancy

Tenant isolation, rate limiting, and database routing.

- **TenantRateLimiter** -- token bucket algorithm with burst allowance and concurrent request tracking; five tiers from free (60 req/min) to whale (50,000 req/min)
- **IsolationTester** -- automated cross-tenant data leak detection across 12 API endpoints; full audit reporting
- **TenantDbRouter** -- routes queries to shared or dedicated PostgreSQL instances; supports migration between shared and dedicated

---

## Agent Systems

### @clawgear/memory

Agent memory management with vector embedding support.

- Memory entry storage and retrieval
- Vector similarity search (via pgvector)
- Memory consolidation and pruning

### @clawgear/learning

Agent learning and improvement.

- Lesson extraction from agent interactions
- Performance trend tracking
- Feedback loop integration

### @clawgear/quality

Quality gate evaluation for agent outputs.

- Rubric-based output scoring
- Pass/fail determination
- Quality trend metrics

### @clawgear/marketplace

Skill marketplace for publishing, discovering, and installing agent skills.

- Skill manifest format (name, version, author, description, signature, checksum)
- Ed25519 signing on publish, verification on install
- Security scanning for malicious patterns (eval, exec, private IP fetch, env access)
- Search and discovery
- Download tracking

### @clawgear/migration

Data migration tools for schema and data evolution.

### @clawgear/browser

Browser automation powered by Playwright.

- Page navigation and interaction
- Screenshot capture
- Form automation
- Data extraction

---

## Adapters

Adapters connect the runtime to execution environments.

| Adapter | Package | Use Case |
|---------|---------|----------|
| Hand | `@clawgear/adapter-hand` | Direct in-process agent execution |
| HTTP | `@clawgear/adapter-http` | Webhook-based remote execution |
| Claude Code | `@clawgear/adapter-claude-code` | AI-powered execution via Claude |
| Process | `@clawgear/adapter-process` | Spawn system processes |

---

## Channels

Messaging channel implementations for agent-user communication.

| Channel | Package | Protocol |
|---------|---------|----------|
| Slack | `@clawgear/channel-slack` | Slack API (Bot) |
| Discord | `@clawgear/channel-discord` | Discord API (Bot) |
| Telegram | `@clawgear/channel-telegram` | Telegram Bot API |
| Teams | `@clawgear/channel-teams` | Microsoft Graph API |
| Email | `@clawgear/channel-email` | SMTP/IMAP |
| WhatsApp | `@clawgear/channel-whatsapp` | WhatsApp Business API |
| Webchat | `@clawgear/channel-webchat` | WebSocket |

All channels depend only on `@clawgear/shared` for maximum portability.

---

## Applications

### @clawgear/dashboard

React 19 web dashboard built with Vite 6.

- Agent management and monitoring
- Goal/project/issue tracking
- Activity feeds and audit logs
- Conversation views

### @clawgear/desktop

Native desktop application built with Tauri.

- Wraps the dashboard for native OS integration
- System notifications via Tauri plugins
- Cross-platform (macOS, Windows, Linux)
