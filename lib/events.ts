import type { Pool } from 'pg';

/**
 * The column list every page and route uses to load an event.
 *
 * These SELECTs had already drifted apart (the dashboard omitted
 * use_call_history, the log page omitted bonuses), and adding the SES columns
 * to four separate lists would have guaranteed more of the same. One source
 * of truth instead. qrz_password is deliberately excluded — it is encrypted
 * at rest and never leaves the server.
 */
export const EVENT_COLUMNS = `
  id, join_code, club_name, club_call, event_year, class, arrl_section,
  event_type, power, location, qrz_username, use_call_history,
  use_master_callsign_file, bonuses, created_at,
  starts_at, ends_at, ses_description, ses_qsl_info,
  slot_enforcement, slot_minutes, dupe_rule, require_operator_approval
`;


/**
 * Dupe detection, per the event's configured rule:
 *
 *   EVENT — once per band/mode for the whole event (the ARRL contest rule)
 *   DAY   — once per band/mode per UTC day. The sane default for a special
 *           event station that may run for weeks, where working the same
 *           station again next weekend is normal rather than a mistake.
 *   NONE  — never flag a dupe.
 *
 * `at` is the QSO's own timestamp rather than "now" so that an ADIF import of
 * back-dated contacts is evaluated against the day it actually happened.
 */
export async function isDupeQSO(
  pool: Pool,
  eventId: string,
  callsign: string,
  band: string,
  mode: string,
  dupeRule: string,
  at: Date
): Promise<boolean> {
  if (dupeRule === 'NONE') return false;

  const params: unknown[] = [eventId, callsign, band, mode];
  let dayClause = '';
  if (dupeRule === 'DAY') {
    params.push(at);
    dayClause = "AND (datetime_utc AT TIME ZONE 'UTC')::date = ($5::timestamptz AT TIME ZONE 'UTC')::date";
  }

  const { rows } = await pool.query(
    `SELECT id FROM qsos
     WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4 AND is_dupe=false
     ${dayClause}
     LIMIT 1`,
    params
  );
  return rows.length > 0;
}
