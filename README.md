# EzFD — Field Day Logger

> **⚠️ Vibe-coded disclaimer:** This project was built entirely with AI assistance (Claude). It works, but the code may contain rough edges, non-idiomatic patterns, or choices a seasoned developer would raise an eyebrow at. Use it, hack it, improve it — but don't cite it as a reference implementation for anything critical. You have been warned.

A real-time, multi-operator ARRL Field Day and Winter Field Day logging application built for amateur radio clubs. EzFD replaces the common N3FJP + SMB-share + `.mdb` file setup with a self-hosted web app that any operator can use from any device on the network — no Windows software, no shared drives, no single point of failure.

---

## Features

| Feature | Details |
|---|---|
| **Multi-op, real-time log** | Every QSO appears on all connected devices within milliseconds via PostgreSQL `pg_notify` + Server-Sent Events |
| **Offline tolerance** | QSOs are written to `localStorage` first and synced when connectivity restores — nothing is lost on a flaky WiFi link |
| **ESM-style Enter navigation** | Enter in Callsign → focuses Rcvd Class → focuses Rcvd Section → logs QSO; matches N1MM+/ESM workflow |
| **Field Day + Winter Field Day** | Supports both ARRL FD (classes A–F) and Winter Field Day (classes H/O/I); class letters validated per event type |
| **Power category** | Events configured as HIGH / LOW (≤150 W) / QRP (≤5 W); affects scoring multiplier (×1 / ×2 / ×5) |
| **Band activity panel** | See which band/mode each station is currently using; conflict banner when two stations select the same band/mode |
| **WSJT-X / JTDX relay** | Download a self-contained `.bat` file that watches your ADIF log and auto-submits new digital QSOs to the server — no manual entry |
| **ADIF import** | Bulk-import QSOs from any `.adi` file; dupes are detected and flagged automatically |
| **Exchange validation** | Rcvd Class validated against contest rules (number + correct letter set for FD/WFD); Rcvd Section validated against all 81 ARRL/RAC sections |
| **Callsign validation** | QSO form warns on unusual callsign patterns before logging |
| **QRZ callsign lookup** | Auto-fills name and state from QRZ.com XML API using a shared club account (optional); credentials encrypted at rest with AES-256-GCM |
| **Dupe checking** | Server-side duplicate detection (same callsign + band + mode); dupes are logged, flagged, and excluded from scoring |
| **QSO editing** | Edit any logged QSO inline; dupe status is re-evaluated automatically |
| **Bonus point tracker** | Track all 17 ARRL Field Day bonus categories including emergency power (doubles base score), GOTA, W1AW, satellite, youth ops, and more |
| **Live scoring** | Correct ARRL formula: QSO points × power multiplier + bonus points — updated in real time |
| **Worked All Sections** | 100-point bonus auto-detected when all 84 ARRL/RAC sections are worked |
| **Last QSO display** | Prominent callsign + status shown after each log for quick confirmation |
| **Dashboard — Map** | Leaflet map with all ARRL/RAC sections plotted; worked sections glow amber |
| **Dashboard — Sections** | Grid of all sections grouped by call district; worked sections highlighted amber |
| **Dashboard — Sections Needed** | Unworked sections grouped by call district with worked ones struck through — the hunt list |
| **Dashboard — Rate chart** | Hourly QSO rate bar chart; zero hours shown as hairlines so contest gaps are visible |
| **Dashboard — Band breakdown** | Band × PH/CW/DIG matrix sorted by points |
| **Summary sheet** | Printable ARRL-style summary with QSO table, score calculation (power multiplier row), active bonus line items, sections worked, and operator list |
| **Operator stats** | Per-operator QSO count, Q/hr (over their operating window), and PH/CW/DIG mode split |
| **Night mode** | One-click dim (35% brightness + warm tone) to preserve dark adaptation during nighttime operations |
| **Light/Dark theme** | Toggle between light and dark UI themes; preference is saved across sessions |
| **PWA / installable** | Add to home screen on Android/iOS or install as a desktop app via Chrome — works offline for the logging UI |
| **ADIF + Cabrillo export** | Download standard `.adi` or Cabrillo 3.0 `.log` for ARRL submission or LoTW upload |
| **Admin console** | `ezfd-admin.sh` — interactive server-side tool to view events, export QSOs, change join codes, delete events, and take JSON backups |
| **One-command deploy** | `deploy.sh` installs all dependencies, generates secrets, configures systemd + nginx, and provisions SSL on any Ubuntu/Debian VPS |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Browser / PWA (any device on the network)                     │
│                                                                 │
│  ┌──────────────────┐   ┌────────────────────────────────────┐  │
│  │   Logger UI      │   │  Dashboard (map + charts + stats)  │  │
│  │   (Next.js)      │   │  (Next.js + Leaflet)               │  │
│  └────────┬─────────┘   └──────────────┬─────────────────────┘  │
│           │ EventSource SSE             │ EventSource SSE        │
└───────────┼─────────────────────────────┼────────────────────────┘
            │                             │
┌───────────▼─────────────────────────────▼────────────────────────┐
│  Next.js App (Node.js standalone, port 3000)                     │
│                                                                   │
│  /api/events    /api/qso    /api/presence    /api/qrz             │
│  /api/realtime/[eventId]  (SSE)                                   │
│  /api/export/[code]  /api/import/adif                             │
│  /api/events/[code]/bonuses                                       │
│  /api/download/relay  /api/download/wsjtx-bridge                  │
└──────────────────────────┬────────────────────────────────────────┘
                           │ pg (node-postgres)
┌──────────────────────────▼────────────────────────────────────────┐
│  PostgreSQL 16                                                    │
│                                                                   │
│  tables: events · qsos · presence                                 │
│  trigger: qso_notify → pg_notify("qsos_<eventId>")               │
└───────────────────────────────────────────────────────────────────┘

  Windows machine (optional)
  ┌──────────────────────────────────────────────────┐
  │  WSJT-X / JTDX  →  wsjtx_log.adi                │
  │  ezfd-wsjt-relay.bat (FileSystemWatcher)         │
  │      → POST /api/qso  (join_code auth)           │
  └──────────────────────────────────────────────────┘
```

**Real-time flow:** When any operator logs a QSO, the server inserts the row. A PostgreSQL trigger immediately calls `pg_notify`. The SSE endpoint (`/api/realtime/[eventId]`) has an active `LISTEN` connection to the database and pushes the payload to every connected browser as an `event: qso` message. No polling, no third-party realtime service.

**Offline flow:** The browser always writes to `localStorage` first. If the server POST succeeds immediately, the entry is removed from the queue. If it fails (or the device is offline), the QSO stays in the queue and is shown in the log with a `↑ sync` indicator. When `navigator.online` fires, the queue is flushed in submission order.

---

## Deploying to a VPS

`deploy.sh` is a single interactive script that turns a fresh Ubuntu or Debian server into a fully configured EzFD instance. It installs every dependency, generates secrets, configures PostgreSQL, builds the app, registers a systemd service, writes an nginx reverse-proxy config, and optionally provisions a Let's Encrypt TLS certificate.

**Supported:** Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, Debian 12. Run as root or via `sudo`.

### What it installs

| Component | Version | Notes |
|---|---|---|
| Node.js | 20 (NodeSource) | App runtime |
| PostgreSQL | 16 (PGDG) | Local database |
| nginx | System package | Reverse proxy |
| certbot | apt (`certbot` + `python3-certbot-nginx`) | Let's Encrypt SSL (optional) |

### Steps

**1 — Provision the server**

Spin up any Ubuntu 22.04/24.04 or Debian 12 VPS. A $6/month instance (1 vCPU, 1 GB RAM) is plenty for a Field Day event.

If you want a domain name (e.g. `fd.w0ny.xyz`), create an **A record** pointing to the server's IP before running the script.

**2 — Clone the repository**

```bash
git clone https://github.com/nreed97/EzFD.git
cd EzFD
```

**3 — Run the deploy script**

```bash
sudo bash deploy.sh
```

The script will prompt you for:

- **Domain name** — e.g. `fd.w0ny.xyz`. Leave blank to access by IP address.
- **Email address** — used by Let's Encrypt for certificate expiry notices. Leave blank to skip SSL for now (certbot is still installed so you can add it later).
- **PostgreSQL password** — press Enter to auto-generate.
- **Admin key** — optional. If set, this key must be entered when creating a new event, preventing unauthorised event creation on a public-facing server. Leave blank to allow open event creation.

The script also auto-generates an `EZFD_ENCRYPTION_KEY` (AES-256-GCM, 32 bytes) on first run and preserves it on subsequent updates. This key encrypts QRZ credentials in the database. On re-runs, the domain and email are pre-filled from the previous deploy.

A summary is shown before any changes are made. The full deployment (including `npm run build`) takes about 3–5 minutes.

**4 — Open the app**

The script prints the URL when it finishes. Navigate to it from any device.

### Updating

Pull the latest code and re-run the script. It detects the existing installation, skips package setup, rebuilds the app, and restarts the service — database, secrets, and config are preserved.

```bash
git pull && sudo bash deploy.sh
```

---

## Usage

### Creating an Event

1. Open the app and click **Create Event**.
2. Choose event type: **ARRL Field Day** or **Winter Field Day**.
3. Fill in your club name, callsign, FD class (e.g. `3A` for FD, `2O` for WFD), and ARRL section.
4. Select your power category: **HIGH** (default), **LOW** (≤150 W), or **QRP** (≤5 W). This sets the scoring multiplier.
5. Optionally enter QRZ.com credentials — a single XML-subscription account shared by all operators during the event. Credentials are encrypted at rest with AES-256-GCM.
6. If the server has an admin key configured, enter it in the **Admin Key** field.
7. Click **Create Event & Get Join Code**. You will receive a 6-character join code (e.g. `HBDAXF`).

### Joining an Event

Share the join code with your operators. Each operator:

1. Opens `http://<server-ip>` (or your domain).
2. Enters the join code and clicks **Join Event**.
3. Enters their callsign and clicks **Enter Logger**.

No account or password is required for operators.

### Logging QSOs

The logging screen is laid out for speed using ESM-style Enter navigation:

1. **Callsign** — type the callsign and press **Enter**. If QRZ is configured it auto-fills name and state. An orange warning appears for unusual callsign formats or dupe contacts.
2. **Rcvd Class** — type the received class (e.g. `2A` for FD, `3O` for WFD) and press **Enter**. Validated against contest rules; orange border on invalid entries.
3. **Rcvd Section** — type the received section (e.g. `MN`). Has autocomplete for all 81 ARRL/RAC sections (alphabetical). Press **Enter** to log the QSO.

The **Log QSO** button and mouse clicks work as always. Use the **▼ QSY** drawer at the bottom to change band or mode.

Duplicate contacts (same callsign + band + mode) are flagged with a `dupe` badge in the log and excluded from scoring, but still stored.

On mobile, the tab bar shows the current score and your operator callsign. Tap **Op On** to change operators.

### Band Activity Panel

The sidebar shows every active operator's current band and mode (updated in real-time). A **red row with `!`** means that station is on the same band and mode as you — a potential source of interference. A yellow banner also appears at the top of the form when a conflict is detected. Operators inactive for more than 15 minutes are greyed out.

### WSJT-X / JTDX Relay

For digital operation, EzFD can watch your WSJT-X or JTDX log file and submit new QSOs automatically:

1. In the logger, click the **WSJT-X/JTDX** button (or select DIG mode and click the banner).
2. Click **Download Relay Script** to get `ezfd-wsjt-relay.bat`.
3. Double-click the `.bat` file on the Windows machine running WSJT-X/JTDX.

The script requires no installation — it uses PowerShell built into Windows 10/11. It watches `wsjtx_log.adi` for new records and posts each QSO to the server using your join code. Leave the window open while operating; close it when done.

### ADIF Import

To bulk-import QSOs from WSJT-X, JTDX, or any other logger:

1. In the logger header, click **Import ADIF**.
2. Select your `.adi` file.
3. QSOs are imported with dupe detection; already-logged contacts are skipped.

### Dashboard

Click **Dashboard** from the logger to open the metrics view. Five tabs:

| Tab | Contents |
|---|---|
| **Map** | All ARRL/RAC sections as markers on a world map; worked sections glow amber |
| **Sections** | Grid of all sections grouped by call district; worked sections highlighted |
| **Needed** | Unworked sections in red grouped by call district; worked ones struck through |
| **Rate** | Hourly QSO rate bar chart for the full contest period |
| **Bands** | Band × PH/CW/DIG matrix sorted by points descending |

The sidebar shows live rate (QSOs in the last 60 minutes), score breakdown, bonus tracker, sections worked, and per-operator stats.

### Bonus Tracker

In the dashboard sidebar, click **Bonuses** to expand the tracker. Check boxes or enter counts for each applicable bonus:

- **Emergency power** — doubles the entire base score (100% bonus)
- **W1AW bulletin, Satellite QSO, Natural power, Public info table** — +100 pts each
- **Media publicity, Educational activity, Message to SM, 100% licensed** — +100 pts each
- **Elected official visit, Web posting, Social media** — +50 pts each
- **Safety officer** — +25 pts
- **Youth operators** — +20 pts each
- **GOTA QSOs** — +10 pts each (capped at 1,000)
- **Served agency reps, NTS messages** — +10 pts each (capped at 100)
- **Worked All Sections** — +100 pts, awarded automatically when all 84 ARRL/RAC sections are worked

Changes save immediately. The Scoreboard updates to show Base Score, Bonus Points, and Claimed Score.

### Summary Sheet

Click **Summary** in the dashboard header to open a printable ARRL-style summary sheet showing the full QSO table, score calculation (with power multiplier row and bonus line items), sections worked, and operator list. Click **Print** to send it to your printer or save as PDF.

### Exporting

Two export buttons appear in both the logger header and the dashboard:

| Button | File | Use for |
|---|---|---|
| **ADIF** | `CLUBCALL_FDyear.adi` | General log import (LoTW, QRZ, log managers) |
| **Cabrillo** | `CLUBCALL_FDyear.log` | ARRL Field Day online score submission |

Both exports include only non-duplicate QSOs, sorted chronologically.

---

## Admin Console

`ezfd-admin.sh` is an interactive server-side admin tool for managing events, recovering data, and running backups. Run it on the server:

```bash
sudo bash ezfd-admin.sh
```

### Main menu

- **List / manage events** — table of all events with QSO/dupe/operator counts; select any event to drill in
- **Server statistics** — totals, top operators across all events, QSOs by event type, database size
- **Full JSON backup** — timestamped dump of all events + QSOs to `/tmp/`
- **Exit**

### Per-event actions

| Action | Description |
|---|---|
| View details | Band breakdown, operator QSO counts, all sections worked |
| Export QSOs to CSV | Writes `/tmp/qsos_CODE.csv` via `psql \COPY` |
| Export JSON backup | Full event + QSO backup to `/tmp/ezfd_CODE_backup.json` |
| Change join code | Update the join code — useful for recovery or resharing |
| Clear all dupes | Resets `is_dupe=false` on all QSOs in the event |
| Delete all QSOs | Permanently removes all QSOs; event shell is kept |
| Delete event | Permanently removes event and all QSOs |

Destructive actions require typing `YES` in all caps to confirm.

### Non-interactive JSON dump

```bash
sudo bash ezfd-admin.sh --json > backup.json
```

Dumps all events with every QSO to stdout — pipeable to `jq`, `gzip`, `scp`, etc.

---

## Configuration Reference

The deploy script writes `/opt/ezfd/.env` for you. If you need to change settings afterward, edit that file and restart the service:

```bash
sudo nano /opt/ezfd/.env
sudo systemctl restart ezfd
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string — `postgresql://ezfd:<password>@localhost/ezfd` |
| `EZFD_ENCRYPTION_KEY` | Yes | 64-char hex string (32 bytes). AES-256-GCM key for QRZ credential encryption. Auto-generated by `deploy.sh`. Generate manually: `openssl rand -hex 32` |
| `EZFD_ADMIN_KEY` | No | If set, this key must be submitted when creating a new event. Prevents unauthorised event creation on public servers. |
| `EZFD_DOMAIN` | No | Domain name saved by `deploy.sh` for use as a default on the next update run. |
| `EZFD_CERT_EMAIL` | No | Let's Encrypt email saved by `deploy.sh` for use as a default on the next update run. |
| `NODE_ENV` | Yes | Always `production` in deployed installs |
| `PORT` | Yes | App port (default `3000`; nginx proxies from 80/443) |
| `HOSTNAME` | Yes | Bind address — `127.0.0.1` so the app is only reachable via nginx |

### External PostgreSQL

To use an existing PostgreSQL server, set `DATABASE_URL` to point at it and apply the schema manually:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

PostgreSQL 14 or newer is required (uses `gen_random_uuid()`, `pg_notify`, and `pgcrypto`).

---

## Development

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ running locally (or via Docker)

### Setup

```bash
git clone https://github.com/nreed97/EzFD.git
cd EzFD
npm install
```

Create `.env.local`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/ezfd_dev
EZFD_ENCRYPTION_KEY=<output of: openssl rand -hex 32>
# EZFD_ADMIN_KEY=optional
```

`EZFD_ENCRYPTION_KEY` is required to save QRZ credentials. Without it, event creation with a QRZ password will return an error.

Initialise the schema:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Start the dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

### Project Structure

```
EzFD/
├── app/
│   ├── page.tsx                        # Landing page (join / create event)
│   ├── layout.tsx                      # Root layout — metadata, PWA tags, SW registrar
│   ├── event/
│   │   ├── new/page.tsx                # Create event form (type, class, power, QRZ, admin key)
│   │   └── [code]/
│   │       ├── page.tsx                # Operator sign-in gate
│   │       ├── log/page.tsx            # Main logging view (server → LoggingClient)
│   │       └── dashboard/page.tsx      # Metrics + map (server → DashboardClient)
│   └── api/
│       ├── events/
│       │   ├── route.ts                # POST create event (admin key, event_type, power, QRZ encryption)
│       │   └── [code]/
│       │       ├── route.ts            # GET event by join code
│       │       └── bonuses/route.ts    # PATCH bonus point tracker state
│       ├── qso/
│       │   ├── route.ts                # POST log QSO (accepts join_code or event_id)
│       │   └── [id]/route.ts           # PATCH edit QSO, DELETE remove QSO
│       ├── presence/route.ts           # GET/POST band-activity presence (15-min TTL)
│       ├── realtime/[eventId]/route.ts # SSE stream (pg_notify → EventSource)
│       ├── qrz/route.ts                # QRZ.com callsign lookup proxy
│       ├── export/[code]/route.ts      # ADIF + Cabrillo download (?format=cabrillo)
│       ├── import/adif/route.ts        # POST bulk ADIF import
│       └── download/
│           ├── relay/route.ts          # GET self-contained WSJT-X relay .bat file
│           └── wsjtx-bridge/route.ts   # GET Node.js bridge script (alternative relay)
├── components/
│   ├── LoggingClient.tsx               # Full logging UI (client component)
│   ├── DashboardClient.tsx             # Dashboard UI with 5-tab view (client component)
│   ├── QSOForm.tsx                     # QSO entry form — ESM Enter nav, callsign/exchange validation, QSY drawer
│   ├── QSOTable.tsx                    # Real-time log table with inline edit + delete
│   ├── Scoreboard.tsx                  # Score breakdown (base score, bonuses, claimed score)
│   ├── BandActivity.tsx                # Other-station band/mode conflict panel + conflict callback
│   ├── BonusTracker.tsx                # 17-category ARRL bonus tracker with PATCH save
│   ├── RateChart.tsx                   # Hourly QSO rate bar chart (pure CSS)
│   ├── BandBreakdown.tsx               # Band × PH/CW/DIG matrix sorted by points
│   ├── SectionsNeeded.tsx              # Unworked sections hunt list grouped by district
│   ├── SummarySheet.tsx                # Printable ARRL summary sheet modal (power multiplier row)
│   ├── MapView.tsx                     # Leaflet section map (dynamic import, no SSR)
│   ├── SectionGrid.tsx                 # Section grid grouped by call district
│   ├── AdifImport.tsx                  # Bulk ADIF import modal
│   ├── WsjtxSetupHelp.tsx              # WSJT-X relay download + setup instructions modal
│   ├── SwRegistrar.tsx                 # PWA service worker registration (client component)
│   ├── ThemeToggle.tsx                 # Light/dark theme toggle
│   └── UTCClock.tsx                    # Live UTC clock (1s resolution)
├── lib/
│   ├── db.ts                           # pg Pool singleton
│   ├── types.ts                        # Shared TypeScript types + ARRL sections constant (sorted A–Z)
│   ├── scoring.ts                      # Field Day score: QSO pts × power mult + bonuses (correct ARRL formula)
│   ├── crypto.ts                       # AES-256-GCM encrypt/decrypt for DB fields
│   ├── adif.ts                         # ADIF file generation (handles pg Date objects)
│   ├── cabrillo.ts                     # Cabrillo 3.0 file generation (handles pg Date objects)
│   ├── offline-queue.ts                # localStorage QSO queue for offline tolerance
│   ├── qrz.ts                          # QRZ XML API client with session caching + decryption
│   └── sections.ts                     # ARRL/RAC section names + map coordinates
├── db/
│   └── schema.sql                      # Schema, indexes, pg_notify trigger, idempotent migrations
│                                       # Migrations: bonuses (v2), event_type (v3), power (v4)
├── public/
│   ├── manifest.json                   # PWA manifest (standalone display, amber theme)
│   ├── sw.js                           # Service worker (cache-first static, network-first pages)
│   └── icons/icon.svg                  # App icon (amber rounded rect, "FD" text)
├── deploy.sh                           # VPS deployment script (Ubuntu/Debian); idempotent update support
└── ezfd-admin.sh                       # Interactive server-side admin console (events, exports, backups)
```

---

## Operations

### Service management

```bash
systemctl status ezfd              # check running state
systemctl restart ezfd             # restart after config change
journalctl -u ezfd -f              # live logs
journalctl -u ezfd --since today   # today's logs
```

### Backups

QSO data lives in the `ezfd` PostgreSQL database. Back up and restore with standard `pg_dump`:

```bash
# Backup
pg_dump -U ezfd ezfd | gzip > ezfd_$(date +%Y%m%d).sql.gz

# Restore (to a fresh database)
gunzip -c ezfd_20260628.sql.gz | psql -U ezfd ezfd
```

The admin console (`ezfd-admin.sh`) also provides JSON backups per-event or for the whole server, and a CSV export per event.

> **Important:** The `EZFD_ENCRYPTION_KEY` in `/opt/ezfd/.env` is required to decrypt QRZ credentials after a restore. Keep a copy of that file in a safe place alongside your database backup.

### nginx notes

The deploy script writes `/etc/nginx/sites-available/ezfd` automatically. One directive is critical and must never be removed:

```nginx
proxy_buffering off;   # without this, SSE (real-time updates) silently breaks
```

### SSL / HTTPS

SSL is configured during `deploy.sh` if you provide a domain and email. Certbot is installed via `apt` (`certbot` + `python3-certbot-nginx`) and a systemd timer handles automatic renewal.

```bash
# Test renewal
certbot renew --dry-run

# Check renewal timer
systemctl status certbot.timer
```

To add SSL after the initial deploy (e.g. once DNS propagates):

```bash
certbot --nginx -d fd.w0ny.xyz
```

---

## Scoring Reference

EzFD calculates scores per the current ARRL Field Day rules:

| Mode | Points per QSO |
|---|---|
| Phone (PH) | 1 |
| CW | 2 |
| Digital (DIG) | 2 |

**Base score = total QSO points × power multiplier**

| Power category | Multiplier |
|---|---|
| QRP (≤5 W) | ×5 |
| Low Power (≤150 W) | ×2 |
| High Power | ×1 |

**Claimed score = base score + bonus points**

Sections worked do **not** multiply the score. They are tracked for the "Worked All Sections" bonus (+100 pts when all 84 ARRL/RAC sections are worked), which is awarded automatically.

Bonus points are tracked in the dashboard's Bonus Tracker panel. The most significant bonus is **Emergency Power** which doubles the entire base score. All 17 ARRL Field Day bonus categories are supported.

For **Winter Field Day**, the same QSO point values and power multipliers apply. Class letters are H (home), O (outdoor), I (indoor/club) instead of A–F.

---

## License

```
GLWT (Good Luck With That) Public License
Copyright (c) 2026 Nick Reed (W0NY)

Everyone is permitted to copy, distribute, modify, merge, sell, publish,
sublicense, or do anything else with this software, with or without
modification, for any purpose.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
The author is not responsible if this software:
  - Causes you to miss a multiplier
  - Crashes at 0200Z on Field Day night
  - Logs your club's dupe count to the ARRL
  - Achieves sentience and starts logging QSOs autonomously
  - Otherwise ruins your Field Day

USE AT YOUR OWN RISK.

IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER
LIABILITY ARISING FROM THE SOFTWARE OR ITS USE.

73 de W0NY — good luck out there.
```
