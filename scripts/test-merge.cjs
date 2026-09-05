#!/usr/bin/env node
/**
 * Merging two instances of the same event (#20).
 *
 * Restoring an export recreates an event; merging reconciles one that ran in
 * two places at once — a field server at the site and the hosted instance —
 * into a single log. The whole thing is SQL (ezfd_merge_event and
 * ezfd_recompute_dupes in db/schema.sql), so it is asserted against a real
 * database rather than a mock.
 *
 * The cases that matter are the ones where a wrong answer silently changes
 * the log a club submits:
 *
 *   * a contact counted twice, or one dropped, when the two copies overlap
 *   * dupe flags left as each instance computed them, which are both wrong
 *     for the union
 *   * a contact deleted here resurrected by the other copy
 *   * two different events merged into one because nothing checked identity
 *   * an edit made on both sides resolved silently in favour of one
 *
 *   DATABASE_URL=postgres://... node scripts/test-merge.cjs
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/ezfd',
});

let failures = 0;
const ok = (m, d = '') => console.log(`ok    ${m}${d ? `  (${d})` : ''}`);
const no = (m, d = '') => { failures++; console.log(`FAIL  ${m}${d ? `  ${d}` : ''}`); };
const eq = (actual, expected, m) =>
  actual === expected ? ok(m) : no(m, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
const truthy = (v, m, d) => (v ? ok(m) : no(m, d));

const T = '2026-06-27T18:00:00Z';
const at = mins => new Date(Date.parse(T) + mins * 60_000).toISOString();

let seq = 0;
const uid = () => {
  seq++;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

/** A QSO as it appears inside an export payload. */
const qso = (over = {}) => ({
  id: uid(),
  callsign: 'W1AW',
  band: '20m',
  mode: 'PH',
  datetime_utc: at(0),
  rcvd_class: '2A',
  rcvd_section: 'CT',
  operator_call: 'W0AAA',
  station_number: 1,
  is_dupe: false,
  is_gota: false,
  created_at: at(0),
  ...over,
});

async function makeEvent(client, over = {}) {
  const code = `M${String(++seq).padStart(5, '0')}`.slice(0, 6).toUpperCase();
  const { rows } = await client.query(
    `INSERT INTO events (join_code, club_name, club_call, class, arrl_section,
                         event_type, power, dupe_rule, bonuses)
     VALUES ($1,'Test Club','W0TST',$2,$3,$4,$5,$6,$7) RETURNING id, join_code`,
    [code, over.class ?? '3A', over.arrl_section ?? 'MN', over.event_type ?? 'FD',
     over.power ?? 'LOW', over.dupe_rule ?? 'EVENT', over.bonuses ?? {}],
  );
  return rows[0];
}

async function addQso(client, eventId, q) {
  await client.query(
    `INSERT INTO qsos (id, event_id, callsign, band, mode, datetime_utc,
                       rcvd_class, rcvd_section, operator_call, station_number,
                       is_dupe, is_gota, created_at, deleted_at, deleted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [q.id, eventId, q.callsign, q.band, q.mode, q.datetime_utc,
     q.rcvd_class ?? null, q.rcvd_section ?? null, q.operator_call ?? null,
     q.station_number ?? 1, q.is_dupe ?? false, q.is_gota ?? false,
     q.created_at ?? q.datetime_utc, q.deleted_at ?? null, q.deleted_by ?? null],
  );
}

/** Merge, expecting it to raise. A RAISE aborts the surrounding transaction,
 *  so the attempt runs inside a savepoint that is rolled back to. */
async function mergeExpectingError(client, targetId, payload, opts = {}) {
  await client.query('SAVEPOINT attempt');
  try {
    await merge(client, targetId, payload, opts);
    await client.query('RELEASE SAVEPOINT attempt');
    return null;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    return e.message;
  }
}

const merge = (client, targetId, payload, opts = {}) =>
  client.query('SELECT ezfd_merge_event($1,$2::jsonb,$3,$4) AS r', [
    targetId, JSON.stringify(payload), opts.window ?? 120, opts.allowDifferentOrigin ?? false,
  ]).then(r => r.rows[0].r);

const liveQsos = (client, eventId) =>
  client.query(
    `SELECT callsign, band, mode, is_dupe, datetime_utc FROM qsos
      WHERE event_id=$1 AND deleted_at IS NULL ORDER BY datetime_utc, callsign`,
    [eventId],
  ).then(r => r.rows);

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── identity survives a round trip ────────────────────────────────────
    // The issue's central worry: "retrofitting identity onto events already
    // in the wild is much worse." It costs nothing because an event with no
    // origin_event_id is its own origin.
    console.log('\n-- event identity --');
    {
      const ev = await makeEvent(client);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const exported = rows[0].x[0];
      eq(exported.origin_event_id, ev.id,
        'an event that was never imported exports itself as its own origin');

      const { rows: r2 } = await client.query(
        'SELECT new_code FROM ezfd_restore_events($1::jsonb)', [JSON.stringify(exported)]);
      const { rows: r3 } = await client.query(
        'SELECT id, origin_event_id FROM events WHERE join_code=$1', [r2[0].new_code]);
      eq(r3[0].origin_event_id, ev.id, 'and the restored copy carries the original identity');
      truthy(r3[0].id !== ev.id, 'while still being a different row');
    }

    // ── the merge refuses what it cannot prove ────────────────────────────
    console.log('\n-- two different events are not merged --');
    {
      const a = await makeEvent(client);
      const b = await makeEvent(client);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [b.id]);
      const raised = await mergeExpectingError(client, a.id, rows[0].x[0]);
      truthy(raised && /different activation/.test(raised),
        'merging an unrelated event is refused', raised ?? 'no error raised');

      // The escape hatch exists because two copies of one weekend can have
      // been created independently, before anything linked them.
      const forced = await merge(client, a.id, rows[0].x[0], { allowDifferentOrigin: true });
      eq(forced.origin_matched, false, 'and an explicit override records that identity did not match');
    }

    // ── the QSO half ──────────────────────────────────────────────────────
    console.log('\n-- contacts are added once, not twice --');
    {
      const ev = await makeEvent(client);
      const shared = qso({ callsign: 'K1ABC', datetime_utc: at(0) });
      await addQso(client, ev.id, shared);

      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      // The remote copy has the shared contact plus two of its own.
      payload.qsos = [
        shared,
        qso({ callsign: 'K2DEF', datetime_utc: at(10) }),
        qso({ callsign: 'K3GHI', datetime_utc: at(20) }),
      ];

      const r = await merge(client, ev.id, payload);
      eq(r.qsos_added, 2, 'the two contacts only the other instance had are added');
      eq(r.already_present_by_id, 1, 'the shared one is recognised by its preserved id');
      eq((await liveQsos(client, ev.id)).length, 3, 'and the log holds three contacts');

      // Idempotency is the property that makes this safe to retry after a
      // half-finished transfer.
      const again = await merge(client, ev.id, payload);
      eq(again.qsos_added, 0, 'running the same merge again adds nothing');
      eq(again.already_present_by_id, 3, 'because the ids were preserved on insert');
      eq((await liveQsos(client, ev.id)).length, 3, 'and the log still holds three');
    }

    console.log('\n-- the same contact logged independently in both places --');
    {
      const ev = await makeEvent(client);
      // Same contact, different row id, stamped 40 seconds apart: two servers
      // took it at slightly different moments.
      await addQso(client, ev.id, qso({ callsign: 'K4JKL', datetime_utc: at(0) }));
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      payload.qsos = [qso({ callsign: 'K4JKL', datetime_utc: at(0.67) })];

      const r = await merge(client, ev.id, payload);
      eq(r.qsos_added, 0, 'a contact 40s apart is the same contact, not a new one');
      eq(r.already_present_by_time, 1, 'matched on the time window rather than the id');
      eq((await liveQsos(client, ev.id)).length, 1, 'so it is not doubled');

      // Outside the window it is a different contact — a station genuinely
      // worked twice, which the dupe rule then flags rather than the merge
      // silently dropping.
      const payload2 = { ...payload, qsos: [qso({ callsign: 'K4JKL', datetime_utc: at(30) })] };
      const r2 = await merge(client, ev.id, payload2);
      eq(r2.qsos_added, 1, 'a contact half an hour later is a separate contact');
    }

    // ── dupe recomputation ────────────────────────────────────────────────
    console.log('\n-- dupe flags are recomputed across the union --');
    {
      const ev = await makeEvent(client, { dupe_rule: 'EVENT' });
      // Each instance saw only its own contact, so each called its own the
      // first — and both are wrong for the merged whole.
      await addQso(client, ev.id, qso({ callsign: 'K5MNO', datetime_utc: at(60), is_dupe: false }));
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      payload.qsos = [qso({ callsign: 'K5MNO', datetime_utc: at(5), is_dupe: false })];

      const r = await merge(client, ev.id, payload);
      eq(r.qsos_added, 1, 'both contacts survive the merge');
      const rowsAfter = await liveQsos(client, ev.id);
      eq(rowsAfter.length, 2, 'two contacts with the same call, band and mode');
      eq(rowsAfter[0].is_dupe, false, 'the earlier one counts');
      eq(rowsAfter[1].is_dupe, true, 'and the later one is the dupe, whichever instance logged it');
      truthy(r.dupe_flags_changed >= 1, 'the recompute reports what it changed');
    }

    console.log('\n-- the DAY rule partitions by UTC date --');
    {
      const ev = await makeEvent(client, { dupe_rule: 'DAY', event_type: 'SES' });
      await client.query('UPDATE events SET class=NULL, arrl_section=NULL WHERE id=$1', [ev.id]);
      await addQso(client, ev.id, qso({ callsign: 'K6PQR', datetime_utc: '2026-06-27T18:00:00Z' }));
      await addQso(client, ev.id, qso({ callsign: 'K6PQR', datetime_utc: '2026-06-27T19:00:00Z' }));
      await addQso(client, ev.id, qso({ callsign: 'K6PQR', datetime_utc: '2026-06-28T18:00:00Z' }));
      await client.query('SELECT ezfd_recompute_dupes($1)', [ev.id]);
      const rowsAfter = await liveQsos(client, ev.id);
      eq(rowsAfter.map(r => r.is_dupe).join(','), 'false,true,false',
        'the same station worked again the next day is not a dupe');
    }

    console.log('\n-- a deleted contact does not hold the first slot --');
    {
      const ev = await makeEvent(client, { dupe_rule: 'EVENT' });
      await addQso(client, ev.id, qso({ callsign: 'K7STU', datetime_utc: at(0), deleted_at: at(1), deleted_by: 'W0AAA' }));
      await addQso(client, ev.id, qso({ callsign: 'K7STU', datetime_utc: at(10) }));
      await client.query('SELECT ezfd_recompute_dupes($1)', [ev.id]);
      const rowsAfter = await liveQsos(client, ev.id);
      eq(rowsAfter.length, 1, 'only the live contact is in the log');
      eq(rowsAfter[0].is_dupe, false,
        'and it counts — deleting the first promotes the second, rather than leaving it a dupe of nothing');
    }

    // ── deletions are respected, not laundered ────────────────────────────
    console.log('\n-- a merge does not resurrect a deleted contact --');
    {
      const ev = await makeEvent(client);
      const removed = qso({ callsign: 'K8VWX', datetime_utc: at(0) });
      await addQso(client, ev.id, { ...removed, deleted_at: at(5), deleted_by: 'W0AAA' });
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      // The other instance still has it live — it never saw the deletion.
      payload.qsos = [removed];

      const r = await merge(client, ev.id, payload);
      eq(r.qsos_added, 0, 'the contact is recognised, not re-added');
      eq(r.skipped_deleted_here, 1, 'and the collision with the deletion is reported');
      eq((await liveQsos(client, ev.id)).length, 0, 'the deletion stands');
    }

    console.log('\n-- nor when the other instance logged it under its own id --');
    {
      // The dangerous shape: no id in common, so the match has to come from
      // the time window — which is the read path that would resurrect a
      // deletion if it filtered deleted rows out and called the contact
      // absent. The ADIF import does exactly that, deliberately, because a
      // file somebody chose to import is a second explicit act. A merge is
      // bulk and automatic, so it goes the other way.
      const ev = await makeEvent(client);
      await addQso(client, ev.id, qso({
        callsign: 'N3CCC', datetime_utc: at(0), deleted_at: at(5), deleted_by: 'W0AAA',
      }));
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      // Same contact, logged independently over there: different id, 30s off.
      payload.qsos = [qso({ callsign: 'N3CCC', datetime_utc: at(0.5) })];

      const r = await merge(client, ev.id, payload);
      eq(r.qsos_added, 0, 'the deleted contact is still recognised through the time window');
      eq(r.already_present_by_time, 1, 'matched on time, since the ids never met');
      eq(r.skipped_deleted_here, 1, 'and the collision is reported rather than passed over');
      eq((await liveQsos(client, ev.id)).length, 0,
        'the deletion stands — a bulk merge does not undo an operator\'s delete');
    }

    console.log('\n-- a contact deleted over there arrives deleted --');
    {
      const ev = await makeEvent(client);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      payload.qsos = [qso({ callsign: 'K9YZA', datetime_utc: at(0), deleted_at: at(9), deleted_by: 'W0BBB' })];

      const r = await merge(client, ev.id, payload);
      eq(r.qsos_added, 1, 'it is carried across');
      eq((await liveQsos(client, ev.id)).length, 0, 'but not as a live contact');
      const { rows: d } = await client.query(
        'SELECT deleted_by FROM qsos WHERE event_id=$1', [ev.id]);
      eq(d[0].deleted_by, 'W0BBB', 'with the audit trail intact rather than laundered');
    }

    // ── conflicts are reported, never resolved ────────────────────────────
    console.log('\n-- an edit on both sides is flagged, not silently picked --');
    {
      const ev = await makeEvent(client);
      const contact = qso({ callsign: 'N1AAA', datetime_utc: at(0), rcvd_section: 'CT' });
      await addQso(client, ev.id, contact);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      // Same contact, corrected differently in the other instance.
      payload.qsos = [{ ...contact, rcvd_section: 'EMA' }];

      const r = await merge(client, ev.id, payload);
      eq(r.conflicts.length, 1, 'the disagreement is reported');
      eq(r.conflicts[0].fields.join(','), 'rcvd_section', 'naming the field that differs');
      const after = await client.query(
        'SELECT rcvd_section FROM qsos WHERE id=$1', [contact.id]);
      eq(after.rows[0].rcvd_section, 'CT',
        "and this instance's value stands — a merge does not overwrite an operator's correction");
    }

    console.log('\n-- a difference that changes nothing submitted is not a conflict --');
    {
      const ev = await makeEvent(client);
      const contact = qso({ callsign: 'N2BBB', datetime_utc: at(0) });
      await addQso(client, ev.id, contact);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      payload.qsos = [{ ...contact, comment: 'nice signal', rcvd_name: 'Bob' }];
      const r = await merge(client, ev.id, payload);
      eq(r.conflicts.length, 0, 'a differing comment is not worth a human reading a report for');
    }

    console.log('\n-- settings edited on both sides are reported, not applied --');
    {
      const ev = await makeEvent(client, { class: '3A', bonuses: { w1aw: true } });
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = { ...rows[0].x[0], class: '4A', bonuses: { w1aw: false } };
      payload.qsos = [];
      const r = await merge(client, ev.id, payload);
      eq(r.settings_differ.sort().join(','), 'bonuses,class', 'both differences are named');
      const after = await client.query('SELECT class FROM events WHERE id=$1', [ev.id]);
      eq(after.rows[0].class, '3A', 'and the target keeps its own settings');
    }

    // ── the pieces around the QSOs ────────────────────────────────────────
    console.log('\n-- the roster is added to, never overwritten --');
    {
      const ev = await makeEvent(client, { event_type: 'SES' });
      await client.query('UPDATE events SET class=NULL, arrl_section=NULL WHERE id=$1', [ev.id]);
      await client.query(
        `INSERT INTO ses_operators (event_id, op_call, grid, state) VALUES ($1,'W0AAA','EN34','MN')`,
        [ev.id]);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      payload.qsos = [];
      payload.ses_operators = [
        { op_call: 'W0AAA', grid: 'FN31', state: 'CT' },   // already here, different grid
        { op_call: 'W0CCC', grid: 'EM48', state: 'MO' },   // new
      ];
      const r = await merge(client, ev.id, payload);
      eq(r.roster_added, 1, 'the operator this instance did not have is added');
      eq(r.roster_already_present, 1, 'the one it did have is left alone');
      const { rows: g } = await client.query(
        `SELECT grid FROM ses_operators WHERE event_id=$1 AND op_call='W0AAA'`, [ev.id]);
      eq(g[0].grid, 'EN34',
        'keeping the grid this instance holds — it is the only source for the ADIF MY_* fields');
    }

    console.log('\n-- checkout history is filed as released --');
    {
      const ev = await makeEvent(client, { event_type: 'SES' });
      await client.query('UPDATE events SET class=NULL, arrl_section=NULL WHERE id=$1', [ev.id]);
      // Both instances held 20m PH over the same span. The exclusion
      // constraint only ever guaranteed that could not happen within one
      // database, so a merge has to cope with it rather than fail.
      await client.query(
        `INSERT INTO ses_reservations (event_id, op_call, band, mode, during, status)
         VALUES ($1,'W0AAA','20m','PH',tstzrange($2::timestamptz,$3::timestamptz,'[)'),'RESERVED')`,
        [ev.id, at(0), at(120)]);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      payload.qsos = [];
      payload.ses_reservations = [
        { op_call: 'W0BBB', band: '20m', mode: 'PH', starts_at: at(30), ends_at: at(90), status: 'RESERVED' },
      ];
      const r = await merge(client, ev.id, payload);
      eq(r.reservations_added, 1, 'the overlapping claim from the other instance is kept as history');
      const { rows: st } = await client.query(
        `SELECT status FROM ses_reservations WHERE event_id=$1 AND op_call='W0BBB'`, [ev.id]);
      eq(st[0].status, 'RELEASED',
        'as RELEASED, which is what lets the exclusion constraint accept it');

      const again = await merge(client, ev.id, payload);
      eq(again.reservations_added, 0, 'and a second run does not stack duplicate history');
    }

    // ── the report is the deliverable ─────────────────────────────────────
    console.log('\n-- the merge reports rather than succeeding silently --');
    {
      const ev = await makeEvent(client);
      const { rows } = await client.query('SELECT ezfd_export_events($1) AS x', [ev.id]);
      const payload = rows[0].x[0];
      payload.qsos = [];
      const r = await merge(client, ev.id, payload);
      for (const key of ['target_join_code', 'origin_event_id', 'origin_matched',
                         'qsos_added', 'already_present_by_id', 'already_present_by_time',
                         'skipped_deleted_here', 'conflicts', 'roster_added',
                         'roster_already_present', 'reservations_added',
                         'dupe_flags_changed', 'settings_differ']) {
        truthy(key in r, `the report carries ${key}`);
      }
    }

    // The window lives in lib/events.ts because the ADIF import and the merge
    // both use it. The SQL default is a fallback for a direct psql call, and a
    // fallback that disagrees with the real value is worse than none.
    console.log('\n-- the time window has one definition --');
    {
      const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'events.ts'), 'utf8');
      const m = /export const MERGE_WINDOW_SECONDS = (\d+);/.exec(src);
      truthy(m, 'lib/events.ts exports MERGE_WINDOW_SECONDS');
      const { rows } = await client.query(
        `SELECT pg_get_function_arguments(oid) AS args FROM pg_proc WHERE proname='ezfd_merge_event'`);
      const d = /p_window_seconds integer DEFAULT (\d+)/.exec(rows[0].args);
      truthy(d, "ezfd_merge_event's window is a parameter, not a hardcoded literal");
      if (m && d) eq(d[1], m[1], "and its default matches lib/events.ts rather than drifting");
    }

    console.log('\n-- merge takes one event, restore takes many --');
    {
      const ev = await makeEvent(client);
      const { rows } = await client.query('SELECT ezfd_export_events(NULL) AS x');
      const raised = await mergeExpectingError(client, ev.id, rows[0].x);
      truthy(raised && /exactly one event/.test(raised),
        'a whole-database export is refused rather than merged arbitrarily', raised ?? 'no error');
    }

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nthrew: ${err.message}`);
    failures++;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(failures === 0 ? '\nAll merge tests passed.' : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
})();
