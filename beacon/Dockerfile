# Beacon (Next.js 16, pnpm workspace) for Dokploy — ADR-007/009/012. SQLite on the /data volume.
# Build from the REPOSITORY ROOT (the panel depends on packages/ui): `docker build -f beacon/Dockerfile .`
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY beacon/package.json beacon/
COPY packages/ui/package.json packages/ui/
# The pnpm store survives between builds (BuildKit cache mount).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter beacon...

FROM base AS build
WORKDIR /repo
COPY --from=deps /repo ./
COPY packages/ui packages/ui
COPY beacon beacon
ARG NEXT_PUBLIC_WARDEND_WS_URL
# Release tag or commit sha, shown in the sidebar (CI passes it as VERSION).
ARG VERSION=dev
ENV NEXT_PUBLIC_WARDEND_WS_URL=$NEXT_PUBLIC_WARDEND_WS_URL NEXT_PUBLIC_BEACON_VERSION=$VERSION
RUN pnpm --filter beacon build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/beacon.db
RUN groupadd -r beacon && useradd -r -g beacon beacon && mkdir -p /data && chown beacon:beacon /data
# outputFileTracingRoot is the repo root, so the standalone tree keeps the beacon/ prefix.
COPY --from=build --chown=beacon:beacon /repo/beacon/.next/standalone ./
COPY --from=build --chown=beacon:beacon /repo/beacon/.next/static ./beacon/.next/static
COPY --from=build --chown=beacon:beacon /repo/beacon/public ./beacon/public
USER beacon
VOLUME ["/data"]
EXPOSE 3000
# /api/auth/ok answers once the schema is migrated and Better Auth is up (instrumentation.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/auth/ok').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Run with an init process (compose `init: true` / `docker run --init`): node as PID 1 does not
# reap children or forward SIGTERM by itself, so stops would wait for the 10 s kill.
CMD ["node", "beacon/server.js"]
