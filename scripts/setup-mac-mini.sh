#!/usr/bin/env bash
# ClawGear Mac Mini Setup Script
# For users migrating from OpenClaw (or clean installs) on macOS Mac Minis.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/halbert04/clawgear/main/scripts/setup-mac-mini.sh | bash
#
# Or locally:
#   chmod +x scripts/setup-mac-mini.sh
#   ./scripts/setup-mac-mini.sh

set -euo pipefail

# --- Colors -----------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# --- Detect existing OpenClaw installation ----------------------------
OPENCLAW_DIR=""
OPENCLAW_DB_URL=""
OPENCLAW_DETECTED=false

detect_openclaw() {
  info "Checking for existing OpenClaw installation..."

  # Common OpenClaw locations on Mac Minis
  local candidates=(
    "$HOME/openclaw"
    "$HOME/OpenClaw"
    "$HOME/projects/openclaw"
    "$HOME/src/openclaw"
    "/opt/openclaw"
    "/usr/local/openclaw"
  )

  for dir in "${candidates[@]}"; do
    if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
      if grep -q "openclaw" "$dir/package.json" 2>/dev/null; then
        OPENCLAW_DIR="$dir"
        OPENCLAW_DETECTED=true
        ok "Found OpenClaw at: $OPENCLAW_DIR"
        break
      fi
    fi
  done

  if [ "$OPENCLAW_DETECTED" = false ]; then
    info "No existing OpenClaw installation found (checked ~/openclaw, ~/projects/openclaw, /opt/openclaw)"
    info "Proceeding with clean install."
  fi

  # Check for OpenClaw's database
  if [ -f "$HOME/.openclaw/config.json" ]; then
    local db_url
    db_url=$(python3 -c "import json; print(json.load(open('$HOME/.openclaw/config.json')).get('database_url', ''))" 2>/dev/null || true)
    if [ -n "$db_url" ]; then
      OPENCLAW_DB_URL="$db_url"
      ok "Found OpenClaw database config: ${db_url%%@*}@..."
    fi
  fi

  # Check .env files in openclaw directory
  if [ "$OPENCLAW_DETECTED" = true ] && [ -f "$OPENCLAW_DIR/.env" ]; then
    local env_db
    env_db=$(grep -E "^DATABASE_URL=" "$OPENCLAW_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
    if [ -n "$env_db" ] && [ -z "$OPENCLAW_DB_URL" ]; then
      OPENCLAW_DB_URL="$env_db"
      ok "Found OpenClaw DATABASE_URL from .env"
    fi
  fi
}

# --- Check and install prerequisites ----------------------------------
check_prereqs() {
  info "Checking prerequisites..."
  local missing=()

  # Homebrew
  if ! command -v brew &>/dev/null; then
    warn "Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add to PATH for Apple Silicon
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
  else
    ok "Homebrew $(brew --version | head -1)"
  fi

  # Node.js >= 22
  if command -v node &>/dev/null; then
    local node_major
    node_major=$(node --version | sed 's/v//' | cut -d. -f1)
    if [ "$node_major" -ge 22 ]; then
      ok "Node.js $(node --version)"
    else
      warn "Node.js $(node --version) found, but >= 22 required. Upgrading..."
      brew install node@22
      brew link --overwrite node@22
    fi
  else
    warn "Node.js not found. Installing v22..."
    brew install node@22
    ok "Node.js installed"
  fi

  # Bun
  if command -v bun &>/dev/null; then
    ok "Bun $(bun --version)"
  else
    warn "Bun not found. Installing..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    ok "Bun installed"
  fi

  # pnpm
  if command -v pnpm &>/dev/null; then
    local pnpm_major
    pnpm_major=$(pnpm --version | cut -d. -f1)
    if [ "$pnpm_major" -ge 10 ]; then
      ok "pnpm $(pnpm --version)"
    else
      warn "pnpm $(pnpm --version) found, but >= 10 required. Upgrading..."
      corepack enable
      corepack prepare pnpm@latest --activate
    fi
  else
    warn "pnpm not found. Installing..."
    corepack enable
    corepack prepare pnpm@latest --activate
    ok "pnpm installed"
  fi

  # Docker
  if command -v docker &>/dev/null; then
    ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
  else
    warn "Docker not found. Installing Docker Desktop..."
    brew install --cask docker
    echo ""
    warn "Docker Desktop installed but needs to be started manually."
    warn "Open Docker Desktop from Applications, wait for it to start,"
    warn "then re-run this script."
    exit 1
  fi

  # Check Docker is running
  if ! docker info &>/dev/null 2>&1; then
    fail "Docker is installed but not running."
    warn "Start Docker Desktop and re-run this script."
    exit 1
  fi

  # Git
  if command -v git &>/dev/null; then
    ok "Git $(git --version | cut -d' ' -f3)"
  else
    warn "Git not found. Installing..."
    brew install git
    ok "Git installed"
  fi

  echo ""
  ok "All prerequisites satisfied."
}

# --- Clone or locate ClawGear -----------------------------------------
setup_clawgear() {
  local install_dir="${CLAWGEAR_DIR:-$HOME/clawgear}"

  if [ -d "$install_dir" ] && [ -f "$install_dir/package.json" ]; then
    if grep -q '"clawgear"' "$install_dir/package.json" 2>/dev/null; then
      ok "ClawGear already cloned at: $install_dir"
      cd "$install_dir"
      info "Pulling latest changes..."
      git pull origin main 2>/dev/null || warn "Could not pull (may be on a feature branch)"
    else
      fail "$install_dir exists but doesn't look like a ClawGear repo"
      exit 1
    fi
  else
    info "Cloning ClawGear to $install_dir..."
    git clone https://github.com/halbert04/clawgear.git "$install_dir"
    cd "$install_dir"
    ok "Cloned."
  fi

  info "Installing dependencies..."
  pnpm install
  ok "Dependencies installed."
}

# --- Configure environment --------------------------------------------
configure_env() {
  local install_dir="${CLAWGEAR_DIR:-$HOME/clawgear}"
  cd "$install_dir"

  if [ -f .env ]; then
    ok ".env already exists. Skipping configuration."
    return
  fi

  info "Creating .env from template..."
  cp env.example .env

  # If OpenClaw had a PostgreSQL running, reuse the host but create a new database
  if [ -n "$OPENCLAW_DB_URL" ]; then
    warn "OpenClaw database detected. ClawGear will use its own database."
    warn "Your OpenClaw data is untouched -- migration is a separate step."
    echo ""
    # Extract host:port from OpenClaw's database URL
    local pg_host
    pg_host=$(echo "$OPENCLAW_DB_URL" | sed -E 's|.*@([^/]+)/.*|\1|')
    if [ -n "$pg_host" ] && [ "$pg_host" != "localhost:5432" ]; then
      info "OpenClaw PostgreSQL is at $pg_host"
      info "ClawGear will use Docker for its own isolated PostgreSQL instance."
    fi
  fi

  ok ".env created. Edit it to add your API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)."
}

# --- Start database and run migrations --------------------------------
setup_database() {
  local install_dir="${CLAWGEAR_DIR:-$HOME/clawgear}"
  cd "$install_dir"

  # Check if ClawGear's PostgreSQL is already running
  if docker ps --format '{{.Names}}' | grep -q 'clawgear-postgres'; then
    ok "ClawGear PostgreSQL already running."
  else
    # Check for port conflict (OpenClaw may be using 5432)
    if lsof -i :5432 &>/dev/null 2>&1; then
      warn "Port 5432 is in use (likely by OpenClaw's PostgreSQL)."
      warn "ClawGear will use port 5433 instead."
      echo ""

      # Modify docker-compose to use 5433
      if grep -q '"5432:5432"' docker-compose.yml; then
        sed -i.bak 's/"5432:5432"/"5433:5432"/' docker-compose.yml
        rm -f docker-compose.yml.bak

        # Update .env
        sed -i.bak 's|localhost:5432/clawgear|localhost:5433/clawgear|' .env
        rm -f .env.bak

        info "Updated docker-compose.yml and .env to use port 5433."
      fi
    fi

    info "Starting ClawGear PostgreSQL..."
    pnpm docker:up

    # Wait for healthy
    info "Waiting for PostgreSQL to be ready..."
    local retries=30
    while [ $retries -gt 0 ]; do
      if docker inspect --format='{{.State.Health.Status}}' clawgear-postgres 2>/dev/null | grep -q healthy; then
        break
      fi
      retries=$((retries - 1))
      sleep 1
    done

    if [ $retries -eq 0 ]; then
      fail "PostgreSQL did not become healthy in 30 seconds."
      warn "Check: docker logs clawgear-postgres"
      exit 1
    fi

    ok "PostgreSQL is ready."
  fi

  info "Running database migrations..."
  pnpm db:migrate
  ok "Migrations complete."

  info "Seeding sample data..."
  pnpm db:seed
  ok "Seed data loaded."
}

# --- Run tests --------------------------------------------------------
verify_install() {
  local install_dir="${CLAWGEAR_DIR:-$HOME/clawgear}"
  cd "$install_dir"

  info "Running tests to verify installation..."
  if pnpm test; then
    ok "All tests passed."
  else
    warn "Some tests failed. This may be due to missing environment variables."
    warn "Check .env and ensure DATABASE_URL is correct."
  fi
}

# --- Optional: launchd service for always-on operation ----------------
setup_launchd() {
  local install_dir="${CLAWGEAR_DIR:-$HOME/clawgear}"
  local plist_path="$HOME/Library/LaunchAgents/com.clawgear.api.plist"

  if [ -f "$plist_path" ]; then
    ok "LaunchAgent already configured."
    return
  fi

  echo ""
  read -rp "Set up ClawGear to start automatically on boot? (y/n) " autostart
  if [ "$autostart" != "y" ]; then
    info "Skipping auto-start setup. Run manually with: cd $install_dir && pnpm dev"
    return
  fi

  info "Creating LaunchAgent for ClawGear API..."

  # Resolve paths
  local bun_path
  bun_path=$(which bun)
  local pnpm_path
  pnpm_path=$(which pnpm)

  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.clawgear.api</string>
    <key>ProgramArguments</key>
    <array>
        <string>$pnpm_path</string>
        <string>dev</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$install_dir</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(dirname "$bun_path"):$(dirname "$pnpm_path"):/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$install_dir/logs/api.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$install_dir/logs/api.stderr.log</string>
</dict>
</plist>
PLIST

  mkdir -p "$install_dir/logs"
  launchctl load "$plist_path"
  ok "ClawGear API will now start automatically on boot."
  info "Logs: $install_dir/logs/api.stdout.log"
  info "Stop: launchctl unload $plist_path"
}

# --- Print migration instructions if OpenClaw detected ----------------
print_migration_info() {
  if [ "$OPENCLAW_DETECTED" = false ]; then
    return
  fi

  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  OpenClaw Migration Available${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  An existing OpenClaw installation was found at:"
  echo "    $OPENCLAW_DIR"
  echo ""
  echo "  To migrate your OpenClaw data to ClawGear:"
  echo ""
  echo "  1. Export from OpenClaw:"
  echo "     cd $OPENCLAW_DIR"
  echo "     openclaw export --format json --output ~/openclaw-export.json"
  echo ""
  echo "  2. Validate the export:"
  echo "     cd ${CLAWGEAR_DIR:-$HOME/clawgear}"
  echo "     pnpm clawgear migrate validate --from openclaw --file ~/openclaw-export.json"
  echo ""
  echo "  3. Preview (dry run):"
  echo "     pnpm clawgear migrate run --from openclaw --file ~/openclaw-export.json \\"
  echo "       --company <your-company-id> --dry-run"
  echo ""
  echo "  4. Run the migration:"
  echo "     pnpm clawgear migrate run --from openclaw --file ~/openclaw-export.json \\"
  echo "       --company <your-company-id>"
  echo ""
  echo "  See docs/migrating-from-openclaw.md for full instructions."
  echo ""
}

# --- Print summary ----------------------------------------------------
print_summary() {
  local install_dir="${CLAWGEAR_DIR:-$HOME/clawgear}"
  local port
  port=$(grep -E "^CLAWGEAR_PORT=" "$install_dir/.env" 2>/dev/null | cut -d= -f2 || echo "3000")
  local db_port
  db_port=$(grep -oE 'localhost:[0-9]+/clawgear' "$install_dir/.env" 2>/dev/null | cut -d: -f2 | cut -d/ -f1 || echo "5432")

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ClawGear is installed and ready${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Project:    $install_dir"
  echo "  API:        http://localhost:${port}"
  echo "  PostgreSQL: localhost:${db_port}"
  echo ""
  echo "  Start dev server:    cd $install_dir && pnpm dev"
  echo "  Start dashboard:     cd $install_dir && pnpm --filter @clawgear/dashboard dev"
  echo "  Run tests:           cd $install_dir && pnpm test"
  echo ""
  echo "  Next steps:"
  echo "    1. Edit .env to add your OPENAI_API_KEY and ANTHROPIC_API_KEY"
  echo "    2. Start the dev server: pnpm dev"
  echo "    3. Browse hands/ to see available agent definitions"
  echo ""

  print_migration_info
}

# --- Main -------------------------------------------------------------
main() {
  echo ""
  echo -e "${BLUE}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║         ClawGear Mac Mini Setup               ║${NC}"
  echo -e "${BLUE}║  CEO Agent Operating System Installer         ║${NC}"
  echo -e "${BLUE}╚═══════════════════════════════════════════════╝${NC}"
  echo ""

  detect_openclaw
  echo ""
  check_prereqs
  echo ""
  setup_clawgear
  echo ""
  configure_env
  echo ""
  setup_database
  echo ""
  verify_install
  echo ""
  setup_launchd
  print_summary
}

main "$@"
