#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EzFD — Interactive admin console
#
# Usage:
#   sudo bash ezfd-admin.sh            interactive menu
#   sudo bash ezfd-admin.sh --json     dump all data as JSON (stdout, pipeable)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
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
        e.starts_at, e.ends_at, e.ses_description, e.ses_qsl_info,
        e.slot_enforcement, e.slot_minutes, e.dupe_rule, e.require_operator_approval,
        (SELECT COUNT(*) FROM qsos q WHERE q.event_id = e.id AND NOT q.is_dupe) AS qso_count,
        (SELECT COUNT(*) FROM qsos q WHERE q.event_id = e.id AND     q.is_dupe) AS dupe_count,
        (SELECT json_agg(DISTINCT q.operator_call ORDER BY q.operator_call)
           FROM qsos q WHERE q.event_id = e.id AND q.operator_call IS NOT NULL
        ) AS operators,
        (SELECT json_agg(row_to_json(q) ORDER BY q.datetime_utc)
           FROM qsos q WHERE q.event_id = e.id
        ) AS qsos,
        -- The SES roster carries each operator's own grid/state, which is
        -- what the ADIF MY_* fields are built from. Omitting it from a dump
        -- would make the backup silently lossy for special event stations.
        (SELECT json_agg(row_to_json(o) ORDER BY o.op_call)
           FROM ses_operators o WHERE o.event_id = e.id
        ) AS ses_operators,
        (SELECT json_agg(json_build_object(
                  'op_call', r.op_call, 'band', r.band, 'mode', r.mode,
                  'starts_at', lower(r.during), 'ends_at', upper(r.during),
                  'planned_freq', r.planned_freq, 'note', r.note,
                  'status', r.status, 'created_at', r.created_at) ORDER BY lower(r.during))
           FROM ses_reservations r WHERE r.event_id = e.id
        ) AS ses_reservations
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
    (( i++ )) || true
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
      -- An SES has no class or power category; show a dash rather than an
      -- empty column, and mark a gated roster so it's visible at a glance.
      COALESCE(NULLIF(e.class,''), CASE WHEN e.event_type='SES' THEN '—' ELSE '?' END),
      COALESCE(e.arrl_section,'—'),
      e.event_type,
      CASE WHEN e.event_type='SES' THEN '—' ELSE e.power END,
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
  local row=""; row=$(PG -c "
    SELECT club_name, club_call, event_year, COALESCE(class,''), COALESCE(arrl_section,''),
           event_type, power, COALESCE(location,''), created_at::date,
           COALESCE(to_char(starts_at,'YYYY-MM-DD HH24:MI'),''),
           COALESCE(to_char(ends_at,'YYYY-MM-DD HH24:MI'),''),
           COALESCE(ses_description,''), COALESCE(ses_qsl_info,''),
           slot_enforcement, slot_minutes, dupe_rule, require_operator_approval
    FROM events WHERE id='$uuid';" 2>/dev/null)
  local club_name="" club_call="" year="" class="" section="" etype="" power="" location="" created=""
  local starts="" ends="" ses_desc="" ses_qsl="" enforce="" slotmin="" duperule="" reqappr=""
  IFS='|' read -r club_name club_call year class section etype power location created \
                  starts ends ses_desc ses_qsl enforce slotmin duperule reqappr <<< "$row"

  echo -e "  ${BOLD}${CYAN}${code}${NC}  ${BOLD}${club_name}${NC} ${DIM}(${club_call})${NC}"
  hr
  if [[ "$etype" == "SES" ]]; then
    # A special event station has no contest class or power category, so
    # printing them would just be two empty fields.
    label "Type:";           echo "Special Event Station"
    [[ -n "$section" ]] && { label "ARRL Section:"; echo "$section"; }
    [[ -n "$ses_desc" ]] && { label "Description:"; echo "$ses_desc"; }
    [[ -n "$starts" || -n "$ends" ]] && {
      label "Runs (UTC):"; echo "${starts:-?}  →  ${ends:-?}"; }
    label "Checkout:";       echo "${enforce}  ·  ${slotmin} min default"
    label "Dupe rule:";      echo "$duperule"
    if [[ "$reqappr" == "t" ]]; then
      label "Operator gate:"; echo -e "${YELLOW}approval required${NC}"
    else
      label "Operator gate:"; echo "join code only"
    fi
    [[ -n "$ses_qsl" ]] && { label "QSL info:"; echo "$ses_qsl"; }
  else
    label "Type / Power:";   echo "${etype}  ·  ${power}"
    label "Class / Section:"; echo "${class}  ·  ${section}"
    label "Dupe rule:";      echo "$duperule"
  fi
  label "Year / Created:"; echo "${year}  ·  ${created}"
  [[ -n "$location" ]] && { label "Location:"; echo "$location"; }
  label "Event UUID:";     echo -e "${DIM}${uuid}${NC}"
  echo

  # SES roster — who may operate, and the locations the ADIF MY_* fields use.
  if [[ "$etype" == "SES" ]]; then
    local roster=""; roster=$(PG -c "
      SELECT op_call, COALESCE(grid,'-'), COALESCE(state,'-'), approved
      FROM ses_operators WHERE event_id='$uuid' ORDER BY op_call;" 2>/dev/null)
    if [[ -n "$roster" ]]; then
      echo -e "  ${BOLD}Operator roster${NC}"
      local rc="" rg="" rs="" ra=""
      while IFS='|' read -r rc rg rs ra; do
        [[ -z "$rc" ]] && continue
        if [[ "$ra" == "t" ]]; then
          printf "    ${GREEN}%-10s${NC} %-8s %-4s ${DIM}approved${NC}\n" "$rc" "$rg" "$rs"
        else
          printf "    ${YELLOW}%-10s${NC} %-8s %-4s ${YELLOW}pending${NC}\n" "$rc" "$rg" "$rs"
        fi
      done <<< "$roster"
      echo
    fi

    local live=""; live=$(PG -c "
      SELECT op_call, band, mode, to_char(upper(during),'HH24:MI')
      FROM ses_reservations
      WHERE event_id='$uuid' AND status <> 'RELEASED' AND during @> NOW()
      ORDER BY band, mode;" 2>/dev/null)
    if [[ -n "$live" ]]; then
      echo -e "  ${BOLD}On the air now${NC}"
      local lc="" lb="" lm="" lu=""
      while IFS='|' read -r lc lb lm lu; do
        [[ -z "$lc" ]] && continue
        printf "    ${CYAN}%-10s${NC} %-6s %-4s ${DIM}until %sZ${NC}\n" "$lc" "$lb" "$lm" "$lu"
      done <<< "$live"
      echo
    fi
  fi

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
  local settings_label="Edit event settings (power / class / section)"
  local roster_label="Manage operator roster (SES only — not applicable)"
  if [[ "$etype" == "SES" ]]; then
    settings_label="Edit event settings (checkout / dupes / approval)"
    roster_label="Manage operator roster (approve / revoke / locations)"
  fi
  menu_pick choice \
    "Export QSOs to CSV  (/tmp/qsos_${code}.csv)" \
    "Export full backup (JSON → /tmp/ezfd_${code}_backup.json)" \
    "Change join code" \
    "$settings_label" \
    "$roster_label" \
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

    4) # Edit event settings
       echo
       echo -e "  ${BOLD}Edit event settings for ${CYAN}${code}${NC}"
       echo -e "  ${DIM}Leave a field blank to keep the current value.${NC}"
       echo

       if [[ "$etype" == "SES" ]]; then
         local cur_enf="" cur_slot="" cur_dupe="" cur_appr=""
         IFS='|' read -r cur_enf cur_slot cur_dupe cur_appr < <(PG -c \
           "SELECT slot_enforcement, slot_minutes, dupe_rule, require_operator_approval
            FROM events WHERE id='$uuid';" 2>/dev/null)

         printf "  Current checkout enforcement: ${BOLD}%s${NC}\n" "$cur_enf"
         echo -e "  ${DIM}SOFT = warn but still log · HARD = refuse the QSO${NC}"
         local new_enf=""
         read -rp "$(echo -e "  New enforcement [Enter to keep]: ")" new_enf
         new_enf="${new_enf^^}"
         if [[ -n "$new_enf" ]]; then
           if [[ "$new_enf" == "SOFT" || "$new_enf" == "HARD" ]]; then
             PG -c "UPDATE events SET slot_enforcement='$new_enf' WHERE id='$uuid';" >/dev/null
             log "Enforcement updated: ${cur_enf} → ${new_enf}"
           else
             warn "Invalid — must be SOFT or HARD. Skipping."
           fi
         fi
         echo

         printf "  Current default slot length: ${BOLD}%s${NC} min\n" "$cur_slot"
         local new_slot=""
         read -rp "$(echo -e "  New slot minutes [Enter to keep]: ")" new_slot
         if [[ -n "$new_slot" ]]; then
           if [[ "$new_slot" =~ ^[0-9]+$ ]] && [[ "$new_slot" -ge 5 ]] && [[ "$new_slot" -le 1440 ]]; then
             PG -c "UPDATE events SET slot_minutes=$new_slot WHERE id='$uuid';" >/dev/null
             log "Slot length updated: ${cur_slot} → ${new_slot} min"
           else
             warn "Invalid — expected 5–1440. Skipping."
           fi
         fi
         echo

         printf "  Current dupe rule: ${BOLD}%s${NC}\n" "$cur_dupe"
         echo -e "  ${DIM}EVENT = once per band/mode all event · DAY = once per UTC day · NONE${NC}"
         local new_dupe=""
         read -rp "$(echo -e "  New dupe rule [Enter to keep]: ")" new_dupe
         new_dupe="${new_dupe^^}"
         if [[ -n "$new_dupe" ]]; then
           if [[ "$new_dupe" == "EVENT" || "$new_dupe" == "DAY" || "$new_dupe" == "NONE" ]]; then
             PG -c "UPDATE events SET dupe_rule='$new_dupe' WHERE id='$uuid';" >/dev/null
             log "Dupe rule updated: ${cur_dupe} → ${new_dupe}"
           else
             warn "Invalid — must be EVENT, DAY, or NONE. Skipping."
           fi
         fi
         echo

         if [[ "$cur_appr" == "t" ]]; then
           echo -e "  Operator approval is ${BOLD}required${NC}."
         else
           echo -e "  Operator approval is ${BOLD}not required${NC} (join code only)."
         fi
         local new_appr=""
         read -rp "$(echo -e "  Toggle approval requirement? [y/N]: ")" new_appr
         if [[ "$new_appr" =~ ^[Yy]$ ]]; then
           PG -c "UPDATE events SET require_operator_approval = NOT require_operator_approval WHERE id='$uuid';" >/dev/null
           log "Operator approval requirement toggled."
         fi
         pause; return
       fi

       local cur_power="" cur_class="" cur_section=""
       IFS='|' read -r cur_power cur_class cur_section < <(PG -c \
         "SELECT power, COALESCE(class,''), COALESCE(arrl_section,'') FROM events WHERE id='$uuid';" 2>/dev/null)

       # Power
       printf "  Current power: ${BOLD}%s${NC}\n" "$cur_power"
       echo -e "  ${DIM}Options: HIGH, LOW, QRP${NC}"
       local new_power=""
       read -rp "$(echo -e "  New power [Enter to keep]: ")" new_power
       new_power="${new_power^^}"
       if [[ -n "$new_power" ]]; then
         if [[ "$new_power" =~ ^(HIGH|LOW|QRP)$ ]]; then
           PG -c "UPDATE events SET power='$new_power' WHERE id='$uuid';" >/dev/null
           log "Power updated: ${cur_power} → ${new_power}"
         else
           warn "Invalid power — must be HIGH, LOW, or QRP. Skipping."
         fi
       fi
       echo

       # Class
       printf "  Current class: ${BOLD}%s${NC}\n" "$cur_class"
       echo -e "  ${DIM}FD examples: 3A, 2B  |  WFD examples: 2O, 1H${NC}"
       local new_class=""
       read -rp "$(echo -e "  New class [Enter to keep]: ")" new_class
       new_class="${new_class^^}"
       if [[ -n "$new_class" ]]; then
         if [[ "$new_class" =~ ^[0-9]+[A-Z]+$ ]]; then
           PG -c "UPDATE events SET class='$new_class' WHERE id='$uuid';" >/dev/null
           log "Class updated: ${cur_class} → ${new_class}"
         else
           warn "Invalid class format (expected number + letters, e.g. 3A). Skipping."
         fi
       fi
       echo

       # ARRL Section
       printf "  Current section: ${BOLD}%s${NC}\n" "$cur_section"
       local new_section=""
       read -rp "$(echo -e "  New section [Enter to keep]: ")" new_section
       new_section="${new_section^^}"
       if [[ -n "$new_section" ]]; then
         if [[ "$new_section" =~ ^[A-Z]{2,5}$ ]]; then
           PG -c "UPDATE events SET arrl_section='$new_section' WHERE id='$uuid';" >/dev/null
           log "Section updated: ${cur_section} → ${new_section}"
         else
           warn "Invalid section format. Skipping."
         fi
       fi
       pause ;;

    5) # Manage the SES operator roster
       if [[ "$etype" != "SES" ]]; then
         warn "The operator roster only applies to special event stations."
         pause; return
       fi
       echo
       echo -e "  ${BOLD}Operator roster for ${CYAN}${code}${NC}"
       echo -e "  ${DIM}Grid and state here become the ADIF MY_* fields on that${NC}"
       echo -e "  ${DIM}operator's own contacts, so they're per-operator, not per-event.${NC}"
       echo
       local rlist=""; rlist=$(PG -c "
         SELECT op_call, COALESCE(grid,'-'), COALESCE(state,'-'), approved
         FROM ses_operators WHERE event_id='$uuid' ORDER BY op_call;" 2>/dev/null)
       if [[ -z "$rlist" ]]; then
         warn "No operators have joined this event yet."
         pause; return
       fi
       local rc="" rg="" rs="" ra=""
       while IFS='|' read -r rc rg rs ra; do
         [[ -z "$rc" ]] && continue
         if [[ "$ra" == "t" ]]; then
           printf "    ${GREEN}%-10s${NC} grid %-8s state %-4s ${DIM}approved${NC}\n" "$rc" "$rg" "$rs"
         else
           printf "    ${YELLOW}%-10s${NC} grid %-8s state %-4s ${YELLOW}pending${NC}\n" "$rc" "$rg" "$rs"
         fi
       done <<< "$rlist"
       echo
       local target=""
       read -rp "$(echo -e "  Operator callsign to change [Enter to cancel]: ")" target
       target="${target^^}"
       if [[ -z "$target" ]]; then
         warn "Cancelled."; pause; return
       fi
       local exists=""; exists=$(PG -c \
         "SELECT 1 FROM ses_operators WHERE event_id='$uuid' AND op_call='$target';" 2>/dev/null)
       if [[ -z "$exists" ]]; then
         err "${target} is not on this event's roster."; pause; return
       fi

       local racts=""
       menu_pick racts \
         "Toggle approval (approved / pending)" \
         "Set grid square" \
         "Set state" \
         "Remove from roster" \
         "← Back"
       case "$racts" in
         1) PG -c "UPDATE ses_operators SET approved = NOT approved
                   WHERE event_id='$uuid' AND op_call='$target';" >/dev/null
            log "Approval toggled for ${target}." ;;
         2) local g=""
            read -rp "$(echo -e "  New grid for ${target}: ")" g
            g="${g^^}"
            if [[ "$g" =~ ^[A-Z]{2}[0-9]{2}([A-Z]{2})?$ ]]; then
              PG -c "UPDATE ses_operators SET grid='$g' WHERE event_id='$uuid' AND op_call='$target';" >/dev/null
              log "Grid set to ${g} for ${target}."
            else
              warn "Invalid grid (expected e.g. EN34 or EN34kl). Skipping."
            fi ;;
         3) local st=""
            read -rp "$(echo -e "  New state for ${target}: ")" st
            st="${st^^}"
            if [[ "$st" =~ ^[A-Z]{2,3}$ ]]; then
              PG -c "UPDATE ses_operators SET state='$st' WHERE event_id='$uuid' AND op_call='$target';" >/dev/null
              log "State set to ${st} for ${target}."
            else
              warn "Invalid state. Skipping."
            fi ;;
         4) # Their QSOs are deliberately left alone — removing someone from
            # the roster revokes access, it does not erase contacts they made.
            if confirm_danger "This removes ${target} from the roster for ${code}. Their logged QSOs are kept."; then
              PG -c "DELETE FROM ses_operators WHERE event_id='$uuid' AND op_call='$target';" >/dev/null
              log "${target} removed from the roster."
            else
              warn "Cancelled."
            fi ;;
       esac
       pause ;;

    6) # Clear dupes
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

    7) # Delete all QSOs
       local n; n=$(PG -c "SELECT COUNT(*) FROM qsos WHERE event_id='$uuid';" 2>/dev/null)
       if confirm_danger "This will permanently delete ALL ${n} QSOs for event ${code}."; then
         PG -c "DELETE FROM qsos WHERE event_id='$uuid';" >/dev/null
         log "All QSOs deleted."
       else
         warn "Cancelled."
       fi
       pause ;;

    8) # Delete event
       if confirm_danger "This will permanently delete event ${code} AND all its QSOs."; then
         PG -c "DELETE FROM events WHERE id='$uuid';" >/dev/null
         log "Event ${code} deleted."
         pause
         return  # back to list — event is gone
       else
         warn "Cancelled."; pause
       fi ;;

    9) return 0 ;;
  esac

  # Re-show detail after action (unless deleted)
  [[ "$choice" != "7" ]] && view_event "$code"
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
    local code="" name="" call="" year="" class="" section="" etype="" power=""
    local location="" created="" qsos="" dupes="" ops=""
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
      return 0
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
# Restore from JSON backup
# ─────────────────────────────────────────────────────────────────────────────
restore_from_json() {
  banner
  echo -e "  ${BOLD}Restore from JSON Backup${NC}"
  echo -e "  ${DIM}Restores event(s) + QSOs from a backup made by the JSON export${NC}"
  echo -e "  ${DIM}options in this script. Always creates NEW event(s) with fresh${NC}"
  echo -e "  ${DIM}join codes — never overwrites or merges into an existing event,${NC}"
  echo -e "  ${DIM}so restoring is always safe to try, even more than once.${NC}"
  echo

  warn "QRZ credentials in the backup are stored encrypted with the ENCRYPTION"
  warn "KEY active when the backup was made. If restoring onto a different"
  warn "server/key, QRZ auto-lookup for that event may not work until re-entered."
  echo
  hr

  # Offer a pick-list of backup files in /tmp, or a custom path
  local -a files=()
  while IFS= read -r f; do files+=("$f"); done < <(ls -t /tmp/ezfd_*.json 2>/dev/null)

  local json_file=""
  if [[ ${#files[@]} -gt 0 ]]; then
    local -a opts=()
    local f size
    for f in "${files[@]}"; do
      size=$(du -h "$f" 2>/dev/null | cut -f1)
      opts+=("$(basename "$f")  (${size})")
    done
    opts+=("Enter a custom path")
    local choice=""
    menu_pick choice "${opts[@]}"
    if [[ "$choice" -le "${#files[@]}" ]]; then
      json_file="${files[$((choice-1))]}"
    fi
  fi

  if [[ -z "$json_file" ]]; then
    echo
    read -rp "$(echo -e "  Path to JSON backup file: ")" json_file
  fi

  if [[ ! -f "$json_file" ]]; then
    err "File not found: $json_file"; pause; return
  fi

  # Postgres reads the file server-side (pg_read_file) so the JSON content
  # never has to pass through shell/psql -c string interpolation — only the
  # file path does.
  local preview
  preview=$(PG -c "
    SELECT jsonb_array_length(
      CASE WHEN jsonb_typeof(d) = 'array' THEN d ELSE jsonb_build_array(d) END
    )
    FROM (SELECT pg_read_file('$json_file')::jsonb AS d) t;" 2>&1)

  if [[ ! "$preview" =~ ^[0-9]+$ ]]; then
    err "Could not read/parse that file as JSON on the server:"
    echo "$preview" >&2
    pause; return
  fi

  echo
  label "File:";          echo "$json_file"
  label "Events found:";  echo "$preview"
  echo
  read -rp "$(echo -e "  ${BOLD}Restore ${preview} event(s) as new event(s)? [y/N]:${NC} ")" ans
  if [[ "${ans,,}" != "y" ]]; then
    warn "Cancelled."; pause; return
  fi

  echo
  echo -e "  ${DIM}Restoring…${NC}"

  local result
  result=$(PG -c "
    CREATE TEMP TABLE _restore_summary (orig_code text, new_code text, qso_count int);

    DO \$\$
    DECLARE
      raw jsonb;
      ev  jsonb;
      qso jsonb;
      op  jsonb;
      res jsonb;
      new_id uuid;
      new_code text;
      n int;
    BEGIN
      raw := pg_read_file('$json_file')::jsonb;
      IF jsonb_typeof(raw) = 'object' THEN
        raw := jsonb_build_array(raw);
      END IF;

      -- json_agg over zero rows yields JSON null — a scalar, not SQL NULL —
      -- so COALESCE(...,'[]') does not catch it and jsonb_array_elements
      -- then fails with "cannot extract elements from a scalar". Every list
      -- below is therefore type-checked rather than COALESCEd.
      FOR ev IN SELECT * FROM jsonb_array_elements(raw) LOOP
        new_id := gen_random_uuid();
        new_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

        INSERT INTO events (id, join_code, club_name, club_call, event_year, class, arrl_section,
                             location, qrz_username, qrz_password, qrz_session_key, qrz_session_expires,
                             bonuses, event_type, power, created_at,
                             starts_at, ends_at, ses_description, ses_qsl_info,
                             slot_enforcement, slot_minutes, dupe_rule, require_operator_approval)
        VALUES (
          new_id, new_code,
          COALESCE(ev->>'club_name',''), COALESCE(ev->>'club_call',''),
          COALESCE((ev->>'event_year')::int, EXTRACT(YEAR FROM NOW())::int),
          -- NULLIF, not COALESCE to '': a special event station stores NULL
          -- here, and restoring it as an empty string would put a blank
          -- MY_ARRL_SECT into every exported ADIF record.
          NULLIF(ev->>'class',''), NULLIF(ev->>'arrl_section',''),
          ev->>'location', ev->>'qrz_username', ev->>'qrz_password', ev->>'qrz_session_key',
          NULLIF(ev->>'qrz_session_expires','')::timestamptz,
          COALESCE(ev->'bonuses','{}'::jsonb),
          COALESCE(ev->>'event_type','FD'),
          COALESCE(ev->>'power','HIGH'),
          COALESCE(NULLIF(ev->>'created_at','')::timestamptz, NOW()),
          NULLIF(ev->>'starts_at','')::timestamptz,
          NULLIF(ev->>'ends_at','')::timestamptz,
          ev->>'ses_description', ev->>'ses_qsl_info',
          COALESCE(ev->>'slot_enforcement','SOFT'),
          COALESCE((ev->>'slot_minutes')::int, 120),
          COALESCE(ev->>'dupe_rule','EVENT'),
          COALESCE((ev->>'require_operator_approval')::boolean, false)
        );

        n := 0;
        FOR qso IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ev->'qsos') = 'array'
                                        THEN ev->'qsos' ELSE '[]'::jsonb END) LOOP
          INSERT INTO qsos (id, event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
                             rcvd_class, rcvd_section, operator_call, station_number, is_dupe, created_at,
                             rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment,
                             adif_mode, freq_khz)
          VALUES (
            gen_random_uuid(), new_id,
            qso->>'callsign', qso->>'band', qso->>'mode',
            COALESCE(NULLIF(qso->>'datetime_utc','')::timestamptz, NOW()),
            qso->>'sent_class', qso->>'sent_section',
            qso->>'rcvd_class', qso->>'rcvd_section',
            qso->>'operator_call', COALESCE((qso->>'station_number')::int, 1),
            COALESCE((qso->>'is_dupe')::boolean, false),
            COALESCE(NULLIF(qso->>'created_at','')::timestamptz, NOW()),
            qso->>'rst_sent', qso->>'rst_rcvd', qso->>'rcvd_name',
            qso->>'rcvd_qth', qso->>'rcvd_grid', qso->>'comment',
            qso->>'adif_mode', NULLIF(qso->>'freq_khz','')::int
          );
          n := n + 1;
        END LOOP;

        -- The SES operator roster. Losing this would strip the per-operator
        -- grid/state that the ADIF MY_* fields are built from, leaving a
        -- restored special event log that no longer uploads correctly.
        FOR op IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ev->'ses_operators') = 'array'
                                        THEN ev->'ses_operators' ELSE '[]'::jsonb END) LOOP
          INSERT INTO ses_operators (event_id, op_call, op_name, grid, state, county, dxcc, approved, created_at)
          VALUES (
            new_id, op->>'op_call', op->>'op_name', op->>'grid', op->>'state',
            op->>'county', NULLIF(op->>'dxcc','')::int,
            COALESCE((op->>'approved')::boolean, true),
            COALESCE(NULLIF(op->>'created_at','')::timestamptz, NOW())
          )
          ON CONFLICT (event_id, op_call) DO NOTHING;
        END LOOP;

        -- Checkout history, rebuilt from the decomposed bounds the backup
        -- stores (a tstzrange doesn't survive a JSON round-trip intact).
        -- Skipped where a bound is missing rather than guessed at.
        FOR res IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ev->'ses_reservations') = 'array'
                                        THEN ev->'ses_reservations' ELSE '[]'::jsonb END) LOOP
          CONTINUE WHEN NULLIF(res->>'starts_at','') IS NULL;
          INSERT INTO ses_reservations (event_id, op_call, band, mode, during,
                                        planned_freq, note, status, created_at)
          VALUES (
            new_id, res->>'op_call', res->>'band', res->>'mode',
            tstzrange(
              (res->>'starts_at')::timestamptz,
              COALESCE(NULLIF(res->>'ends_at','')::timestamptz,
                       (res->>'starts_at')::timestamptz + interval '2 hours'),
              '[)'
            ),
            res->>'planned_freq', res->>'note',
            COALESCE(res->>'status','RELEASED'),
            COALESCE(NULLIF(res->>'created_at','')::timestamptz, NOW())
          );
        END LOOP;

        INSERT INTO _restore_summary VALUES (ev->>'join_code', new_code, n);
      END LOOP;
    END \$\$;

    SELECT orig_code, new_code, qso_count FROM _restore_summary;
  " 2>&1)
  local status=$?

  if [[ $status -ne 0 ]]; then
    err "Restore failed:"
    echo "$result" >&2
    pause; return
  fi

  echo
  echo -e "  ${BOLD}Restored:${NC}"
  printf "  ${BOLD}%-10s  %-10s  %6s${NC}\n" "Old Code" "New Code" "QSOs"
  hr
  while IFS='|' read -r orig new_code qso_count; do
    [[ -z "$orig" ]] && continue
    printf "  ${DIM}%-10s${NC}  ${CYAN}%-10s${NC}  %6s\n" "$orig" "$new_code" "$qso_count"
  done <<< "$result"
  echo
  log "Restore complete. Share the new join code(s) above with operators."
  pause
}

# ─────────────────────────────────────────────────────────────────────────────
# Update application (git pull → build → rsync → migrate → restart)
# ─────────────────────────────────────────────────────────────────────────────
update_app() {
  banner
  echo -e "  ${BOLD}Update Application${NC}"
  echo
  hr

  local APP_DIR="/opt/ezfd"
  local REPO_DIR=""
  REPO_DIR="$(grep '^EZFD_REPO_DIR=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"

  if [[ -z "$REPO_DIR" || ! -d "$REPO_DIR/.git" ]]; then
    err "Cannot locate the source repository."
    echo -e "  ${DIM}Expected EZFD_REPO_DIR in ${APP_DIR}/.env pointing to the cloned repo.${NC}"
    echo -e "  ${DIM}Re-run deploy.sh once to set this up automatically.${NC}"
    pause; return
  fi

  label "Repo:";    echo "$REPO_DIR"
  label "App dir:"; echo "$APP_DIR"

  local cur_commit; cur_commit=$(git -C "$REPO_DIR" log --oneline -1 2>/dev/null || echo "(unknown)")
  label "Current:"; echo "$cur_commit"
  echo

  echo -e "  ${DIM}Fetching latest changes from remote…${NC}"
  if ! git -C "$REPO_DIR" pull 2>&1 | sed 's/^/    /'; then
    err "git pull failed — check your network or repo state."
    pause; return
  fi

  local new_commit; new_commit=$(git -C "$REPO_DIR" log --oneline -1 2>/dev/null || echo "(unknown)")
  label "Updated to:"; echo "$new_commit"
  echo

  if [[ "$cur_commit" == "$new_commit" ]]; then
    warn "Already up to date — no rebuild needed."
    pause; return
  fi

  echo -e "  ${DIM}Installing dependencies…${NC}"
  if ! (cd "$REPO_DIR" && npm ci --silent 2>&1 | sed 's/^/    /'); then
    err "npm ci failed."; pause; return
  fi

  echo -e "  ${DIM}Building…${NC}"
  if ! (cd "$REPO_DIR" && npm run build 2>&1 | sed 's/^/    /'); then
    err "Build failed."; pause; return
  fi

  echo -e "  ${DIM}Deploying files…${NC}"
  # --exclude='.env' prevents rsync --delete from removing the live secrets file,
  # which lives in $APP_DIR but is not part of the standalone build output.
  rsync -a --delete --exclude='.env' "${REPO_DIR}/.next/standalone/"  "$APP_DIR/"
  rsync -a --delete "${REPO_DIR}/.next/static/"      "$APP_DIR/.next/static/"
  rsync -a --delete "${REPO_DIR}/public/"            "$APP_DIR/public/"
  cp "$REPO_DIR/ezfd-admin.sh" "$APP_DIR/ezfd-admin.sh"
  chmod +x "$APP_DIR/ezfd-admin.sh"

  if [[ ! -f "$APP_DIR/.env" ]]; then
    err ".env is missing from $APP_DIR — run deploy.sh to recreate it before restarting."
    pause; return
  fi

  echo -e "  ${DIM}Applying database migrations…${NC}"
  sudo -u postgres psql -d ezfd -f "$REPO_DIR/db/schema.sql" >/dev/null 2>&1 || true

  echo -e "  ${DIM}Restarting service…${NC}"
  systemctl restart ezfd
  sleep 2
  if systemctl is-active --quiet ezfd; then
    log "Service restarted successfully."
  else
    err "Service failed to start — check: journalctl -u ezfd -n 30"
  fi

  echo
  log "Update complete: ${new_commit}"
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
      "Restore from JSON backup" \
      "Update application (git pull + rebuild)" \
      "Exit"

    case "$choice" in
      1) list_events ;;
      2) server_stats ;;
      3) backup_all ;;
      4) restore_from_json ;;
      5) update_app ;;
      6) echo; exit 0 ;;
    esac
  done
}

main_menu
