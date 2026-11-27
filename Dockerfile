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
ARG APP_GIT_BRANCH=""
ARG APP_GIT_SHA=""
ARG APP_GIT_TAG=""
ARG APP_GIT_COMMITS_AHEAD=""
ARG APP_GIT_DIRTY=""
ARG APP_BUILD_TIME=""
ARG APP_RELEASE_CHANNEL=""
ENV APP_GIT_BRANCH=${APP_GIT_BRANCH} \
    APP_GIT_SHA=${APP_GIT_SHA} \
    APP_GIT_TAG=${APP_GIT_TAG} \
    APP_GIT_COMMITS_AHEAD=${APP_GIT_COMMITS_AHEAD} \
    APP_GIT_DIRTY=${APP_GIT_DIRTY} \
    APP_BUILD_TIME=${APP_BUILD_TIME} \
    APP_RELEASE_CHANNEL=${APP_RELEASE_CHANNEL}
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

# Internal health check runs on 3001 by default. Webhook mode listens on 3000 and Mini App on 3002.
EXPOSE 3000 3002

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --start-interval=5s --retries=4 \
  CMD node -e "const p=process.env.HEALTH_CHECK_PORT||process.env.PORT||3001;fetch('http://127.0.0.1:'+p+'/readyz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
