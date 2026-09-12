# Multi-stage Dockerfile for codePracticeDaily
# Usage:
#   docker compose up           # starts postgres + api + executor
#   docker build --target api -t cpd-api .
#   docker build --target executor -t cpd-executor .

# ---------- base ----------
FROM node:22-alpine AS base
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy workspace root manifest + lockfile
COPY package.json package-lock.json* ./

# Copy all workspace package.json files (needed for npm install to resolve workspaces)
COPY packages/core/package.json ./packages/core/
COPY packages/ai/package.json ./packages/ai/
COPY packages/curriculum/package.json ./packages/curriculum/
COPY apps/api/package.json ./apps/api/
COPY apps/executor/package.json ./apps/executor/
COPY apps/worker/package.json ./apps/worker/

# Install dependencies (including devDependencies for build)
RUN npm install

# Copy tsconfig files
COPY tsconfig.base.json ./
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/ai/tsconfig.json ./packages/ai/
COPY packages/curriculum/tsconfig.json ./packages/curriculum/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/executor/tsconfig.json ./apps/executor/
COPY apps/worker/tsconfig.json ./apps/worker/

# Copy source code
COPY packages/core/ ./packages/core/
COPY packages/ai/ ./packages/ai/
COPY packages/curriculum/ ./packages/curriculum/
COPY apps/api/ ./apps/api/
COPY apps/executor/ ./apps/executor/
COPY apps/worker/ ./apps/worker/

# Build all packages (order matters: core -> ai -> curriculum -> api/executor)
RUN npm run build

# ---------- api ----------
FROM base AS api
ENV NODE_ENV=production
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/index.js"]

# ---------- executor ----------
FROM base AS executor
ENV NODE_ENV=production
EXPOSE 4100
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/executor/dist/index.js"]

# ---------- worker ----------
FROM base AS worker
ENV NODE_ENV=production
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/worker/dist/index.js"]
