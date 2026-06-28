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
| **Docker deploy** | Single `docker compose up -d` starts both the app and a local PostgreSQL instance |

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

## Quick Start (Docker)

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with the Compose plugin (`docker compose version`)
- Git

### 1 — Clone

```bash
git clone https://github.com/nreed97/EzFD.git
cd EzFD
```

### 2 — Configure

```bash
cp .env.example .env.local
```

Open `.env.local` and set a strong database password:

```env
POSTGRES_PASSWORD=change_me_to_a_strong_password
```

That is the only required change. The app reads `DATABASE_URL` from the Compose environment automatically.

### 3 — Start

```bash
docker compose up -d
```

The first run builds the Next.js image and initialises the database schema automatically. It takes about 60–90 seconds.

```bash
docker compose logs -f web   # watch startup
```

### 4 — Open

Navigate to `http://<server-ip>:3000` from any device on the same network.

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

All configuration is through environment variables. In Docker deployments these are set in `.env.local`; for bare-metal deployments export them before starting the app.

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | **Yes** | Password for the `ezfd` database user. Set this before the first `docker compose up`. |
| `DATABASE_URL` | Auto | Connection string built by Compose as `postgresql://ezfd:<POSTGRES_PASSWORD>@db:5432/ezfd`. Override to point at an external Postgres instance. |

### External PostgreSQL

To use an existing PostgreSQL server instead of the bundled container, set `DATABASE_URL` directly and remove (or comment out) the `db` service from `docker-compose.yml`. Apply the schema manually:

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
├── Dockerfile                      # Multi-stage Next.js standalone build
├── docker-compose.yml              # App + PostgreSQL services
└── .env.example                    # Environment variable template
```

---

## Production Deployment Notes

### Reverse Proxy (nginx)

To run EzFD behind nginx on port 80/443, add these directives. The `proxy_buffering off` line is required — nginx buffers responses by default and will break the SSE stream.

```nginx
location / {
    proxy_pass          http://localhost:3000;
    proxy_http_version  1.1;
    proxy_set_header    Upgrade $http_upgrade;
    proxy_set_header    Connection '';
    proxy_set_header    Host $host;
    proxy_set_header    X-Real-IP $remote_addr;

    # Required for SSE (real-time QSO updates)
    proxy_buffering     off;
    proxy_cache         off;
    chunked_transfer_encoding on;
}
```

### TLS / HTTPS

Use [Certbot](https://certbot.eff.org/) with the nginx plugin to obtain a free Let's Encrypt certificate. HTTPS is strongly recommended if the app is exposed beyond the local network.

### Backups

QSO data lives in the `postgres_data` Docker volume. Back it up with:

```bash
docker exec ezfd-db-1 pg_dump -U ezfd ezfd | gzip > ezfd_backup_$(date +%Y%m%d).sql.gz
```

Restore with:

```bash
gunzip -c ezfd_backup_20260622.sql.gz | docker exec -i ezfd-db-1 psql -U ezfd ezfd
```

### Updates

```bash
git pull
docker compose build web
docker compose up -d web
```

The database schema is applied once on the first container start via `docker-entrypoint-initdb.d`. It will not re-run on subsequent updates. Future releases that include schema changes will ship with explicit migration instructions.

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
