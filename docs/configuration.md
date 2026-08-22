# Configuration

Every environment variable EzFD reads. In a normal install these live in
`/opt/ezfd/.env`, written by `deploy.sh` and read by the systemd unit.

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

See [Digital modes](digital-modes.md).

## Applying changes

```bash
# nano /opt/ezfd/.env
# systemctl restart ezfd
```

The service reads the file at start, so a restart is required.

## Security notes

`/opt/ezfd/.env` holds the database password, the encryption key and the admin
key. It should be readable only by the service user.

QRZ passwords are encrypted at rest with `EZFD_ENCRYPTION_KEY` and never
returned by the API — the event endpoint omits the column entirely.

There are no user accounts. Access to an event is the six-character join code,
and operator identity is self-asserted at join time. For a special event you
can additionally require roster approval before an operator may log, but that
is an authorisation gate, not authentication. Treat the join code as the
secret it is, and don't expose an instance publicly if that model doesn't suit
you.
