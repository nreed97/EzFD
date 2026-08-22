# Architecture

EzFD is a Next.js 16 App Router application (standalone output, run as
`node server.js`) on PostgreSQL 16, with Tailwind v4 for styling. Dark is the
default theme, so light-mode styles carry the `light:` prefix.

There are four ideas worth understanding; the rest is ordinary CRUD.

## Real-time updates

Every operator needs to see every QSO immediately, including for duplicate
checking. Rather than polling, the app uses PostgreSQL's own notification
system.

```
QSO INSERT ─→ trigger ─→ pg_notify('qsos_<event_id>')
                              │
                    ┌─────────┴─────────┐
                    │  /api/realtime     │  a dedicated pg connection
                    │  LISTENs on both   │  per connected client
                    │  channels          │
                    └─────────┬─────────┘
                              │  Server-Sent Events
                    ┌─────────┴─────────┐
                    │  every browser     │
                    └────────────────────┘
```

Two channels per event: `qsos_<id>` for QSO changes and `ses_<id>` for special
event checkouts. One SSE endpoint serves both, tagging each message with an
event name so the client can tell them apart. That keeps it to one connection
per browser window rather than one per data type.

Consequences:

- A connection pooler in transaction mode breaks this silently. See
  [Configuration](configuration.md#database_url).
- nginx must not buffer the SSE response. The app sets
  `X-Accel-Buffering: no`; the deployed nginx config disables buffering too.
- The stream sends a keepalive comment every 25 seconds so proxies don't time
  it out.

## Offline tolerance

Field Day sites have unreliable networking, so the log is written locally
first and synced second.

```
operator logs ─→ localStorage queue ─→ POST /api/qso ─→ dequeue on success
                        │                     │
                        │                     └─ on failure: stays queued
                        └─ shown immediately, marked "Queued — syncing…"
```

The queue flushes on reconnect and can be retried manually. A QSO leaves the
queue only when the server confirms it — an earlier version checked the wrong
value and dropped QSOs whenever a submit failed, which is exactly the failure
this design exists to prevent.

Replayed QSOs carry a `replay` flag. The server accepts those unconditionally,
bypassing the special event checkout and approval gates, because by reconnect
time the reservation has expired and the contact already happened on the air.
Refusing it would only lose the record.

## Special event call checkout

The rule is one signal per band per mode. Two operators claiming the same slot
at the same instant is a genuine race, and no application-level check closes
it — between the `SELECT` that finds the slot free and the `INSERT` that
claims it, the other operator can do both.

So the database enforces it:

```sql
CONSTRAINT ses_no_overlap EXCLUDE USING gist (
  event_id WITH =, band WITH =, mode WITH =, during WITH &&
) WHERE (status <> 'RELEASED')
```

`during` is a `tstzrange`. The constraint makes overlapping rows impossible,
so the loser of a race gets SQLSTATE `23P01` and the route turns that into a
409 naming the current holder. It also rejects an *extension* that would run
into someone else's slot, which is the desired behaviour rather than a bug.

`btree_gist` is required for the `=` comparisons to sit alongside the range
overlap test in one GiST index.

See [Database](database.md#ses_reservations).

## Rig control

The bridge runs entirely on the operator's machine:

```
radio ──serial──→ rigctld ──TCP──→ ezfd-rig-bridge.py ──WebSocket──→ browser
                                        (localhost:4575)
```

The server is not involved and never learns anything about the radio. Both the
main logging tab and the CW popout open their own connection to the bridge via
a shared hook.

All `rigctld` I/O is serialised behind one lock, because polling and CW
commands share a connection and interleaving them corrupts both.

## Layout

```
app/
  api/            route handlers
  event/[code]/   join, log, dashboard, CW popout
  event/new/      event creation
components/       React components, all client-side
lib/              shared logic — scoring, exports, db, types
db/               schema and its tests
scripts/          test suites and the WSJT-X relay
```

`lib/` holds anything that is or could be shared between routes and
components. Notable pieces:

| File | Responsibility |
|---|---|
| `scoring.ts` | The ARRL formula. The single source of truth for score |
| `adif.ts` | ADIF import parsing and export generation |
| `cabrillo.ts` | Cabrillo export (contest events only) |
| `ses.ts` | Checkout queries, the `23P01` constant, slot formatting |
| `events.ts` | Shared event column list, and the dupe rule |
| `offline-queue.ts` | The localStorage queue |
| `useRigBridge.ts` | WebSocket hook shared by both logging windows |
| `types.ts` | Domain types, band and mode lists, section list |

## Things that bite

Collected here because they've each cost real debugging time. `AGENTS.md`
carries the full list for anyone changing the code.

**`pg` returns `TIMESTAMPTZ` as JavaScript `Date` objects, not strings.**
Export and formatting code has to handle both shapes. Interpolating one into a
message produces `Sat Aug 22 2026 02:24:29 GMT+0000 (Coordinated Universal
Time)` rather than a time an operator can read.

**Sections do not multiply the Field Day score.** This has been implemented
wrongly more than once. See [Field Day](field-day.md#scoring).

**Inline arrow-function props recreate identity every render.** A parent that
re-renders on every rig frequency tick — four times a second — passing
`foo={() => …}` to a child whose effect depends on it will retrigger that
effect continuously. This once prevented an auto-CQ timer from ever completing
an interval. Memoise in the parent, or read the current value through a ref
inside long-lived timers.

**`json_agg` over zero rows serialises as JSON `null`** — a scalar, not SQL
NULL — so `COALESCE(x, '[]')` doesn't catch it and `jsonb_array_elements`
fails. Check `jsonb_typeof` instead.
