#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EzFD — Interactive admin console
#
# Usage:
#   sudo bash ezfd-admin.sh            interactive menu
#   sudo bash ezfd-admin.sh --json     dump all data as JSON (stdout, pipeable)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
IFS=$'\n\t'

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

hr()    { echo -e "${DIM}────────────────────────────────────────────────────────────────${NC}"; }
hr2()   { echo -e "${BOLD}════════════════════════════════════════════════════════════════${NC}"; }
label() { printf "  ${BOLD}%-22s${NC}" "$1"; }
log()   { echo -e "  ${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "  ${YELLOW}[!]${NC} $*"; }
err()   { echo -e "  ${RED}[✗]${NC} $*" >&2; }
pause() { read -rp "$(echo -e "\n  ${DIM}Press Enter to continue…${NC}")" _; }

# ── Database ──────────────────────────────────────────────────────────────────
DB="ezfd"
PG()  { sudo -u postgres psql -d "$DB" -tAX "$@"; }

if ! PG -c "SELECT 1" &>/dev/null; then
  err "Cannot connect to the ezfd database. Is PostgreSQL running?"
  echo -e "    Try: systemctl start postgresql" >&2
  exit 1
fi

# ── JSON mode (non-interactive, pipeable) ─────────────────────────────────────
if [[ "${1:-}" == "--json" ]]; then
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
      FROM events e ORDER BY e.created_at
    ) t;"
  exit 0
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
banner() {
  clear
  echo
  echo -e "${BOLD}${GREEN}  EzFD Admin Console${NC}  ${DIM}$(date -u '+%Y-%m-%d %H:%M UTC')${NC}"
  hr2
  echo
}

# Print a numbered menu and read a choice.
# Usage: menu_pick RESULT_VAR "Option 1" "Option 2" ...
menu_pick() {
  local _var="$1"; shift
  local i=1
  for opt in "$@"; do
    printf "  ${BOLD}%2d)${NC}  %s\n" "$i" "$opt"
    ((i++))
  done
  echo
  local _input=""
  while true; do
    read -rp "$(echo -e "  ${BOLD}Choice [1-$(($#))]:${NC} ")" _input
    if [[ "$_input" =~ ^[0-9]+$ ]] && (( _input >= 1 && _input <= $# )); then
      printf -v "$_var" '%s' "$_input"
      return
    fi
    warn "Enter a number between 1 and $#"
  done
}

confirm_danger() {
  # Returns 0 (true) if user typed YES, 1 otherwise
  local msg="${1:-Are you sure?}"
  echo -e "\n  ${RED}${BOLD}⚠  ${msg}${NC}"
  echo -e "  ${DIM}Type YES (all caps) to confirm, anything else to cancel.${NC}"
  local ans
  read -rp "  > " ans
  [[ "$ans" == "YES" ]]
}

# ── Fetch event list (returns pipe-delimited rows) ────────────────────────────
fetch_events() {
  PG -c "
    SELECT
      e.join_code, e.club_name, e.club_call, e.event_year,
      e.class, e.arrl_section, e.event_type, e.power,
      COALESCE(e.location,''),
      e.created_at::date,
      COUNT(q.id) FILTER (WHERE NOT q.is_dupe)  AS qsos,
      COUNT(q.id) FILTER (WHERE     q.is_dupe)  AS dupes,
      COUNT(DISTINCT q.operator_call) FILTER (WHERE q.operator_call IS NOT NULL) AS ops
    FROM events e
    LEFT JOIN qsos q ON q.event_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC;" 2>/dev/null
}

event_uuid() {
  PG -c "SELECT id FROM events WHERE UPPER(join_code)=UPPER('$1');" 2>/dev/null
}

# ─────────────────────────────────────────────────────────────────────────────
# Event detail view
# ─────────────────────────────────────────────────────────────────────────────
view_event() {
  local code="$1"
  banner
  local uuid; uuid=$(event_uuid "$code")
  if [[ -z "$uuid" ]]; then
    err "Event $code not found."; pause; return
  fi

  # Header row
  local row; row=$(PG -c "
    SELECT club_name, club_call, event_year, class, arrl_section,
           event_type, power, COALESCE(location,''), created_at::date
    FROM events WHERE id='$uuid';" 2>/dev/null)
  IFS='|' read -r club_name club_call year class section etype power location created <<< "$row"

  echo -e "  ${BOLD}${CYAN}${code}${NC}  ${BOLD}${club_name}${NC} ${DIM}(${club_call})${NC}"
  hr
  label "Type / Power:";   echo "${etype}  ·  ${power}"
  label "Class / Section:"; echo "${class}  ·  ${section}"
  label "Year / Created:"; echo "${year}  ·  ${created}"
  [[ -n "$location" ]] && { label "Location:"; echo "$location"; }
  label "Event UUID:";     echo "${DIM}${uuid}${NC}"
  echo

  # Stats
  local stats; stats=$(PG -c "
    SELECT
      COUNT(*) FILTER (WHERE NOT is_dupe) AS qsos,
      COUNT(*) FILTER (WHERE     is_dupe) AS dupes,
      COUNT(DISTINCT operator_call) FILTER (WHERE operator_call IS NOT NULL) AS ops,
      COUNT(DISTINCT rcvd_section)  FILTER (WHERE rcvd_section IS NOT NULL AND rcvd_section != '' AND NOT is_dupe) AS sections
    FROM qsos WHERE event_id='$uuid';" 2>/dev/null)
  IFS='|' read -r qsos dupes ops sections <<< "$stats"

  label "QSOs (non-dupe):"; echo -e "${GREEN}${qsos}${NC}"
  label "Dupes:";            echo -e "${YELLOW}${dupes}${NC}"
  label "Operators:";        echo "${ops}"
  label "Sections worked:";  echo "${sections}"
  echo

  # Band/mode breakdown
  local band_rows; band_rows=$(PG -c "
    SELECT band, mode, COUNT(*) AS n FROM qsos
    WHERE event_id='$uuid' AND NOT is_dupe
    GROUP BY band, mode ORDER BY n DESC;" 2>/dev/null || true)
  if [[ -n "$band_rows" ]]; then
    echo -e "  ${BOLD}Band breakdown:${NC}"
    while IFS='|' read -r band mode count; do
      printf "    %-8s %-4s  %s QSOs\n" "$band" "$mode" "$count"
    done <<< "$band_rows"
    echo
  fi

  # Operators
  local op_rows; op_rows=$(PG -c "
    SELECT operator_call, COUNT(*) AS n FROM qsos
    WHERE event_id='$uuid' AND operator_call IS NOT NULL AND NOT is_dupe
    GROUP BY operator_call ORDER BY n DESC;" 2>/dev/null || true)
  if [[ -n "$op_rows" ]]; then
    echo -e "  ${BOLD}Operators:${NC}"
    while IFS='|' read -r op count; do
      printf "    %-12s  %s QSOs\n" "$op" "$count"
    done <<< "$op_rows"
    echo
  fi

  # Sections
  local sec_list; sec_list=$(PG -c "
    SELECT DISTINCT rcvd_section FROM qsos
    WHERE event_id='$uuid' AND rcvd_section IS NOT NULL AND rcvd_section != '' AND NOT is_dupe
    ORDER BY rcvd_section;" 2>/dev/null | tr '\n' ' ' || true)
  if [[ -n "$sec_list" ]]; then
    echo -e "  ${BOLD}Sections worked:${NC}"
    echo "    $sec_list"
    echo
  fi

  hr
  echo -e "  ${BOLD}Actions:${NC}"
  echo
  local choice=""
  menu_pick choice \
    "Export QSOs to CSV  (/tmp/qsos_${code}.csv)" \
    "Export full backup (JSON → /tmp/ezfd_${code}_backup.json)" \
    "Change join code" \
    "Clear all dupes (mark as non-dupe)" \
    "Delete ALL QSOs for this event" \
    "Delete this event entirely" \
    "← Back"

  case "$choice" in
    1) # CSV export
       local file="/tmp/qsos_${code}.csv"
       sudo -u postgres psql -d "$DB" -c \
         "\COPY (SELECT * FROM qsos WHERE event_id='$uuid' ORDER BY datetime_utc) TO '${file}' CSV HEADER" \
         >/dev/null
       log "Exported to ${file}"
       pause ;;

    2) # JSON backup
       local file="/tmp/ezfd_${code}_backup.json"
       PG -c "
         SELECT row_to_json(t) FROM (
           SELECT e.*,
             (SELECT json_agg(row_to_json(q) ORDER BY q.datetime_utc) FROM qsos q WHERE q.event_id=e.id) AS qsos
           FROM events e WHERE e.id='$uuid'
         ) t;" > "$file"
       log "Backup written to ${file}"
       pause ;;

    3) # Change join code
       echo
       read -rp "$(echo -e "  New join code (6 chars, letters/digits): ")" new_code
       new_code="${new_code^^}"
       if [[ ! "$new_code" =~ ^[A-Z0-9]{4,8}$ ]]; then
         warn "Invalid code — must be 4–8 alphanumeric characters."; pause; return
       fi
       if PG -c "UPDATE events SET join_code='$new_code' WHERE id='$uuid';" &>/dev/null; then
         log "Join code changed: ${code} → ${new_code}"
       else
         err "Failed — code may already be in use."
       fi
       pause ;;

    4) # Clear dupes
       local n; n=$(PG -c "SELECT COUNT(*) FROM qsos WHERE event_id='$uuid' AND is_dupe;" 2>/dev/null)
       if [[ "$n" == "0" ]]; then
         warn "No dupes to clear."; pause; return
       fi
       if confirm_danger "This will mark ${n} dupe QSOs as non-dupe for ${code}."; then
         PG -c "UPDATE qsos SET is_dupe=false WHERE event_id='$uuid' AND is_dupe=true;" >/dev/null
         log "${n} dupes cleared."
       else
         warn "Cancelled."
       fi
       pause ;;

    5) # Delete all QSOs
       local n; n=$(PG -c "SELECT COUNT(*) FROM qsos WHERE event_id='$uuid';" 2>/dev/null)
       if confirm_danger "This will permanently delete ALL ${n} QSOs for event ${code}."; then
         PG -c "DELETE FROM qsos WHERE event_id='$uuid';" >/dev/null
         log "All QSOs deleted."
       else
         warn "Cancelled."
       fi
       pause ;;

    6) # Delete event
       if confirm_danger "This will permanently delete event ${code} AND all its QSOs."; then
         PG -c "DELETE FROM events WHERE id='$uuid';" >/dev/null
         log "Event ${code} deleted."
         pause
         return  # back to list — event is gone
       else
         warn "Cancelled."; pause
       fi ;;

    7) return ;;
  esac

  # Re-show detail after action (unless deleted)
  [[ "$choice" != "6" ]] && view_event "$code"
}

# ─────────────────────────────────────────────────────────────────────────────
# Event list screen
# ─────────────────────────────────────────────────────────────────────────────
list_events() {
  while true; do
    banner

    local event_data; event_data=$(fetch_events)

    if [[ -z "$event_data" ]]; then
      echo -e "  ${YELLOW}No events found.${NC}"
      echo
      menu_pick choice "← Back to main menu"
      return
    fi

    # Print table header
    printf "  ${BOLD}%-8s  %-24s %-7s %-4s  %-5s  %6s  %5s  %4s${NC}\n" \
      "Code" "Club" "Type" "Pwr" "Class" "QSOs" "Dupes" "Ops"
    hr

    # Collect codes for selection
    local -a codes=()
    while IFS='|' read -r code name call year class section etype power location created qsos dupes ops; do
      codes+=("$code")
      printf "  ${CYAN}%-8s${NC}  %-24s %-7s %-4s  %-5s  ${GREEN}%6s${NC}  ${YELLOW}%5s${NC}  %4s\n" \
        "$code" "${name:0:24}" "$etype" "$power" "$class" "$qsos" "$dupes" "$ops"
    done <<< "$event_data"

    echo
    hr

    # Build menu options
    local -a opts=()
    for c in "${codes[@]}"; do opts+=("Open event $c"); done
    opts+=("← Back to main menu")

    menu_pick choice "${opts[@]}"

    if [[ "$choice" -le "${#codes[@]}" ]]; then
      view_event "${codes[$((choice-1))]}"
    else
      return
    fi
  done
}

# ─────────────────────────────────────────────────────────────────────────────
# Server stats screen
# ─────────────────────────────────────────────────────────────────────────────
server_stats() {
  banner
  echo -e "  ${BOLD}Server Statistics${NC}"
  echo
  hr

  local totals; totals=$(PG -c "
    SELECT
      COUNT(DISTINCT e.id),
      COUNT(q.id) FILTER (WHERE NOT q.is_dupe),
      COUNT(q.id) FILTER (WHERE     q.is_dupe),
      COUNT(DISTINCT q.operator_call) FILTER (WHERE q.operator_call IS NOT NULL),
      COUNT(DISTINCT q.rcvd_section)  FILTER (WHERE q.rcvd_section IS NOT NULL AND NOT q.is_dupe),
      MIN(e.created_at)::date,
      MAX(e.created_at)::date
    FROM events e LEFT JOIN qsos q ON q.event_id = e.id;" 2>/dev/null)
  IFS='|' read -r tot_events tot_qsos tot_dupes tot_ops tot_sections first_event last_event <<< "$totals"

  label "Total events:";       echo "$tot_events"
  label "Total QSOs:";         echo "$tot_qsos"
  label "Total dupes:";        echo "$tot_dupes"
  label "Unique operators:";   echo "$tot_ops"
  label "Unique sections:";    echo "$tot_sections"
  label "First event:";        echo "$first_event"
  label "Latest event:";       echo "$last_event"
  echo

  # Top operators across all events
  echo -e "  ${BOLD}Top 10 operators (all events):${NC}"
  PG -c "
    SELECT operator_call, COUNT(*) AS n FROM qsos
    WHERE operator_call IS NOT NULL AND NOT is_dupe
    GROUP BY operator_call ORDER BY n DESC LIMIT 10;" 2>/dev/null | \
  while IFS='|' read -r op count; do
    printf "    %-12s  %s QSOs\n" "$op" "$count"
  done
  echo

  # QSOs per event type
  echo -e "  ${BOLD}QSOs by event type:${NC}"
  PG -c "
    SELECT e.event_type, COUNT(q.id) FILTER (WHERE NOT q.is_dupe) AS n
    FROM events e LEFT JOIN qsos q ON q.event_id = e.id
    GROUP BY e.event_type ORDER BY n DESC;" 2>/dev/null | \
  while IFS='|' read -r etype count; do
    printf "    %-8s  %s QSOs\n" "$etype" "$count"
  done
  echo

  # DB size
  local db_size; db_size=$(PG -c "SELECT pg_size_pretty(pg_database_size('$DB'));" 2>/dev/null)
  label "Database size:"; echo "$db_size"
  echo

  pause
}

# ─────────────────────────────────────────────────────────────────────────────
# Full JSON backup (to file)
# ─────────────────────────────────────────────────────────────────────────────
backup_all() {
  banner
  local file="/tmp/ezfd_backup_$(date -u +%Y%m%d_%H%M%S).json"
  echo -e "  Writing full backup to ${BOLD}${file}${NC}…"
  echo
  PG -c "
    SELECT json_agg(row_to_json(t)) FROM (
      SELECT e.*,
        (SELECT json_agg(row_to_json(q) ORDER BY q.datetime_utc)
         FROM qsos q WHERE q.event_id = e.id) AS qsos
      FROM events e ORDER BY e.created_at
    ) t;" > "$file"
  log "Backup complete: $file"
  local size; size=$(du -sh "$file" | awk '{print $1}')
  echo -e "  ${DIM}File size: ${size}${NC}"
  echo
  echo -e "  ${DIM}To transfer off-server:${NC}"
  echo -e "  ${DIM}  scp root@\$(hostname -I | awk '{print \$1}'):${file} ./ezfd_backup.json${NC}"
  pause
}

# ─────────────────────────────────────────────────────────────────────────────
# Main menu loop
# ─────────────────────────────────────────────────────────────────────────────
main_menu() {
  while true; do
    banner

    # Quick summary line
    local totals; totals=$(PG -c "
      SELECT COUNT(DISTINCT e.id),
             COUNT(q.id) FILTER (WHERE NOT q.is_dupe)
      FROM events e LEFT JOIN qsos q ON q.event_id = e.id;" 2>/dev/null)
    IFS='|' read -r tot_events tot_qsos <<< "$totals"
    echo -e "  ${DIM}${tot_events} event(s)  ·  ${tot_qsos} QSO(s) on this server${NC}"
    echo

    local choice=""
    menu_pick choice \
      "List / manage events" \
      "Server statistics" \
      "Full JSON backup (all events + QSOs)" \
      "Exit"

    case "$choice" in
      1) list_events ;;
      2) server_stats ;;
      3) backup_all ;;
      4) echo; exit 0 ;;
    esac
  done
}

main_menu
