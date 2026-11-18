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

    // ── ezfd_recompute_dupes, scoped to one group, both rules ────────────
    // What every insert, edit, delete and restore calls. The DAY event here
    // must not flag a contact three days ago; an EVENT event must, and
    // deleting the first of two must promote the second.
    await pool.query(
      `INSERT INTO qsos (event_id, callsign, band, mode, datetime_utc, is_dupe)
       VALUES ($1,'K1ABC','20m','PH', NOW() - interval '3 days', false),
              ($1,'K1ABC','20m','PH', NOW(), false)`, [ev.id]);
    await pool.query('SELECT ezfd_recompute_dupes($1, $2, $3, $4)', [ev.id, 'K1ABC', '20m', 'PH']);
    const { rows: dayRows } = await pool.query(
      `SELECT is_dupe FROM qsos WHERE event_id=$1 AND callsign='K1ABC' ORDER BY datetime_utc`, [ev.id]);
    check('DAY rule: a contact 3 days ago is not a dupe today',
      dayRows.length === 2 && dayRows.every(r => !r.is_dupe));
    // The second row is today's, and the idempotency check below expects
    // only the old one.
    await pool.query(`DELETE FROM qsos WHERE event_id=$1 AND callsign='K1ABC' AND datetime_utc > NOW() - interval '1 day'`, [ev.id]);

    const fdCode = 'QTFD' + Math.floor(Math.random() * 10);
    await pool.query('DELETE FROM events WHERE join_code = $1', [fdCode]);
    const { rows: [fd] } = await pool.query(
      `INSERT INTO events (join_code, club_name, club_call, event_type, class, arrl_section, dupe_rule)
       VALUES ($1,'Query Test FD','N0CALL','FD','2A','MN','EVENT') RETURNING id`, [fdCode]);
    try {
      const { rows: two } = await pool.query(
        `INSERT INTO qsos (event_id, callsign, band, mode, datetime_utc, is_dupe)
         VALUES ($1,'W1AW','40m','CW', NOW() - interval '1 hour', false),
                ($1,'W1AW','40m','CW', NOW(), false)
         RETURNING id, datetime_utc`, [fd.id]);
      await pool.query('SELECT ezfd_recompute_dupes($1, $2, $3, $4)', [fd.id, 'W1AW', '40m', 'CW']);
      const flags = async () => (await pool.query(
        `SELECT is_dupe FROM qsos WHERE event_id=$1 AND deleted_at IS NULL ORDER BY datetime_utc`,
        [fd.id])).rows.map(r => r.is_dupe);
      const before = await flags();
      check('EVENT rule: the second of two contacts is the dupe',
        before.length === 2 && !before[0] && before[1], JSON.stringify(before));

      const first = two.sort((a, b) => a.datetime_utc - b.datetime_utc)[0];
      await pool.query('UPDATE qsos SET deleted_at = NOW() WHERE id = $1', [first.id]);
      await pool.query('SELECT ezfd_recompute_dupes($1, $2, $3, $4)', [fd.id, 'W1AW', '40m', 'CW']);
      const after = await flags();
      check('deleting the first of two promotes the second', after.length === 1 && !after[0],
        JSON.stringify(after));

      // A scoped pass leaves other groups alone: a group the caller did not
      // name keeps a wrong flag rather than being silently rewritten.
      await pool.query(
        `INSERT INTO qsos (event_id, callsign, band, mode, datetime_utc, is_dupe)
         VALUES ($1,'K9OTH','20m','PH', NOW(), true)`, [fd.id]);
      await pool.query('SELECT ezfd_recompute_dupes($1, $2, $3, $4)', [fd.id, 'W1AW', '40m', 'CW']);
      const { rows: [other] } = await pool.query(
        `SELECT is_dupe FROM qsos WHERE event_id=$1 AND callsign='K9OTH'`, [fd.id]);
      check('a scoped recompute touches only its own group', other.is_dupe === true);
      await pool.query('SELECT ezfd_recompute_dupes($1)', [fd.id]);
      const { rows: [fixed] } = await pool.query(
        `SELECT is_dupe FROM qsos WHERE event_id=$1 AND callsign='K9OTH'`, [fd.id]);
      check('the whole-event recompute still works with one argument', fixed.is_dupe === false);

      // ── app/api/qso INSERT dates a queued contact by its age ───────────
      const { rows: [aged] } = await pool.query(
        `INSERT INTO qsos (event_id, callsign, band, mode, datetime_utc, is_dupe)
         VALUES ($1,'K2AGE','20m','PH', NOW() - make_interval(secs => $2::double precision), false)
         RETURNING EXTRACT(EPOCH FROM (NOW() - datetime_utc)) AS age`, [fd.id, 1200]);
      check('a queued contact is dated by its age, not its arrival',
        Math.abs(Number(aged.age) - 1200) < 1, String(aged.age));

      // ── NOTIFY payload guard ────────────────────────────────────────────
      // A row too big for NOTIFY must not fail the write it announces.
      let bigErr = null;
      try {
        await pool.query(
          `INSERT INTO qsos (event_id, callsign, band, mode, datetime_utc, comment)
           VALUES ($1,'K2BIG','20m','PH', NOW(), repeat('x', 9000))`, [fd.id]);
      } catch (e) { bigErr = e.message; }
      check('a row larger than the NOTIFY limit still inserts', bigErr === null, bigErr || '');

      // ── app/api/import/adif batched insert ─────────────────────────────
      const at = new Date(Date.now() - 600e3);
      const importSql = `INSERT INTO qsos
           (event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
            rcvd_class, rcvd_section, operator_call, station_number, is_dupe,
            adif_mode, freq_khz)
         SELECT $1, r.callsign, r.band, r.mode, r.at, $2, $3,
                NULLIF(r.rcvd_class, ''), NULLIF(r.rcvd_section, ''), $4, $5, false,
                r.adif_mode, r.freq_khz
           FROM unnest($6::text[], $7::text[], $8::text[], $9::timestamptz[],
                       $10::text[], $11::text[], $12::text[], $13::int[])
                AS r(callsign, band, mode, at, rcvd_class, rcvd_section, adif_mode, freq_khz)
          WHERE NOT EXISTS (
            SELECT 1 FROM qsos q
             WHERE q.event_id = $1 AND q.callsign = r.callsign AND q.band = r.band
               AND q.mode = r.mode AND q.deleted_at IS NULL
               AND ABS(EXTRACT(EPOCH FROM (q.datetime_utc - r.at))) <= $14)
         RETURNING id`;
      const importArgs = [fd.id, '2A', 'MN', 'N0CALL', 1,
        ['K3IMP', 'K4IMP'], ['20m', '40m'], ['DIG', 'CW'], [at, at],
        ['1D', ''], ['MN', ''], ['FT8', null], [14074, null], 120];
      const { rows: imp1 } = await pool.query(importSql, importArgs);
      const { rows: imp2 } = await pool.query(importSql, importArgs);
      const { rows: [ft8] } = await pool.query(
        `SELECT adif_mode, freq_khz, rcvd_class FROM qsos WHERE event_id=$1 AND callsign='K3IMP'`, [fd.id]);
      check('ADIF import inserts the batch once, and a re-import is a no-op',
        imp1.length === 2 && imp2.length === 0, `${imp1.length}, ${imp2.length}`);
      check('ADIF import keeps the submode and frequency',
        ft8.adif_mode === 'FT8' && ft8.freq_khz === 14074 && ft8.rcvd_class === '1D');

      // ── restore join codes come from the API's alphabet ─────────────────
      const { rows: [jc] } = await pool.query('SELECT ezfd_new_join_code() AS code');
      check('restored join codes use the 32-symbol alphabet',
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(jc.code), jc.code);
    } finally {
      await pool.query('DELETE FROM events WHERE id = $1', [fd.id]);
    }

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

    // ── presence is keyed per radio, not per person ──────────────────────
    //
    // One operator running two rigs is one callsign in two windows, each on
    // its own band. With the station out of the primary key the second window
    // overwrote the first's row, so the band activity panel could only ever
    // show one of the two — and going QRT on either cleared both.
    const upsertPresence = (station, band, mode) => pool.query(
      `INSERT INTO presence (event_id, op_call, station, band, mode, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (event_id, op_call, station)
       DO UPDATE SET band=$4, mode=$5, updated_at=NOW()`,
      [ev.id, 'W0AAA', station, band, mode]);

    await upsertPresence(1, '20m', 'PH');
    await upsertPresence(2, '40m', 'CW');
    const { rows: both } = await pool.query(
      `SELECT station, band, mode FROM presence
        WHERE event_id=$1 AND op_call='W0AAA' ORDER BY station`, [ev.id]);
    check('two radios for one operator keep separate presence rows',
      both.length === 2 && both[0].band === '20m' && both[1].band === '40m',
      both.map(r => `${r.station}:${r.band}`).join(' '));

    // Re-posting a radio's own band must update in place, not add a third row.
    await upsertPresence(2, '15m', 'CW');
    const { rows: still } = await pool.query(
      `SELECT station, band FROM presence
        WHERE event_id=$1 AND op_call='W0AAA' ORDER BY station`, [ev.id]);
    check('a radio moving band updates its own row rather than adding one',
      still.length === 2 && still[1].band === '15m',
      still.map(r => `${r.station}:${r.band}`).join(' '));

    // QRT is per radio: shutting one down leaves the other on the air.
    await pool.query(
      `DELETE FROM presence WHERE event_id=$1 AND op_call=$2 AND station=$3`,
      [ev.id, 'W0AAA', 2]);
    const { rows: left } = await pool.query(
      `SELECT station, band FROM presence WHERE event_id=$1 AND op_call='W0AAA'`,
      [ev.id]);
    check('QRT on one radio leaves the operator\'s other radio on the air',
      left.length === 1 && left[0].station === 1,
      left.map(r => `${r.station}:${r.band}`).join(' ') || 'none left');

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
