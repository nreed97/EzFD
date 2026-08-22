# Administration

`ezfd-admin.sh` is an interactive console for managing events, recovering
data, and updating the app. Run it on the server:

```bash
# bash ezfd-admin.sh
```

It connects to the local `ezfd` database as `postgres` and refuses to start if
PostgreSQL isn't reachable.

## Main menu

| Action | What it does |
|---|---|
| List / manage events | Browse events, open one for detail and per-event actions |
| Server statistics | Totals across all events, QSOs by event type |
| Server time / clock | Show the system, database and NTP state; set the clock by hand |
| Full JSON backup | Every event and QSO to one file |
| Restore from JSON backup | Recreate events from a backup file |
| Update application | `git pull`, rebuild and restart |

## Server time

QSOs are timestamped by the database, so the server's clock is the log's clock.
That is fine on a hosted instance with NTP and a problem on a field server: a
Raspberry Pi has no battery-backed real-time clock, so with no internet it
comes up holding the time of its last shutdown, or an epoch date. Every contact
then gets a plausible-looking but wrong time, which corrupts the log's
chronology, the Cabrillo output, and the ±2-minute window ADIF import uses to
skip contacts it has already seen. None of that is repairable afterwards.

**Server time / clock** shows the system clock, the database's clock and
whether NTP is synchronised, then offers to set the clock by hand (UTC, read
off a phone or GPS) or to re-enable NTP. Setting by hand disables NTP first —
`systemd-timesyncd` refuses the set otherwise — and writes the result to the
hardware clock if one is fitted.

Operators see this from the other side: the logging page shows a standing
banner when the server's clock and their device's disagree by more than a
minute.

Setting the clock only fixes contacts logged from that point on. **QSOs already
in the log keep the timestamps they were given** — they aren't rewritten.
So check the clock before an event starts, not after.

For anything more than a casual activation, fit a hardware RTC module. See
[Deployment](deployment.md#offline-field-servers).

## Per-event actions

Opening an event shows its configuration, QSO and duplicate counts, operators,
and — for a special event — the operator roster and who's currently on the
air.

| Action | Notes |
|---|---|
| Export QSOs to CSV | `/tmp/qsos_CODE.csv` |
| Export full backup | `/tmp/ezfd_CODE_backup.json`, including SES roster and checkouts |
| Change join code | 4–8 alphanumeric characters, must be unique |
| Edit event settings | Contest events: power, class, section. Special events: enforcement, slot length, dupe rule, approval |
| Manage operator roster | Special events only — approve, revoke, fix grid or state, remove |
| Clear all dupes | Marks every duplicate as non-duplicate |
| Delete ALL QSOs | Keeps the event, empties the log |
| Delete this event | Everything, including QSOs, roster and checkouts |

Destructive actions require typing `YES` in full.

### The operator roster

Special events only. Shows each operator with their grid, state and approval
status, then lets you act on one:

- **Toggle approval** — flips between approved and pending. Only matters if
  the event requires approval; see
  [Special event stations](special-events.md#approval-gating).
- **Set grid square** / **Set state** — these feed the ADIF `MY_*` fields for
  that operator's QSOs, so fixing a typo here fixes their exported log.
- **Remove from roster** — revokes access. Their logged QSOs are deliberately
  kept; contacts they made were still real contacts.

## Backups

### Per-event

**Export full backup** writes one JSON file containing the event, all its
QSOs, and — for a special event — the operator roster and checkout history.

The roster matters more than it looks. It holds each operator's grid and
state, which is the only source for the ADIF `MY_*` fields. A backup without
it produces a restored log that no longer uploads correctly to LoTW.

### Everything

**Full JSON backup** from the menu, or non-interactively:

```bash
# bash ezfd-admin.sh --json > /backup/ezfd-$(date +%F).json
```

The `--json` form prints to stdout and takes no input, so it's the one to put
in cron.

### Database-level

```bash
# sudo -u postgres pg_dump ezfd | gzip > /backup/ezfd-$(date +%F).sql.gz
```

Restore with:

```bash
# sudo -u postgres psql -c "DROP DATABASE ezfd;"
# sudo -u postgres psql -c "CREATE DATABASE ezfd;"
# gunzip -c /backup/ezfd-2026-06-28.sql.gz | sudo -u postgres psql -d ezfd
```

## Restoring from JSON

**Restore from JSON backup** reads a file and recreates the events in it.

Restored events get **new join codes**, so a restore never collides with
anything already in the database. The console prints the mapping from old code
to new.

What comes back: the event and its settings, every QSO with its full field
set, and for a special event the operator roster with approval state and the
checkout history.

Two details that were wrong once and are worth not re-breaking:

- Contest class and section restore as NULL when they were NULL, not as empty
  strings. An empty string there puts a blank `MY_ARRL_SECT` into every
  exported record.
- Every list is type-checked before iterating, because `json_agg` over zero
  rows serialises as JSON `null` — a scalar, which `COALESCE` doesn't catch.
  Before this was fixed, restoring an event with no QSOs failed outright.

Both are covered by `scripts/test-restore.sh`; see
[Development](development.md#tests).

## Updating the application

**Update application** runs `git pull` in `EZFD_REPO_DIR`, rebuilds, and
restarts the service — the same work `deploy.sh` does, without re-checking the
system packages.

If `EZFD_REPO_DIR` isn't set in `/opt/ezfd/.env`, the action can't find the
source. Add it, or re-run `deploy.sh`, which writes it.

## Notes on the script itself

If you extend it, `AGENTS.md` documents the conventions. The important one:
it deliberately uses `set -uo pipefail` **without** `-e`, because `-e`
terminates interactive menus on the first non-zero return — and a menu that
exits when you pick the wrong option is worse than useless. Related: use
`[[ ]]` rather than `(( ))` for comparisons, since `(( ))` returns exit 1 on a
false result.
