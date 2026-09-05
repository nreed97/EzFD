# Database

PostgreSQL 16. The full definition is `db/schema.sql`, which is applied on
every deploy and written to be idempotent — re-running it is the normal case
and also the repair path.

Extensions: `pgcrypto` for UUID generation, `btree_gist` for the special event
overlap constraint.

## Roles

The schema is applied as `postgres`, so `postgres` owns every table. The
application connects as `ezfd`, which is granted `SELECT`, `INSERT`, `UPDATE`
and `DELETE` — no ownership.

One practical consequence: `TRUNCATE` requires ownership and fails at runtime
with a permission error. Bulk clears in application code use `DELETE FROM`.
`lib/masterCallsigns.ts` does this inside a transaction, so a mid-import
failure can't leave a partial list carrying a fresh timestamp.

Any new table needs an explicit `GRANT` or every query against it fails in
production while working fine in a superuser test.

## `events`

One row per event. The join code is what operators type; the UUID is internal.

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `join_code` | Unique, six characters, what operators enter |
| `club_name`, `club_call` | Display name and the callsign signed on the air |
| `event_year` | |
| `event_type` | `FD`, `WFD` or `SES` |
| `class` | **Nullable.** NULL for special events |
| `arrl_section` | **Nullable.** NULL or optional for special events |
| `gota_call` | **Nullable.** The GOTA station's callsign. NULL turns the feature off, and it is only stored for Field Day |
| `power` | `HIGH`, `LOW`, `QRP` — scoring multiplier, contests only |
| `location` | Free text |
| `qrz_username`, `qrz_password` | Password encrypted at rest, never returned by the API |
| `qrz_session_key`, `qrz_session_expires` | Cached QRZ session |
| `bonuses` | JSONB, contest bonus tracking |
| `use_call_history`, `use_master_callsign_file` | Opt-in callsign databases |
| `starts_at`, `ends_at` | Special event activation window |
| `ses_description`, `ses_qsl_info` | Shown to operators on join |
| `slot_enforcement` | `SOFT` or `HARD` |
| `slot_minutes` | Default checkout length |
| `dupe_rule` | `EVENT`, `DAY` or `NONE` |
| `require_operator_approval` | Roster gating, default false |

`qsos.is_gota` marks a contact worked at the Get On The Air station. It is a
flag rather than a separate event because rule 4.1.1.5 makes a GOTA contact
count **twice**: full QSO credit for the parent entry, *and* 5 bonus points
under 7.3.13.1. A separate log would have to be merged back before the entry
could be scored correctly. Excluding these contacts from QSO points — which is
the intuitive reading, and what this feature's original plan proposed — costs
a point per phone contact and two per CW or digital one.

`class` and `arrl_section` became nullable when special events were added.
Every read of them needs a null guard — `cabrillo.ts`, `adif.ts`,
`SummarySheet.tsx` and the QSO insert paths all have one.

## `qsos`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `event_id` | FK, cascade delete |
| `callsign`, `band`, `mode` | `mode` is constrained to `PH`, `CW`, `DIG` |
| `datetime_utc` | Defaults to now |
| `sent_class`, `sent_section` | Copied from the event at insert |
| `rcvd_class`, `rcvd_section` | The received exchange |
| `operator_call`, `station_number` | Who logged it |
| `is_dupe` | Computed at insert per the event's dupe rule |
| `is_gota` | Worked at the Get On The Air station. Still counts for the entry — see below |
| `rst_sent`, `rst_rcvd` | Special event exchange |
| `rcvd_name`, `rcvd_qth`, `rcvd_grid`, `comment` | Special event exchange |
| `adif_mode` | The real submode, e.g. `FT8` |
| `freq_khz` | Actual frequency when known |

The `mode` CHECK constraint stays at three values deliberately. Scoring,
duplicate detection and the band/mode UI all rely on that split. The real
submode goes in `adif_mode`, which ADIF export prefers when set. Widening the
CHECK would break the three things that depend on it.

Indexes cover the three access patterns: by event, the duplicate lookup
(`event_id, callsign, band, mode`), and chronological listing.

## `presence`

Ephemeral, one row per operator per event, TTL-based rather than explicitly
cleaned. Drives the Operators panel. Rows older than 90 seconds are treated as
gone; the read filters them rather than a job deleting them.

## `ses_operators`

The special event roster. One row per operator per event.

| Column | Notes |
|---|---|
| `event_id`, `op_call` | Composite primary key |
| `op_name`, `grid`, `state`, `county`, `dxcc` | The operator's own location |
| `approved` | Enforced only when the event requires approval |

This table is the **only** source for the ADIF `MY_GRIDSQUARE`, `MY_STATE` and
`MY_CNTY` fields on a special event's exports. Losing it produces a log that
no longer uploads correctly to LoTW, which is why the admin console's backup
and restore carry it.

## `ses_reservations`

Call checkouts. The important part is the constraint, not the columns.

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `event_id`, `op_call` | Who holds it |
| `band`, `mode` | What they hold |
| `during` | `TSTZRANGE` — the window |
| `planned_freq` | Free text, no exclusivity |
| `note` | |
| `status` | `RESERVED` or `RELEASED` |

```sql
CONSTRAINT ses_no_overlap EXCLUDE USING gist (
  event_id WITH =,
  band     WITH =,
  mode     WITH =,
  during   WITH &&
) WHERE (status <> 'RELEASED')
```

This is what makes "one signal per band per mode" true rather than merely
intended. Two operators claiming the same slot simultaneously cannot both
succeed; the loser gets SQLSTATE `23P01`.

Three things to know before changing it:

- **Do not narrow the granularity to frequency.** Special event rules
  generally permit one signal per band per mode, so a finer slot would let the
  database bless something the rules forbid.
- **Do not replace it with an application-level check.** A `SELECT` followed
  by an `INSERT` has a window between them, which is the entire problem.
- **Releasing clamps with `GREATEST(lower(during), NOW())`.** Clamping to
  `NOW()` alone inverts the range when a not-yet-started slot is cancelled,
  and Postgres rejects an inverted range.

Because the constraint is declared inline in `CREATE TABLE`, which Postgres
skips once the table exists, the schema also carries an explicit
`pg_constraint` check that re-adds it if missing. Without that, re-applying
the schema — the documented repair path — could not restore it.

`db/test-ses-constraint.sql` asserts all of this against a real database and
runs in CI.

## `call_history_entries` and `master_callsigns`

Optional callsign databases.

`call_history_entries` is per-event, imported from the N1MM file, and carries
a station's usual class and section. The file is contest- and year-specific.

`master_callsigns` is a single global list from `MASTER.SCP`, shared by every
event that opts in and refreshed at most once a day. It is not event-scoped
because it isn't contest-specific.

## Notification triggers

Two triggers publish to `pg_notify`:

| Trigger | Channel | Fires on |
|---|---|---|
| `qso_notify` | `qsos_<event_id>` | INSERT, UPDATE, DELETE on `qsos` |
| `ses_reservation_notify` | `ses_<event_id>` | INSERT, UPDATE, DELETE on `ses_reservations` |

Both send the operation and the full row as JSON. The reservation payload
carries the raw range column rather than decomposed timestamps, so the client
treats it as a signal to refetch rather than parsing it.

See [Architecture](architecture.md#real-time-updates).
