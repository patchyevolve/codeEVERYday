# Multi-stage Dockerfile for codePracticeDaily
# Usage:
#   docker compose up                     # starts postgres + api + executor + worker + web
#   docker build --target api -t cpd-api .
#   docker build --target executor -t cpd-executor .

# ---------- base ----------
FROM node:22-alpine AS base
WORKDIR /app

# dumb-init forwards SIGTERM/SIGINT so the node process drains instead of
# being killed hard by the container runtime.
RUN apk add --no-cache dumb-init

# Copy workspace root manifest + lockfile first so installs are layer-cached
# and reproducible (npm ci fails fast if the lockfile drifts).
COPY package.json package-lock.json ./

# Copy every workspace package.json (needed for npm install to resolve workspaces,
# including apps/web which the `web` service runs).
COPY packages/core/package.json ./packages/core/
COPY packages/ai/package.json ./packages/ai/
COPY packages/curriculum/package.json ./packages/curriculum/
COPY apps/api/package.json ./apps/api/
COPY apps/executor/package.json ./apps/executor/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy tsconfig files
COPY tsconfig.base.json ./
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/ai/tsconfig.json ./packages/ai/
COPY packages/curriculum/tsconfig.json ./packages/curriculum/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/executor/tsconfig.json ./apps/executor/
COPY apps/worker/tsconfig.json ./apps/worker/
COPY apps/web/tsconfig.json ./apps/web/

# Copy source code
COPY packages/core/ ./packages/core/
COPY packages/ai/ ./packages/ai/
COPY packages/curriculum/ ./packages/curriculum/
COPY apps/api/ ./apps/api/
COPY apps/executor/ ./apps/executor/
COPY apps/worker/ ./apps/worker/
COPY apps/web/ ./apps/web/

# Build all packages (order matters: core -> ai -> curriculum -> api/executor/worker).
# apps/web is deliberately not built here: the `web` service runs the Vite dev
# server, and a production build would be a separate target.
RUN npm run build

# ---------- api ----------
FROM base AS api
ENV NODE_ENV=production
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/index.js"]

# ---------- executor ----------
FROM base AS executor
# The executor shells out to the docker CLI to run sandboxed learner code;
# the compose file mounts the host /var/run/docker.sock into this container.
# Without docker-cli the container boots but every /execute call fails.
RUN apk add --no-cache docker-cli
ENV NODE_ENV=production
EXPOSE 4100
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/executor/dist/index.js"]

# ---------- worker ----------
FROM base AS worker
ENV NODE_ENV=production
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/worker/dist/index.js"]

# ---------- web (Vite dev server) ----------
FROM base AS web
ENV NODE_ENV=development
EXPOSE 5173
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "dev", "-w", "@cpd/web", "--", "--host", "--port", "5173"]
