# syntax=docker/dockerfile:1.7

############################
# Stage 1: dependencies
############################
FROM node:20.18.1-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Install only production deps, deterministically.
RUN npm ci --omit=dev && npm cache clean --force

############################
# Stage 2: build/test (full deps)
############################
FROM node:20.18.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run lint && npm test

############################
# Stage 3: runtime (minimal, non-root)
############################
FROM node:20.18.1-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Drop to an unprivileged user; node image ships a `node` (uid 1000) user.
WORKDIR /app

# Tini for correct PID 1 signal handling (graceful shutdown).
RUN apk add --no-cache tini

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node
EXPOSE 8080

# Container-level healthcheck (also covered by K8s probes).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
