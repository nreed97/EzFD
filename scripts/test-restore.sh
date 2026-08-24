#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Backup / restore round-trip tests for ezfd-admin.sh.
#
# This path is worth testing because it has been wrong twice: json_agg over
# zero rows serialises as JSON null (a scalar, so COALESCE misses it and
# jsonb_array_elements errors), and class/arrl_section were restored with
# COALESCE(...,'') which turns an SES event's NULL section into an empty
# string. Both were silent — a restore reported success and returned bad data.
#
# The restore SQL is extracted from ezfd-admin.sh rather than copied, so this
# exercises the real code and can't drift away from it.
#
#   PSQL="psql -h 127.0.0.1 -p 5432 -U postgres" bash scripts/test-restore.sh
# ─────────────────────────────────────────────────────────────────────────────
# No `set -e`: this script inspects failures rather than aborting on them,
# matching the convention in ezfd-admin.sh (see AGENTS.md).
set -uo pipefail

PSQL="${PSQL:-psql -h 127.0.0.1 -p 5432 -U postgres}"
DB="${DB:-ezfd}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
FAILURES=0

q()  { $PSQL -d "$DB" -tAX -c "$1" 2>&1; }
ok() { echo "ok    $1"; }
no() { echo "FAIL  $1  ${2:-}"; FAILURES=$((FAILURES + 1)); }

# Invoked by the EXIT trap below, which shellcheck can't see.
# shellcheck disable=SC2317
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Export and restore are functions in db/schema.sql, so this exercises the
# shipped definitions directly rather than a copy. That matters here more than
# most places: this test used to carry its own third variant of the backup
# query, so it round-tripped a shape the admin console's menu action never
# actually produced -- and stayed green while that action silently dropped the
# SES roster.
backup() {
  local uuid="$1" out="$2"
  $PSQL -d "$DB" -tAX -c "SELECT ezfd_export_events('$uuid');" > "$out"
}

restore() {
  local json_file="$1"
  # The payload goes in as a psql variable rather than pg_read_file(), which
  # reads the *database server's* filesystem -- invisible to the runner when
  # the database is a container, as it is in CI. Fed on stdin, not with -c:
  # psql only interpolates :'variables' when it lexes the input, which it does
  # for stdin and -f but not for -c.
  $PSQL -d "$DB" -tAX -v ON_ERROR_STOP=1 \
    -v payload="$(cat "$json_file")" \
    <<< "SELECT new_code FROM ezfd_restore_events(:'payload'::jsonb);" 2>&1 \
    | grep -E '^[A-Z0-9]{6}$' | head -1
}

echo "── seeding ──"
q "DELETE FROM events WHERE join_code IN ('RTSES','RTFD','RTNIL');" >/dev/null

# 1. A special event station with a full roster, a checkout, and an SES QSO.
q "
WITH e AS (
  INSERT INTO events (join_code, club_name, club_call, event_type, class, arrl_section,
                      ses_description, slot_enforcement, slot_minutes, dupe_rule,
                      require_operator_approval, starts_at, ends_at)
  VALUES ('RTSES','Round Trip SES','W9RT','SES',NULL,'MN','anniversary',
          'HARD', 90, 'DAY', TRUE, NOW(), NOW() + interval '7 days')
  RETURNING id)
INSERT INTO ses_operators (event_id, op_call, op_name, grid, state, county, approved)
SELECT id, v.c, v.n, v.g, v.s, v.y, v.a FROM e, (VALUES
  ('W0AAA','Dave','EN34','MN','Hennepin',TRUE),
  ('W1BBB','Sam','FN31','CT',NULL,FALSE)) AS v(c,n,g,s,y,a);" >/dev/null
q "INSERT INTO ses_reservations (event_id, op_call, band, mode, during, planned_freq)
   SELECT id,'W0AAA','20m','PH', tstzrange(NOW(), NOW()+interval '2 hours','[)'),'14.250'
   FROM events WHERE join_code='RTSES';" >/dev/null
q "INSERT INTO qsos (event_id, callsign, band, mode, operator_call, rst_sent, rst_rcvd,
                     rcvd_name, rcvd_qth, rcvd_grid, rcvd_section, freq_khz)
   SELECT id,'K1AAA','20m','PH','W0AAA','59','57','Dave','Duluth','EN36','MN',14250
   FROM events WHERE join_code='RTSES';" >/dev/null

# 2. A Field Day event — its SES arrays serialise as JSON null.
q "
WITH e AS (
  INSERT INTO events (join_code, club_name, club_call, event_type, class, arrl_section, power, bonuses)
  VALUES ('RTFD','Round Trip FD','W0RT','FD','3A','MN','LOW','{\"emergency_power\":true}'::jsonb)
  RETURNING id)
INSERT INTO qsos (event_id, callsign, band, mode, sent_class, sent_section, rcvd_class, rcvd_section)
SELECT id,'K1XYZ','20m','PH','3A','MN','2A','EPA' FROM e;" >/dev/null

# 3. An event with no QSOs at all — the case that used to abort the restore.
q "INSERT INTO events (join_code, club_name, club_call, event_type, class, arrl_section)
   VALUES ('RTNIL','No QSOs','W0NQ','FD','1D','MN');" >/dev/null

# The export query was copied four times before it was made a function, and
# every copy had drifted. Two of them used SELECT e.*, which is what leaked the
# encrypted QRZ credentials into files under /tmp. Nothing but this stops a
# fifth appearing.
echo "── one export definition ──"
STRAY=$(grep -n "SELECT e\.\*" "$REPO/ezfd-admin.sh" | grep -v "^[0-9]*: *#" || true)
if [[ -z "$STRAY" ]]; then
  ok "  ezfd-admin.sh builds no event export of its own"
else
  no "  ezfd-admin.sh builds no event export of its own" "$STRAY"
fi

# Fed on stdin, psql exits 0 even when a statement failed unless
# ON_ERROR_STOP is set. This test has always set it; ezfd-admin.sh's own
# restore had not, so a restore that died on a constraint violation printed
# "Restore complete" and then rendered the error text as the results table.
# The two are separate call sites, so only a check keeps them agreeing.
echo "── restore reports failure ──"
RESTORE_CALL=$(grep -c "ezfd_restore_events" "$REPO/ezfd-admin.sh")
# Every call that feeds a payload on stdin has to go through PGS, the wrapper
# that sets ON_ERROR_STOP -- both the restore itself and the count preceding
# it. Checking for PGS anywhere in the file is not enough: with two such call
# sites, one of them reverting still leaves the other to satisfy the grep.
LAX=$(grep -nE '(^|[^A-Za-z])PG -v payload=' "$REPO/ezfd-admin.sh" || true)
if [[ "$RESTORE_CALL" -eq 0 ]]; then
  no "  ezfd-admin.sh calls ezfd_restore_events" "no call site found"
elif [[ -z "$LAX" ]]; then
  ok "  every payload psql call in ezfd-admin.sh sets ON_ERROR_STOP"
else
  no "  every payload psql call in ezfd-admin.sh sets ON_ERROR_STOP" "$LAX"
fi

# psql -A does not escape its field separator inside a value, so with the
# default pipe a club called "Pipe|Name Club" shifted every following column
# of the event table one field right. Rows are split on an ASCII unit
# separator now; a reader that still splits on a pipe would silently
# reintroduce it for whichever query it reads.
echo "── no pipe-delimited row parsing ──"
PIPE_READ=$(grep -n "IFS='|'" "$REPO/ezfd-admin.sh" || true)
if [[ -z "$PIPE_READ" ]]; then
  ok "  ezfd-admin.sh parses rows on the unit separator, not a pipe"
else
  no "  ezfd-admin.sh parses rows on the unit separator, not a pipe" "$PIPE_READ"
fi

echo "── round trips ──"

# ── SES ──────────────────────────────────────────────────────────────────────
SES_UUID=$(q "SELECT id FROM events WHERE join_code='RTSES';")
backup "$SES_UUID" "$WORK/ses.json"

# Both of these were live bugs. ezfd-admin.sh's interactive "Full JSON backup"
# used SELECT e.*, so it dumped the encrypted QRZ credentials into a file the
# script then offers to scp off-server, and it carried neither the SES roster
# nor the checkout history -- silently lossy for exactly the event type that
# needs the roster most, since it is the only source for the ADIF MY_* fields.
if grep -qi 'qrz' "$WORK/ses.json"; then
  no "  the export carries no QRZ credentials" "$(grep -oi 'qrz[a-z_]*' "$WORK/ses.json" | sort -u | tr '\n' ' ')"
else
  ok "  the export carries no QRZ credentials"
fi
for table in ses_operators ses_reservations qsos; do
  if grep -q "\"$table\"" "$WORK/ses.json"; then
    ok "  the export carries $table"
  else
    no "  the export carries $table"
  fi
done

SES_NEW=$(restore "$WORK/ses.json")
if [[ -z "$SES_NEW" ]]; then
  no "SES event restores"
else
  ok "SES event restores as $SES_NEW"

  # NULLIF, not COALESCE(...,''): an empty string here would put a blank
  # MY_ARRL_SECT into every exported ADIF record.
  if [[ "$(q "SELECT class IS NULL FROM events WHERE join_code='$SES_NEW';")" == "t" ]]; then
    ok "  class restores as NULL, not an empty string"
  else
    no "  class restores as NULL, not an empty string"
  fi

  if [[ "$(q "SELECT slot_enforcement||'/'||slot_minutes||'/'||dupe_rule||'/'||require_operator_approval
           FROM events WHERE join_code='$SES_NEW';")" == "HARD/90/DAY/true" ]]; then
    ok "  checkout, dupe and approval settings survive"
  else
    no "  checkout, dupe and approval settings survive"
  fi

  # The roster is the only source for the ADIF MY_* fields, so losing it
  # produces a restored log that no longer uploads correctly.
  if [[ "$(q "SELECT COUNT(*)||':'||COUNT(*) FILTER (WHERE approved)
           FROM ses_operators o JOIN events e ON e.id=o.event_id WHERE e.join_code='$SES_NEW';")" == "2:1" ]]; then
    ok "  operator roster survives with per-operator approval state"
  else
    no "  operator roster survives with per-operator approval state"
  fi

  if [[ "$(q "SELECT COALESCE(grid,'-')||'/'||COALESCE(state,'-')||'/'||COALESCE(county,'-')
           FROM ses_operators o JOIN events e ON e.id=o.event_id
           WHERE e.join_code='$SES_NEW' AND o.op_call='W0AAA';")" == "EN34/MN/Hennepin" ]]; then
    ok "  per-operator location survives (feeds ADIF MY_*)"
  else
    no "  per-operator location survives (feeds ADIF MY_*)"
  fi

  # A tstzrange can't survive JSON intact, so it's decomposed and rebuilt.
  if [[ "$(q "SELECT ROUND(EXTRACT(EPOCH FROM (upper(during)-lower(during)))/60)::text
           FROM ses_reservations r JOIN events e ON e.id=r.event_id WHERE e.join_code='$SES_NEW';")" == "120" ]]; then
    ok "  reservation range rebuilt with the right span"
  else
    no "  reservation range rebuilt with the right span"
  fi

  if [[ "$(q "SELECT COALESCE(rst_sent,'-')||'/'||COALESCE(rcvd_name,'-')||'/'||COALESCE(rcvd_section,'-')||'/'||COALESCE(freq_khz::text,'-')
           FROM qsos q JOIN events e ON e.id=q.event_id WHERE e.join_code='$SES_NEW';")" == "59/Dave/MN/14250" ]]; then
    ok "  SES QSO columns survive"
  else
    no "  SES QSO columns survive"
  fi
fi

# ── Field Day (JSON-null SES arrays) ─────────────────────────────────────────
FD_UUID=$(q "SELECT id FROM events WHERE join_code='RTFD';")
backup "$FD_UUID" "$WORK/fd.json"
FD_NEW=$(restore "$WORK/fd.json")
if [[ -z "$FD_NEW" ]]; then
  no "FD event restores (JSON-null ses arrays)"
else
  ok "FD event restores as $FD_NEW"
  if [[ "$(q "SELECT class||'/'||arrl_section||'/'||power||'/'||(SELECT COUNT(*) FROM qsos q WHERE q.event_id=e.id)
           FROM events e WHERE join_code='$FD_NEW';")" == "3A/MN/LOW/1" ]]; then
    ok "  contest fields and QSOs survive"
  else
    no "  contest fields and QSOs survive"
  fi
fi

# ── Event with zero QSOs ─────────────────────────────────────────────────────
NIL_UUID=$(q "SELECT id FROM events WHERE join_code='RTNIL';")
backup "$NIL_UUID" "$WORK/nil.json"
NIL_NEW=$(restore "$WORK/nil.json")
if [[ -n "$NIL_NEW" ]]; then
  ok "event with zero QSOs restores (json_agg null scalar)"
else
  no "event with zero QSOs restores (json_agg null scalar)"
fi

echo "── cleanup ──"
for c in RTSES RTFD RTNIL "$SES_NEW" "$FD_NEW" "$NIL_NEW"; do
  [[ -n "$c" ]] && q "DELETE FROM events WHERE join_code='$c';" >/dev/null
done

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "All restore round-trip tests passed."
  exit 0
fi
echo "$FAILURES failure(s)."
exit 1
