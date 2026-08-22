#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# End-to-end API tests against a running EzFD server.
#
# Covers the SES route behaviour that unit-level checks can't reach: the
# checkout conflict path, both enforcement modes, the offline-replay bypass,
# per-operator ADIF, and Field Day still behaving as before.
#
#   BASE_URL=http://127.0.0.1:3000 bash scripts/test-e2e.sh
# ─────────────────────────────────────────────────────────────────────────────
# No `set -e`: assertions report and continue rather than aborting, so one
# failure doesn't hide the rest (see AGENTS.md on bash in this repo).
set -uo pipefail

BASE="${BASE_URL:-http://127.0.0.1:3000}"
FAILURES=0

ok() { echo "ok    $1"; }
no() { echo "FAIL  $1  ${2:-}"; FAILURES=$((FAILURES + 1)); }

# Assert an HTTP status and echo the body for further inspection.
req() {
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -s -X "$method" "$BASE$path" -H 'Content-Type: application/json' -d "$data"
  else
    curl -s -X "$method" "$BASE$path"
  fi
}
status() {
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" -H 'Content-Type: application/json' -d "$data"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path"
  fi
}
jq_get() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))"; }

echo "── waiting for $BASE ──"
for _ in $(seq 1 60); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" 2>/dev/null)" == "200" ]] && break
  sleep 1
done
if [[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" 2>/dev/null)" != "200" ]]; then
  echo "FAIL  server never became ready at $BASE"; exit 1
fi

# ── Special event station, warn-only enforcement ─────────────────────────────
echo "── SES: soft enforcement ──"
SOFT=$(req POST /api/events '{"club_name":"E2E Soft","club_call":"W9S","event_type":"SES","slot_enforcement":"SOFT","dupe_rule":"DAY","arrl_section":"MN"}' | jq_get join_code)
SOFT_ID=$(req GET "/api/events/$SOFT" | jq_get id)
[[ -n "$SOFT_ID" ]] && ok "SES event created ($SOFT)" || no "SES event created"

EV=$(req GET "/api/events/$SOFT")
[[ "$(echo "$EV" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['class'] is None)")" == "True" ]] \
  && ok "  class is NULL on an SES event" || no "  class is NULL on an SES event"

WARN=$(req POST /api/qso "{\"event_id\":\"$SOFT_ID\",\"callsign\":\"K1AAA\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\",\"rst_sent\":\"59\",\"rst_rcvd\":\"57\",\"rcvd_name\":\"Dave\",\"rcvd_grid\":\"EN34\",\"rcvd_section\":\"MN\"}")
[[ -n "$(echo "$WARN" | jq_get slot_warning)" ]] \
  && ok "  logging without a checkout warns but still records" \
  || no "  logging without a checkout warns but still records"

RES=$(req POST /api/ses/reservations "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W0AAA\",\"band\":\"20m\",\"mode\":\"PH\"}")
[[ "$(echo "$RES" | jq_get op_call)" == "W0AAA" ]] && ok "  checkout succeeds" || no "  checkout succeeds"

CONFLICT=$(req POST /api/ses/reservations "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W1BBB\",\"band\":\"20m\",\"mode\":\"PH\"}")
CONFLICT_MSG=$(echo "$CONFLICT" | jq_get error)
[[ "$(status POST /api/ses/reservations "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W1BBB\",\"band\":\"20m\",\"mode\":\"PH\"}")" == "409" ]] \
  && ok "  a conflicting checkout is refused with 409" || no "  a conflicting checkout is refused with 409"
[[ "$CONFLICT_MSG" == *"W0AAA"* ]] && ok "  the 409 names the current holder" || no "  the 409 names the current holder" "$CONFLICT_MSG"
# pg hands back TIMESTAMPTZ as a Date; interpolating it raw produced
# "Sat Aug 22 2026 02:24:29 GMT+0000 (Coordinated Universal Time)".
[[ "$CONFLICT_MSG" != *"GMT"* && "$CONFLICT_MSG" == *"Z"* ]] \
  && ok "  the 409 formats the end time as UTC, not a raw Date" \
  || no "  the 409 formats the end time as UTC, not a raw Date" "$CONFLICT_MSG"

CLEAN=$(req POST /api/qso "{\"event_id\":\"$SOFT_ID\",\"callsign\":\"K2BBB\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\"}")
[[ -z "$(echo "$CLEAN" | jq_get slot_warning)" ]] \
  && ok "  logging on your own slot produces no warning" || no "  logging on your own slot produces no warning"

# ── Hard enforcement and the offline-replay bypass ───────────────────────────
echo "── SES: hard enforcement ──"
HARD=$(req POST /api/events '{"club_name":"E2E Hard","club_call":"W9H","event_type":"SES","slot_enforcement":"HARD"}' | jq_get join_code)
HARD_ID=$(req GET "/api/events/$HARD" | jq_get id)
BODY="{\"event_id\":\"$HARD_ID\",\"callsign\":\"K3CCC\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W0AAA\"}"
[[ "$(status POST /api/qso "$BODY")" == "409" ]] \
  && ok "  logging without a checkout is refused" || no "  logging without a checkout is refused"
# A contact that already happened on the air must never be dropped because
# the network blipped, so a replay is accepted regardless of the gate.
[[ "$(status POST /api/qso "${BODY%\}}, \"replay\":true}")" == "201" ]] \
  && ok "  the same QSO replayed from the offline queue is accepted" \
  || no "  the same QSO replayed from the offline queue is accepted"

req POST /api/ses/reservations "{\"event_id\":\"$HARD_ID\",\"op_call\":\"W0AAA\",\"band\":\"40m\",\"mode\":\"CW\"}" >/dev/null
[[ "$(status POST /api/qso "{\"event_id\":\"$HARD_ID\",\"callsign\":\"K4DDD\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W0AAA\"}")" == "201" ]] \
  && ok "  logging after checking out succeeds" || no "  logging after checking out succeeds"
[[ "$(status POST /api/qso "{\"event_id\":\"$HARD_ID\",\"callsign\":\"K5EEE\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W1BBB\"}")" == "409" ]] \
  && ok "  a different operator is refused on someone else's slot" \
  || no "  a different operator is refused on someone else's slot"

# ── Roster approval gating ───────────────────────────────────────────────────
echo "── SES: roster approval ──"
GATED=$(req POST /api/events '{"club_name":"E2E Gated","club_call":"W9G","event_type":"SES","require_operator_approval":true}' | jq_get join_code)
GATED_ID=$(req GET "/api/events/$GATED" | jq_get id)
req POST /api/ses/operators "{\"event_id\":\"$GATED_ID\",\"op_call\":\"W0AAA\",\"grid\":\"EN34\"}" >/dev/null
[[ "$(req GET "/api/ses/operators?event_id=$GATED_ID" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['approved'])")" == "False" ]] \
  && ok "  a new operator on a gated event starts unapproved" \
  || no "  a new operator on a gated event starts unapproved"
[[ "$(status POST /api/qso "{\"event_id\":\"$GATED_ID\",\"callsign\":\"K6FFF\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\"}")" == "403" ]] \
  && ok "  an unapproved operator cannot log" || no "  an unapproved operator cannot log"
[[ "$(status POST /api/qso "{\"event_id\":\"$GATED_ID\",\"callsign\":\"K6FFF\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\",\"replay\":true}")" == "201" ]] \
  && ok "  but a replayed QSO is still accepted" || no "  but a replayed QSO is still accepted"

# ── Export: per-operator MY_* is the LoTW-correctness case ───────────────────
echo "── SES: export ──"
req POST /api/ses/operators "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W0AAA\",\"grid\":\"EN34\",\"state\":\"MN\",\"county\":\"Hennepin\"}" >/dev/null
req POST /api/ses/operators "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W1BBB\",\"grid\":\"FN31\",\"state\":\"CT\"}" >/dev/null
req POST /api/qso "{\"event_id\":\"$SOFT_ID\",\"callsign\":\"K7GGG\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W1BBB\",\"replay\":true}" >/dev/null
ADIF=$(req GET "/api/export/$SOFT")
[[ "$ADIF" == *"MY_GRIDSQUARE:4>EN34"* && "$ADIF" == *"MY_GRIDSQUARE:4>FN31"* ]] \
  && ok "  ADIF carries each operator's own grid" \
  || no "  ADIF carries each operator's own grid"
[[ "$(grep -c 'STATION_CALLSIGN:3>W9S' <<< "$ADIF")" -ge 2 ]] \
  && ok "  every record shares one STATION_CALLSIGN" || no "  every record shares one STATION_CALLSIGN"
[[ "$ADIF" == *"ARRL_SECT:2>MN"* ]] && ok "  the optional SES section is exported" || no "  the optional SES section is exported"
FILTERED=$(req GET "/api/export/$SOFT?op=W1BBB")
[[ "$FILTERED" == *"FN31"* && "$FILTERED" != *"EN34"* ]] \
  && ok "  ?op= filters to one operator's contacts" || no "  ?op= filters to one operator's contacts"
[[ "$(status GET "/api/export/$SOFT?format=cabrillo")" == "400" ]] \
  && ok "  Cabrillo is refused for an SES" || no "  Cabrillo is refused for an SES"

# ── Field Day regression ─────────────────────────────────────────────────────
echo "── Field Day regression ──"
FD=$(req POST /api/events '{"club_name":"E2E FD","club_call":"W0NY","event_type":"FD","class":"3A","arrl_section":"MN","power":"LOW"}' | jq_get join_code)
FD_ID=$(req GET "/api/events/$FD" | jq_get id)
FDQ=$(req POST /api/qso "{\"event_id\":\"$FD_ID\",\"callsign\":\"K1XYZ\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"2A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0AAA\"}")
[[ "$(echo "$FDQ" | jq_get sent_class)" == "3A" && "$(echo "$FDQ" | jq_get rcvd_class)" == "2A" ]] \
  && ok "  the contest exchange is still stamped" || no "  the contest exchange is still stamped"
[[ -z "$(echo "$FDQ" | jq_get slot_warning)" ]] \
  && ok "  no SES checkout gate is applied to Field Day" || no "  no SES checkout gate is applied to Field Day"
FDQ2=$(req POST /api/qso "{\"event_id\":\"$FD_ID\",\"callsign\":\"K1XYZ\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"2A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0AAA\"}")
[[ "$(echo "$FDQ2" | jq_get is_dupe)" == "True" ]] \
  && ok "  dupe detection still flags a repeat" || no "  dupe detection still flags a repeat"
CAB=$(req GET "/api/export/$FD?format=cabrillo")
[[ "$CAB" == *"CONTEST: ARRL-FD"* && "$CAB" == *"QSO: "* ]] \
  && ok "  Cabrillo still generates for Field Day" || no "  Cabrillo still generates for Field Day"
[[ "$(req GET "/api/export/$FD")" == *"STX_STRING:5>3A MN"* ]] \
  && ok "  FD ADIF still carries the contest exchange" || no "  FD ADIF still carries the contest exchange"

# ── Server clock endpoint ────────────────────────────────────────────────────
#
# The clock-skew banner is only as good as this endpoint. A field server with
# no RTC stamps every QSO with a wrong time and nothing else notices, so the
# check needs to keep working — including the database clock, which is what
# actually stamps the QSOs.
echo "── server clock ──"
TIME_JSON=$(req GET /api/time)
APP_TIME=$(echo "$TIME_JSON" | jq_get app_time)
DB_TIME=$(echo "$TIME_JSON" | jq_get db_time)
[[ "$(status GET /api/time)" == "200" ]] \
  && ok "  /api/time responds" || no "  /api/time responds"
[[ "$APP_TIME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] \
  && ok "  it reports the app clock as an ISO timestamp" || no "  it reports the app clock as an ISO timestamp" "$APP_TIME"
[[ "$DB_TIME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] \
  && ok "  it reports the database clock too" || no "  it reports the database clock too" "$DB_TIME"
# Both clocks are read within one request, so any real gap between them means
# the app and the database are on hosts whose clocks disagree.
SKEW=$(python3 -c "
import sys
from datetime import datetime
a = datetime.fromisoformat('$APP_TIME'.replace('Z','+00:00'))
d = datetime.fromisoformat('$DB_TIME'.replace('Z','+00:00'))
print(int(abs((a-d).total_seconds())))
" 2>/dev/null)
[[ -n "$SKEW" && "$SKEW" -lt 60 ]] \
  && ok "  the app and database clocks agree" || no "  the app and database clocks agree" "${SKEW:-unparseable}s apart"

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "All end-to-end tests passed."
  exit 0
fi
echo "$FAILURES failure(s)."
exit 1
