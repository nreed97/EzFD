#!/usr/bin/env bash
# The container stack, exercised end to end.
#
#   bash scripts/test-compose.sh
#
# This is the field server's only test. `deploy.sh` at least fails loudly on a
# VPS you are watching; a compose stack is meant to be carried to a field and
# switched on by someone with no shell and no internet, so the failures that
# matter are the ones that happen when nobody is in a position to debug them:
# the app starting before the schema exists, the database coming back empty
# after a power cut, the log not surviving a restart.
#
# Non-interactive, so `set -e` is right — unlike ezfd-admin.sh, where it breaks
# the menus.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${EZFD_TEST_PORT:-8099}"
BASE="http://127.0.0.1:${PORT}"
PROJECT="ezfd-test-$$"
COMPOSE=(docker compose -p "$PROJECT")

pass=0; fail=0
ok()  { echo "  [ok]   $*"; pass=$((pass + 1)); }
no()  { echo "  [FAIL] $*"; fail=$((fail + 1)); }
step() { echo; echo "── $* ──"; }

# The stack must come down even when an assertion aborts the script, or the
# next run collides with the volume this one left behind.
cleanup() {
  echo
  echo "── tearing down ──"
  # -v because this project's volume is throwaway test data. Never do this to
  # a real deployment: it is the one command that deletes a log.
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE" 2>/dev/null || true
}
trap cleanup EXIT

# A throwaway .env so the run never reads or writes a real one.
ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/ezfd-compose-env.XXXXXX")"
cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=test-super-$$
EZFD_DB_PASSWORD=test-ezfd-$$
EZFD_ENCRYPTION_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
EZFD_ADMIN_KEY=
EZFD_PORT=${PORT}
EOF
COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE")

api() { curl -sS --noproxy 127.0.0.1 -H 'Content-Type: application/json' "$@"; }

# How many contacts the export carries. Deliberately cannot fail: grep exits 1
# when it matches nothing, and under `set -euo pipefail` that would abort the
# run at exactly the moment a check is about to catch something — an assertion
# that kills the script instead of reporting is worse than no assertion, since
# every check after it silently never runs.
qso_count() {
  api "$BASE/api/export/$1?format=json" | { grep -o '"callsign"' || true; } | wc -l | tr -d ' '
}

step "build and start"
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 300
ok "stack reached a healthy state"

# db-init is a one-shot: compose ran it to completion before the app was
# allowed to start. If it had failed, --wait above would already have given up.
init_code="$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.ExitCode}}' | awk '$1=="db-init"{print $2}')"
if [ "$init_code" = "0" ]; then ok "db-init completed successfully"
else no "db-init completed successfully (exit ${init_code:-missing})"; fi

step "the app answers"
code="$(curl -sS --noproxy 127.0.0.1 -o /dev/null -w '%{http_code}' "$BASE/")"
if [ "$code" = "200" ]; then ok "GET / is 200"; else no "GET / is 200 (got $code)"; fi

# /api/time reports both clocks. db_time being present is the proof the app
# reached PostgreSQL through the compose network, not merely that it booted.
time_json="$(api "$BASE/api/time")"
if printf '%s' "$time_json" | grep -q '"db_time":"2'; then
  ok "the app is talking to the database (/api/time reports a db clock)"
else
  no "the app is talking to the database — got: $time_json"
fi

step "an event survives the round trip"
created="$(api -X POST "$BASE/api/events" -d '{
  "club_name":"Compose Test ARC","club_call":"W0CMP","event_type":"FD",
  "class":"2A","arrl_section":"MN","power":"LOW"}')"
CODE="$(printf '%s' "$created" | sed -n 's/.*"join_code":"\([^"]*\)".*/\1/p')"
if [ -n "$CODE" ]; then ok "event created (join code $CODE)"; else no "event created — got: $created"; fi

for n in 1 2 3; do
  api -X POST "$BASE/api/qso" -d "{
    \"join_code\":\"$CODE\",\"callsign\":\"K${n}CMP\",\"band\":\"20m\",\"mode\":\"PH\",
    \"rcvd_class\":\"1D\",\"rcvd_section\":\"IL\",\"op_call\":\"W0CMP\",\"station\":1}" >/dev/null
done
logged="$(qso_count "$CODE")"
if [ "$logged" = "3" ]; then ok "three contacts logged and exported"; else no "three contacts logged and exported (found $logged)"; fi

# The export is reachable with nothing but a join code, over plain HTTP, on a
# LAN anyone at the site is on. It must not carry the stored QRZ credentials —
# that omission is by construction in ezfd_export_events(), and this is the
# only place it gets checked against a running server.
if api "$BASE/api/export/$CODE?format=json" | grep -q 'qrz_password\|qrz_session_key'; then
  no "the export omits the QRZ credentials"
else
  ok "the export omits the QRZ credentials"
fi

step "the log survives losing power"
# The scenario is a generator coughing at 3am with nobody awake. `kill` rather
# than `stop`: SIGKILL to the whole stack is what a power cut looks like to
# PostgreSQL, and the recovery path it takes on the next boot is the one worth
# testing. `restart: unless-stopped` is what brings it back on a real machine.
"${COMPOSE[@]}" kill >/dev/null 2>&1
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 >/dev/null 2>&1
ok "the stack came back after a hard kill"

survived="$(qso_count "$CODE")"
if [ "$survived" = "3" ]; then ok "all three contacts are still in the log"; else no "all three contacts are still in the log (found $survived)"; fi

# db-init runs again on that second `up`. It has to be a no-op against a
# database that already has everything, or every power cut would be a chance to
# corrupt the schema.
init_code="$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.ExitCode}}' | awk '$1=="db-init"{print $2}')"
if [ "$init_code" = "0" ]; then ok "db-init is idempotent (clean re-run on the second boot)"
else no "db-init is idempotent (exit ${init_code:-missing} on the second boot)"; fi

step "the log survives the containers being replaced"
# This is the check the power-cut one above cannot make, and the distinction
# matters. `kill` and `up` restart the *same* containers, so the log survives
# even with no volume configured at all — the postgres image declares a VOLUME,
# and Docker quietly supplies an anonymous one. Recreating the containers is
# what orphans an anonymous volume, and recreating them is what happens on an
# ordinary upgrade between events: pull a new image, `up`, done.
#
# So without `db-data:` in compose.yaml the stack looks fine through every
# power cut and then loses the log the first time someone updates it. Told that
# way it is obviously the worse failure, and it is the one nothing else here
# would catch.
"${COMPOSE[@]}" down >/dev/null 2>&1
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 >/dev/null 2>&1
recreated="$(qso_count "$CODE")"
if [ "$recreated" = "3" ]; then ok "the log survived a down/up cycle (the named volume is doing its job)"
else no "the log survived a down/up cycle — found $recreated of 3 contacts"; fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All ${pass} compose checks passed."
else
  echo "${fail} of $((pass + fail)) compose checks FAILED."
  exit 1
fi
