FROM node:20.18-alpine AS dev

WORKDIR /app

# Install deps before mounting source so node_modules lives in the image layer.
COPY package.json package-lock.json ./
RUN npm ci

EXPOSE 3000

# Source code is mounted at runtime via volume.
# node_modules and .next are declared as anonymous volumes in compose so the
# host mount does not shadow the image-layer install.
ENV NODE_ENV=development
CMD ["npm", "run", "dev"]

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20.18-alpine AS production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
