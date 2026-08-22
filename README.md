# EzFD

A self-hosted, real-time, multi-operator logger for **ARRL Field Day**,
**Winter Field Day**, and **special event stations**.

Every operator logs into one shared log. Every QSO appears on every other
device within milliseconds. When the network drops — and at a Field Day site
it will — logging carries on locally and syncs when it comes back.

📖 **[Full documentation](docs/)**

<p align="center">
  <img src="docs/images/logging-screen.png" alt="The logging screen: entry form, band/mode, operators and live score" width="100%">
</p>

---

## What it does

**One log, many operators.** Operators join with a six-character code and
their callsign. No accounts, no setup per person. QSOs propagate live over
PostgreSQL `pg_notify` and Server-Sent Events, so duplicate checking and band
conflicts are accurate the moment someone else logs.

**Built for operating at speed.** Enter moves through the exchange and logs;
Tab wraps back to the callsign rather than escaping into the page. Callsign
lookups prefill from QRZ, the N1MM call history file and `MASTER.SCP`, without
ever overwriting something you typed. Night mode dims to 35% for the overnight
shift.

**Offline by design, not as an afterthought.** QSOs are written to local
storage first and sent second. A flaky link costs you nothing.

**Radios if you want them.** A local Python bridge connects any
Hamlib-supported rig, so band and mode follow the VFO. If the rig supports CAT
keying, a popout window gives F1–F12 macros, Run/S&P sets, adjustable auto-CQ
and ESM. The server is never involved.

**Digital modes.** WSJT-X and JTDX log straight into EzFD over a small relay,
or bulk-import any ADIF file. Imports are idempotent, so re-importing can't
double your log.

**Correct scoring.** QSO points × power multiplier + bonuses, with all 17
Field Day bonus categories tracked live. Sections do not multiply the score —
a detail that's easy to get wrong and expensive when you do.

**Special event stations.** A third event type for a callsign activated across
many operators and locations. Operators check the callsign out for a band and
mode, and a database constraint makes overlapping checkouts impossible — one
signal per band per mode, enforced rather than merely intended. Each operator's
own grid and state follow their contacts into the exported ADIF, which is what
LoTW needs from a station operated from several places.

**Exports that go where you need them.** ADIF for LoTW and QRZ, Cabrillo for
ARRL submission, a printable summary worksheet, and per-operator or
date-filtered ADIF slices.

<table>
<tr>
<td width="50%">
  <img src="docs/images/dashboard.png" alt="Live dashboard: section map, score, sections worked and operators"><br>
  <sub>Live dashboard — section map, score, and every operator's rate on a second screen</sub>
</td>
<td width="50%">
  <img src="docs/images/ses-checkout.png" alt="Special event call checkout panel, holding 20m PH"><br>
  <sub>Special event call checkout — one signal per band/mode, enforced by the database</sub>
</td>
</tr>
<tr>
<td width="50%">
  <img src="docs/images/summary-sheet.png" alt="Printable ARRL Field Day summary sheet"><br>
  <sub>Printable ARRL summary sheet — QSO totals, score calculation, bonuses and sections</sub>
</td>
<td width="50%">
  <img src="docs/images/create-event-ses.png" alt="Create event form for a special event station"><br>
  <sub>One event type for Field Day, Winter Field Day, or a special event station</sub>
</td>
</tr>
</table>

---

## Quick start

On a fresh Ubuntu or Debian machine with a DNS record pointing at it:

```bash
# git clone https://github.com/nreed97/EzFD.git /opt/ezfd-src
# cd /opt/ezfd-src
# bash deploy.sh
```

That installs Node, PostgreSQL, nginx and certbot, applies the schema, builds
the app, provisions TLS and registers a systemd service. Re-running it is the
update path and preserves your configuration.

Then open the site, create an event, and share the join code.

→ [Getting started](docs/getting-started.md) · [Deployment](docs/deployment.md)

## Running it locally

```bash
$ npm install
$ createdb ezfd && psql -d ezfd -f db/schema.sql
$ echo 'DATABASE_URL=postgres://localhost:5432/ezfd' > .env.local
$ npm run dev
```

→ [Development](docs/development.md)

---

## Documentation

**Running an event**
[Getting started](docs/getting-started.md) ·
[Operating](docs/operating.md) ·
[Field Day](docs/field-day.md) ·
[Special event stations](docs/special-events.md) ·
[Rig control and CW](docs/rig-control.md) ·
[Digital modes](docs/digital-modes.md) ·
[Troubleshooting](docs/troubleshooting.md)

**Running the server**
[Deployment](docs/deployment.md) ·
[Administration](docs/administration.md) ·
[Configuration](docs/configuration.md)

**Working on the code**
[Development](docs/development.md) ·
[Architecture](docs/architecture.md) ·
[Database](docs/database.md) ·
[HTTP API](docs/api.md)

---

## Built with

Next.js 16 (App Router, standalone output) · React 19 · PostgreSQL 16 ·
Tailwind v4 · Leaflet · Hamlib

## Contributing

`AGENTS.md` documents the conventions and the accumulated gotchas — worth
reading before changing anything non-obvious. `npx tsc --noEmit` and
`npm run build` must both be clean; CI additionally runs the schema,
query, restore and end-to-end suites.

When adding a test, break the thing it guards and watch it fail before
trusting it. That practice has already caught a bug the test was written to
prevent.

## Known issues

- [#12](https://github.com/nreed97/EzFD/issues/12) — the Cabrillo
  `CLAIMED-SCORE` header is computed separately from the app's scoring and is
  wrong. The score shown in the app is correct.
- [#13](https://github.com/nreed97/EzFD/issues/13) — eslint and shellcheck
  backlogs, keeping those CI gates advisory for now.
- [#14](https://github.com/nreed97/EzFD/issues/14) — the Worked All Sections
  bonus is awarded at the app's section-list length (81) while the summary
  sheet checks a hardcoded 84, so the worksheet can omit a bonus the score
  includes.
