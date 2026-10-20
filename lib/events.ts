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
  slot_enforcement, slot_minutes, dupe_rule, require_operator_approval,
  gota_call
`;


/**
 * How close two contacts must be in time to be the same contact arriving
 * twice, rather than a station worked twice.
 *
 * Distinct from the dupe *rule* below: that flags a contact genuinely worked
 * twice on the air, this recognises one contact reaching the log by two
 * routes. ADIF carries only minute resolution and loggers round differently,
 * and two instances of the same event stamp a contact seconds apart, so an
 * exact timestamp match is too strict for both.
 *
 * One definition because it is now used in two places — the ADIF import and
 * the event merge — and `ezfd_merge_event` takes it as a parameter rather
 * than hardcoding a second copy in SQL. `scripts/test-merge.cjs` fails if the
 * function's default drifts from this value.
 */
export const MERGE_WINDOW_SECONDS = 120;

/**
 * Dupe detection, per the event's configured rule:
 *
 *   EVENT — once per band/mode for the whole event (the ARRL contest rule)
 *   DAY   — once per band/mode per UTC day. The sane default for a special
 *           event station that may run for weeks, where working the same
 *           station again next weekend is normal rather than a mistake.
 *   NONE  — never flag a dupe.
 *
 * The rule is applied in one place, `ezfd_recompute_dupes()` in
 * `db/schema.sql`, which every insert, edit, delete, restore, import and merge
 * calls for the groups it touched. This file used to hold a per-row check
 * that the insert and the import called and the edit reimplemented without the
 * rule; a check that answers "is this row a dupe?" can set a flag but never
 * clear one, which is how deleting the first of two contacts left the second
 * scoring nothing.
 */
export const DUPE_RULES = ['EVENT', 'DAY', 'NONE'] as const;
