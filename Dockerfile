# EzFD as a container image.
#
# This exists for the field server: a Raspberry Pi at a site with no internet,
# acting as the central log for the event. `deploy.sh` cannot do that job — it
# adds the NodeSource and PGDG apt repositories, installs packages and runs
# certbot, every one of which needs the network at the moment you run it. An
# image is pulled or loaded once, while connectivity exists, and then runs
# forever without asking anyone for anything.
#
# It is also what makes the build portable. A Pi 5 can build this itself — the
# build peaks around 550 MB and completes with the JS heap capped at 256 MB, so
# memory is not the obstacle it is often assumed to be. Building on a laptop and
# carrying the image over is for a Pi 4 or a 1-2 GB machine, and for getting
# postgres:16 onto a host that can never pull it. See docs/field-server.md.
#
# Node 22 to match .github/workflows/ci.yml, so the image runs what CI tested.

# ── deps ─────────────────────────────────────────────────────────────────────
# Split from the build stage so a source-only change does not re-resolve the
# dependency tree. `npm ci` and not `npm install`: the lockfile is the input.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NODE_ENV is deliberately not set to production here: `next build` needs the
# devDependencies that are already installed, and setting it changes nothing
# about the output that `output: 'standalone'` does not already decide.
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# 0.0.0.0, not the 127.0.0.1 `deploy.sh` uses. There it is right — nginx is in
# front and the app must not be reachable except through it. Here the container
# boundary is the thing doing that job, and binding loopback would make the
# app unreachable from outside its own namespace: the port mapping would
# publish a port nothing is listening on.

RUN addgroup -S ezfd && adduser -S -G ezfd ezfd

# Three copies, because `output: 'standalone'` emits only the server and its
# traced dependencies. Static assets and public/ are not traced — they are
# served from disk — which is why deploy.sh rsyncs the same three paths.
COPY --from=build --chown=ezfd:ezfd /app/.next/standalone ./
COPY --from=build --chown=ezfd:ezfd /app/.next/static ./.next/static
COPY --from=build --chown=ezfd:ezfd /app/public ./public

USER ezfd
EXPOSE 3000

# /api/time is the cheapest honest liveness signal the app has, and it is the
# one endpoint guaranteed to exist for the clock check. It reports rather than
# fails when the database is unreachable, which is correct here: the database
# has its own healthcheck, and an app that is up but cannot reach its database
# should still answer so the failure is visible instead of looking like a
# crash loop.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/time >/dev/null || exit 1

CMD ["node", "server.js"]
