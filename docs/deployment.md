# Deployment

There are two ways to install EzFD, and they run the same app against the
same schema:

- **`deploy.sh`** takes a fresh Debian, Ubuntu or Raspberry Pi OS machine to a
  running, TLS-secured install with nginx, certbot and a systemd service. It
  is also the update path — re-running it is safe and preserves
  configuration. Most of this page is about it.
- **[Docker Compose](#docker-compose)** runs the app, PostgreSQL and a Caddy
  proxy as containers on any machine with Docker, whatever the distribution.

Pick `deploy.sh` on a machine it supports, and on a Raspberry Pi field server
in particular, where [Offline field servers](field-server.md) is written
around it. Pick Docker Compose on a distribution `deploy.sh` refuses, or on a
host that already runs other things in containers.

## Requirements

- **Root access, and systemd.** The service unit is how EzFD starts, and how
  it starts again after a power cut, so systemd is not optional.
- **Debian, Ubuntu or Raspberry Pi OS** — including derivatives that declare
  that heritage, such as Mint and Pop!_OS. The script stops on anything else.
  See [Other distributions](#other-distributions).
- A DNS record pointing at the machine, if you want TLS. Leave the domain
  blank and certbot never runs, which is the field-server answer.
- 1 GB RAM is enough; the script adds swap below 2 GB because `next build`
  can get OOM-killed at that size otherwise.

## Other distributions

`deploy.sh` stops on anything that is not Debian, Ubuntu or Raspberry Pi OS.
That is a statement about the script, not about the app: EzFD is an ordinary
Node standalone build against PostgreSQL behind a reverse proxy, and runs
anywhere those do.

The reason the script is narrow is that everything it does after the pre-flight
assumes Debian's layout — that nginx reads server blocks from `sites-enabled`,
that the PostgreSQL package creates and starts a cluster, that the firewall is
`ufw`, that `nologin` lives in `/usr/sbin`. Where those do not hold, the
failures are **silent**: a server block written to a directory nginx never
includes still passes `nginx -t`, because a file nobody includes is not a
syntax error, so the deploy reports success and the site serves nginx's welcome
page. One narrow path that is correct is worth more than a wide one that is
quietly wrong, particularly while the app is changing quickly.

Deploying by hand on another distribution is not difficult, and the script
prints this shape when it stops:

- Node 24+, PostgreSQL, nginx, rsync and openssl from your package manager.
  On Fedora and RHEL the cluster needs `postgresql-setup --initdb` first; on
  Arch, `initdb` as the `postgres` user
- Create the role and database, then apply `db/schema.sql` **once**. It is
  complete on its own — the `apply_migration` steps in `deploy.sh` exist only
  to upgrade installs that predate a column, and CI builds its entire test
  database from `schema.sql` alone
- `npm ci && npm run build`, then run `.next/standalone/server.js` under
  whatever supervisor you use, with `static/` and `public/` alongside it
- Point a reverse proxy at it with **`proxy_buffering off`** — without that,
  SSE never streams and the log silently stops updating on other screens
- With SELinux enforcing, `setsebool -P httpd_can_network_connect on`, or
  every request 502s

The environment variables are listed in
[Configuration](configuration.md); only `DATABASE_URL` is strictly required.

This path is unsupported in the sense that nothing here tests it. It is not
discouraged.

Before doing that, consider the [Docker Compose](#docker-compose) install,
which needs nothing from the distribution but Docker and is tested in CI.

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
| Node.js | The major in `.nvmrc` (24 LTS), from NodeSource — amd64 and arm64 only |
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

An update also brings Node.js up to the major in `.nvmrc` if the server is
running an older one. Servers installed before this was added were left on
Node 20 through every redeploy, and Node 20 stopped receiving security fixes in
April 2026; re-running `deploy.sh` once moves them to Node 24. A newer Node is
left alone.

You can also update from the admin console — **Update application** does the
same `git pull`, rebuild and restart, but it does not install Node. If the
server is below the version in `.nvmrc` it says so and carries on; re-run
`deploy.sh` to upgrade.

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

A restart takes a second or two, even with operators logging. The app ends
its live-update streams when told to stop, so open tabs don't hold the old
process up; they drop, reconnect to the new one within a few seconds, and send
anything they queued in between. If `systemctl restart ezfd` ever sits for
15 seconds, that is the unit's `TimeoutStopSec` force-stopping something that
did not exit — worth a look in `journalctl -u ezfd`.

## Running the database elsewhere

Point `DATABASE_URL` at any reachable PostgreSQL 16 and apply `db/schema.sql`
to it as a superuser. The app needs `pgcrypto` and `btree_gist`, both created
by the schema.

The real-time layer uses `LISTEN`/`NOTIFY`, which works over a normal
connection but not through a connection pooler in transaction mode — PgBouncer
in that mode will silently break live updates. Use session mode or connect
directly.

## Docker Compose

`compose.yaml` at the root of the repository runs EzFD as four containers.
It needs nothing from the host but Docker, so it works on distributions
`deploy.sh` stops on. CI builds it from scratch on every change and runs the
whole end-to-end suite through its proxy.

### Requirements for Docker

- **Docker Engine with the Compose plugin** (`docker compose`, not the old
  `docker-compose`). Docker's own install instructions cover every major
  distribution.
- **A 64-bit machine**, amd64 or arm64. A 64-bit Raspberry Pi OS is fine; a
  32-bit one is not, for the same reason `deploy.sh` cannot use it.
- **The network while it builds.** The image runs `npm ci` and fetches the
  interface font, exactly as `deploy.sh` does. Build at home, then carry the
  machine anywhere.
- **Swap on a 1 GB machine.** `deploy.sh` adds a swap file below 2 GB of RAM
  because `next build` can be OOM-killed without one. Docker does not, so on a
  small droplet add swap yourself before the first build.
- Ports 80 and 443 free, and a DNS record pointing at the machine if you want
  TLS.

### First install with Docker

```bash
$ git clone https://github.com/nreed97/EzFD.git ezfd
$ cd ezfd
$ cp .env.example .env
$ chmod 600 .env
$ nano .env
$ docker compose up -d
```

`.env.example` is the template, with a comment on every setting. Fill in the
three required ones, generating each with the command the file gives beside
it:

```bash
$ openssl rand -hex 24    # POSTGRES_PASSWORD, and again for EZFD_DB_PASSWORD
$ openssl rand -hex 32    # EZFD_ENCRYPTION_KEY
```

Set `EZFD_DOMAIN` for a TLS certificate; leave it blank for plain HTTP on
port 80, by IP address or any name. `EZFD_ADMIN_KEY` works as it does on a
`deploy.sh` install. Every setting is described in
[Configuration → The Docker Compose .env](configuration.md#the-docker-compose-env).

The last command builds the app image, `ezfd:latest`, from this checkout.
EzFD is not published to Docker Hub or any other registry, so there is nothing
to pull: the `app` service in `compose.yaml` carries its own `build:` and
`pull_policy: build`, which makes every `docker compose up` build it locally.
That also means a tool that drives compose for you, such as Arcane, builds it
the same way, as long as the project folder it uses is this checkout rather
than a copy of `compose.yaml` on its own.

Keep the passwords to letters and digits, as `openssl rand -hex` produces.
`EZFD_DB_PASSWORD` is written into a connection URL, where some punctuation
has a meaning of its own.

The first build takes a few minutes. When `docker compose ps` shows `app`,
`db` and `proxy` running and `init` exited with code 0, the site is up.

### What runs

| Service | What it is |
|---|---|
| `db` | PostgreSQL 16. Data lives in the `ezfd-db` volume and survives rebuilds |
| `init` | Runs on every start, before the app, then exits. Creates the `ezfd` role and applies `db/schema.sql` as the superuser |
| `app` | The Next.js server, built locally from the `Dockerfile` as `ezfd:latest`. Its container is named `ezfd` |
| `proxy` | Caddy. Obtains and renews the certificate when `EZFD_DOMAIN` is set, and streams live updates without buffering |

The database is laid out exactly as on a `deploy.sh` install: `postgres` owns
the tables and the app connects as `ezfd` with `SELECT`, `INSERT`, `UPDATE`
and `DELETE` only (see [Database schema](#database-schema)).

Every service is `restart: unless-stopped`, so the stack comes back after a
reboot or a power cut as long as the Docker service itself starts at boot,
which it does by default wherever Docker is packaged.

### Updating a Docker install

The admin console does it in the safe order:

```bash
$ sudo bash ezfd-admin.sh      # → Update application
```

It pulls, builds the new image while the old app keeps serving, applies the
schema on its own, and only then replaces the app, so a schema error stops the
update with the old app still running. By hand, the same steps are:

```bash
$ git pull
$ docker compose build
$ docker compose run --rm init
$ docker compose up -d
```

Don't shorten that to a bare `docker compose up -d` on an install you care
about. It builds and starts everything, but compose stops the old app before
the schema step has finished, so a schema error leaves the site returning 502
until it is fixed. On a first install there is nothing to lose, which is why
the install above uses it.

Every `docker compose up -d` rebuilds the app image, from the build cache when
nothing has changed, and on current Docker versions it then replaces the app
container even so. That costs about a second: open tabs reconnect and send
anything they queued, as they do after any restart.

### Logs and restarts

```bash
$ docker compose logs -f app
$ docker compose restart app
$ docker compose ps
```

A restart takes about a second with operators logging, as it does under
systemd: the app ends its live-update streams when told to stop, and open tabs
reconnect and send anything they queued.

### What is different under Docker

- **The admin console runs on the host**, from the checkout. It finds the
  `db` container through `compose.yaml` and otherwise works as it does on a
  `deploy.sh` install. See
  [Administration → On a Docker install](administration.md#on-a-docker-install).
- **The clock belongs to the host.** Containers share the host's clock, so it
  is set and checked from the host, and the admin console's
  **Server time / clock** works unchanged. The app inside the container
  cannot see what disciplines that clock, so it reports it as unknown rather
  than as a problem; its comparison against the operators' devices still
  works. See
  [Troubleshooting → Nothing is holding this server's clock](troubleshooting.md#nothing-is-holding-this-servers-clock-has-not-been-set-for-n-days).
- **Database-level backups come from the `db` container:**
  `docker compose exec -T db pg_dump -U postgres ezfd | gzip > ezfd.sql.gz`.
  `ezfd-admin.sh --json` works as before.
- **`docker compose down -v` deletes the database.** `down` on its own keeps
  the volumes; `-v` removes them, log included.

### Moving a deploy.sh install to Docker

Take a database dump on the old server, then load it into the new stack
before the app first starts:

```bash
# on the old server
# sudo -u postgres pg_dump --no-owner ezfd > ezfd.sql

# on the new one, with .env written and ezfd.sql copied over
$ docker compose build
$ docker compose run --rm init
$ docker compose exec -T db dropdb -U postgres ezfd
$ docker compose exec -T db createdb -U postgres ezfd
$ docker compose exec -T db psql -U postgres -d ezfd -v ON_ERROR_STOP=1 < ezfd.sql
$ docker compose up -d
```

`init` runs first so the `ezfd` role exists when the dump's grants are
replayed. Copy `EZFD_ENCRYPTION_KEY` from the old `/opt/ezfd/.env` into the
new `.env`, or stored QRZ passwords cannot be decrypted. Join codes, contacts
and the SES roster come across as they were.

## Offline field servers

A Pi at the site with no internet is a different deployment from this one, and
it has its own guide: **[Offline field servers](field-server.md)**.

It is the same `deploy.sh`, run in a different order. Everything on this page
needs the network *at install time* — apt repositories, and Let's Encrypt if
you asked for a domain — so a field server is installed at home and carried to
the site. Leave the domain blank and certbot never runs at all. What the guide
covers is the rest: the clock, mDNS, verifying it boots with the network off,
and merging the log back afterwards.

The one thing worth repeating here, because it is unrecoverable rather than
merely inconvenient: **a Pi earlier than a 5 has no battery-backed clock**, and
QSOs are timestamped by the server. With no NTP it comes up holding the time of
its last shutdown or an epoch date, and every contact gets a plausible-looking
wrong time that costs QSOs at checking time. Fit an RTC or a GPS receiver, or
set the clock by hand before the first contact — `bash ezfd-admin.sh` →
**Server time / clock**, which reports which of those is actually keeping time.

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
