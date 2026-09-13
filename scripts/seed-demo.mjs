/**
 * Sample data for the documentation screenshots.
 *
 *   node scripts/seed-demo.mjs http://127.0.0.1:3000
 *
 * `AGENTS.md` asks for screenshots captured against a built server with
 * realistic fixture data, and names two artefacts that have shipped before:
 * every QSO stamped with the same second, and a false band-conflict banner
 * from an operator with no presence row. Both come from a fixture written for
 * the database rather than for the screen, so this one is written for the
 * screen:
 *
 *   * Contacts go in through the real API, so scoring, dupe detection and
 *     section counting are computed the way an event computes them.
 *   * `datetime_utc` is then spread across a plausible weekend in SQL, because
 *     posting 240 contacts in a loop stamps them within two seconds and the
 *     rolling-hour rate panel reads the total instead of a rate. Note it is
 *     `datetime_utc` the panel and the log read, not `created_at`.
 *   * Bands and modes are weighted the way a weekend actually falls. Cycling
 *     them with a fixed stride gives every band an identical count, which is
 *     as obviously synthetic as one timestamp.
 *   * Operators get presence rows, so the panels that read presence show the
 *     live state rather than the empty one.
 *
 * The section list is deliberately not every section: a clean sweep is not
 * what a screenshot should imply, and the gaps are what the Needed view and
 * the map's unworked fill are for.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';

// Deterministic, so re-running produces the same log and a re-taken
// screenshot differs only where the app changed.
let seed = 20260613;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (weighted) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of weighted) { if ((r -= w) < 0) return v; }
  return weighted[0][0];
};

const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};

// Worked sections. `ON` is deliberately absent: RAC replaced it with
// ONE/ONN/ONS/GH, and sending it would land in unknown_sections rather than
// count -- which is correct behaviour, and not what a screenshot should show.
const WORKED = [
  'MN','WI','IA','ND','SD','NE','KS','MO','IL','IN','OH','MI','KY','TN','AL','GA',
  'NFL','SFL','WCF','SC','NC','VA','WV','MDC','DE','EPA','WPA','SNJ','NNJ','NLI',
  'ENY','NNY','WNY','CT','RI','EMA','WMA','NH','VT','ME','AR','LA','MS','OK','NTX',
  'STX','WTX','NM','AZ','CO','UT','WY','MT','ID','OR','EWA','WWA','SB','SDG','ORG',
  'LAX','SV','SF','EB','SCV','SJV','PAC','AK','ONE','ONS','GH','MB','SK','AB','BC',
];
// 20m and 40m carry a Field Day weekend; 10m rarely does.
const BANDS = [['20m', 34], ['40m', 30], ['80m', 15], ['15m', 13], ['10m', 8]];
const MODES = [['PH', 55], ['CW', 32], ['DIG', 13]];
const CLASSES = [['1A',8],['2A',14],['3A',18],['4A',10],['5A',5],
                 ['1B',9],['2B',4],['1D',16],['1E',6],['2E',5],['1F',5]];
const OPS = ['W0LCA', 'K0MN', 'N0DUL', 'KD0XYZ', 'W0ABC'];

const callsign = (i) => {
  const pre = ['K', 'W', 'N', 'AA', 'KB', 'WA', 'NK', 'AC', 'KE', 'WB'][i % 10];
  const suf = String.fromCharCode(65 + (i % 26))
            + String.fromCharCode(65 + ((i * 7) % 26))
            + String.fromCharCode(65 + ((i * 13) % 26));
  return `${pre}${i % 10}${suf}`;
};

const ev = await post('/api/events', {
  club_name: 'Lake County ARC', club_call: 'W0LCA', event_type: 'FD',
  class: '3A', arrl_section: 'MN', power: 'LOW', event_year: 2026,
  location: 'Gooseberry Falls State Park, MN',
});
const join = ev.join_code ?? ev.event?.join_code;
const full = await (await fetch(`${BASE}/api/events/${join}`)).json();

let n = 0;
for (let i = 0; i < 260; i++) {
  // Every section gets worked, then the rest of the log falls where the bands
  // take it, which is what leaves some sections on one band and some on five.
  const section = i < WORKED.length ? WORKED[i] : WORKED[Math.floor(rnd() * WORKED.length)];
  await post('/api/qso', {
    event_id: full.id,
    callsign: callsign(i),
    band: pick(BANDS),
    mode: pick(MODES),
    operator_call: OPS[Math.floor(rnd() * OPS.length)],
    station_number: 1 + Math.floor(rnd() * 3),
    rcvd_class: pick(CLASSES),
    rcvd_section: section,
  });
  n++;
}

for (let s = 1; s <= 3; s++) {
  await post('/api/presence', {
    event_id: full.id, op_call: OPS[s - 1], station: s,
    band: ['20m', '40m', '15m'][s - 1], mode: s === 2 ? 'CW' : 'PH',
  }).catch(() => {});
}

console.log(JSON.stringify({ join_code: join, event_id: full.id, qsos: n }));
