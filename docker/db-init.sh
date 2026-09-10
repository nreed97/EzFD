#!/usr/bin/env bash
# Provision the database for the container stack, then get out of the way.
#
# Runs as its own one-shot compose service on every `up`, before the app is
# allowed to start. Everything here is idempotent, because "every up" includes
# the up after a power cut mid-event and the up after pulling a new image.
#
# This is deliberately the same three steps `deploy.sh` and CI both take, in
# the same order and with the same tool — create the role, create the database,
# apply `db/schema.sql` as the superuser. The schema file does its own GRANTs
# and carries every table, index, constraint and function; CI applies it twice
# against an empty database and then runs the full suite, which is what makes
# it safe to treat as the one true provisioning step rather than writing a
# container-specific variant. A second copy of this recipe is exactly the class
# of bug this repository keeps finding (see AGENTS.md on the backup query that
# lived in four places and disagreed with itself in three).
#
# Not interactive, so `set -e` is right here — unlike ezfd-admin.sh, where it
# breaks the menus.
set -euo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
: "${EZFD_DB_PASSWORD:?EZFD_DB_PASSWORD must be set}"

DB_HOST="${DB_HOST:-db}"
SCHEMA="${SCHEMA:-/schema/schema.sql}"

export PGPASSWORD="$POSTGRES_PASSWORD"
psql_super() { psql -h "$DB_HOST" -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "[db-init] provisioning against ${DB_HOST}"

# The role owns nothing and is granted DML only — schema.sql hands out the
# grants. Tables stay owned by postgres, which is why the app cannot TRUNCATE
# and lib/masterCallsigns.ts clears with DELETE instead.
if [ -z "$(psql_super -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'ezfd'")" ]; then
  psql_super -q -c "CREATE ROLE ezfd LOGIN PASSWORD '${EZFD_DB_PASSWORD}'"
  echo "[db-init] role 'ezfd' created"
else
  # Re-set on every run so rotating the password in .env is enough to rotate it
  # here, rather than needing someone to remember a manual ALTER.
  psql_super -q -c "ALTER ROLE ezfd LOGIN PASSWORD '${EZFD_DB_PASSWORD}'"
  echo "[db-init] role 'ezfd' password synchronised with the environment"
fi

if [ -z "$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname = 'ezfd'")" ]; then
  psql_super -q -c "CREATE DATABASE ezfd OWNER ezfd"
  echo "[db-init] database 'ezfd' created"
fi

# ON_ERROR_STOP is not optional. Fed a file or a heredoc, psql exits 0 even
# when a statement failed; only -c reports a SQL error in its exit status
# without it. Without this line a schema that half-applied would report success
# and the app would start against a database missing whatever came after the
# failure.
psql_super -q -d ezfd -f "$SCHEMA"
echo "[db-init] schema applied"
