#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EzFD — Admin inspection script
# Run on the server as root or the ezfd user:
#   sudo bash ezfd-admin.sh
#   sudo bash ezfd-admin.sh --event ABC123
#   sudo bash ezfd-admin.sh --json
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

hr()    { echo -e "${DIM}────────────────────────────────────────────────────────────────${NC}"; }
hr2()   { echo -e "${BOLD}════════════════════════════════════════════════════════════════${NC}"; }
label() { printf "${BOLD}%-22s${NC}" "$1"; }

# ── Args ─────────────────────────────────────────────────────────────────────
FILTER_CODE=""
JSON_MODE=false
for arg in "$@"; do
  case "$arg" in
    --event)  shift; FILTER_CODE="${1:-}" ;;
    --json)   JSON_MODE=true ;;
    --help|-h)
      echo "Usage: sudo bash ezfd-admin.sh [--event JOIN_CODE] [--json]"
      echo "  (no args)         — list all events with stats"
      echo "  --event ABC123    — show full detail for one event"
      echo "  --json            — dump all data as JSON (for backups/recovery)"
      exit 0 ;;
  esac
done

# ── Database helper ───────────────────────────────────────────────────────────
DB="ezfd"
PG() { sudo -u postgres psql -d "$DB" -tAX "$@"; }
PG_TABLE() { sudo -u postgres psql -d "$DB" "$@"; }

# Verify DB is accessible
if ! PG -c "SELECT 1" &>/dev/null; then
  echo -e "${RED}[✗] Cannot connect to the ezfd database. Is PostgreSQL running?${NC}" >&2
  echo -e "    Try: systemctl start postgresql" >&2
  exit 1
fi

# ── JSON dump mode ────────────────────────────────────────────────────────────
if [[ "$JSON_MODE" == "true" ]]; then
  PG -c "
    SELECT json_agg(row_to_json(t)) FROM (
      SELECT
        e.id, e.join_code, e.club_name, e.club_call, e.event_year,
        e.class, e.arrl_section, e.event_type, e.power, e.location,
        e.bonuses, e.created_at,
        (SELECT COUNT(*) FROM qsos q WHERE q.event_id = e.id AND NOT q.is_dupe) AS qso_count,
        (SELECT COUNT(*) FROM qsos q WHERE q.event_id = e.id AND     q.is_dupe) AS dupe_count,
        (SELECT json_agg(DISTINCT q.operator_call ORDER BY q.operator_call)
           FROM qsos q WHERE q.event_id = e.id AND q.operator_call IS NOT NULL
        ) AS operators,
        (SELECT json_agg(row_to_json(q) ORDER BY q.datetime_utc)
           FROM qsos q WHERE q.event_id = e.id
        ) AS qsos
      FROM events e
      ORDER BY e.created_at
    ) t;
  "
  exit 0
fi

# ── Fetch event list ──────────────────────────────────────────────────────────
EVENTS=$(PG -c "
  SELECT
    e.join_code,
    e.club_name,
    e.club_call,
    e.event_year,
    e.class,
    e.arrl_section,
    e.event_type,
    e.power,
    e.location,
    e.created_at::date,
    COUNT(q.id) FILTER (WHERE NOT q.is_dupe)  AS qsos,
    COUNT(q.id) FILTER (WHERE     q.is_dupe)  AS dupes,
    COUNT(DISTINCT q.operator_call) FILTER (WHERE q.operator_call IS NOT NULL) AS ops,
    COUNT(DISTINCT q.band || '/' || q.mode)   AS band_modes
  FROM events e
  LEFT JOIN qsos q ON q.event_id = e.id
  $([ -n "$FILTER_CODE" ] && echo "WHERE UPPER(e.join_code) = UPPER('$FILTER_CODE')")
  GROUP BY e.id
  ORDER BY e.created_at DESC;
" 2>/dev/null)

if [[ -z "$EVENTS" ]]; then
  echo -e "\n${YELLOW}No events found.${NC}\n"
  exit 0
fi

# ── Banner ────────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${GREEN}  EzFD Admin Console${NC}"
echo -e "  $(date '+%Y-%m-%d %H:%M:%S UTC' --utc 2>/dev/null || date -u '+%Y-%m-%d %H:%M:%S UTC')"
hr2

# ── Event listing ─────────────────────────────────────────────────────────────
while IFS='|' read -r join_code club_name club_call year class section etype power location created qsos dupes ops band_modes; do
  echo
  echo -e "  ${BOLD}${CYAN}${join_code}${NC}  ${BOLD}${club_name}${NC} ${DIM}(${club_call})${NC}"
  hr

  printf "  "; label "Type / Power:";  echo -e "${etype}  ·  ${power}"
  printf "  "; label "Class / Section:"; echo "${class}  ·  ${section}"
  printf "  "; label "Year:";           echo "${year}"
  [[ -n "$location" && "$location" != "" ]] && { printf "  "; label "Location:"; echo "$location"; }
  printf "  "; label "Created:";        echo "${created}"

  echo
  printf "  "; label "QSOs (non-dupe):"; echo -e "${GREEN}${qsos}${NC}"
  printf "  "; label "Dupes:";           echo -e "${YELLOW}${dupes}${NC}"
  printf "  "; label "Operators:";       echo "${ops}"
  printf "  "; label "Band/Mode combos:"; echo "${band_modes}"

  # Per-band/mode breakdown
  BAND_ROWS=$(PG -c "
    SELECT band, mode, COUNT(*) AS n
    FROM qsos
    WHERE event_id = (SELECT id FROM events WHERE UPPER(join_code) = UPPER('${join_code}'))
      AND NOT is_dupe
    GROUP BY band, mode
    ORDER BY n DESC;
  " 2>/dev/null || true)
  if [[ -n "$BAND_ROWS" ]]; then
    echo
    echo -e "  ${BOLD}Band breakdown:${NC}"
    while IFS='|' read -r band mode count; do
      printf "    %-8s %-4s  %s QSOs\n" "$band" "$mode" "$count"
    done <<< "$BAND_ROWS"
  fi

  # Operator list with QSO counts
  OP_ROWS=$(PG -c "
    SELECT operator_call, COUNT(*) AS n
    FROM qsos
    WHERE event_id = (SELECT id FROM events WHERE UPPER(join_code) = UPPER('${join_code}'))
      AND operator_call IS NOT NULL
      AND NOT is_dupe
    GROUP BY operator_call
    ORDER BY n DESC;
  " 2>/dev/null || true)
  if [[ -n "$OP_ROWS" ]]; then
    echo
    echo -e "  ${BOLD}Operators:${NC}"
    while IFS='|' read -r op count; do
      printf "    %-12s  %s QSOs\n" "$op" "$count"
    done <<< "$OP_ROWS"
  fi

  # Sections worked (only shown in --event detail mode)
  if [[ -n "$FILTER_CODE" ]]; then
    SECTION_ROWS=$(PG -c "
      SELECT DISTINCT rcvd_section
      FROM qsos
      WHERE event_id = (SELECT id FROM events WHERE UPPER(join_code) = UPPER('${join_code}'))
        AND rcvd_section IS NOT NULL AND rcvd_section != ''
        AND NOT is_dupe
      ORDER BY rcvd_section;
    " 2>/dev/null || true)
    if [[ -n "$SECTION_ROWS" ]]; then
      SECTION_LIST=$(echo "$SECTION_ROWS" | tr '\n' ' ')
      echo
      echo -e "  ${BOLD}Sections worked:${NC}"
      echo "    $SECTION_LIST"
    fi

    # Recovery info: event UUID and full config
    UUID=$(PG -c "SELECT id FROM events WHERE UPPER(join_code) = UPPER('${join_code}');" 2>/dev/null)
    echo
    echo -e "  ${BOLD}Recovery info:${NC}"
    printf "  "; label "Event UUID:"; echo "${UUID}"
    echo -e "  ${DIM}To export QSOs:${NC}"
    echo -e "    ${DIM}sudo -u postgres psql -d ezfd -c \"\\COPY (SELECT * FROM qsos WHERE event_id='${UUID}') TO '/tmp/qsos_${join_code}.csv' CSV HEADER\"${NC}"
  fi

done <<< "$EVENTS"

echo
hr2

# ── Totals ────────────────────────────────────────────────────────────────────
TOTALS=$(PG -c "
  SELECT
    COUNT(DISTINCT e.id)                                          AS events,
    COUNT(q.id) FILTER (WHERE NOT q.is_dupe)                     AS total_qsos,
    COUNT(DISTINCT q.operator_call) FILTER (WHERE q.operator_call IS NOT NULL) AS total_ops
  FROM events e
  LEFT JOIN qsos q ON q.event_id = e.id;
" 2>/dev/null)
IFS='|' read -r tot_events tot_qsos tot_ops <<< "$TOTALS"

echo
echo -e "  ${BOLD}Totals across all events:${NC}  ${tot_events} events  ·  ${tot_qsos} QSOs  ·  ${tot_ops} unique operators"
echo
