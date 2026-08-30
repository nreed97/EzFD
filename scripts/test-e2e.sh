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
if [[ -n "$SOFT_ID" ]]; then
  ok "SES event created ($SOFT)"
else
  no "SES event created"
fi

EV=$(req GET "/api/events/$SOFT")
if [[ "$(echo "$EV" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['class'] is None)")" == "True" ]]; then
  ok "  class is NULL on an SES event"
else
  no "  class is NULL on an SES event"
fi

WARN=$(req POST /api/qso "{\"event_id\":\"$SOFT_ID\",\"callsign\":\"K1AAA\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\",\"rst_sent\":\"59\",\"rst_rcvd\":\"57\",\"rcvd_name\":\"Dave\",\"rcvd_grid\":\"EN34\",\"rcvd_section\":\"MN\"}")
if [[ -n "$(echo "$WARN" | jq_get slot_warning)" ]]; then
  ok "  logging without a checkout warns but still records"
else
  no "  logging without a checkout warns but still records"
fi

RES=$(req POST /api/ses/reservations "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W0AAA\",\"band\":\"20m\",\"mode\":\"PH\"}")
if [[ "$(echo "$RES" | jq_get op_call)" == "W0AAA" ]]; then
  ok "  checkout succeeds"
else
  no "  checkout succeeds"
fi

CONFLICT=$(req POST /api/ses/reservations "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W1BBB\",\"band\":\"20m\",\"mode\":\"PH\"}")
CONFLICT_MSG=$(echo "$CONFLICT" | jq_get error)
if [[ "$(status POST /api/ses/reservations "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W1BBB\",\"band\":\"20m\",\"mode\":\"PH\"}")" == "409" ]]; then
  ok "  a conflicting checkout is refused with 409"
else
  no "  a conflicting checkout is refused with 409"
fi
if [[ "$CONFLICT_MSG" == *"W0AAA"* ]]; then
  ok "  the 409 names the current holder"
else
  no "  the 409 names the current holder" "$CONFLICT_MSG"
fi
# pg hands back TIMESTAMPTZ as a Date; interpolating it raw produced
# "Sat Aug 22 2026 02:24:29 GMT+0000 (Coordinated Universal Time)".
if [[ "$CONFLICT_MSG" != *"GMT"* && "$CONFLICT_MSG" == *"Z"* ]]; then
  ok "  the 409 formats the end time as UTC, not a raw Date"
else
  no "  the 409 formats the end time as UTC, not a raw Date" "$CONFLICT_MSG"
fi

CLEAN=$(req POST /api/qso "{\"event_id\":\"$SOFT_ID\",\"callsign\":\"K2BBB\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\"}")
if [[ -z "$(echo "$CLEAN" | jq_get slot_warning)" ]]; then
  ok "  logging on your own slot produces no warning"
else
  no "  logging on your own slot produces no warning"
fi

# ── Hard enforcement and the offline-replay bypass ───────────────────────────
echo "── SES: hard enforcement ──"
HARD=$(req POST /api/events '{"club_name":"E2E Hard","club_call":"W9H","event_type":"SES","slot_enforcement":"HARD"}' | jq_get join_code)
HARD_ID=$(req GET "/api/events/$HARD" | jq_get id)
BODY="{\"event_id\":\"$HARD_ID\",\"callsign\":\"K3CCC\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W0AAA\"}"
if [[ "$(status POST /api/qso "$BODY")" == "409" ]]; then
  ok "  logging without a checkout is refused"
else
  no "  logging without a checkout is refused"
fi
# A contact that already happened on the air must never be dropped because
# the network blipped, so a replay is accepted regardless of the gate.
if [[ "$(status POST /api/qso "${BODY%\}}, \"replay\":true}")" == "201" ]]; then
  ok "  the same QSO replayed from the offline queue is accepted"
else
  no "  the same QSO replayed from the offline queue is accepted"
fi

req POST /api/ses/reservations "{\"event_id\":\"$HARD_ID\",\"op_call\":\"W0AAA\",\"band\":\"40m\",\"mode\":\"CW\"}" >/dev/null
if [[ "$(status POST /api/qso "{\"event_id\":\"$HARD_ID\",\"callsign\":\"K4DDD\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W0AAA\"}")" == "201" ]]; then
  ok "  logging after checking out succeeds"
else
  no "  logging after checking out succeeds"
fi
if [[ "$(status POST /api/qso "{\"event_id\":\"$HARD_ID\",\"callsign\":\"K5EEE\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W1BBB\"}")" == "409" ]]; then
  ok "  a different operator is refused on someone else's slot"
else
  no "  a different operator is refused on someone else's slot"
fi

# ── Roster approval gating ───────────────────────────────────────────────────
echo "── SES: roster approval ──"
GATED=$(req POST /api/events '{"club_name":"E2E Gated","club_call":"W9G","event_type":"SES","require_operator_approval":true}' | jq_get join_code)
GATED_ID=$(req GET "/api/events/$GATED" | jq_get id)
req POST /api/ses/operators "{\"event_id\":\"$GATED_ID\",\"op_call\":\"W0AAA\",\"grid\":\"EN34\"}" >/dev/null
if [[ "$(req GET "/api/ses/operators?event_id=$GATED_ID" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['approved'])")" == "False" ]]; then
  ok "  a new operator on a gated event starts unapproved"
else
  no "  a new operator on a gated event starts unapproved"
fi
if [[ "$(status POST /api/qso "{\"event_id\":\"$GATED_ID\",\"callsign\":\"K6FFF\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\"}")" == "403" ]]; then
  ok "  an unapproved operator cannot log"
else
  no "  an unapproved operator cannot log"
fi
if [[ "$(status POST /api/qso "{\"event_id\":\"$GATED_ID\",\"callsign\":\"K6FFF\",\"band\":\"20m\",\"mode\":\"PH\",\"operator_call\":\"W0AAA\",\"replay\":true}")" == "201" ]]; then
  ok "  but a replayed QSO is still accepted"
else
  no "  but a replayed QSO is still accepted"
fi

# ── Export: per-operator MY_* is the LoTW-correctness case ───────────────────
echo "── SES: export ──"
req POST /api/ses/operators "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W0AAA\",\"grid\":\"EN34\",\"state\":\"MN\",\"county\":\"Hennepin\"}" >/dev/null
req POST /api/ses/operators "{\"event_id\":\"$SOFT_ID\",\"op_call\":\"W1BBB\",\"grid\":\"FN31\",\"state\":\"CT\"}" >/dev/null
req POST /api/qso "{\"event_id\":\"$SOFT_ID\",\"callsign\":\"K7GGG\",\"band\":\"40m\",\"mode\":\"CW\",\"operator_call\":\"W1BBB\",\"replay\":true}" >/dev/null
ADIF=$(req GET "/api/export/$SOFT")
if [[ "$ADIF" == *"MY_GRIDSQUARE:4>EN34"* && "$ADIF" == *"MY_GRIDSQUARE:4>FN31"* ]]; then
  ok "  ADIF carries each operator's own grid"
else
  no "  ADIF carries each operator's own grid"
fi
if [[ "$(grep -c 'STATION_CALLSIGN:3>W9S' <<< "$ADIF")" -ge 2 ]]; then
  ok "  every record shares one STATION_CALLSIGN"
else
  no "  every record shares one STATION_CALLSIGN"
fi
if [[ "$ADIF" == *"ARRL_SECT:2>MN"* ]]; then
  ok "  the optional SES section is exported"
else
  no "  the optional SES section is exported"
fi
FILTERED=$(req GET "/api/export/$SOFT?op=W1BBB")
if [[ "$FILTERED" == *"FN31"* && "$FILTERED" != *"EN34"* ]]; then
  ok "  ?op= filters to one operator's contacts"
else
  no "  ?op= filters to one operator's contacts"
fi
if [[ "$(status GET "/api/export/$SOFT?format=cabrillo")" == "400" ]]; then
  ok "  Cabrillo is refused for an SES"
else
  no "  Cabrillo is refused for an SES"
fi

# ── Field Day regression ─────────────────────────────────────────────────────
echo "── Field Day regression ──"
FD=$(req POST /api/events '{"club_name":"E2E FD","club_call":"W0NY","event_type":"FD","class":"3A","arrl_section":"MN","power":"LOW"}' | jq_get join_code)
FD_ID=$(req GET "/api/events/$FD" | jq_get id)
FDQ=$(req POST /api/qso "{\"event_id\":\"$FD_ID\",\"callsign\":\"K1XYZ\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"2A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0AAA\"}")
if [[ "$(echo "$FDQ" | jq_get sent_class)" == "3A" && "$(echo "$FDQ" | jq_get rcvd_class)" == "2A" ]]; then
  ok "  the contest exchange is still stamped"
else
  no "  the contest exchange is still stamped"
fi
# Was "no SES checkout gate is applied to Field Day". Contests now share the
# coordination, so the assertion has to change — but the important half is
# preserved and sharpened: claiming is *opt-in* on a contest, so an event that
# has never claimed a slot must not warn on any QSO.
if [[ -z "$(echo "$FDQ" | jq_get slot_warning)" ]]; then
  ok "  an unclaimed contest band produces no warning"
else
  no "  an unclaimed contest band produces no warning" "$(echo "$FDQ" | jq_get slot_warning)"
fi
FDQ2=$(req POST /api/qso "{\"event_id\":\"$FD_ID\",\"callsign\":\"K1XYZ\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"2A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0AAA\"}")
if [[ "$(echo "$FDQ2" | jq_get is_dupe)" == "True" ]]; then
  ok "  dupe detection still flags a repeat"
else
  no "  dupe detection still flags a repeat"
fi
CAB=$(req GET "/api/export/$FD?format=cabrillo")
if [[ "$CAB" == *"CONTEST: ARRL-FD"* && "$CAB" == *"QSO: "* ]]; then
  ok "  Cabrillo still generates for Field Day"
else
  no "  Cabrillo still generates for Field Day"
fi
if [[ "$(req GET "/api/export/$FD")" == *"STX_STRING:5>3A MN"* ]]; then
  ok "  FD ADIF still carries the contest exchange"
else
  no "  FD ADIF still carries the contest exchange"
fi

# ── Section accounting and bonus arithmetic ──────────────────────────────────
#
# calculateScore runs server-side for the Cabrillo CLAIMED-SCORE header, so the
# whole scoring path is reachable end to end here.
#
# Sections earn nothing. ARRL Field Day rule 7.3 runs 7.3.1 to 7.3.18 and none
# of them concerns sections; this app awarded 100 points for a clean sweep for
# several releases, and this suite asserted it — a fourth copy of the same
# wrong belief, after the scorer, the summary sheet and the unit suite. What is
# asserted now is that a sweep changes nothing, and that DX is accepted without
# counting as a section.
echo "── sections are not a bonus ──"

# Build an ADIF holding one QSO per section, straight from the app's own list
# so this can never drift from it. Each is 1 point (phone), power LOW = x2.
SECTIONS=$(node -e "
const s=require('fs').readFileSync('lib/types.ts','utf8');
const b=s.match(/export const ARRL_SECTIONS = \[([\s\S]*?)\] as const;/)[1];
console.log([...b.matchAll(/'([A-Z0-9]+)'/g)].map(m=>m[1]).join(' '));
")
N_SECTIONS=$(echo "$SECTIONS" | wc -w)

adif_for() {
  # $1 = space-separated exchanges; one QSO each, unique callsign and minute.
  local i=0 out="EzFD test<EOH>\n"
  for sec in $1; do
    out="${out}<CALL:6>T${i}AAAA<BAND:3>20m<MODE:3>SSB<QSO_DATE:8>20260627<TIME_ON:6>$(printf '%06d' $((120000 + i)))<ARRL_SECT:${#sec}>${sec}<CLASS:2>1A<EOR>\n"
    i=$((i + 1))
  done
  printf '%b' "$out"
}

claimed_score() {  # $1 = join code
  req GET "/api/export/$1?format=cabrillo" | sed -n 's/^CLAIMED-SCORE: //p'
}

# (a) every real section worked → the bonus is awarded
ALL=$(req POST /api/events '{"club_name":"E2E WAS","club_call":"W0WAS","event_type":"FD","class":"1A","arrl_section":"MN","power":"LOW"}' | jq_get join_code)
ALL_ID=$(req GET "/api/events/$ALL" | jq_get id)
ADIF_ALL=$(adif_for "$SECTIONS" | python3 -c "import sys,json;print(json.dumps(sys.stdin.read()))")
req POST /api/import/adif "{\"event_id\":\"$ALL_ID\",\"adif\":$ADIF_ALL,\"operator_call\":\"W0AAA\"}" > /dev/null
FULL=$(claimed_score "$ALL")
# N QSOs x 1 pt x 2 (LOW), and nothing else — a sweep is worth no bonus.
EXPECT_FULL=$(( N_SECTIONS * 2 ))
if [[ "$FULL" == "$EXPECT_FULL" ]]; then
  ok "  working all $N_SECTIONS sections awards no bonus"
else
  no "  working all $N_SECTIONS sections awards no bonus" "got $FULL, expected $EXPECT_FULL"
fi

# (b) one section swapped for a typo → identical score, since sections are
#     worth nothing either way. The typo must still be surfaced as an
#     unrecognised exchange so an operator can find and correct it.
TYPO_LIST="$(echo "$SECTIONS" | cut -d" " -f2-) ZZZ"
TYPO=$(req POST /api/events '{"club_name":"E2E Typo","club_call":"W0TYP","event_type":"FD","class":"1A","arrl_section":"MN","power":"LOW"}' | jq_get join_code)
TYPO_ID=$(req GET "/api/events/$TYPO" | jq_get id)
ADIF_TYPO=$(adif_for "$TYPO_LIST" | python3 -c "import sys,json;print(json.dumps(sys.stdin.read()))")
req POST /api/import/adif "{\"event_id\":\"$TYPO_ID\",\"adif\":$ADIF_TYPO,\"operator_call\":\"W0AAA\"}" > /dev/null
TYPO_SCORE=$(claimed_score "$TYPO")
if [[ "$TYPO_SCORE" == "$FULL" ]]; then
  ok "  one section short scores exactly the same — sections do not move a score"
else
  no "  one section short scores exactly the same" "got $TYPO_SCORE, expected $FULL"
fi

# (c) DX is accepted and logged, but is not a section
DXE=$(req POST /api/events '{"club_name":"E2E DX","club_call":"W0DX","event_type":"FD","class":"1A","arrl_section":"MN","power":"HIGH"}' | jq_get join_code)
DX_ID=$(req GET "/api/events/$DXE" | jq_get id)
DXQ=$(req POST /api/qso "{\"event_id\":\"$DX_ID\",\"callsign\":\"G0XYZ\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"1D\",\"rcvd_section\":\"DX\",\"operator_call\":\"W0AAA\"}")
if [[ "$(echo "$DXQ" | jq_get rcvd_section)" == "DX" ]]; then
  ok "  a DX exchange is accepted and stored"
else
  no "  a DX exchange is accepted and stored"
fi
if [[ "$(req GET "/api/export/$DXE?format=cabrillo")" == *"DX"* ]]; then
  ok "  DX survives into the Cabrillo log"
else
  no "  DX survives into the Cabrillo log"
fi

# (d) emergency power pays per transmitter, over the real route.
#
# Rule 7.3.1 is 100 points per claimed transmitter, capped at 20. The app used
# to add the entire base score again, so a large log over-claimed by thousands
# — and because the class drives the transmitter count, this is only reachable
# end to end, through an event created with a real class.
echo "── emergency power is per transmitter (7.3.1) ──"

bonus_score() {  # $1 = class, $2 = bonuses JSON → CLAIMED-SCORE
  local code="" id=""
  code=$(req POST /api/events \
    "{\"club_name\":\"E2E Bonus\",\"club_call\":\"W0BON\",\"event_type\":\"FD\",\"class\":\"$1\",\"arrl_section\":\"MN\",\"power\":\"HIGH\"}" \
    | jq_get join_code)
  id=$(req GET "/api/events/$code" | jq_get id)
  req POST /api/qso "{\"event_id\":\"$id\",\"callsign\":\"K1EMG\",\"band\":\"20m\",\"mode\":\"CW\",\"rcvd_class\":\"1A\",\"rcvd_section\":\"MN\",\"operator_call\":\"W0AAA\"}" > /dev/null
  req PATCH "/api/events/$code/bonuses" "$2" > /dev/null
  claimed_score "$code"
}

# 1 CW QSO = 2 points, HIGH power x1 = 2 base.
EMG_3A=$(bonus_score "3A" '{"emergency_power":true}')
if [[ "$EMG_3A" == "302" ]]; then
  ok "  a 3A entry claims 3 x 100, not the base score again"
else
  no "  a 3A entry claims 3 x 100" "got $EMG_3A, expected 302"
fi

# Rule 7.3.1 caps the bonus at 20 transmitters / 2,000 points.
EMG_22A=$(bonus_score "22A" '{"emergency_power":true}')
if [[ "$EMG_22A" == "2002" ]]; then
  ok "  and a 22A entry is capped at 20 transmitters"
else
  no "  a 22A entry is capped at 20 transmitters" "got $EMG_22A, expected 2002"
fi

# GOTA is 5 points per contact under 7.3.13.1, uncapped, and is not multiplied.
GOTA=$(bonus_score "1A" '{"gota_qsos":40}')
if [[ "$GOTA" == "202" ]]; then
  ok "  GOTA contacts are 5 points each"
else
  no "  GOTA contacts are 5 points each" "got $GOTA, expected 202"
fi

# ── Self-service event portability ───────────────────────────────────────────
#
# Moving an event between instances used to require shell access on the server.
# These cover the round trip over HTTP: a full-event backup out, and an import
# that recreates it as a new event with a fresh join code.
echo "── event export / import ──"

# No QRZ credentials here: storing them needs EZFD_ENCRYPTION_KEY, which CI
# doesn't set. The leak case with a real encrypted secret is covered in
# scripts/test-restore.sh, which inserts one directly and greps the export
# for it. What this asserts is the structural guarantee — the export names
# its columns explicitly and no qrz_ field appears at all.
PORT_EV=$(req POST /api/events '{"club_name":"Portable","club_call":"W0PRT","event_type":"SES","slot_enforcement":"SOFT","arrl_section":"MN"}' | jq_get join_code)
PORT_ID=$(req GET "/api/events/$PORT_EV" | jq_get id)
req POST /api/ses/operators "{\"event_id\":\"$PORT_ID\",\"op_call\":\"W0AAA\",\"grid\":\"EN34\",\"state\":\"MN\"}" > /dev/null
req POST /api/qso "{\"event_id\":\"$PORT_ID\",\"callsign\":\"K1POR\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0AAA\"}" > /dev/null

EXPORT_JSON=$(req GET "/api/export/$PORT_EV?format=json")
if [[ "$(status GET "/api/export/$PORT_EV?format=json")" == "200" ]]; then
  ok "  a full-event JSON export downloads"
else
  no "  a full-event JSON export downloads"
fi
if [[ "$EXPORT_JSON" == *"ses_operators"* && "$EXPORT_JSON" == *"W0AAA"* ]]; then
  ok "  it carries the SES roster"
else
  no "  it carries the SES roster"
fi
# The password is encrypted with a key the backup doesn't contain, and this
# endpoint is reachable over HTTP with only a join code.
if [[ "$EXPORT_JSON" == *"qrz"* ]]; then
  no "  it carries no QRZ fields at all" "$(echo "$EXPORT_JSON" | grep -oi 'qrz[a-z_]*' | sort -u | tr '\n' ' ')"
else
  ok "  it carries no QRZ fields at all"
fi

IMPORTED=$(req POST /api/import/event "{\"payload\":$EXPORT_JSON}")
NEW_CODE=$(echo "$IMPORTED" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('imported') or [{}])[0].get('new_code',''))" 2>/dev/null)
if [[ -n "$NEW_CODE" && "$NEW_CODE" != "$PORT_EV" ]]; then
  ok "  importing it creates a new event with a fresh join code"
else
  no "  importing it creates a new event with a fresh join code" "got '$NEW_CODE'"
fi
IMPORTED_EV=$(req GET "/api/events/$NEW_CODE")
if [[ "$(echo "$IMPORTED_EV" | jq_get club_call)" == "W0PRT" ]]; then
  ok "  the restored event keeps its settings"
else
  no "  the restored event keeps its settings"
fi
if [[ "$(req GET "/api/export/$NEW_CODE")" == *"K1POR"* ]]; then
  ok "  and its QSOs"
else
  no "  and its QSOs"
fi
if [[ "$(req GET "/api/export/$NEW_CODE")" == *"EN34"* ]]; then
  ok "  and the roster that feeds the ADIF MY_* fields"
else
  no "  and the roster that feeds the ADIF MY_* fields"
fi

# Importing must never damage what is already there.
if [[ "$(status GET "/api/events/$PORT_EV")" == "200" ]]; then
  ok "  the original event is untouched by the import"
else
  no "  the original event is untouched by the import"
fi

if [[ "$(status POST /api/import/event '{"payload":"not-an-event"}')" == "400" ]]; then
  ok "  a payload that is not an event is refused"
else
  no "  a payload that is not an event is refused"
fi
if [[ "$(status POST /api/import/event '{}')" == "400" ]]; then
  ok "  a missing payload is refused"
else
  no "  a missing payload is refused"
fi

# ── Per-station coordination for contests ────────────────────────────────────
#
# Field Day has the same one-signal-per-band-per-mode rule as a special event,
# and a multi-transmitter club has the same coordination problem — but the
# holder is the station, not the operator, and enforcement stays soft because
# refusing a contact that already happened is worse than a warning.
echo "── contest station coordination ──"

STN=$(req POST /api/events '{"club_name":"Stations","club_call":"W0STN","event_type":"FD","class":"3A","arrl_section":"MN","power":"LOW"}' | jq_get join_code)
STN_ID=$(req GET "/api/events/$STN" | jq_get id)

CLAIM=$(req POST /api/ses/reservations "{\"event_id\":\"$STN_ID\",\"op_call\":\"W0AAA\",\"band\":\"20m\",\"mode\":\"PH\",\"station_number\":1}")
if [[ "$(echo "$CLAIM" | jq_get station_number)" == "1" ]]; then
  ok "  a contest event can claim a band for a station"
else
  no "  a contest event can claim a band for a station" "$CLAIM"
fi

# The one-signal-per-band-per-mode rule holds across stations: station 2 must
# not be able to take 20m PH while station 1 has it. Adding station to the
# exclusion constraint would have allowed exactly that.
if [[ "$(status POST /api/ses/reservations "{\"event_id\":\"$STN_ID\",\"op_call\":\"W0BBB\",\"band\":\"20m\",\"mode\":\"PH\",\"station_number\":2}")" == "409" ]]; then
  ok "  a second station cannot take the same band and mode"
else
  no "  a second station cannot take the same band and mode"
fi
if [[ "$(status POST /api/ses/reservations "{\"event_id\":\"$STN_ID\",\"op_call\":\"W0BBB\",\"band\":\"40m\",\"mode\":\"CW\",\"station_number\":2}")" == "201" ]]; then
  ok "  but it can take a different one"
else
  no "  but it can take a different one"
fi

# Logging from the station that holds the slot is clean...
S1=$(req POST /api/qso "{\"event_id\":\"$STN_ID\",\"callsign\":\"K1STN\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"1A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0AAA\",\"station_number\":1}")
if [[ -z "$(echo "$S1" | jq_get slot_warning)" ]]; then
  ok "  the holding station logs without a warning"
else
  no "  the holding station logs without a warning" "$(echo "$S1" | jq_get slot_warning)"
fi

# ...and from a different station it warns, naming the station rather than a
# person, since operators rotate through stations and the claim doesn't.
S2=$(req POST /api/qso "{\"event_id\":\"$STN_ID\",\"callsign\":\"K2STN\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"1A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0BBB\",\"station_number\":2}")
WARN2=$(echo "$S2" | jq_get slot_warning)
if [[ "$WARN2" == *"Station 1"* ]]; then
  ok "  another station is warned, and the holder is named as a station"
else
  no "  another station is warned, and the holder is named as a station" "$WARN2"
fi
if [[ -n "$(echo "$S2" | jq_get id)" ]]; then
  ok "  and the QSO is still logged — enforcement is soft on a contest"
else
  no "  and the QSO is still logged — enforcement is soft on a contest"
fi

# A different operator at the holding station inherits the claim: the slot
# belongs to the station, and people rotate through it.
S3=$(req POST /api/qso "{\"event_id\":\"$STN_ID\",\"callsign\":\"K3STN\",\"band\":\"20m\",\"mode\":\"PH\",\"rcvd_class\":\"1A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0CCC\",\"station_number\":1}")
if [[ -z "$(echo "$S3" | jq_get slot_warning)" ]]; then
  ok "  a new operator at the holding station inherits the claim"
else
  no "  a new operator at the holding station inherits the claim" "$(echo "$S3" | jq_get slot_warning)"
fi

# The claim survives a backup round trip.
if [[ "$(req GET "/api/export/$STN?format=json")" == *"station_number"* ]]; then
  ok "  station claims survive into the full-event backup"
else
  no "  station claims survive into the full-event backup"
fi

# ── The in-app documentation ─────────────────────────────────────────────────
#
# The guides are read from docs/ at request time, which only works because
# next.config.ts names them in outputFileTracingIncludes — file tracing can
# follow a static path but not a filename built from a URL slug. This suite
# runs against the standalone bundle, so it is the thing that would notice the
# guides silently not shipping.
echo "── documentation ──"

if [[ "$(status GET /docs)" == "200" ]]; then
  ok "  the documentation index renders"
else
  no "  the documentation index renders"
fi

DOC=$(req GET /docs/operating)
if [[ "$DOC" == *"Working offline"* ]]; then
  ok "  a guide renders from the shipped markdown"
else
  no "  a guide renders from the shipped markdown"
fi

# Cross-links are written for GitHub as `field-day.md#scoring`; both halves are
# rewritten, and headings carry GitHub's slug so the anchor still lands.
if [[ "$DOC" == *'href="/docs/'* && "$DOC" != *'.md"'* ]]; then
  ok "  cross-links are rewritten for the app"
else
  no "  cross-links are rewritten for the app"
fi
if [[ "$(req GET /docs/deployment)" == *'id="offline-field-servers"'* ]]; then
  ok "  headings carry anchors, so a #link lands on its section"
else
  no "  headings carry anchors, so a #link lands on its section"
fi

# An apostrophe reaches the slugifier as `&#39;`, not as a character. Stripping
# only named entities left "39" sitting in the id, so every heading with an
# apostrophe got an id GitHub would never generate and every cross-link to one
# quietly landed at the top of the page. The old check used a heading with no
# punctuation in it and so never saw this.
# The index is docs/README.md on GitHub but is served at /docs, so a guide
# linking its own index must be rewritten to /docs and not to /docs/README,
# which is not a page. The changelog links it twice.
if [[ "$(req GET /docs/changelog)" != *'href="/docs/README'* ]]; then
  ok "  a link to the docs index points at /docs, not /docs/README"
else
  no "  a link to the docs index points at /docs, not /docs/README"
fi

# The sidebar is built by reading the groups back out of the index, so a guide
# can fall out of the navigation while still existing on disk. The unit suite
# asserts the shape; this asserts the server actually renders it.
DOC_PAGE=$(req GET /docs/operating)
if [[ "$DOC_PAGE" == *'aria-label="Documentation"'* ]] \
   && [[ "$DOC_PAGE" == *'href="/docs/changelog"'* ]] \
   && [[ "$DOC_PAGE" == *'I want to run an event'* ]]; then
  ok "  the sidebar renders, grouped, with the changelog in it"
else
  no "  the sidebar renders, grouped, with the changelog in it"
fi

# Previous/next follow the index's order. The quick start is first, so it has a
# next and no previous — the pair that proves the ends are handled.
if [[ "$DOC_PAGE" == *'aria-label="More guides"'* ]]; then
  ok "  a guide offers previous/next links"
else
  no "  a guide offers previous/next links"
fi

QS_DOC=$(req GET /docs/quick-start)
if [[ "$QS_DOC" == *'id="pick-where-youre-operating"'* ]]; then
  ok "  an apostrophe in a heading slugs the way GitHub slugs it"
else
  no "  an apostrophe in a heading slugs the way GitHub slugs it" "got: $(printf '%s' "$QS_DOC" | grep -o 'id=\"pick[^\"]*\"' | head -1)"
fi

if [[ "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/docs/images/dashboard.png")" == "image/png" ]]; then
  ok "  screenshots referenced by the guides are served"
else
  no "  screenshots referenced by the guides are served"
fi

# The quick start is the front door for anyone who isn't running the server,
# so it gets its own assertion rather than relying on the index listing it.
QS=$(req GET /docs/quick-start)
if [[ "$QS" == *"For operators"* && "$QS" == *"join code"* ]]; then
  ok "  the operator quick start renders"
else
  no "  the operator quick start renders"
fi
# Matched on the index's own wording rather than an href: the sidebar links
# every guide that exists, so an href match would pass even with the row gone.
INDEX=$(req GET /docs)
if [[ "$INDEX" == *"Nothing to install, nothing to administer"* ]]; then
  ok "  the quick start is listed on the docs index"
else
  no "  the quick start is listed on the docs index"
fi

# The checkout board screenshot is referenced from the special event guide.
if [[ "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/docs/images/checkout-board.png")" == "image/png" ]]; then
  ok "  the checkout board screenshot is served"
else
  no "  the checkout board screenshot is served"
fi

# The log view screenshot is referenced from the operating guide.
if [[ "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/docs/images/log-view.png")" == "image/png" ]]; then
  ok "  the log view screenshot is served"
else
  no "  the log view screenshot is served"
fi

# The operating position screenshot is referenced from the quick start.
if [[ "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/docs/images/operating-position.png")" == "image/png" ]]; then
  ok "  the operating position screenshot is served"
else
  no "  the operating position screenshot is served"
fi

# The slug reaches the filesystem, so it must not be able to leave docs/.
if [[ "$(status GET "/docs/images/..%2f..%2fpackage.json")" == "404" ]]; then
  ok "  a traversal attempt on the docs images is refused"
else
  no "  a traversal attempt on the docs images is refused"
fi

# ── One operator, two radios ─────────────────────────────────────────────────
#
# A single operator running two rigs is one callsign in two logging windows,
# each on its own band. Presence is keyed per radio so both stay visible, and
# going QRT on one leaves the other on the air. Keyed on the operator alone,
# the second window overwrote the first and QRT cleared both.
echo "── two radios, one operator ──"

RAD=$(req POST /api/events '{"club_name":"Two Radio","club_call":"W0RAD","event_type":"SES","slot_enforcement":"SOFT","arrl_section":"MN"}' | jq_get join_code)
RAD_ID=$(req GET "/api/events/$RAD" | jq_get id)

req POST /api/presence "{\"event_id\":\"$RAD_ID\",\"op_call\":\"W0AAA\",\"station\":1,\"band\":\"20m\",\"mode\":\"PH\"}" > /dev/null
req POST /api/presence "{\"event_id\":\"$RAD_ID\",\"op_call\":\"W0AAA\",\"station\":2,\"band\":\"40m\",\"mode\":\"CW\"}" > /dev/null
PRES=$(req GET "/api/presence?event_id=$RAD_ID")
if [[ "$(echo "$PRES" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')" == "2" ]]; then
  ok "  both of an operator's radios appear in presence"
else
  no "  both of an operator's radios appear in presence" "$PRES"
fi

# QRT is per radio. Shutting down station 2 must leave station 1 transmitting.
req DELETE /api/presence "{\"event_id\":\"$RAD_ID\",\"op_call\":\"W0AAA\",\"station\":2}" > /dev/null
PRES=$(req GET "/api/presence?event_id=$RAD_ID")
LEFT_N=$(echo "$PRES" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
LEFT_STN=$(echo "$PRES" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["station"] if d else "")')
if [[ "$LEFT_N" == "1" && "$LEFT_STN" == "1" ]]; then
  ok "  going QRT on one radio leaves the other on the air"
else
  no "  going QRT on one radio leaves the other on the air" "$PRES"
fi

# A special event claim records which radio took it, so two windows for one
# operator can be told apart — without it, leaving a band in one window
# released the slot the other was transmitting on.
R1=$(req POST /api/ses/reservations "{\"event_id\":\"$RAD_ID\",\"op_call\":\"W0AAA\",\"band\":\"20m\",\"mode\":\"PH\",\"station_number\":1}")
R2=$(req POST /api/ses/reservations "{\"event_id\":\"$RAD_ID\",\"op_call\":\"W0AAA\",\"band\":\"40m\",\"mode\":\"CW\",\"station_number\":2}")
if [[ "$(echo "$R1" | jq_get station_number)" == "1" && "$(echo "$R2" | jq_get station_number)" == "2" ]]; then
  ok "  a special event claim records which radio holds it"
else
  no "  a special event claim records which radio holds it" "$R1 / $R2"
fi

# ...but the holder still reads as the operator on a special event: the person
# holds the club call, whichever of their radios took the slot.
CONFLICT=$(req POST /api/ses/reservations "{\"event_id\":\"$RAD_ID\",\"op_call\":\"W0BBB\",\"band\":\"20m\",\"mode\":\"PH\",\"station_number\":1}")
if [[ "$CONFLICT" == *"W0AAA"* && "$CONFLICT" != *"Station 1"* ]]; then
  ok "  a special event holder is still named by callsign, not station"
else
  no "  a special event holder is still named by callsign, not station" "$CONFLICT"
fi

# ── QSO audit trail and soft delete ──────────────────────────────────────────
#
# There is no authentication here — anyone with the join code can edit or
# delete any contact — so the log needs to be able to answer "what happened to
# that QSO?". The risk in soft delete is a read path that forgets the filter,
# which is how a deleted contact reappears in a submission.
echo "── audit trail ──"

AUD=$(req POST /api/events '{"club_name":"Audit","club_call":"W0AUD","event_type":"FD","class":"1A","arrl_section":"MN","power":"LOW"}' | jq_get join_code)
AUD_ID=$(req GET "/api/events/$AUD" | jq_get id)
AQ1=$(req POST /api/qso "{\"event_id\":\"$AUD_ID\",\"callsign\":\"K1KEEP\",\"band\":\"20m\",\"mode\":\"CW\",\"rcvd_class\":\"1A\",\"rcvd_section\":\"EPA\",\"operator_call\":\"W0AAA\"}" | jq_get id)
AQ2=$(req POST /api/qso "{\"event_id\":\"$AUD_ID\",\"callsign\":\"K2GONE\",\"band\":\"40m\",\"mode\":\"CW\",\"rcvd_class\":\"1A\",\"rcvd_section\":\"MDC\",\"operator_call\":\"W0AAA\"}" | jq_get id)

# An edit stamps who claimed to make it.
req PATCH "/api/qso/$AQ1" '{"callsign":"K1KEPT","band":"20m","mode":"CW","rcvd_class":"1A","rcvd_section":"EPA","operator_call":"W0BBB"}' > /dev/null
EDITED=$(req GET "/api/qso?event_id=$AUD_ID")
if [[ "$EDITED" == *"W0BBB"* && "$EDITED" == *"K1KEPT"* ]]; then
  ok "  an edit records updated_by"
else
  no "  an edit records updated_by"
fi

# Delete, then confirm it is gone from every live view.
req DELETE "/api/qso/$AQ2?operator_call=W0CCC" > /dev/null
LIVE=$(req GET "/api/qso?event_id=$AUD_ID")
if [[ "$LIVE" != *"K2GONE"* ]]; then
  ok "  a deleted contact leaves the live log"
else
  no "  a deleted contact leaves the live log"
fi
if [[ "$(req GET "/api/export/$AUD")" != *"K2GONE"* ]]; then
  ok "  and the ADIF export"
else
  no "  and the ADIF export — a deleted contact would be submitted"
fi
if [[ "$(req GET "/api/export/$AUD?format=cabrillo")" != *"K2GONE"* ]]; then
  ok "  and the Cabrillo submission"
else
  no "  and the Cabrillo submission — a deleted contact would be submitted"
fi
# 2 CW QSOs = 4 pts x2 (LOW) = 8; with one deleted it must be 4.
CLAIMED=$(req GET "/api/export/$AUD?format=cabrillo" | sed -n 's/^CLAIMED-SCORE: //p')
if [[ "$CLAIMED" == "4" ]]; then
  ok "  and the score"
else
  no "  and the score" "CLAIMED-SCORE=$CLAIMED, expected 4"
fi

# But the full-event backup keeps it — an audit trail a backup drops is none.
BACKUP=$(req GET "/api/export/$AUD?format=json")
if [[ "$BACKUP" == *"K2GONE"* && "$BACKUP" == *"W0CCC"* ]]; then
  ok "  the backup keeps it, with who deleted it"
else
  no "  the backup keeps it, with who deleted it"
fi

# The recovery path a hard delete never had.
DELETED_LIST=$(req GET "/api/qso?event_id=$AUD_ID&deleted=1")
if [[ "$DELETED_LIST" == *"K2GONE"* && "$DELETED_LIST" != *"K1KEPT"* ]]; then
  ok "  the deleted list shows it and nothing else"
else
  no "  the deleted list shows it and nothing else"
fi
req POST "/api/qso/$AQ2" '{"operator_call":"W0DDD"}' > /dev/null
if [[ "$(req GET "/api/qso?event_id=$AUD_ID")" == *"K2GONE"* ]]; then
  ok "  restoring puts it back in the live log"
else
  no "  restoring puts it back in the live log"
fi
if [[ "$(req GET "/api/qso?event_id=$AUD_ID&deleted=1")" != *"K2GONE"* ]]; then
  ok "  and out of the deleted list"
else
  no "  and out of the deleted list"
fi

# A deleted contact must not block re-logging the same station: it is not in
# the log any more, so it cannot be what makes a new contact a dupe.
req DELETE "/api/qso/$AQ2" > /dev/null
REDUPE=$(req POST /api/qso "{\"event_id\":\"$AUD_ID\",\"callsign\":\"K2GONE\",\"band\":\"40m\",\"mode\":\"CW\",\"rcvd_class\":\"1A\",\"rcvd_section\":\"MDC\",\"operator_call\":\"W0AAA\"}")
if [[ "$(echo "$REDUPE" | jq_get is_dupe)" == "False" ]]; then
  ok "  a deleted contact does not make a re-log a dupe"
else
  no "  a deleted contact does not make a re-log a dupe"
fi

# Deleting twice is not an error — two operators can press it at once.
if [[ "$(status DELETE "/api/qso/$AQ2")" == "200" ]]; then
  ok "  deleting an already-deleted contact is not an error"
else
  no "  deleting an already-deleted contact is not an error"
fi

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
if [[ "$(status GET /api/time)" == "200" ]]; then
  ok "  /api/time responds"
else
  no "  /api/time responds"
fi
if [[ "$APP_TIME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
  ok "  it reports the app clock as an ISO timestamp"
else
  no "  it reports the app clock as an ISO timestamp" "$APP_TIME"
fi
if [[ "$DB_TIME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
  ok "  it reports the database clock too"
else
  no "  it reports the database clock too" "$DB_TIME"
fi
# Both clocks are read within one request, so any real gap between them means
# the app and the database are on hosts whose clocks disagree.
SKEW=$(python3 -c "
import sys
from datetime import datetime
a = datetime.fromisoformat('$APP_TIME'.replace('Z','+00:00'))
d = datetime.fromisoformat('$DB_TIME'.replace('Z','+00:00'))
print(int(abs((a-d).total_seconds())))
" 2>/dev/null)
if [[ -n "$SKEW" && "$SKEW" -lt 60 ]]; then
  ok "  the app and database clocks agree"
else
  no "  the app and database clocks agree" "${SKEW:-unparseable}s apart"
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "All end-to-end tests passed."
  exit 0
fi
echo "$FAILURES failure(s)."
exit 1
