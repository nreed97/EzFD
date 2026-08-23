# HTTP API

All endpoints live under `/api`. Everything is JSON except the export and
download routes, which return files, and the real-time route, which is an
event stream.

There is no authentication. Access control is the join code, plus
`EZFD_ADMIN_KEY` on event creation if the server sets it. See
[Configuration](configuration.md#security-notes).

## Events

### `POST /api/events`

Create an event. Returns `{ id, join_code }`, plus `warnings` if an optional
callsign database failed to download.

| Field | Notes |
|---|---|
| `club_name`, `club_call` | Required |
| `event_type` | `FD`, `WFD` or `SES`; defaults to `FD` |
| `class`, `arrl_section` | Required for contests; optional for `SES` |
| `power` | `HIGH`, `LOW`, `QRP` |
| `event_year` | Defaults to the current year |
| `location` | |
| `qrz_username`, `qrz_password` | Password encrypted before storage |
| `admin_key` | Required if the server sets `EZFD_ADMIN_KEY` |
| `use_call_history`, `use_master_callsign_file` | Forced off for `SES` and non-applicable respectively |
| `starts_at`, `ends_at` | `SES` only, ISO 8601 |
| `ses_description`, `ses_qsl_info` | `SES` only |
| `slot_enforcement` | `SOFT` (default) or `HARD` |
| `slot_minutes` | Default checkout length, default 120 |
| `dupe_rule` | `EVENT`, `DAY` or `NONE` |
| `require_operator_approval` | `SES` only, default false |

Callsign database downloads are best-effort and time-limited. A failure
returns a warning and still creates the event.

`403` if the admin key is required and wrong.

### `GET /api/events/{code}`

Event by join code. Never returns `qrz_password`.

### `PATCH /api/events/{code}/bonuses`

Replace the bonus object. Body is the bonuses map itself.

## QSOs

### `POST /api/qso`

Log a QSO. Returns the created row, `201`.

| Field | Notes |
|---|---|
| `event_id` or `join_code` | One is required |
| `callsign`, `band`, `mode` | Required |
| `rcvd_class`, `rcvd_section` | Contest exchange; class ignored for `SES` |
| `operator_call`, `station_number` | |
| `rst_sent`, `rst_rcvd`, `rcvd_name`, `rcvd_qth`, `rcvd_grid`, `comment` | Special event exchange |
| `adif_mode`, `freq_khz` | Optional detail for export |
| `replay` | Marks a QSO replayed from the offline queue |

Duplicate status is computed server-side from the event's dupe rule.
Duplicates are logged and flagged, never rejected.

On a special event the server may add `slot_warning` to the response — the
QSO was logged, but on a band and mode the operator hasn't checked out.

`403` if roster approval is required and the operator isn't approved.
`409` if enforcement is `HARD` and the operator doesn't hold the slot.

**`replay: true` bypasses both**, unconditionally. A contact that already
happened on the air must not be dropped because the network blipped.

### `GET /api/qso?event_id=`

Every QSO for an event, newest first.

### `PATCH /api/qso/{id}`

Edit callsign, band, mode or exchange. Duplicate status is re-evaluated.

### `DELETE /api/qso/{id}?operator_call=`

Soft delete — the row is marked, not removed. It leaves the live log, the
ADIF and Cabrillo exports, scoring and dupe checking immediately; the
full-event JSON backup keeps it. `operator_call` records who claimed to
delete it. Deleting an already-deleted contact returns 200.

### `POST /api/qso/{id}`

Restore a soft-deleted contact. Body `{ "operator_call": "W0AAA" }`.

### `GET /api/qso?event_id=&deleted=1`

The soft-deleted contacts for an event, most recently deleted first. Without
`deleted=1` only live contacts are returned.



## Special events

### `GET /api/ses/reservations?event_id=`

Current and upcoming checkouts, within the next 48 hours, excluding released
ones. Each row carries `starts_at` and `ends_at` decomposed from the stored
range.

### `POST /api/ses/reservations`

Check out a band and mode. Returns the reservation, `201`.

| Field | Notes |
|---|---|
| `event_id` or `join_code` | Required |
| `op_call`, `band`, `mode` | Required |
| `minutes` | Defaults to the event's slot length |
| `starts_at` | Defaults to now; a future value books ahead |
| `planned_freq`, `note` | Free text |

`409` if it would overlap an existing checkout, with `holder` naming who has
it and until when. `400` for an unknown band or mode, or a non-`SES` event.

### `PATCH /api/ses/reservations/{id}`

| Field | Notes |
|---|---|
| `action` | `extend` or `release` |
| `op_call` | Must match the holder |
| `minutes` | For `extend`, default 15 |

`403` if the slot belongs to someone else. `409` if an extension would run
into the next holder's window.

### `GET /api/ses/operators?event_id=`

The roster.

### `POST /api/ses/operators`

Create or update a roster entry. Upserts on `(event_id, op_call)`, and only
overwrites fields you actually send — saving just a grid won't blank a name.

On an event requiring approval, a newly-created entry starts unapproved.
Existing entries keep whatever approval state they have; re-saving your grid
never silently re-approves you.

## Presence

### `GET /api/presence?event_id=`

Operators active in the last 90 seconds.

### `POST /api/presence`

Publish or refresh your band and mode. Upserts on `(event_id, op_call)`.

### `DELETE /api/presence`

Go QRT.

## Real-time

### `GET /api/realtime/{eventId}`

Server-Sent Events. Two event types:

| Event | Payload |
|---|---|
| `qso` | `{ op, record }` where `op` is `INSERT`, `UPDATE` or `DELETE` |
| `reservation` | Same shape, for checkouts |

A keepalive comment every 25 seconds keeps proxies from timing the stream out.

The reservation payload carries the raw range column rather than decomposed
timestamps — treat it as a signal to refetch, not as data.

## Import and export

### `GET /api/export/{code}`

`?format=json` returns the whole event — settings, bonuses, every QSO, the SES
roster and the checkout history — as a restorable backup. QRZ credentials are
excluded by construction. The `op`/`from`/`to` filters apply to ADIF only; a
filtered portability export would restore as a partial event.


ADIF by default; `?format=cabrillo` for Cabrillo.

| Parameter | Effect |
|---|---|
| `format` | `adif` (default) or `cabrillo` |
| `op` | Only that operator's QSOs |
| `from`, `to` | Restrict to a UTC window |

Duplicates are excluded and records are chronological. Filenames reflect the
filters, so per-operator exports don't collide.

`400` for `format=cabrillo` on a special event — there is no contest to
submit to.

### `POST /api/import/event`

Recreate an event from a full-event JSON export.

```json
{ "payload": [ /* the export */ ], "admin_key": "optional" }
```

Always creates a **new** event with a fresh join code — never overwrites or
merges — so importing is safe to try, and safe to try twice. Returns
`{ "imported": [{ "orig_code", "new_code", "qso_count" }] }`.

Gated by `EZFD_ADMIN_KEY` when it is set, matching event creation.

### `POST /api/import/adif`

| Field | Notes |
|---|---|
| `event_id`, `adif` | Required |
| `operator_call`, `station_number` | Attributed to the imported QSOs |

Returns `{ imported, dupes, already_present, skipped, total }`.

Idempotent: a record matching an existing QSO on callsign, band, mode and a
±2 minute window is skipped rather than inserted.

## Lookups

### `GET /api/qrz?callsign=&event_id=`

QRZ lookup using the event's stored credentials. Returns name, state, country
and grid where available.

### `GET /api/callhistory?callsign=&event_id=`

The station's usual class and section from the N1MM file, plus
`known_master` indicating whether the callsign appears in `MASTER.SCP`.

## Server

### `GET /api/time`

The server's current time, so a client can tell when its own clock disagrees.

```json
{ "app_time": "2026-06-27T18:04:11.204Z", "db_time": "2026-06-27T18:04:11.207Z" }
```

`db_time` is PostgreSQL's clock — the one that actually stamps QSOs — and is
`null` if the database can't be reached, which is not treated as an error. The
two are reported separately because the app process and the database need not
be on the same host.

This doesn't change who is authoritative: QSOs are still stamped by the server.
It exists so a wrong server clock is visible rather than silent. Clients should
halve the round-trip time when comparing, so a slow link doesn't read as skew.

## Downloads

### `GET /api/download/wsjtx-bridge`

The relay script.

### `GET /api/download/relay?join_code=&operator=&station=&api_url=`

A Windows `.bat` wrapper with the event details filled in.
