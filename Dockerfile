# 1. Base runtime image with system tools (cached permanently across application builds)
FROM node:24.18.0-alpine AS base

RUN apk add --no-cache postgresql16-client postgresql18-client tar gzip && \
    ln -sf /usr/libexec/postgresql16/pg_dump /usr/bin/pg_dump && \
    ln -sf /usr/libexec/postgresql18/pg_restore /usr/bin/pg_restore

# 2. Production dependencies stage (cached whenever package.json/package-lock.json are unchanged)
FROM node:24.18.0-alpine AS prod-deps

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# 3. Builder stage (compiles TypeScript source code with esbuild in <1s)
FROM node:24.18.0-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# 4. Final runtime container
FROM base AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# The application's compiled migrator consumes the SQL migration set directly.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/docker-compose.yml ./docker-compose.yml

USER node

# Internal health check runs on 3001. Webhook mode listens on port 3000 by default.
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --start-interval=5s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3001/readyz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
