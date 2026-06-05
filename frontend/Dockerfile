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

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
