<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# EzFD project notes

EzFD is a real-time, multi-operator ARRL Field Day / Winter Field Day logger. Next.js 16 App Router (standalone output, `node server.js`), PostgreSQL 16 with `pg_notify` → SSE for real-time updates, Tailwind v4 (`light:` prefix for light mode — dark is default). Deployed to Ubuntu/Debian VPS via `deploy.sh` (nginx + certbot + systemd). See `README.md` for full feature docs and usage.

## Before finishing a frontend change
Run `npx tsc --noEmit` and `npm run build` — both must be clean.

## Critical gotchas

- **`pg` returns `TIMESTAMPTZ` as JS `Date` objects**, not strings. `lib/adif.ts` and `lib/cabrillo.ts` must handle both shapes.
- **ARRL scoring formula**: `QSO points × power multiplier + bonus points`. Sections do **not** multiply the score — that was a real bug once. Power mult: HIGH=×1, LOW=×2, QRP=×5. See `lib/scoring.ts`.
- **Bash `set -e` breaks interactive menus** — `ezfd-admin.sh` uses `set -uo pipefail` only, no `-e`. Any new interactive bash needs the same. Use `[[ ]]` comparisons, not `(( ))` (returns exit 1 on false, triggers `-e`-style failures). Always `local var=""`, never bare `local var`, to avoid unbound-variable errors under `set -u`.
- **`deploy.sh`'s rsync of `.next/standalone/` must keep `--exclude='.env'`** — without it, `rsync --delete` wipes the live secrets file on every redeploy.
- **`public/ezfd-rig-bridge.py` is a manual duplicate** of the root `ezfd-rig-bridge.py`, served for direct browser download. They are NOT symlinked — always `cp` the root file over the public copy after editing the bridge script.
- **`EZFD_REPO_DIR`** (in `/opt/ezfd/.env`, written by `deploy.sh`) tells `ezfd-admin.sh`'s "Update application" action where to `git pull` from.
- **N1MM call history files are contest-year-specific**, unlike `MASTER.SCP` (evergreen). `lib/callHistory.ts` builds the download URL from `event_type`+`event_year` against N1MM's `{fd|wfd}_{year}-LAST.txt` slug and falls back to the prior year if that year's file isn't published yet — override with `EZFD_FD_CALL_HISTORY_URL`/`EZFD_WFD_CALL_HISTORY_URL` (supports a `{year}` placeholder) if N1MM changes their URL scheme. The FD/WFD file's `Exch1` column is the station's **sent class** (e.g. `3A`), not a generic exchange field — mapped to `sent_class` and used to prefill Rcvd Class, alongside `Sect` → Rcvd Section. `MASTER.SCP` header/comment lines start with `!` or `#` (not `;`). Both downloads are best-effort at event creation — a failed fetch must never block event creation, only degrade the prefill/lookup feature.

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
| `lib/scoring.ts` | ARRL scoring formula |
| `lib/callHistory.ts` | N1MM call history file download/parse, per-event prefill lookup |
| `lib/masterCallsigns.ts` | `MASTER.SCP` (Super Check Partial) download/parse, shared known-callsign lookup |
| `ezfd-admin.sh` | Interactive server admin console |
| `deploy.sh` | VPS deploy/update script |
| `ezfd-rig-bridge.py` | Local rig control bridge (keep `public/` copy in sync) |
