FROM node:24.18.0-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc tsconfig.json ./
RUN npm ci

COPY . .
RUN npm run build
# Keep the runtime dependency tree generated from the locked builder install.
# This avoids a second, independent npm install and guarantees the migration
# CLI uses exactly the dependency versions that were compiled and tested.
RUN npm prune --omit=dev && npm cache clean --force

FROM node:24.18.0-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# The application's compiled migrator consumes the SQL migration set directly.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/docker-compose.yml ./docker-compose.yml

RUN apk add --no-cache postgresql16-client postgresql18-client tar gzip && \
    ln -sf /usr/libexec/postgresql16/pg_dump /usr/bin/pg_dump && \
    ln -sf /usr/libexec/postgresql18/pg_restore /usr/bin/pg_restore

USER node

# This port intentionally has no EXPOSE instruction or Compose port mapping.
# Docker probes localhost inside the bot container; Telegram uses outbound long
# polling, so the deployment has no inbound network surface.
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --start-interval=5s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3001/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
