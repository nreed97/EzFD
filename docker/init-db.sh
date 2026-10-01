#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EzFD — database setup for the Docker Compose install.
#
# Runs as the one-shot `init` service on every `docker compose up`, before the
# app starts. It does what deploy.sh's PostgreSQL block does on a systemd
# install: make sure the `ezfd` role exists with the current password, then
# apply db/schema.sql as the superuser.
#
# The split matters. The schema is owned by postgres and the app connects as
# `ezfd`, which the schema grants DML only — the same arrangement as a
# deploy.sh install, so a TRUNCATE in app code fails here exactly as it would
# there, rather than passing in Docker and failing in the field.
#
# schema.sql is idempotent (CI applies it twice), which is what makes running
# it on every start safe, and what lets `docker compose up -d` act as an update.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${EZFD_DB_PASSWORD:?EZFD_DB_PASSWORD is not set}"

# The password goes in as a psql variable and is quoted by format(%L), so a
# quote in it cannot break out of the statement.
psql -v ON_ERROR_STOP=1 -q -v pw="$EZFD_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE ezfd LOGIN PASSWORD %L', :'pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ezfd')
\gexec
SELECT format('ALTER ROLE ezfd LOGIN PASSWORD %L', :'pw')
\gexec
SQL

psql -v ON_ERROR_STOP=1 -q -f /schema/schema.sql
echo "EzFD database ready"
