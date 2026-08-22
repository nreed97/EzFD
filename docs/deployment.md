# Deployment

`deploy.sh` takes a fresh Ubuntu or Debian machine to a running, TLS-secured
install. It is also the update path — re-running it is safe and preserves
configuration.

## Requirements

- Ubuntu or Debian with root access
- A DNS record pointing at the machine, if you want TLS
- 1 GB RAM is enough; the script adds swap because `next build` gets
  OOM-killed at that size otherwise

## First install

```bash
# git clone https://github.com/nreed97/EzFD.git /opt/ezfd-src
# cd /opt/ezfd-src
# bash deploy.sh
```

You'll be asked for:

| Prompt | Notes |
|---|---|
| Domain name | Leave blank for IP-only access without TLS |
| Let's Encrypt email | Leave blank to skip TLS for now |
| PostgreSQL password | Leave blank to auto-generate |
| Admin key | Leave blank to allow open event creation |

Everything else is derived. The encryption key for QRZ credentials is
generated automatically and stored in `/opt/ezfd/.env`.

## What it installs

| Component | Detail |
|---|---|
| Node.js | Current LTS |
| PostgreSQL | Database `ezfd`, role `ezfd` with DML-only grants |
| nginx | Reverse proxy, with SSE buffering disabled |
| certbot | TLS certificate and automatic renewal |
| systemd | `ezfd.service`, restart on failure, starts at boot |
| Swap | Only if the machine has little RAM and none configured |

The application lives in `/opt/ezfd`, runs as its own unprivileged user, and
listens on localhost with nginx in front.

## Configuration file

`deploy.sh` writes `/opt/ezfd/.env`:

```
DATABASE_URL=postgres://ezfd:PASSWORD@localhost:5432/ezfd
EZFD_ENCRYPTION_KEY=<64 hex characters>
EZFD_DOMAIN=fd.example.org
EZFD_CERT_EMAIL=admin@example.org
EZFD_ADMIN_KEY=<optional>
EZFD_REPO_DIR=/opt/ezfd-src
```

Full meanings in [Configuration](configuration.md).

`EZFD_REPO_DIR` records where you cloned the source, so the admin console's
update action knows where to `git pull` from.

## Updating

```bash
# cd /opt/ezfd-src && git pull
# bash deploy.sh
```

Re-running detects the existing install and preserves the domain, certificate
email, database password, encryption key and admin key. It re-applies the
schema, rebuilds, and restarts.

You can also update from the admin console — **Update application** does the
same `git pull`, rebuild and restart.

> **The rsync that deploys the build must keep `--exclude='.env'`.** Without
> it, `rsync --delete` wipes the live secrets file on every redeploy. This is
> load-bearing; don't remove it while tidying.

## Database schema

`db/schema.sql` is applied on every deploy, as the `postgres` superuser. It is
written to be idempotent — every migration is `IF NOT EXISTS` or otherwise
safe to re-run — so applying it repeatedly is the normal case, not an edge
case.

That also makes it the repair path: if something has gone wrong with the
schema, re-applying it restores what's missing, including the special event
overlap constraint.

Because the schema is applied as `postgres`, that role owns every table. The
application's `ezfd` role has `SELECT`, `INSERT`, `UPDATE` and `DELETE` only.
One practical consequence: `TRUNCATE` requires ownership and fails at runtime,
so bulk clears in the code use `DELETE FROM`.

## TLS

certbot obtains the certificate and installs a renewal timer. If you skipped
the domain at install time, add it later by re-running `deploy.sh` and
answering the prompt.

For SSE to work through nginx, the proxy configuration disables buffering
(`X-Accel-Buffering: no` is also set by the app). If you replace the nginx
config, keep that — without it the real-time updates queue up in the proxy and
arrive in bursts, or not at all.

## Service management

```bash
# systemctl status ezfd
# systemctl restart ezfd
# journalctl -u ezfd -f
```

## Running the database elsewhere

Point `DATABASE_URL` at any reachable PostgreSQL 16 and apply `db/schema.sql`
to it as a superuser. The app needs `pgcrypto` and `btree_gist`, both created
by the schema.

The real-time layer uses `LISTEN`/`NOTIFY`, which works over a normal
connection but not through a connection pooler in transaction mode — PgBouncer
in that mode will silently break live updates. Use session mode or connect
directly.

## Offline field servers

A field server with no internet — typically a Raspberry Pi at the site — works,
with one hardware caveat: **a Pi has no battery-backed real-time clock.**
Without NTP it restores the time from its last shutdown or falls back to an
epoch date, and since QSOs are timestamped by the database, every contact is
then silently logged at the wrong time. Contest logs are cross-checked against
other stations' logs by time, so that costs QSOs at checking time, and it
cannot be repaired after the event.

Two fixes, in order of preference:

1. **Fit an RTC module.** They cost a few dollars (DS3231 and similar), hold
   time across a power cycle, and remove the problem outright. This is the
   recommended setup for anything more than a casual activation.
2. **Set the clock by hand before the event.** `bash ezfd-admin.sh` →
   **Server time / clock** → *Set the clock by hand (UTC)*. Read the time off a
   phone or a GPS receiver.

Either way the app will tell you when it's wrong: the logging page shows a
standing banner whenever the server's clock and the operator's device disagree
by more than a minute. Operators should report that rather than log through it.

Also worth doing on an offline server:

- Create the event **while still online** if you can. The N1MM call history and
  `MASTER.SCP` downloads happen at event creation and are best-effort — a
  failed fetch never blocks the event, it just means no callsign prefill.
- Take a backup to removable media before packing up, since the machine going
  home in a car is a worse failure mode than a disk.

## Backups

Take one before any event you care about:

```bash
# bash ezfd-admin.sh     # → Full JSON backup
# bash ezfd-admin.sh --json > /backup/ezfd-$(date +%F).json
```

Or at the database level:

```bash
# sudo -u postgres pg_dump ezfd | gzip > /backup/ezfd-$(date +%F).sql.gz
```

See [Administration](administration.md) for restores.
