# Architecture

EzFD is a Next.js 16 App Router application (standalone output, run as
`node server.js`) on PostgreSQL 16, with Tailwind v4 for styling. Dark is the
default theme, so light-mode styles carry the `light:` prefix.

There are five ideas worth understanding; the rest is ordinary CRUD.

## Real-time updates

Every operator needs to see every QSO immediately, including for duplicate
checking. Rather than polling, the app uses PostgreSQL's own notification
system.

```
QSO INSERT ─→ trigger ─→ pg_notify('qsos_<event_id>')
                              │
                    ┌─────────┴──────────┐
                    │  one shared        │  a single pg connection for the
                    │  listener          │  whole process, LISTENing for
                    │  (lib/realtime.ts) │  every event that has a stream open
                    └─────────┬──────────┘
                              │  fanned out in memory
                    ┌─────────┴──────────┐
                    │  /api/realtime     │  one Server-Sent Events stream
                    │                    │  per browser window
                    └─────────┬──────────┘
                              │
                    ┌─────────┴──────────┐
                    │  every browser     │
                    └────────────────────┘
```

Three channels per event: `qsos_<id>` for QSO changes, `ses_<id>` for
checkouts and claims, and `presence_<id>` for a logging window changing band
or mode, arriving or going QRT. One SSE endpoint serves all three, tagging each
message with an event name (`qso`, `reservation`, `presence`) so the client can
tell them apart. That keeps it to one stream per browser window rather than one
per data type.

The database side is shared. Each stream used to open its own PostgreSQL
connection to `LISTEN`, so a hundred open tabs — or a hundred requests from
anybody, for event ids that did not even exist — took every connection the
server had, and every other API call failed until they closed. Now one
connection listens on behalf of every stream: an event's channels are
subscribed when its first stream opens and released when its last one closes.
That relies on EzFD being a single `node server.js`. The route refuses an id
that is not a UUID, or that names no event, before anything reaches the
database; channel names are quoted with `escapeIdentifier`. Total streams are
capped by `EZFD_MAX_STREAMS` (see [Configuration](configuration.md#ezfd_max_streams)).

`NOTIFY` refuses a payload of 8,000 bytes or more, and refuses it by raising
inside the trigger, which rolled back the write being announced. The triggers
therefore send a row too large to fit as its id alone, and the shared listener
fetches the row before passing it on, so the browser receives the same shape
either way. The API also trims free text well below that size.

Three screens open a stream: the logging window, the CW keying popout — a
separate document — and the operating position picker, which is watching for a
checkout made somewhere else while an operator decides where to sit. The
dashboard opens a fourth.

Presence is announced only when something an operator would see changes. Every
logging window heartbeats every 30 seconds to say it is still there, and those
heartbeats are deliberately silent: announcing them would turn each one into a
refetch by every other window. A window that closes without going QRT (a lid
shut, a battery gone) announces nothing, so screens still sweep presence and
claims once a minute. The sweep is the recovery path too, since an SSE stream
can die quietly, and it pauses while the page is hidden. The heartbeat never
pauses, because a logger in a background tab is still on the air.

Consequences:

- Anything deciding whether a claim is live from a clock has to read that
  clock at least as often as it expects data. The position picker read it on
  the poll interval, which was invisible until checkouts started arriving on
  the stream — a claim made *now* begins after the last tick, so fresh data
  landed and the board still called it not yet started.
- A connection pooler in transaction mode breaks this silently. See
  [Configuration](configuration.md#database_url).
- nginx must not buffer the SSE response. The app sets
  `X-Accel-Buffering: no`; the deployed nginx config disables buffering too.
- The stream sends a keepalive comment every 25 seconds so proxies don't time
  it out.
- A stream never finishes on its own, so it has to be ended on shutdown. Next
  closes the HTTP server on `SIGTERM` and waits for every connection to
  finish, and one open tab used to hold a restart until systemd force-killed
  the process at 90 seconds. The route keeps a set of its open streams and ends
  them all on `SIGTERM` and closes the shared listener, so the process exits
  in well under a second. Each
  browser sees its stream drop and reconnects once the new process is up, which
  is also the signal that drains its offline queue.

## Offline tolerance

Field Day sites have unreliable networking, so the log is written locally
first and synced second.

```
operator logs ─→ localStorage queue ─→ POST /api/qso ─→ dequeue on success
                        │                     │
                        │                     ├─ no answer or 5xx: stays queued
                        │                     └─ 4xx: kept, set aside, shown
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

A refusal the server means (a 4xx, other than 408 and 429) is not retried,
because retrying cannot change the answer, and is not dropped either, because
the contact happened on the air. It is set aside in the queue with the server's
reason and shown in the log list until an operator re-logs it correctly and
deletes it. Before this, a contact that could never be accepted sat at the head
of the queue retrying every minute, and every contact queued behind it waited
with it.

Every contact is still dated by the server's clock, but a queued one is dated
by how long it waited: the browser sends `age_ms`, the time between queueing it
and sending it, and the server stores `NOW() - age`. Both ends of that interval
are read from the same browser clock, so however wrong that clock is cancels
out, and the single-clock property the log depends on holds. Before this, a
contact queued through a twenty-minute outage was stamped with the reconnect
time. The WSJT-X relay does the same from WSJT-X's own logged time.

## Duplicate contacts

Whether a contact is a dupe is a property of its group (the event, call, band
and mode, and on a `DAY` event the UTC date), not of the row, so it is settled
for the group. `ezfd_recompute_dupes()` in `db/schema.sql` ranks the group's
live contacts by time and flags all but the first; every insert, edit, delete,
restore, ADIF import and merge calls it for the groups it touched. The per-row
check it replaced could set a flag but never clear one, so deleting the first
of two contacts left the second flagged and scoring nothing. An insert takes a
transaction-scoped advisory lock on its group first, so two operators logging
the same station in the same instant cannot both be recorded as the one that
counts.

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
