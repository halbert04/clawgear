# ClawGear

CEO Agent Operating System -- orchestrate teams of AI agents to run a business.

ClawGear is a modular platform for deploying, scheduling, and managing autonomous AI agents that collaborate to execute business operations. Agents run on cron schedules ("heartbeats"), produce structured output, learn from feedback, and coordinate through a flat orchestration model with capability-based task routing.

## Architecture

```
                          +-----------+
                          |  Dashboard |  (React + Vite)
                          +-----+-----+
                                |
                          +-----+-----+
                          |    API    |  (Hono REST)
                          +-----+-----+
                                |
              +-----------------+-----------------+
              |                 |                 |
        +-----+-----+   +------+------+   +------+------+
        |   Kernel  |   |   Runtime   |   |   Security  |
        | scheduling|   | execution   |   | SSRF, caps, |
        | events    |   | TOML config |   | secrets     |
        +-----------+   +-------------+   +-------------+
              |                 |
    +---------+---------+      |
    |         |         |      |
+---+---+ +--+---+ +---+--+   |
|Adapter| |Adapter| |Adapter|  |
| hand  | | http  | |claude |  |
+---+---+ +------++ +--+---+  |
    |         |         |      |
    +----+----+---------+------+
         |
   +-----+------+
   |   Channels  |  (Slack, Discord, Teams, Telegram, WhatsApp, Email, Webchat)
   +-------------+
```

**Core loop:** The kernel schedules agent heartbeats via cron. Each heartbeat goes through the runtime, which loads the agent's HAND.toml config, injects the system prompt, and dispatches execution through an adapter. Results flow back through the API, get quality-gated, and persist to PostgreSQL.

## Monorepo Structure

```
clawgear/
  packages/         Core libraries
    api/            REST API (Hono framework)
    kernel/         Orchestration engine (cron scheduling, event dispatch)
    runtime/        Execution runtime (TOML config, adapter dispatch)
    shared/         Types, validators, events, constants (Zod schemas)
    db/             Database layer (Drizzle ORM, PostgreSQL + pgvector)
    cli/            Command-line interface (Commander.js)
    security/       SSRF guard, capability enforcement, secret management
    signing/        Ed25519 digital signatures, agent identity, capability declarations
    audit/          Merkle hash-chain audit log with tamper detection
    marketplace/    Skill publishing, search, install with integrity verification
    memory/         Agent memory management
    learning/       Agent learning and training
    quality/        Quality gate evaluation
    migration/      Data migration tools
    browser/        Browser automation (Playwright)
    wasm-sandbox/   WebAssembly sandboxed execution
    taint-tracking/ Information flow tracking with sensitivity labels
    p2p-auth/       HMAC-SHA256 mutual authentication for multi-instance deployments
    multi-tenancy/  Tenant isolation, per-tenant rate limiting, DB-per-tenant routing
  adapters/         Execution environment adapters
    hand/           Direct hand/agent integration
    http/           HTTP/webhook adapter
    claude-code/    Claude Code integration
    process/        System process adapter
  channels/         Messaging channel implementations
    slack/          Slack bot
    discord/        Discord bot
    telegram/       Telegram bot
    teams/          Microsoft Teams bot
    email/          Email integration
    whatsapp/       WhatsApp integration
    webchat/        Web-based chat widget
  hands/            Agent definitions (HAND.toml + system-prompt.md)
    browser/        Web automation hand
    collector/      OSINT monitoring hand
    researcher/     Deep research hand (CRAAP methodology)
  apps/             End-user applications
    dashboard/      React web dashboard (Vite)
    desktop/        Desktop client (Tauri)
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22.0.0
- [Bun](https://bun.sh/) (runtime and test runner)
- [pnpm](https://pnpm.io/) 10.x (package manager)
- [Docker](https://www.docker.com/) (for PostgreSQL with pgvector)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/halbert04/clawgear.git
cd clawgear

# Install dependencies
pnpm install

# Start PostgreSQL (pgvector/pgvector:pg17)
pnpm docker:up

# Run database migrations
pnpm db:migrate

# Seed sample data
pnpm db:seed

# Start the API dev server
pnpm dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the API dev server |
| `pnpm build` | Build all packages |
| `pnpm test` | Run tests across all packages |
| `pnpm typecheck` | TypeScript type-check all packages |
| `pnpm lint` | Lint with Biome |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm format` | Format with Biome |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:seed` | Seed sample data |
| `pnpm docker:up` | Start Docker services |
| `pnpm docker:down` | Stop Docker services |
| `pnpm clean` | Remove all dist/ and node_modules/ |

## Hands

Hands are agent definitions stored as directories containing a `HAND.toml` configuration and a `system-prompt.md` that defines the agent's persona and instructions.

```toml
# hands/researcher/HAND.toml
[hand]
name = "researcher"
description = "Deep research hand using CRAAP methodology"
schedule = "0 */6 * * *"
requires_approval = false
output_mode = "comment"

[adapter]
type = "claude_code"

[settings]
methodology = "CRAAP"
max_sources = 5

[metrics]
track = ["sources_evaluated", "facts_discovered", "research_quality_score"]
```

Three built-in hands ship with ClawGear:

| Hand | Schedule | Description |
|------|----------|-------------|
| **browser** | Weekdays 9am | Web automation with human approval gates |
| **collector** | Every 4 hours | OSINT monitoring and intelligence collection |
| **researcher** | Every 6 hours | Deep research with CRAAP source evaluation |

## Security

ClawGear implements defense in depth across multiple packages:

- **SSRF Guard** -- blocks requests to private IP ranges and internal networks
- **Capability Enforcement** -- agents can only use tools they are explicitly granted
- **Secret Management** -- encrypted storage with scoped access
- **Ed25519 Signing** -- cryptographic agent identity and capability declarations
- **Merkle Audit Chain** -- tamper-evident hash-chain audit log with proof generation
- **WASM Sandbox** -- isolate untrusted code execution in WebAssembly
- **Taint Tracking** -- information flow labels (public/internal/confidential/secret) with sink policies
- **Mutual Authentication** -- HMAC-SHA256 nonce-based handshake for multi-instance P2P trust
- **Tenant Isolation** -- per-tenant rate limiting, cross-tenant leak detection, database-per-tenant routing
- **Marketplace Integrity** -- Ed25519-signed skill packages with security scanning for malicious patterns

## Multi-Tenancy

ClawGear supports five tenant tiers with tiered rate limits:

| Tier | Max Requests/min | Max Concurrent | Burst |
|------|-----------------|----------------|-------|
| Free | 60 | 5 | 10 |
| Starter | 300 | 20 | 50 |
| Business | 1,000 | 50 | 100 |
| Enterprise | 5,000 | 200 | 500 |
| Whale | 50,000 | Unlimited | 5,000 |

Whale customers can be routed to dedicated PostgreSQL databases. The isolation tester framework verifies no cross-tenant data leakage across all API endpoints.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh/) |
| Language | TypeScript (strict mode, ESNext) |
| API | [Hono](https://hono.dev/) |
| Database | PostgreSQL 17 + [pgvector](https://github.com/pgvector/pgvector) |
| ORM | [Drizzle](https://orm.drizzle.team/) |
| Validation | [Zod](https://zod.dev/) |
| CLI | [Commander.js](https://github.com/tj/commander.js) |
| Desktop | [Tauri](https://tauri.app/) |
| Dashboard | [React](https://react.dev/) 19 + [Vite](https://vite.dev/) 6 |
| Browser Automation | [Playwright](https://playwright.dev/) |
| Linting/Formatting | [Biome](https://biomejs.dev/) 2.x |
| CI | GitHub Actions (lint, typecheck, test with pgvector service) |
| Package Manager | pnpm 10.x workspaces |

## Testing

606 tests across 44 test files, using Bun's built-in test runner:

```bash
# Run all tests
pnpm test

# Run tests for a specific package
bun test packages/security/src/index.test.ts

# Run with watch mode
bun test --watch packages/kernel/
```

## CLI

The `clawgear` CLI provides commands for managing agents, skills, and migrations:

```bash
# Skill management
clawgear skill publish       # Publish a skill to the marketplace
clawgear skill install <name> # Install a skill from the marketplace
clawgear skill search <query> # Search for skills

# Database
clawgear migrate             # Run database migrations
```

## API

The Hono REST API exposes endpoints scoped to companies (tenants):

```
GET    /api/companies/:companyId/agents
GET    /api/companies/:companyId/goals
GET    /api/companies/:companyId/projects
GET    /api/companies/:companyId/issues
GET    /api/companies/:companyId/activity
GET    /api/companies/:companyId/facts
GET    /api/companies/:companyId/memory
GET    /api/companies/:companyId/conversations
GET    /api/companies/:companyId/audit
GET    /api/companies/:companyId/audit/verify
GET    /api/companies/:companyId/audit/head
GET    /api/companies/:companyId/marketplace
GET    /api/companies/:companyId/triggers
GET    /api/companies/:companyId/workflows
POST   /api/companies/:companyId/marketplace/publish
GET    /api/marketplace/search
GET    /api/marketplace/skills/:name
```

## Contributing

```bash
# Create a feature branch
git checkout -b feat/your-feature

# Make changes, then run quality checks
pnpm typecheck
pnpm lint
pnpm test

# Commit with conventional format
git commit -m "feat(scope): description"
```

The CI pipeline runs lint, typecheck, and tests on every pull request against `main`.

## License

MIT
