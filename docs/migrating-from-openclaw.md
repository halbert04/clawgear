# Migrating from OpenClaw

This guide walks through migrating an existing OpenClaw installation to ClawGear. ClawGear's migration tooling handles the data format differences automatically -- your skills, triggers, workflows, and sessions transfer over with full ID mapping.

If you're running OpenClaw on a Mac Mini, the [setup script](#one-command-setup) detects your installation and handles port conflicts automatically.

## What Migrates

| OpenClaw Entity | ClawGear Equivalent | Notes |
|----------------|--------------------|----|
| Config entries | Agent runtime state | Key-value config mapped to agent state JSON |
| Sessions | Runtime state | Session state preserved with agent ID mapping |
| Skills | Marketplace skills | Name, content, version carried over; status set to `active` |
| Triggers | Triggers | Pattern type, config, action type, action config preserved |
| Workflows | Workflows | Full workflow definition JSON transferred |

Entities that don't have a direct mapping (such as OpenClaw's internal scheduling state) are skipped with warnings in the migration report.

## Prerequisites

- ClawGear installed and database running (see [installation guide](installation.md))
- Access to your OpenClaw installation or a JSON export file
- Your ClawGear company ID (created during `db:seed` or via the API)

## Step 1: Export from OpenClaw

From your OpenClaw installation directory, export your data as JSON:

```bash
cd ~/openclaw   # or wherever OpenClaw is installed

# OpenClaw's built-in export
openclaw export --format json --output ~/openclaw-export.json
```

If you don't have the `openclaw export` command, you can manually construct the JSON. The expected format is:

```json
{
  "config": [
    { "id": "cfg-1", "agentId": "agent-1", "key": "model", "value": "claude-3" }
  ],
  "sessions": [
    { "id": "sess-1", "agentId": "agent-1", "state": { "lastRun": "2025-01-01" } }
  ],
  "skills": [
    { "id": "skill-1", "agentId": "agent-1", "name": "web-search", "content": "...", "version": 1 }
  ],
  "triggers": [
    {
      "id": "trig-1",
      "name": "on-new-issue",
      "patternType": "event",
      "patternConfig": { "event": "issue.created" },
      "actionType": "webhook",
      "actionConfig": { "url": "https://..." }
    }
  ],
  "workflows": [
    {
      "id": "wf-1",
      "name": "onboarding",
      "definition": { "steps": [...] }
    }
  ]
}
```

All fields except `id` and `name` are optional. The migration will warn about skipped entities missing required fields.

## Step 2: Validate the Export

Before importing, validate that the file structure is correct:

```bash
cd ~/clawgear

pnpm clawgear migrate validate \
  --from openclaw \
  --file ~/openclaw-export.json
```

Expected output:

```
Validating openclaw export file: /Users/you/openclaw-export.json

File structure valid. Entity counts:
  config: 12
  sessions: 3
  skills: 8
  triggers: 5
  workflows: 2

Total entities: 30
Validation passed.
```

## Step 3: Preview with Dry Run

Run the migration in dry-run mode to see what would happen without writing to the database:

```bash
pnpm clawgear migrate run \
  --from openclaw \
  --file ~/openclaw-export.json \
  --company YOUR_COMPANY_ID \
  --dry-run \
  --output ~/migration-preview.json
```

Review the output for:
- **Counts**: how many entities of each type will be imported
- **Warnings**: entities skipped due to missing fields
- **Errors**: structural problems that would cause failures
- **ID mappings**: how OpenClaw IDs map to new ClawGear UUIDs

## Step 4: Run the Migration

When satisfied with the preview, run the actual migration:

```bash
pnpm clawgear migrate run \
  --from openclaw \
  --file ~/openclaw-export.json \
  --company YOUR_COMPANY_ID \
  --output ~/migration-report.json
```

The migration report is saved to `~/migration-report.json` with full details including all ID mappings.

## Step 5: Verify

After migration, verify your data is accessible through the API:

```bash
# Check skills
curl http://localhost:3000/api/companies/YOUR_COMPANY_ID/marketplace

# Check triggers
curl http://localhost:3000/api/companies/YOUR_COMPANY_ID/triggers

# Check workflows
curl http://localhost:3000/api/companies/YOUR_COMPANY_ID/workflows
```

## Running Both Systems Side by Side

If you want to run OpenClaw and ClawGear simultaneously on the same Mac Mini (e.g., during a transition period), the setup script handles port conflicts automatically. If you're doing it manually:

1. **Database ports**: ClawGear defaults to port 5432. If OpenClaw is already using 5432, change ClawGear to 5433:

   ```yaml
   # docker-compose.yml
   ports:
     - "5433:5432"  # ClawGear on 5433, OpenClaw keeps 5432
   ```

   Update `.env`:
   ```bash
   DATABASE_URL=postgresql://clawgear:clawgear@localhost:5433/clawgear
   ```

2. **API ports**: ClawGear defaults to port 3000. If that's taken:

   ```bash
   # .env
   CLAWGEAR_PORT=3001
   ```

3. **Docker containers**: ClawGear's container is named `clawgear-postgres`, so it won't conflict with OpenClaw's containers regardless of naming.

## One-Command Setup

For Mac Mini users with an existing OpenClaw installation, the setup script automates everything:

```bash
curl -fsSL https://raw.githubusercontent.com/halbert04/clawgear/main/scripts/setup-mac-mini.sh | bash
```

The script will:
1. Detect your OpenClaw installation (checks `~/openclaw`, `~/projects/openclaw`, `/opt/openclaw`)
2. Find OpenClaw's database configuration
3. Install any missing prerequisites (Homebrew, Node.js 22, Bun, pnpm 10, Docker)
4. Clone and set up ClawGear
5. Automatically resolve port conflicts (uses 5433 if 5432 is taken)
6. Run migrations and seed data
7. Run the test suite to verify everything works
8. Optionally set up a macOS LaunchAgent for auto-start on boot
9. Print migration instructions for your specific OpenClaw install

## Migrating from Paperclip or OpenFang

ClawGear also supports migration from the other two inspiration projects:

**From Paperclip:**
```bash
pnpm clawgear migrate run \
  --from paperclip \
  --file ~/paperclip-export.json \
  --company YOUR_COMPANY_ID
```

Paperclip migrations import: companies, agents, goals, projects, and issues.

**From OpenFang:**
```bash
pnpm clawgear migrate run \
  --from openfang \
  --file ~/openfang-export.json \
  --company YOUR_COMPANY_ID
```

OpenFang migrations import: agents, skills, facts, and lessons.

## Mapping OpenClaw Concepts to ClawGear

If you're familiar with OpenClaw's architecture, here's how the concepts translate:

| OpenClaw | ClawGear | Key Difference |
|----------|----------|---------------|
| Agent config | HAND.toml | ClawGear uses TOML files instead of database config rows |
| Flat pool | Kernel | Same dispatch model, but with cron-scheduled heartbeats |
| Skills | Hands + Marketplace | Skills are now signed packages with security scanning |
| Sessions | Runtime state | State is scoped to company (tenant) |
| Triggers | Triggers | Same concept; now supports cron, webhook, event, and compound patterns |
| Workflows | Workflows | Same concept; now has typed step definitions |
| Channel adapters | channels/* | Each channel is its own package for independent deployment |
| CLI | `clawgear` CLI | Similar commands, different binary name |

## Troubleshooting

### "Missing agentId for session, skipping"

OpenClaw sessions without an `agentId` field can't be mapped. These are usually stale sessions. Safe to ignore.

### "Missing skill name or content, skipping"

Skills need both a `name` and `content` field. If your OpenClaw skills use different field names, you'll need to rename them in the JSON export before importing.

### ID mapping mismatches

The migration creates new UUIDs for all entities. If you have external systems referencing OpenClaw IDs, use the `--output` flag to save the full ID mapping report and update your external references accordingly.

### Port 5432 already in use

The setup script handles this automatically. For manual setup, change the port in `docker-compose.yml` and `.env` as described in the side-by-side section above.
