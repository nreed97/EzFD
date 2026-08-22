<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# EzFD project notes

EzFD is a real-time, multi-operator ARRL Field Day / Winter Field Day logger. Next.js 16 App Router (standalone output, `node server.js`), PostgreSQL 16 with `pg_notify` → SSE for real-time updates, Tailwind v4 (`light:` prefix for light mode — dark is default). Deployed to Ubuntu/Debian VPS via `deploy.sh` (nginx + certbot + systemd). See `README.md` for full feature docs and usage.

## Before finishing a frontend change
Run `npx tsc --noEmit` and `npm run build` — both must be clean.

Changes touching the schema, the SES routes, or `ezfd-admin.sh` should also run
the relevant suite (CI runs all of them — see the Tests section in `README.md`):

| Script | Covers |
|---|---|
| `db/test-ses-constraint.sql` | The SES overlap constraint, asserted against a real database |
| `scripts/test-queries.cjs` | Route SQL through the `pg` driver — casts the typechecker can't see |
| `scripts/test-restore.sh` | `ezfd-admin.sh` backup/restore for SES, FD and empty events |
| `scripts/test-e2e.sh` | The API end to end, including Field Day regressions |
| `scripts/test-sections.cjs` | The ARRL/RAC section list — the three enumerations agree, no hardcoded totals |

When adding a test, check it can actually fail — break the thing it guards and
watch it go red. Doing that is what surfaced the missing self-heal on the
exclusion constraint.

## Critical gotchas

- **`pg` returns `TIMESTAMPTZ` as JS `Date` objects**, not strings. `lib/adif.ts` and `lib/cabrillo.ts` must handle both shapes.
- **ARRL scoring formula**: `QSO points × power multiplier + bonus points`. Sections do **not** multiply the score — that was a real bug once. Power mult: HIGH=×1, LOW=×2, QRP=×5. See `lib/scoring.ts`.
- **The ARRL/RAC section list is enumerated in three places** — `ARRL_SECTIONS` (`lib/types.ts`), `SECTION_DATA` (`lib/sections.ts`, adds map coordinates) and the `GROUPS` grid (`components/SectionGrid.tsx`, adds call-area layout). They must cover the same 85 sections; `scripts/test-sections.cjs` fails if they drift. Never write the total out as a literal — derive it from `ARRL_SECTIONS.length`, which is what the Worked All Sections bonus already does. A hardcoded `84` in the summary sheet against a list of 81 meant the sheet an operator transcribes onto their ARRL entry omitted a bonus its own claimed score included. RAC's recent changes are the usual source of a stale list: `MAR` → `NB`/`NS`/`PE`, `ON` → `ONE`/`ONN`/`ONS`/`GH` (`GTA` renamed to `GH`), and Yukon folded into `NT`.
- **Bash `set -e` breaks interactive menus** — `ezfd-admin.sh` uses `set -uo pipefail` only, no `-e`. Any new interactive bash needs the same. Use `[[ ]]` comparisons, not `(( ))` (returns exit 1 on false, triggers `-e`-style failures). Always `local var=""`, never bare `local var`, to avoid unbound-variable errors under `set -u`.
- **`deploy.sh`'s rsync of `.next/standalone/` must keep `--exclude='.env'`** — without it, `rsync --delete` wipes the live secrets file on every redeploy.
- **`public/ezfd-rig-bridge.py` is a manual duplicate** of the root `ezfd-rig-bridge.py`, served for direct browser download. They are NOT symlinked — always `cp` the root file over the public copy after editing the bridge script.
- **`EZFD_REPO_DIR`** (in `/opt/ezfd/.env`, written by `deploy.sh`) tells `ezfd-admin.sh`'s "Update application" action where to `git pull` from.
- **N1MM call history files are contest-year-specific**, unlike `MASTER.SCP` (evergreen). `lib/callHistory.ts` builds the download URL from `event_type`+`event_year` against N1MM's `{fd|wfd}_{year}-LAST.txt` slug and falls back to the prior year if that year's file isn't published yet — override with `EZFD_FD_CALL_HISTORY_URL`/`EZFD_WFD_CALL_HISTORY_URL` (supports a `{year}` placeholder) if N1MM changes their URL scheme. The FD/WFD file's `Exch1` column is the station's **sent class** (e.g. `3A`), not a generic exchange field — mapped to `sent_class` and used to prefill Rcvd Class, alongside `Sect` → Rcvd Section. `MASTER.SCP` header/comment lines start with `!` or `#` (not `;`). Both downloads are best-effort at event creation — a failed fetch must never block event creation, only degrade the prefill/lookup feature (each fetch carries an `AbortSignal.timeout`, since the create request awaits them).
- **`events.class` and `events.arrl_section` are nullable** — they are NULL for every `event_type='SES'` row (a special event station has no contest exchange). Anything reading them needs a null guard; `lib/cabrillo.ts`, `lib/adif.ts`, `components/SummarySheet.tsx` and the QSO insert paths already have one. Cabrillo export is refused outright for SES.
- **SES checkout granularity is (band, mode) and must not be narrowed to frequency.** Special event rules generally allow one signal per band per mode, so frequency-level slots would let the database permit something the rules forbid. `ses_reservations.planned_freq` is free text for humans and deliberately carries no exclusivity.
- **SES call checkout is enforced by a database constraint, not application code.** `ses_reservations` carries `EXCLUDE USING gist (event_id WITH =, band WITH =, mode WITH =, during WITH &&) WHERE (status <> 'RELEASED')`, which needs the `btree_gist` extension for the `=` comparisons. Never replace it with a SELECT-then-INSERT check: two operators claiming the same slot in the same instant is exactly the case it exists to prevent. A collision arrives as SQLSTATE **`23P01`** and the routes translate it to a 409 naming the holder. Releasing a slot clamps the range with `GREATEST(lower(during), NOW())` — clamping to `NOW()` alone inverts the range when a not-yet-started slot is cancelled.
- **Offline-queue replays must never be rejected.** `POST /api/qso` takes a `replay: true` flag that bypasses the SES band/mode gate unconditionally, and `LoggingClient`'s `flushQueue` sets it. By reconnect time the slot has always expired; a contact that already happened on the air must not be dropped because the network blipped. For the same reason `flushQueue` only dequeues once `result.qso` is present — checking the wrapper object instead silently discarded QSOs whenever a submit failed.
- **`json_agg` over zero rows serialises as JSON `null`, a scalar — not SQL NULL.** `COALESCE(ev->'qsos','[]'::jsonb)` therefore does *not* catch it, and `jsonb_array_elements` then fails with "cannot extract elements from a scalar". `ezfd-admin.sh`'s restore guards every list with `jsonb_typeof(...) = 'array'` instead. This bit the QSO loop too: restoring an event with no QSOs used to error out.
- **`ezfd-admin.sh`'s backup and restore must carry `ses_operators` and `ses_reservations`.** The roster holds each operator's grid/state, which is the only source for the ADIF `MY_*` fields — dropping it makes a restored special event log silently unuploadable. Reservations are stored as a `tstzrange`, which doesn't survive a JSON round-trip, so the backup decomposes it into `starts_at`/`ends_at` and the restore rebuilds it. Restore uses `NULLIF(...,'')` for `class`/`arrl_section`, never `COALESCE(...,'')`, so an SES comes back with NULL rather than an empty string.
- **ADIF `MY_*` fields come from `ses_operators`, per QSO — not from `events.location`.** A distributed SES has one location per operator, and LoTW signs by station callsign *and* location. `STATION_CALLSIGN` is the event call, `OPERATOR` is the individual. Sourcing the location from the event would stamp every operator's contacts with the same wrong location.
- **`qsos.mode` keeps its `CHECK (mode IN ('PH','CW','DIG'))`** — scoring, dupe detection and the band/mode UI all rely on that three-way split. The real submode (FT8, RTTY, …) goes in the separate nullable `adif_mode` column, which ADIF export prefers when present. Don't widen the CHECK.
- **The app's DB role (`ezfd`) is granted DML only, not table ownership** — `db/schema.sql` is applied as the `postgres` superuser by both `deploy.sh` and `ezfd-admin.sh`, so `postgres` owns every table. `TRUNCATE` needs ownership and fails with "permission denied" at runtime; use `DELETE FROM` for bulk clears (`lib/masterCallsigns.ts` refreshes the whole list this way, inside a transaction so a mid-import failure can't leave a partial list carrying a fresh `updated_at`).

## Rig control / CW keying (`ezfd-rig-bridge.py`, `lib/useRigBridge.ts`)

A local Python script bridges Hamlib `rigctld` ↔ WebSocket (`ws://localhost:4575`) ↔ browser. Runs entirely on the operator's machine; the EzFD server is never involved. `lib/useRigBridge.ts` is a shared hook used independently by both `LoggingClient` (main tab) and `CwLoggingClient` (CW popout) — each opens its own WS connection.

Hard-won fixes worth knowing before touching this code:

- **No VFO argument on `\send_morse`/`\stop_morse`** unless rigctld was started with `--vfo` (this bridge never does). Passing one sends the literal word "VFO" as CW text (audibly confusable with "4FO").
- **`\dump_caps` (CW-support detection) is not a fast local-only command** — it exercises real CAT round-trips over the serial link and can take several seconds with irregular gaps. It runs on a **separate throwaway TCP connection** (`probe_cw_support()`), never the polling connection — otherwise misread bytes permanently desync every later `get_freq`/`get_mode` response by one field.
- **Serial connections default to `--set-conf=serial_handshake=None`** — virtual/software CAT ports (e.g. FlexRadio SmartCAT) commonly don't implement RTS/CTS hardware handshake, causing silent write failures otherwise. Safe default for real hardware too.
- **FlexRadio SmartCAT emulates Kenwood TS-2000 CAT**, not FlexRadio's native protocol — use Hamlib model `2014`, not the FlexRadio-specific models (which are TCP-only and can't open a COM port at all).
- **All rigctld I/O is guarded by one `asyncio.Lock`** — polling (`get_freq`/`get_mode`) and CW commands share a single connection and must not interleave.

## React gotchas from this project

- **Inline arrow-function props recreate identity every render.** If a parent re-renders often (e.g. every rig frequency tick, ~4/sec) and passes `foo={() => ...}` to a child whose `useCallback`/`useEffect` depends on it, that effect keeps re-firing — this once prevented an auto-CQ timer from ever completing its interval. Fix: memoize with `useCallback(..., [])` in the parent, and/or read the latest value via a ref inside long-lived timers instead of depending on the function directly.
- **`QSOForm` exposes an imperative handle** (`QSOFormHandle` via `forwardRef`/`useImperativeHandle`) for reading live field values without lifting state — used by `CwMacroPanel` for `{call}`/`{exch}` macro placeholder expansion.

## Key files

| File | Purpose |
|---|---|
| `components/LoggingClient.tsx` | Main logging tab |
| `components/CwLoggingClient.tsx` | CW keying popout (separate window, `window.open`) |
| `components/QSOForm.tsx` | Shared entry form — ESM nav, Tab loop, used by both windows |
| `components/CwMacroPanel.tsx` | F1–F12 macros, Run/S&P modes, ESM, auto-CQ |
| `components/BandActivity.tsx` | Presence/conflict panel — QRT, QSY occupancy |
| `lib/useRigBridge.ts` | Shared rig WebSocket hook |
| `components/SesCoordination.tsx` | SES call checkout panel — claim/extend/release a band+mode |
| `lib/ses.ts` | SES slot queries, `23P01` constant, UTC slot-time formatting |
| `lib/events.ts` | Shared event SELECT column list + configurable dupe rule |
| `lib/scoring.ts` | ARRL scoring formula (FD/WFD only — SES has no score) |
| `lib/callHistory.ts` | N1MM call history file download/parse, per-event prefill lookup |
| `lib/masterCallsigns.ts` | `MASTER.SCP` (Super Check Partial) download/parse, shared known-callsign lookup |
| `ezfd-admin.sh` | Interactive server admin console |
| `deploy.sh` | VPS deploy/update script |
| `ezfd-rig-bridge.py` | Local rig control bridge (keep `public/` copy in sync) |
