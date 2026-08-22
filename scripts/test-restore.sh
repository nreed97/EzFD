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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL="${PSQL:-psql -h 127.0.0.1 -p 5432 -U postgres}"
DB="${DB:-ezfd}"
WORK="$(mktemp -d)"
# pg_read_file runs as the PostgreSQL server process, which is a different
# user, so it must be able to traverse this directory. mktemp -d gives 0700.
chmod 755 "$WORK"
FAILURES=0

q()  { $PSQL -d "$DB" -tAX -c "$1" 2>&1; }
ok() { echo "ok    $1"; }
no() { echo "FAIL  $1  ${2:-}"; FAILURES=$((FAILURES + 1)); }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# The backup query from ezfd-admin.sh's "Export full backup" action.
backup() {
  local uuid="$1" out="$2"
  $PSQL -d "$DB" -tAX -c "
    SELECT row_to_json(t) FROM (
      SELECT e.*,
        (SELECT json_agg(row_to_json(q) ORDER BY q.datetime_utc) FROM qsos q WHERE q.event_id=e.id) AS qsos,
        (SELECT json_agg(row_to_json(o) ORDER BY o.op_call)
           FROM ses_operators o WHERE o.event_id=e.id) AS ses_operators,
        (SELECT json_agg(json_build_object(
                  'op_call', r.op_call, 'band', r.band, 'mode', r.mode,
                  'starts_at', lower(r.during), 'ends_at', upper(r.during),
                  'planned_freq', r.planned_freq, 'note', r.note,
                  'status', r.status, 'created_at', r.created_at) ORDER BY lower(r.during))
           FROM ses_reservations r WHERE r.event_id=e.id) AS ses_reservations
      FROM events e WHERE e.id='$uuid'
    ) t;" > "$out"
  # pg_read_file runs as the server process, which is not this user.
  chmod 644 "$out"
}

# Pull the restore DO block out of ezfd-admin.sh so the real code is what runs.
extract_restore() {
  local json_file="$1" out="$2"
  python3 - "$SCRIPT_DIR/ezfd-admin.sh" "$json_file" "$out" <<'PY'
import sys
src, json_file, out = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src).read()
start = s.index('    DO \\$\\$')
end = s.index('SELECT orig_code, new_code, qso_count FROM _restore_summary;')
block = s[start:end].replace('\\$\\$', '$$').replace("'$json_file'", f"'{json_file}'")
open(out, 'w').write(
    "CREATE TEMP TABLE _restore_summary(orig_code text, new_code text, qso_count int);\n"
    + block + "\nSELECT new_code FROM _restore_summary;\n")
PY
}

restore() {
  local json_file="$1" sql="$WORK/restore.sql"
  extract_restore "$json_file" "$sql"
  $PSQL -d "$DB" -tAX -v ON_ERROR_STOP=1 -f "$sql" 2>&1 | grep -E '^[A-Z0-9]{6}$' | head -1
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

echo "── round trips ──"

# ── SES ──────────────────────────────────────────────────────────────────────
SES_UUID=$(q "SELECT id FROM events WHERE join_code='RTSES';")
backup "$SES_UUID" "$WORK/ses.json"
SES_NEW=$(restore "$WORK/ses.json")
if [[ -z "$SES_NEW" ]]; then
  no "SES event restores"
else
  ok "SES event restores as $SES_NEW"

  # NULLIF, not COALESCE(...,''): an empty string here would put a blank
  # MY_ARRL_SECT into every exported ADIF record.
  [[ "$(q "SELECT class IS NULL FROM events WHERE join_code='$SES_NEW';")" == "t" ]] \
    && ok "  class restores as NULL, not an empty string" \
    || no "  class restores as NULL, not an empty string"

  [[ "$(q "SELECT slot_enforcement||'/'||slot_minutes||'/'||dupe_rule||'/'||require_operator_approval
           FROM events WHERE join_code='$SES_NEW';")" == "HARD/90/DAY/true" ]] \
    && ok "  checkout, dupe and approval settings survive" \
    || no "  checkout, dupe and approval settings survive"

  # The roster is the only source for the ADIF MY_* fields, so losing it
  # produces a restored log that no longer uploads correctly.
  [[ "$(q "SELECT COUNT(*)||':'||COUNT(*) FILTER (WHERE approved)
           FROM ses_operators o JOIN events e ON e.id=o.event_id WHERE e.join_code='$SES_NEW';")" == "2:1" ]] \
    && ok "  operator roster survives with per-operator approval state" \
    || no "  operator roster survives with per-operator approval state"

  [[ "$(q "SELECT COALESCE(grid,'-')||'/'||COALESCE(state,'-')||'/'||COALESCE(county,'-')
           FROM ses_operators o JOIN events e ON e.id=o.event_id
           WHERE e.join_code='$SES_NEW' AND o.op_call='W0AAA';")" == "EN34/MN/Hennepin" ]] \
    && ok "  per-operator location survives (feeds ADIF MY_*)" \
    || no "  per-operator location survives (feeds ADIF MY_*)"

  # A tstzrange can't survive JSON intact, so it's decomposed and rebuilt.
  [[ "$(q "SELECT ROUND(EXTRACT(EPOCH FROM (upper(during)-lower(during)))/60)::text
           FROM ses_reservations r JOIN events e ON e.id=r.event_id WHERE e.join_code='$SES_NEW';")" == "120" ]] \
    && ok "  reservation range rebuilt with the right span" \
    || no "  reservation range rebuilt with the right span"

  [[ "$(q "SELECT COALESCE(rst_sent,'-')||'/'||COALESCE(rcvd_name,'-')||'/'||COALESCE(rcvd_section,'-')||'/'||COALESCE(freq_khz::text,'-')
           FROM qsos q JOIN events e ON e.id=q.event_id WHERE e.join_code='$SES_NEW';")" == "59/Dave/MN/14250" ]] \
    && ok "  SES QSO columns survive" \
    || no "  SES QSO columns survive"
fi

# ── Field Day (JSON-null SES arrays) ─────────────────────────────────────────
FD_UUID=$(q "SELECT id FROM events WHERE join_code='RTFD';")
backup "$FD_UUID" "$WORK/fd.json"
FD_NEW=$(restore "$WORK/fd.json")
if [[ -z "$FD_NEW" ]]; then
  no "FD event restores (JSON-null ses arrays)"
else
  ok "FD event restores as $FD_NEW"
  [[ "$(q "SELECT class||'/'||arrl_section||'/'||power||'/'||(SELECT COUNT(*) FROM qsos q WHERE q.event_id=e.id)
           FROM events e WHERE join_code='$FD_NEW';")" == "3A/MN/LOW/1" ]] \
    && ok "  contest fields and QSOs survive" \
    || no "  contest fields and QSOs survive"
fi

# ── Event with zero QSOs ─────────────────────────────────────────────────────
NIL_UUID=$(q "SELECT id FROM events WHERE join_code='RTNIL';")
backup "$NIL_UUID" "$WORK/nil.json"
NIL_NEW=$(restore "$WORK/nil.json")
[[ -n "$NIL_NEW" ]] \
  && ok "event with zero QSOs restores (json_agg null scalar)" \
  || no "event with zero QSOs restores (json_agg null scalar)"

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
