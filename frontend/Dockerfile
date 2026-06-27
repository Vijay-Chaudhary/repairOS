FROM node:22-alpine AS dev

WORKDIR /app

# npm install (not ci) tolerates a stale lockfile in dev.
# Run `npm install` on the host and commit the updated package-lock.json
# before switching to `npm ci` here.
COPY package.json package-lock.json ./
RUN npm install

EXPOSE 3000

# Source code is mounted at runtime via volume.
# node_modules and .next are declared as anonymous volumes in compose so the
# host mount does not shadow the image-layer install.
ENV NODE_ENV=development
CMD ["npm", "run", "dev"]

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# NEXT_PUBLIC_* vars are inlined into the bundle at `next build` time, so they
# must be present as build args — they cannot be injected at container runtime.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_MINIO_URL
ARG NEXT_PUBLIC_TENANT_SLUG=

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_PUBLIC_MINIO_URL=${NEXT_PUBLIC_MINIO_URL} \
    NEXT_PUBLIC_TENANT_SLUG=${NEXT_PUBLIC_TENANT_SLUG}

# Full deps (incl. dev) so `next build` has its toolchain (TypeScript, Tailwind).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production runtime (standalone) ─────────────────────────────────────────────
# next.config.mjs sets output:'standalone' → a minimal traced server with only
# the node_modules actually used. Far smaller image + RAM than `npm start`.
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# `node` (uid 1000) ships with the base image — run unprivileged.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000
CMD ["node", "server.js"]
