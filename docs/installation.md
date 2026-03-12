# Installation Guide

## Prerequisites

ClawGear requires the following tools installed on your system:

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| [Node.js](https://nodejs.org/) | 22.0.0 | JavaScript runtime (required by some tooling) |
| [Bun](https://bun.sh/) | latest | Primary runtime, test runner, and bundler |
| [pnpm](https://pnpm.io/) | 10.x | Package manager with workspace support |
| [Docker](https://www.docker.com/) | 20.x | PostgreSQL database container |
| [Git](https://git-scm.com/) | 2.x | Source control |

### Installing Prerequisites

**macOS (Homebrew):**

```bash
# Node.js
brew install node@22

# Bun
curl -fsSL https://bun.sh/install | bash

# pnpm
corepack enable
corepack prepare pnpm@latest --activate

# Docker Desktop
brew install --cask docker
```

**Linux (Ubuntu/Debian):**

```bash
# Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Bun
curl -fsSL https://bun.sh/install | bash

# pnpm
corepack enable
corepack prepare pnpm@latest --activate

# Docker
sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

**Windows (WSL2 recommended):**

```powershell
# Install WSL2 if not already present
wsl --install

# Then follow the Linux instructions inside WSL2
```

### Verifying Prerequisites

```bash
node --version    # v22.x.x
bun --version     # 1.x.x
pnpm --version    # 10.x.x
docker --version  # Docker version 2x.x.x
```

## Clone and Install

```bash
git clone https://github.com/halbert04/clawgear.git
cd clawgear
```

Install all workspace dependencies:

```bash
pnpm install
```

This installs dependencies for all 30+ packages in the monorepo via pnpm workspaces. Internal packages reference each other with `workspace:*` protocol, so no manual linking is needed.

## Database Setup

### Start PostgreSQL

ClawGear uses PostgreSQL 17 with the [pgvector](https://github.com/pgvector/pgvector) extension for vector similarity search.

```bash
pnpm docker:up
```

This starts a `pgvector/pgvector:pg17` container with:

| Setting | Value |
|---------|-------|
| Host | localhost |
| Port | 5432 |
| User | clawgear |
| Password | clawgear |
| Database | clawgear |
| Shared Buffers | 256MB |
| Effective Cache | 512MB |
| Max Connections | 100 |

Data is persisted in a Docker volume (`pgdata`), so it survives container restarts.

### Wait for PostgreSQL to Be Ready

The container includes a health check. Wait for it to report healthy:

```bash
docker inspect --format='{{.State.Health.Status}}' clawgear-postgres
# Should print: healthy
```

Or simply wait a few seconds after `docker:up`.

### Run Migrations

Apply the database schema:

```bash
pnpm db:migrate
```

This uses Drizzle ORM to apply all migration files to the PostgreSQL database.

### Seed Sample Data

Optionally populate the database with sample companies, agents, and data:

```bash
pnpm db:seed
```

### Using an External PostgreSQL

If you prefer to use your own PostgreSQL instance instead of Docker, set the `DATABASE_URL` environment variable:

```bash
export DATABASE_URL="postgresql://user:password@host:5432/clawgear"
pnpm db:migrate
```

Your PostgreSQL instance must have the `pgvector` extension installed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Environment Variables

Create a `.env` file in the project root (or export these variables):

```bash
# Required
DATABASE_URL="postgresql://clawgear:clawgear@localhost:5432/clawgear"

# Optional
PORT=3000                    # API server port (default: 3000)
NODE_ENV=development         # Environment (development | production)
LOG_LEVEL=info               # Logging level (debug | info | warn | error)
```

The `.env` file is gitignored by default.

## Running the Application

### API Server

```bash
pnpm dev
```

The Hono REST API starts at `http://localhost:3000` (or the port specified in `PORT`).

### Dashboard

In a separate terminal:

```bash
pnpm --filter @clawgear/dashboard dev
```

The React dashboard starts at `http://localhost:5173` (Vite default).

### Desktop App

Requires [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Rust toolchain):

```bash
pnpm --filter @clawgear/desktop dev
```

### Running Everything

To start the API, dashboard, and watch for changes:

```bash
# Terminal 1: Database
pnpm docker:up

# Terminal 2: API server
pnpm dev

# Terminal 3: Dashboard
pnpm --filter @clawgear/dashboard dev
```

## Verify Installation

Run the full test suite to confirm everything is working:

```bash
pnpm test
```

All 606 tests across 44 files should pass. You can also run individual checks:

```bash
# TypeScript type checking
pnpm typecheck

# Linting
pnpm lint

# Single package tests
bun test packages/security/src/index.test.ts
```

## Building for Production

Build all packages:

```bash
pnpm build
```

This compiles TypeScript sources to the `dist/` directory of each package.

### Production Database

For production deployments:

1. Use a managed PostgreSQL service (AWS RDS, Google Cloud SQL, Neon, Supabase) with pgvector support
2. Set `DATABASE_URL` to the production connection string
3. Run migrations: `DATABASE_URL="..." pnpm db:migrate`
4. Do **not** run `db:seed` in production

### Production Considerations

- Set `NODE_ENV=production`
- Use connection pooling (PgBouncer or built-in pool) for PostgreSQL
- Configure proper secrets management (do not use default database credentials)
- Enable HTTPS via a reverse proxy (nginx, Caddy, or cloud load balancer)
- Set up log aggregation for structured JSON output
- Monitor the health endpoint for uptime checks

## Cleanup

Stop and remove Docker containers:

```bash
pnpm docker:down
```

Remove all build artifacts and installed dependencies:

```bash
pnpm clean
```

This removes all `dist/` and `node_modules/` directories across the monorepo.

## Troubleshooting

### `pnpm install` fails with workspace errors

Ensure you are using pnpm 10.x. Older versions may not support the catalog protocol:

```bash
corepack prepare pnpm@latest --activate
pnpm install
```

### Docker container won't start

Check if port 5432 is already in use:

```bash
lsof -i :5432
```

If another PostgreSQL instance is running, stop it or change the port mapping in `docker-compose.yml`.

### `db:migrate` fails with connection refused

The PostgreSQL container may not be ready yet. Wait for the health check:

```bash
docker inspect --format='{{.State.Health.Status}}' clawgear-postgres
```

If the container isn't running:

```bash
pnpm docker:up
# Wait a few seconds
pnpm db:migrate
```

### Tests fail with database errors

Ensure PostgreSQL is running and the `DATABASE_URL` is set:

```bash
export DATABASE_URL="postgresql://clawgear:clawgear@localhost:5432/clawgear"
pnpm db:migrate
pnpm test
```

### Bun not found

Ensure Bun is installed and on your PATH:

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc  # or ~/.zshrc
```

### TypeScript errors after pulling changes

After pulling new code, reinstall dependencies and re-check types:

```bash
pnpm install
pnpm typecheck
```

### Biome lint failures

Auto-fix most lint issues:

```bash
pnpm lint:fix
```

For import ordering issues specifically:

```bash
npx @biomejs/biome check --write --unsafe .
```
