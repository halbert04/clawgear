# Development Guide

## Setup

### Prerequisites

- **Node.js** >= 22.0.0
- **Bun** (latest) -- runtime and test runner
- **pnpm** 10.x -- package manager
- **Docker** -- for PostgreSQL with pgvector

### Installation

```bash
git clone https://github.com/halbert04/clawgear.git
cd clawgear
pnpm install
```

### Database

Start PostgreSQL with pgvector:

```bash
pnpm docker:up
```

This starts `pgvector/pgvector:pg17` on port 5432 with:
- User: `clawgear`
- Password: `clawgear`
- Database: `clawgear`
- Shared buffers: 256MB
- Max connections: 100

Run migrations and seed data:

```bash
pnpm db:migrate
pnpm db:seed
```

### Running

```bash
# Start the API dev server
pnpm dev

# Start the dashboard dev server
pnpm --filter @clawgear/dashboard dev
```

## Project Conventions

### TypeScript

- Strict mode enabled across all packages
- ESNext target with bundler module resolution
- All packages use `.ts` extensions with ESM (`"type": "module"`)
- Import paths use `.js` extensions (TypeScript ESM convention): `import { Foo } from './foo.js'`

### Package Structure

Each package follows this layout:

```
packages/example/
  package.json        # name: @clawgear/example
  tsconfig.json       # extends ../../tsconfig.base.json
  src/
    index.ts          # barrel exports
    types.ts          # type definitions
    *.ts              # implementation modules
    index.test.ts     # tests
```

Package naming: `@clawgear/<name>` with `workspace:*` for internal dependencies.

### Code Style

Enforced by [Biome](https://biomejs.dev/) 2.x:

- 2-space indentation
- Single quotes
- Semicolons required
- Trailing commas
- 100-character line width
- Organized imports (auto-sorted)
- No unused imports/variables (warning)

```bash
# Check
pnpm lint

# Auto-fix
pnpm lint:fix

# Format only
pnpm format
```

### Testing

Tests use Bun's built-in test runner with `describe`, `it`, and `expect`:

```typescript
import { describe, expect, it } from 'bun:test';

describe('MyModule', () => {
  it('should do something', () => {
    expect(myFunction()).toBe(expected);
  });
});
```

Run tests:

```bash
# All packages
pnpm test

# Single package
bun test packages/security/src/index.test.ts

# Watch mode
bun test --watch packages/kernel/
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(kernel): add heartbeat retry logic
fix(api): handle missing company_id in audit routes
docs(readme): add architecture diagram
test(security): add SSRF bypass regression tests
```

### Database Schema

Schema definitions live in `packages/db/src/pg/schema.ts` using Drizzle ORM:

```typescript
import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const myTable = pgTable(
  'my_table',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_my_table_company').on(t.companyId),
  ],
);
```

After modifying the schema:

```bash
pnpm db:generate   # creates migration SQL
pnpm db:migrate    # applies to running database
```

### API Routes

Routes are defined in `packages/api/src/routes/` using Hono:

```typescript
import { Hono } from 'hono';
import type { AppDeps } from '../types.js';

export function myRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get('/', async (c) => {
    return c.json({ data: [] });
  });

  return app;
}
```

Routes are mounted in `packages/api/src/app.ts`:

```typescript
app.route('/api/companies/:companyId/my-resource', myRoutes(deps));
```

### Adding a New Package

1. Create the directory structure:
   ```bash
   mkdir -p packages/my-package/src
   ```

2. Create `package.json`:
   ```json
   {
     "name": "@clawgear/my-package",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "exports": { ".": "./src/index.ts" },
     "scripts": {
       "test": "bun test",
       "typecheck": "tsc --noEmit"
     },
     "dependencies": {
       "@clawgear/shared": "workspace:*"
     },
     "devDependencies": {
       "@types/bun": "catalog:",
       "typescript": "^5.8.0"
     }
   }
   ```

3. Create `tsconfig.json`:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
     "include": ["src"]
   }
   ```

4. Create `src/index.ts` with barrel exports.

5. Run `pnpm install` from the repo root to link the workspace.

## CI/CD

GitHub Actions runs on every push to `main` and every pull request:

**Jobs:**

1. **lint-and-typecheck** -- Biome check + TypeScript strict type checking
2. **test** -- Full test suite with PostgreSQL pgvector service container

The pipeline uses:
- `pnpm/action-setup@v4` for pnpm
- `oven-sh/setup-bun@v2` for Bun runtime
- `actions/setup-node@v4` (Node 22) for compatibility
- `pgvector/pgvector:pg17` service for database tests

## Creating a Hand

1. Create a directory under `hands/`:
   ```bash
   mkdir hands/my-hand
   ```

2. Create `HAND.toml`:
   ```toml
   [hand]
   name = "my-hand"
   description = "What this hand does"
   schedule = "0 */2 * * *"    # every 2 hours
   requires_approval = false
   output_mode = "comment"      # or "fact"

   [adapter]
   type = "claude_code"         # or "http", "process", "hand"

   [settings]
   # hand-specific configuration

   [metrics]
   track = ["metric_a", "metric_b"]
   ```

3. Create `system-prompt.md` with the agent's persona and instructions.

4. Optionally add a `package.json` if the hand needs its own dependencies.
