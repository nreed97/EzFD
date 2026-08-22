#!/usr/bin/env node
/**
 * Query-level regression tests for the SES routes.
 *
 * These queries are built as SQL strings, so the typechecker can't see them:
 * an interval cast that only works when the parameter is text, or a range
 * bound that comes back as a Date rather than a string, fails at runtime and
 * nowhere earlier. Each case below mirrors a query a route actually issues.
 *
 *   DATABASE_URL=postgres://... node scripts/test-queries.cjs
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/ezfd',
});

// Mirrors RESERVATION_COLUMNS in lib/ses.ts — reservations are stored as one
// tstzrange so the exclusion constraint can test overlap directly, but every
// client wants two plain timestamps.
const RESERVATION_COLUMNS = `
  id, event_id, op_call, band, mode, planned_freq, note, status, created_at,
  lower(during) AS starts_at,
  upper(during) AS ends_at
`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

(async () => {
  const code = 'QTEST' + Math.floor(Math.random() * 10);
  await pool.query('DELETE FROM events WHERE join_code = $1', [code]);
  const { rows: [ev] } = await pool.query(
    `INSERT INTO events (join_code, club_name, club_call, event_type, class, arrl_section, dupe_rule)
     VALUES ($1,'Query Test','W0QT','SES',NULL,NULL,'DAY') RETURNING id`, [code]);

  try {
    // ── app/api/ses/reservations POST ────────────────────────────────────
    const start = new Date();
    const end = new Date(Date.now() + 2 * 3600e3);
    const { rows: [slot] } = await pool.query(
      `INSERT INTO ses_reservations (event_id, op_call, band, mode, during, planned_freq, note)
       VALUES ($1,$2,$3,$4, tstzrange($5,$6,'[)'), $7, $8)
       RETURNING ${RESERVATION_COLUMNS}`,
      [ev.id, 'W0AAA', '20m', 'PH', start, end, '14.250', null]);
    check('checkout insert returns decomposed range bounds',
      slot.starts_at instanceof Date && slot.ends_at instanceof Date);

    // pg returns TIMESTAMPTZ as Date objects, not strings — the gotcha that
    // put a raw Date.toString() into a 409 message during development.
    check('range bounds are Date objects, not strings',
      typeof slot.ends_at !== 'string', typeof slot.ends_at);

    // ── the exclusion constraint through the driver ──────────────────────
    let code23 = null;
    try {
      await pool.query(
        `INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
         VALUES ($1,$2,$3,$4, tstzrange($5,$6,'[)'))`,
        [ev.id, 'W1BBB', '20m', 'PH', start, end]);
    } catch (e) { code23 = e.code; }
    check('overlap surfaces as SQLSTATE 23P01 via the pg driver', code23 === '23P01', `got ${code23}`);

    // ── app/api/ses/reservations GET — the ($n || ' hours')::interval cast
    const { rows: upcoming } = await pool.query(
      `SELECT ${RESERVATION_COLUMNS} FROM ses_reservations
       WHERE event_id = $1 AND status <> 'RELEASED'
         AND during && tstzrange(NOW(), NOW() + ($2 || ' hours')::interval, '[)')
       ORDER BY lower(during) ASC`, [ev.id, String(48)]);
    check('upcoming-slots query (hours interval cast)', upcoming.length === 1);

    // ── GET past_hours / include_released, for the dashboard timeline ────
    // The timeline shows who held a band/mode *before* you, so the route
    // takes two opt-in widening params that must each leave the default
    // result untouched. Each fixture below is placed so that exactly one
    // clause can exclude it — otherwise the assertion passes for the wrong
    // reason (the first draft of this test was guarded by the time window,
    // not by the status filter it claimed to check).
    const timelineSql = `
      SELECT ${RESERVATION_COLUMNS} FROM ses_reservations
      WHERE event_id = $1
        AND ($4::boolean OR status <> 'RELEASED')
        AND during && tstzrange(NOW() - ($3 || ' hours')::interval,
                                NOW() + ($2 || ' hours')::interval, '[)')
      ORDER BY lower(during) ASC`;
    const names = async (past, incRel) =>
      (await pool.query(timelineSql, [ev.id, String(48), String(past), incRel]))
        .rows.map(r => r.op_call);

    // Spans NOW, so it sits inside the default time window: only the
    // status filter can keep it out. (The exclusion constraint ignores
    // RELEASED rows, so this may overlap a live slot freely.)
    await pool.query(
      `INSERT INTO ses_reservations (event_id, op_call, band, mode, during, status)
       VALUES ($1,'W4RELNOW','15m','CW',
               tstzrange(NOW() - interval '1 hour', NOW() + interval '1 hour','[)'),'RELEASED')`,
      [ev.id]);
    check('an active RELEASED slot stays hidden unless asked for',
      !(await names(0, false)).includes('W4RELNOW'));
    check('include_released surfaces that same active slot',
      (await names(0, true)).includes('W4RELNOW'));

    // Entirely in the past and still RESERVED, so only the past window can
    // reach it — isolating past_hours from the status filter.
    await pool.query(
      `INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
       VALUES ($1,'W5DONE','10m','PH',
               tstzrange(NOW() - interval '5 hours', NOW() - interval '3 hours','[)'))`,
      [ev.id]);
    check('a finished slot is outside the default window',
      !(await names(0, false)).includes('W5DONE'));
    check('past_hours reaches back to it',
      (await names(6, false)).includes('W5DONE'));

    // ── lib/ses.ts currentHolder ─────────────────────────────────────────
    const { rows: [holder] } = await pool.query(
      `SELECT ${RESERVATION_COLUMNS} FROM ses_reservations
       WHERE event_id=$1 AND band=$2 AND mode=$3 AND status <> 'RELEASED'
         AND during @> NOW() LIMIT 1`, [ev.id, '20m', 'PH']);
    check('currentHolder finds the live slot', holder?.op_call === 'W0AAA');

    // ── app/api/ses/reservations/[id] PATCH extend ───────────────────────
    const { rows: [extended] } = await pool.query(
      `UPDATE ses_reservations
       SET during = tstzrange(lower(during), NOW() + ($2 || ' minutes')::interval, '[)')
       WHERE id = $1 RETURNING ${RESERVATION_COLUMNS}`, [slot.id, String(15)]);
    check('extend slot (minutes interval cast)', !!extended?.ends_at);

    // ── release clamps with GREATEST so a future slot can't invert ───────
    const { rows: [future] } = await pool.query(
      `INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
       VALUES ($1,'W3DDD','40m','CW', tstzrange(NOW() + interval '5 hours', NOW() + interval '7 hours','[)'))
       RETURNING id`, [ev.id]);
    let releaseErr = null;
    try {
      await pool.query(
        `UPDATE ses_reservations SET status='RELEASED',
           during = tstzrange(lower(during), GREATEST(lower(during), NOW()), '[)')
         WHERE id=$1`, [future.id]);
    } catch (e) { releaseErr = e.message; }
    check('cancelling a not-yet-started slot does not invert the range',
      releaseErr === null, releaseErr || '');

    // ── lib/events.ts isDupeQSO, both rules ──────────────────────────────
    await pool.query(
      `INSERT INTO qsos (event_id, callsign, band, mode, datetime_utc, is_dupe)
       VALUES ($1,'K1ABC','20m','PH', NOW() - interval '3 days', false)`, [ev.id]);
    const dayClause =
      "AND (datetime_utc AT TIME ZONE 'UTC')::date = ($5::timestamptz AT TIME ZONE 'UTC')::date";
    const { rows: dayHit } = await pool.query(
      `SELECT id FROM qsos WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4
         AND is_dupe=false ${dayClause} LIMIT 1`,
      [ev.id, 'K1ABC', '20m', 'PH', new Date()]);
    const { rows: eventHit } = await pool.query(
      `SELECT id FROM qsos WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4
         AND is_dupe=false LIMIT 1`, [ev.id, 'K1ABC', '20m', 'PH']);
    check('DAY rule: a contact 3 days ago is not a dupe today', dayHit.length === 0);
    check('EVENT rule: the same contact is a dupe', eventHit.length === 1);

    // ── app/api/import/adif idempotency window ───────────────────────────
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600e3);
    const { rows: seen } = await pool.query(
      `SELECT id FROM qsos WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4
         AND ABS(EXTRACT(EPOCH FROM (datetime_utc - $5::timestamptz))) <= $6 LIMIT 1`,
      [ev.id, 'K1ABC', '20m', 'PH', threeDaysAgo, 120]);
    const { rows: unseen } = await pool.query(
      `SELECT id FROM qsos WHERE event_id=$1 AND callsign=$2 AND band=$3 AND mode=$4
         AND ABS(EXTRACT(EPOCH FROM (datetime_utc - $5::timestamptz))) <= $6 LIMIT 1`,
      [ev.id, 'K1ABC', '20m', 'PH', new Date(), 120]);
    check('import idempotency: a re-imported QSO is detected', seen.length === 1);
    check('import idempotency: a genuinely new QSO is not', unseen.length === 0);

    // ── app/api/qso INSERT with the full SES column set ──────────────────
    const { rows: [qso] } = await pool.query(
      `INSERT INTO qsos (event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
         rcvd_class, rcvd_section, operator_call, station_number, is_dupe,
         rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment, adif_mode, freq_khz)
       VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [ev.id,'K2XYZ','20m','PH',null,null,null,'MN','W0AAA',1,false,
       '59','57','Dave','Duluth','EN36','portable','SSB',14250]);
    check('SES QSO insert keeps class NULL but records the section',
      qso.sent_class === null && qso.rcvd_section === 'MN' && qso.freq_khz === 14250);

    // ── app/api/ses/operators upsert must not blank existing fields ──────
    await pool.query(
      `INSERT INTO ses_operators (event_id, op_call, grid, state) VALUES ($1,'W0AAA','EN34','MN')`,
      [ev.id]);
    const { rows: [op] } = await pool.query(
      `INSERT INTO ses_operators (event_id, op_call, op_name, grid, state, county, dxcc, approved)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (event_id, op_call) DO UPDATE SET
         op_name = COALESCE(EXCLUDED.op_name, ses_operators.op_name),
         grid    = COALESCE(EXCLUDED.grid,    ses_operators.grid),
         state   = COALESCE(EXCLUDED.state,   ses_operators.state)
       RETURNING *`, [ev.id,'W0AAA','Dave',null,null,null,null,true]);
    check('roster upsert keeps grid/state when only a name is sent',
      op.grid === 'EN34' && op.state === 'MN' && op.op_name === 'Dave');

    // ── grants: the app role is DML-only and must still reach these ──────
    const { rows: [priv] } = await pool.query(
      `SELECT has_table_privilege('ezfd','ses_reservations','INSERT') AS r,
              has_table_privilege('ezfd','ses_operators','INSERT')    AS o`);
    check('the ezfd role has DML on both SES tables', priv.r && priv.o);
  } finally {
    await pool.query('DELETE FROM events WHERE id = $1', [ev.id]);
    await pool.end();
  }

  console.log(failures === 0 ? '\nAll query tests passed.' : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('threw:', e.message, e.code || '');
  process.exit(1);
});
