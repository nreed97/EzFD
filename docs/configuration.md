# Configuration

Every environment variable EzFD reads. On a `deploy.sh` install these live in
`/opt/ezfd/.env`, written by `deploy.sh` and read by the systemd unit. On a
Docker Compose install they live in `.env` beside `compose.yaml`, in a
slightly different shape — see
[The Docker Compose .env](#the-docker-compose-env).

## Required

### `DATABASE_URL`

PostgreSQL connection string.

```
DATABASE_URL=postgres://ezfd:PASSWORD@localhost:5432/ezfd
```

Used by the connection pool and, separately, by the real-time endpoint, which
opens its own dedicated connection per client to `LISTEN` on that event's
channels.

A connection pooler in transaction mode (PgBouncer's default) silently breaks
`LISTEN`/`NOTIFY` and therefore all live updates. Use session mode or connect
directly.

## Strongly recommended

### `EZFD_ENCRYPTION_KEY`

64 hex characters — 32 bytes. Encrypts stored QRZ passwords with AES-256-GCM.

```bash
$ openssl rand -hex 32
```

`deploy.sh` generates one automatically and preserves it across updates.

Without it, creating an event that includes QRZ credentials fails with a clear
error. Everything else works. **Changing it makes existing stored QRZ
passwords undecryptable** — they must be re-entered.

### `EZFD_ADMIN_KEY`

If set, creating an event requires this key. If unset, anyone who can reach
the site can create events.

Worth setting on a public server. Not needed on a private LAN.

## Optional

### `EZFD_DOMAIN`, `EZFD_CERT_EMAIL`

Recorded by `deploy.sh` for the nginx configuration and certbot. Re-used when
you re-run the script so it doesn't re-prompt.

### `EZFD_REPO_DIR`

Where the source was cloned. The admin console's **Update application** action
uses it to find the git checkout to pull. Written by `deploy.sh`.

### `EZFD_FD_CALL_HISTORY_URL`, `EZFD_WFD_CALL_HISTORY_URL`

Override where the N1MM call history file is fetched from. Supports a `{year}`
placeholder.

These exist because N1MM's files are contest- and year-specific, published at
a URL built from the contest and year. The app derives the URL and falls back
to the prior year if the current one isn't published yet. Override if N1MM
changes their scheme.

### `EZFD_MASTER_SCP_URL`

Override where `MASTER.SCP` is fetched from. Unlike the call history file this
one is evergreen — not year-specific — and is shared across every event on the
server, refreshed at most once a day.

## The Docker Compose .env

`compose.yaml` reads `.env` from the same directory and builds the app's
environment from it. Start from the template in the repository —
`cp .env.example .env` — which lists every setting below with a comment;
nothing generates the file for you. The first three are required, and
`docker compose` refuses to start without them, naming the one that is
missing.

| Variable | What it is |
|---|---|
| `POSTGRES_PASSWORD` | The database superuser's password. Used by the `db` container and by the `init` step that applies the schema; the app never sees it |
| `EZFD_DB_PASSWORD` | The `ezfd` role's password. The `init` step sets it on every start and compose builds `DATABASE_URL` from it, so there is no `DATABASE_URL` to write |
| `EZFD_ENCRYPTION_KEY` | As [above](#ezfd_encryption_key). 64 hex characters |
| `EZFD_ADMIN_KEY` | As [above](#ezfd_admin_key). Optional |
| `EZFD_DOMAIN` | The domain Caddy obtains a certificate for. Blank serves plain HTTP on port 80 |
| `EZFD_HTTP_PORT`, `EZFD_HTTPS_PORT` | The host ports Caddy listens on, 80 and 443 by default. A certificate needs both at their defaults |
| `EZFD_REF` | The branch, tag or commit of `https://github.com/nreed97/EzFD` the images are built from. Blank builds `master` |
| `EZFD_SOURCE` | Replaces the repository and `EZFD_REF` entirely. `.` builds from the checkout `compose.yaml` sits in, including uncommitted changes; a fork's URL with its own `#branch` builds the fork. Blank uses GitHub at `EZFD_REF` |

The call history and `MASTER.SCP` overrides work here too, under the same
names. `EZFD_CERT_EMAIL` and `EZFD_REPO_DIR` are `deploy.sh`'s and are not
used.

Generate the secrets with `openssl rand -hex`, as `.env.example` and
[Deployment → First install with Docker](deployment.md#first-install-with-docker)
show. Changing `EZFD_DB_PASSWORD` later is fine, since `init` re-applies it on
the next start. Changing `POSTGRES_PASSWORD` after the first start is not: the
`db` container only reads it when it creates the database, so the new value
stops matching and `init` fails to connect.

## The WSJT-X relay

These are read by `wsjtx-bridge.cjs`, which runs on the *operator's* machine,
not the server. Each has a matching command-line flag that takes precedence.

| Variable | Flag | Default |
|---|---|---|
| `EZFD_EVENT_ID` | `--event-id` | *required* |
| `EZFD_API_URL` | `--api-url` | `http://localhost:3000` |
| `EZFD_OPERATOR` | `--operator` | *(empty)* |
| `EZFD_STATION` | `--station` | `1` |
| `EZFD_UDP_PORT` | `--port` | `2237` |
| `EZFD_SPOOL` | `--spool` | `~/.ezfd/wsjtx-queue-<event-id>.jsonl` |

See [Digital modes](digital-modes.md).

## Applying changes

```bash
# nano /opt/ezfd/.env
# systemctl restart ezfd
```

The service reads the file at start, so a restart is required.

On a Docker install, edit `.env` beside `compose.yaml` and recreate the
containers, which a plain restart does not do:

```bash
$ docker compose up -d
```

## Security notes

`/opt/ezfd/.env` holds the database password, the encryption key and the admin
key. It should be readable only by the service user. The Docker `.env` holds
the same and more, so `chmod 600` it; `.dockerignore` keeps it out of the
image.

QRZ passwords are encrypted at rest with `EZFD_ENCRYPTION_KEY` and never
returned by the API — the event endpoint omits the column entirely.

There are no user accounts. Access to an event is the six-character join code,
and operator identity is self-asserted at join time. For a special event you
can additionally require roster approval before an operator may log, but that
is an authorisation gate, not authentication. Treat the join code as the
secret it is, and don't expose an instance publicly if that model doesn't suit
you.
