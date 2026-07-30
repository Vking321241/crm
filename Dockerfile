# DivaryTalk — production image for EasyPanel.
#
# Simple two-stage build (not the trimmed `.next/standalone` runtime)
# on purpose: `scripts/migrate.mjs` (the migration runner run as a
# one-off command against this same image, see below) needs `pg` and
# `drizzle-orm` at runtime, and both are already plain `dependencies`
# in package.json — a full `npm install --omit=dev` guarantees they
# (and everything else the app needs) are present, without having to
# fight Next's file-tracing to make sure a script nothing in the App
# Router imports still gets its deps copied into a pruned image.
#
# `npm install`, not `npm ci`: package-lock.json is generated on
# whatever host runs `npm install` locally (Windows, in this repo's
# case), and npm v10's lockfile format pins OS/CPU-specific optional
# dependencies (e.g. `@swc/helpers` resolution, `@next/swc-*`
# variants) per the platform that generated it. `npm ci` refuses to
# proceed when the lockfile doesn't exactly match the current
# platform's resolution ("Missing: X from lock file") — which is
# exactly what happens building on node:20-alpine (linux/musl) from a
# Windows-generated lockfile. `npm install` reconciles instead of
# refusing, at the cost of strict reproducibility we don't need here.
#
# Running migrations: after this image is deployed (or before, via
# EasyPanel's pre-deploy command), run:
#   node scripts/migrate.mjs main
#   node scripts/migrate.mjs storage
# Idempotent — safe to run on every deploy.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S divarytalk -u 1001

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/messages ./messages
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle-storage ./drizzle-storage
COPY --from=builder /app/scripts ./scripts

# Volume for local file storage (avatars/media — Fatia 3). Mount an
# EasyPanel persistent volume at this path so uploads survive
# redeploys.
RUN mkdir -p /data/storage && chown -R divarytalk:nodejs /data/storage

USER divarytalk

EXPOSE 3000
ENV PORT=3000

CMD ["npm", "start"]
