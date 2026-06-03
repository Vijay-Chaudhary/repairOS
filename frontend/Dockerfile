FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

FROM base AS dev-deps
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# ── Development target (used in docker-compose for local dev) ─────────────────
FROM base AS dev
ENV NODE_ENV=development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ── Builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=dev-deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
RUN npm run build

# ── Production runner ─────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]
