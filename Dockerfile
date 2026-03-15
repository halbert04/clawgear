# syntax=docker/dockerfile:1

# ---- Base ----
FROM oven/bun:1 AS base
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy all package.json files for workspace resolution
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/runtime/package.json packages/runtime/
COPY packages/security/package.json packages/security/
COPY packages/learning/package.json packages/learning/
COPY packages/kernel/package.json packages/kernel/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/marketplace/package.json packages/marketplace/
COPY adapters/claude-code/package.json adapters/claude-code/
COPY adapters/hand/package.json adapters/hand/

RUN bun install --frozen-lockfile

# ---- Release ----
FROM base AS release
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/*/node_modules 2>/dev/null || true
COPY --from=deps /app/adapters/*/node_modules ./adapters/*/node_modules 2>/dev/null || true

# Copy source (TypeScript runs directly in Bun)
COPY . .

ENV NODE_ENV=production
ENV CLAWGEAR_HOST=0.0.0.0
ENV CLAWGEAR_PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "packages/api/src/index.ts"]
