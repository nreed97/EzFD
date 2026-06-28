# EzFD — Field Day Logger

A real-time, multi-operator ARRL Field Day logging application built for amateur radio clubs. EzFD replaces the common N3FJP + SMB-share + `.mdb` file setup with a self-hosted web app that any operator can use from any device on the network — no Windows software, no shared drives, no single point of failure.

---

## Features

| Feature | Details |
|---|---|
| **Multi-op, real-time log** | Every QSO appears on all connected devices within milliseconds via PostgreSQL `pg_notify` + Server-Sent Events |
| **Offline tolerance** | QSOs are written to `localStorage` first and synced when connectivity restores — nothing is lost on a flaky WiFi link |
| **Band activity panel** | See which band/mode each station is currently using; conflict warnings when two stations select the same band/mode |
| **Live UTC clock** | Seconds-precision UTC display in the logger header |
| **Night mode** | One-click dim (35% brightness + warm tone) to preserve dark adaptation during nighttime Field Day operations |
| **QRZ callsign lookup** | Auto-fills name and state from QRZ.com XML API using a single shared club account (optional) |
| **Scoring** | Live PH/CW/Digital QSO counts, section multiplier, and estimated score per ARRL Field Day rules |
| **Section map** | Leaflet map with all 83 ARRL/RAC sections plotted; worked sections glow amber |
| **Dupe checking** | Server-side duplicate detection (same callsign + band + mode); dupes are logged but flagged and excluded from scoring |
| **ADIF export** | Download a standard `.adi` file for upload to ARRL or any log management tool |
| **Cabrillo export** | Download a Cabrillo 3.0 `.log` file for direct contest submission |
| **One-command deploy** | `deploy.sh` installs all dependencies, configures systemd + nginx, and provisions SSL on any Ubuntu/Debian VPS |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (any device on the network)                │
│                                                     │
│  ┌──────────────┐   ┌────────────────────────────┐  │
│  │  Logger UI   │   │   Dashboard (map + stats)  │  │
│  │  (Next.js)   │   │   (Next.js + Leaflet)      │  │
│  └──────┬───────┘   └────────────┬───────────────┘  │
│         │ EventSource SSE        │ EventSource SSE  │
└─────────┼────────────────────────┼──────────────────┘
          │                        │
┌─────────▼────────────────────────▼──────────────────┐
│  Next.js App (Node.js standalone, port 3000)        │
│                                                     │
│  API routes: /api/events  /api/qso  /api/presence   │
│              /api/realtime/[eventId]  (SSE)         │
│              /api/qrz  /api/export/[code]           │
└─────────────────────────┬───────────────────────────┘
                          │ pg (node-postgres)
┌─────────────────────────▼───────────────────────────┐
│  PostgreSQL 16                                      │
│                                                     │
│  tables: events · qsos · presence                  │
│  trigger: qso_notify → pg_notify("qsos_<eventId>") │
└─────────────────────────────────────────────────────┘
```

**Real-time flow:** When any operator logs a QSO, the server inserts the row. A PostgreSQL trigger immediately calls `pg_notify`. The SSE endpoint (`/api/realtime/[eventId]`) has an active `LISTEN` connection to the database and pushes the payload to every connected browser as an `event: qso` message. No polling, no third-party realtime service.

**Offline flow:** The browser always writes to `localStorage` first. If the server POST succeeds immediately, the entry is removed from the queue. If it fails (or the device is offline), the QSO stays in the queue and is shown in the log with a `↑ sync` indicator. When `navigator.online` fires, the queue is flushed in submission order.

---

## Deploying to a VPS

`deploy.sh` is a single interactive script that turns a fresh Ubuntu or Debian server into a fully configured EzFD instance. It installs every dependency, configures PostgreSQL, builds the app, registers a systemd service, writes an nginx reverse-proxy config, and optionally provisions a Let's Encrypt TLS certificate.

**Supported:** Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, Debian 12. Run as root or via `sudo`.

### What it installs

| Component | Version | Notes |
|---|---|---|
| Node.js | 20 (NodeSource) | App runtime |
| PostgreSQL | 16 (PGDG) | Local database |
| nginx | System package | Reverse proxy |
| certbot | Latest (snap) | Let's Encrypt SSL (optional) |

### Steps

**1 — Provision the server**

Spin up any Ubuntu 22.04/24.04 or Debian 12 VPS. A $6/month instance (1 vCPU, 1 GB RAM) is plenty for a Field Day event.

If you want a domain name (e.g. `fd.k3abc.org`), create an **A record** pointing to the server's IP before running the script.

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

- **Domain name** — e.g. `fd.k3abc.org`. Leave blank to access the app by IP address.
- **Email address** — used by Let's Encrypt for certificate expiry notices. Leave blank to skip SSL.
- **PostgreSQL password** — press Enter to auto-generate a strong password.

A summary is shown before any changes are made. The full deployment (including `npm run build`) takes about 3–5 minutes.

**4 — Open the app**

The script prints the URL when it finishes. Navigate to it from any device.

### Updating

Pull the latest code and re-run the script. It detects the existing installation, skips package setup, rebuilds the app, and restarts the service — database and config are preserved.

```bash
git pull && sudo bash deploy.sh
```

---

## Usage

### Creating an Event

1. Open the app and click **Create Event**.
2. Fill in your club name, callsign, Field Day class (e.g. `3A`), and ARRL section.
3. Optionally enter QRZ.com credentials — a single XML-subscription account shared by all operators during the event.
4. Click **Create Event & Get Join Code**. You will receive a 6-character join code (e.g. `W3K7RZ`).

### Joining an Event

Share the join code with your operators. Each operator:

1. Opens `http://<server-ip>:3000`.
2. Enters the join code and clicks **Join Event**.
3. Enters their callsign and selects their station number.
4. Clicks **Enter Logger**.

No account or password is required for operators.

### Logging QSOs

The logging screen is laid out for speed:

- **Callsign field** is always focused. Type the callsign — if QRZ is configured it auto-fills name and state after a short pause.
- **Band grid** — click any band button. The currently selected band is highlighted amber.
- **Mode buttons** — PH / CW / DIG toggle strip.
- **Exchange fields** — received class (e.g. `2A`) and section (e.g. `NE`). The section field has autocomplete for all 83 ARRL/RAC sections.
- Press **Enter** or click **Log QSO** to submit.

Duplicate contacts (same callsign + band + mode) are detected server-side and flagged with `[D]` in the log. They are stored but excluded from scoring.

### Band Activity Panel

The sidebar shows every other active operator's current band and mode (updated every 15 seconds). A **red row with `!`** means that station is on the same band and mode as you — a potential source of interference.

### Night Mode

Click **☾ Night** in the header. The entire logger dims to approximately 35% brightness with a warm tone to protect dark adaptation. Click **☀ Day** to restore normal brightness. The preference is saved in `localStorage` and persists across page reloads.

### Dashboard

Click **Dashboard** from the logger to open the metrics view:

- **Leaflet map** — all 83 ARRL/RAC sections as markers; worked ones glow amber. Hover for section name.
- **Rate** — QSOs logged in the last 60 minutes.
- **Score** — PH/CW/Digital breakdown, section count, and estimated score.
- **Sections worked** — chip list of every worked section abbreviation.
- **Operator breakdown** — QSO count per operator callsign.

The dashboard receives the same SSE stream as the logger and updates in real-time without a manual refresh.

### Exporting

Two export buttons appear in both the logger header and the dashboard:

| Button | File | Use for |
|---|---|---|
| **ADIF** | `CLUBCALL_FDyear.adi` | General log import (LoTW, QRZ, log managers) |
| **Cabrillo** | `CLUBCALL_FDyear.log` | ARRL Field Day online score submission |

Both exports include only non-duplicate QSOs, sorted chronologically.

---

## Configuration Reference

The deploy script writes `/opt/ezfd/.env` for you. If you need to change settings afterward, edit that file and restart the service:

```bash
sudo nano /opt/ezfd/.env
sudo systemctl restart ezfd
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string — `postgresql://ezfd:<password>@localhost/ezfd` |
| `NODE_ENV` | Always `production` in deployed installs |
| `PORT` | App port (default `3000`; nginx proxies from 80/443) |
| `HOSTNAME` | Bind address — `127.0.0.1` so the app is only reachable via nginx |

### External PostgreSQL

To use an existing PostgreSQL server, set `DATABASE_URL` to point at it and apply the schema manually:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

PostgreSQL 14 or newer is required (uses `gen_random_uuid()`, `pg_notify`, and `ON CONFLICT DO UPDATE`).

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
```

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
│   ├── page.tsx                    # Landing page (join / create event)
│   ├── event/
│   │   ├── new/page.tsx            # Create event form
│   │   └── [code]/
│   │       ├── page.tsx            # Operator sign-in gate
│   │       ├── log/page.tsx        # Main logging view (server → LoggingClient)
│   │       └── dashboard/page.tsx  # Metrics + map (server → DashboardClient)
│   └── api/
│       ├── events/                 # POST create event, GET by join code
│       ├── qso/                    # POST log QSO, GET list, DELETE by id
│       ├── presence/               # GET/POST band-activity presence
│       ├── realtime/[eventId]/     # SSE stream (pg_notify → EventSource)
│       ├── qrz/                    # QRZ.com callsign lookup proxy
│       └── export/[code]/          # ADIF + Cabrillo download (?format=cabrillo)
├── components/
│   ├── LoggingClient.tsx           # Full logging UI (client component)
│   ├── DashboardClient.tsx         # Dashboard UI (client component)
│   ├── QSOForm.tsx                 # QSO entry form with band grid + mode toggle
│   ├── QSOTable.tsx                # Real-time log table with pending indicators
│   ├── Scoreboard.tsx              # Score breakdown widget
│   ├── BandActivity.tsx            # Other-station band/mode conflict panel
│   ├── MapView.tsx                 # Leaflet map (dynamic import, no SSR)
│   └── UTCClock.tsx                # Live UTC clock (1s resolution)
├── lib/
│   ├── db.ts                       # pg Pool singleton
│   ├── types.ts                    # Shared TypeScript types + band/mode constants
│   ├── scoring.ts                  # Field Day score calculation
│   ├── adif.ts                     # ADIF file generation
│   ├── cabrillo.ts                 # Cabrillo 3.0 file generation
│   ├── offline-queue.ts            # localStorage QSO queue for offline tolerance
│   ├── qrz.ts                      # QRZ XML API client with session caching
│   └── sections.ts                 # ARRL/RAC section names + map coordinates
├── db/
│   └── schema.sql                  # Database schema, indexes, pg_notify trigger
└── deploy.sh                       # VPS deployment script (Ubuntu/Debian)
```

---

## Operations

### Service management

```bash
systemctl status ezfd          # check running state
systemctl restart ezfd         # restart after config change
journalctl -u ezfd -f          # live logs
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

### nginx notes

The deploy script writes `/etc/nginx/sites-available/ezfd` automatically. One directive is critical and must never be removed:

```nginx
proxy_buffering off;   # without this, SSE (real-time updates) silently breaks
```

### SSL / HTTPS

SSL is configured during `deploy.sh` if you provide a domain and email. Certbot installs a systemd timer for automatic renewal. To renew manually or check renewal:

```bash
certbot renew --dry-run
systemctl status snap.certbot.renew.timer
```

To add SSL after the initial deploy (e.g. once DNS propagates):

```bash
certbot --nginx -d fd.k3abc.org
```

---

## Scoring Reference

EzFD calculates scores per the current ARRL Field Day rules:

| Mode | Points per QSO |
|---|---|
| Phone (PH) | 1 |
| CW | 2 |
| Digital (DIG) | 2 |

**Multiplier:** number of unique ARRL/RAC sections worked (maximum 83).

**Estimated score = total QSO points × sections worked**

Bonus points (GOTA station, W1AW contact, satellite QSO, emergency power, public information table, etc.) are not currently tracked. The score displayed is a floor — your actual submitted score will be higher after accounting for applicable bonuses.

---

## License

MIT — 73 de EzFD.
