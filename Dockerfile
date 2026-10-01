# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# EzFD — application image, used by compose.yaml.
#
# Two stages: the first runs `npm ci` and `next build` exactly as deploy.sh
# does, the second carries only the standalone server, its static assets and
# public/ — the same three directories deploy.sh rsyncs into /opt/ezfd.
#
# NODE_MAJOR must match .nvmrc, which is where the Node major is decided.
# scripts/test-docker.sh fails if the two disagree, because a Dockerfile that
# quietly kept an older Node is the drift deploy.sh once had with setup_20.x.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_MAJOR=24

FROM node:${NODE_MAJOR}-bookworm-slim AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:${NODE_MAJOR}-bookworm-slim
WORKDIR /app
# HOSTNAME is not optional. Next's standalone server binds to $HOSTNAME, and
# Docker sets HOSTNAME to the container id — so without this the server
# listens on an address only the container itself can reach, and the proxy in
# front of it gets "connection refused" while the container reports healthy.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /src/.next/standalone ./
COPY --from=build --chown=node:node /src/.next/static ./.next/static
COPY --from=build --chown=node:node /src/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
