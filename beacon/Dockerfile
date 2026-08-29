# Beacon (Next.js 16, pnpm) for Dokploy — ADR-007/009. SQLite on the /data volume.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# The pnpm store survives between builds (BuildKit cache mount).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_WARDEND_WS_URL
ENV NEXT_PUBLIC_WARDEND_WS_URL=$NEXT_PUBLIC_WARDEND_WS_URL
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/beacon.db
RUN groupadd -r beacon && useradd -r -g beacon beacon && mkdir -p /data && chown beacon:beacon /data
COPY --from=build --chown=beacon:beacon /app/.next/standalone ./
COPY --from=build --chown=beacon:beacon /app/.next/static ./.next/static
COPY --from=build --chown=beacon:beacon /app/public ./public
USER beacon
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
