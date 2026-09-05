# Administration

`ezfd-admin.sh` is an interactive console for managing events, recovering
data, and updating the app. Run it on the server:

```bash
# bash ezfd-admin.sh
```

It connects to the local `ezfd` database as `postgres` and refuses to start if
PostgreSQL isn't reachable.

## Command line

```
$ bash ezfd-admin.sh --help
EzFD — Interactive admin console

Usage:
  sudo bash ezfd-admin.sh            interactive menu
  sudo bash ezfd-admin.sh --json     dump all events as JSON (stdout, pipeable)
  sudo bash ezfd-admin.sh --help     this message
```

| Exit code | Means |
|---|---|
| `0` | Success |
| `1` | The database is unreachable |
| `2` | Unrecognised option |

An unrecognised option is an error, not a request for the menu — so a typo in
a cron line fails loudly instead of hanging on a prompt no one is there to
answer:

```
$ bash ezfd-admin.sh --dump-json
  [✗] Unknown option: --dump-json

EzFD — Interactive admin console

Usage:
  sudo bash ezfd-admin.sh            interactive menu
  sudo bash ezfd-admin.sh --json     dump all events as JSON (stdout, pipeable)
  sudo bash ezfd-admin.sh --help     this message

$ echo $?
2
```

## Main menu

| Action | What it does |
|---|---|
| List / manage events | Browse events, open one for detail and per-event actions |
| Server statistics | Totals across all events, QSOs by event type |
| Server time / clock | Show the system, database and NTP state; set the clock by hand |
| Full JSON backup | Every event with its QSOs, SES roster and checkout history, to one file |
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

## The event list

**List / manage events** shows one line per event, newest first, numbered
where it is printed:

```
    #  Code      Club                     Type Pwr   Class    QSOs  Dupes   Ops
───────────────────────────────────────────────────────────────────────────────
    1  K7F2A6    Lakeside Radio Club      FD   LOW   3A        284     13     4
    2  P4M9XZ    Cedar Valley ARC         FD   LOW   2A        179      8     4
    3  B8N3QT    Northern Lights ARS      WFD  QRP   1O        287     13     4
    4  Z2H7RK    Harbor City Radio Amateu FD   HIGH  4A        196      8     4
    5  Q6D1VN    Prairie Winds ARC        FD   LOW   2A        219      9     4
    6  T3J8WC    Bayside Amateur Radio So SES  -     -          73      3     4
    7  M9K4YB    Granite State Radio Club FD   QRP   1B        136      6     4
    8  R7L2FD    Cedar Valley ARC         WFD  LOW   2H        186      8     4
    9  X4P6GH    Delta Amateur Radio Club FD   HIGH  5A         88      3     4
   10  C1S5MJ    Mesa Verde Radio Group   SES  -     -         222     10     4
   11  V8T3NP    Lakeside Radio Club      WFD  LOW   1I        246     11     4
───────────────────────────────────────────────────────────────────────────────
  Showing 1–11 of 22  ·  page 1/2
  1-11 open  n/p page  /text filter  CODE open by join code  b back
  >
```

Counts exclude deleted contacts. A special event has no contest class or power
category, so those columns show `-`.

At the prompt:

| Input | Does |
|---|---|
| `1`–`11` | Open that row. Numbering restarts at 1 on each page |
| `n` / `p` | Next / previous page |
| `/text` | Filter by join code, club name or club call |
| `/` | Clear the filter |
| `K7F2A6` | Open by join code, from any page |
| `b` | Back to the main menu |

The page holds as many rows as the terminal has, so the header stays on
screen. A short window pages sooner; a tall one shows more.

### Filtering

Type `/` and any part of a code, club name or call. The match is
case-insensitive and literal — `_` and `%` match themselves, not wildcards:

```
  Filter: cedar  (3 matching)  ·  Enter / to clear

    #  Code      Club                     Type Pwr   Class    QSOs  Dupes   Ops
───────────────────────────────────────────────────────────────────────────────
    1  P4M9XZ    Cedar Valley ARC         FD   LOW   2A        179      8     4
    2  R7L2FD    Cedar Valley ARC         WFD  LOW   2H        186      8     4
    3  S6L1ZN    Cedar Valley ARC         SES  -     -          92      4     4
───────────────────────────────────────────────────────────────────────────────
  3 event(s)
  1-3 open  /text filter  CODE open by join code  b back
```

The filter survives opening an event and coming back, so you can work through
one club's events without retyping it.

### Opening by join code

Typing the code is usually faster than finding its row, and it is the only
option that doesn't care which page you're on — useful when an operator reads
you a code over the air:

```
  > K7F2A6
```

Anything that isn't a number, a command letter or a `/filter` is treated as a
join code. If no event has it, the console says so and suggests the search:

```
  [!] No event with join code 'CEDAR'. Use /CEDAR to search names.
```

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
| Clear all dupes | Marks every live duplicate as non-duplicate |
| Delete ALL QSOs | Keeps the event, empties the log — including deleted contacts |
| Delete this event | Everything, including QSOs, roster and checkouts |

Destructive actions require typing `YES` in full.

### Deleted contacts and these two actions

QSOs are soft-deleted: `DELETE /api/qso/{id}` marks the row rather than
removing it, so the log can still answer "what happened to that contact?".
Two of the actions above have to be explicit about which rows they mean.

**Clear all dupes** works on live contacts only. A contact an operator
deleted stays deleted and keeps its duplicate flag — clearing duplicates is
about what you are going to submit, and a deleted contact isn't part of that.
The count in the prompt is the number of rows that will change:

```
  ⚠  This will mark 13 dupe QSOs as non-dupe for K7F2A6.
```

**Delete ALL QSOs** means all of them, deleted ones included. That matters
because a soft-deleted row is still carried in a backup and still comes back
from a restore — leaving them behind would empty the log on screen and then
repopulate it from the next round trip. The prompt says so when there are any:

```
  ⚠  This will permanently delete ALL 297 QSOs for event K7F2A6. 6 previously deleted QSO(s) go too.
```

This one is a real `DELETE`, not a soft delete. It is the one place in EzFD
where contacts leave the database for good.

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

Event owners can also take a backup without shell access: **Full event backup**
in the dashboard's ☰ menu downloads the same JSON this console writes, and the
home page restores one. Both call the same `ezfd_export_events()` /
`ezfd_restore_events()` functions in `db/schema.sql`, so the two paths cannot
produce or accept different shapes.


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
in cron. It sets `ON_ERROR_STOP`, so a failed dump exits non-zero — a cron job
wrapping it can tell a real failure from an empty server:

```bash
# bash ezfd-admin.sh --json > /backup/ezfd-$(date +%F).json \
#   || echo "EzFD backup FAILED" | mail -s "backup" admin@example.org
```

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

### When an export fails

Every export path — CSV, per-event JSON, **Full JSON backup** and `--json` —
reports a failure instead of announcing success over a file that isn't there:

```
  [✗] Backup failed — the file is incomplete and has been removed:
ERROR:  could not write to file: No space left on device
```

The partial file is deleted rather than left behind, because a truncated
backup that looks like a backup is worse than no backup. These paths used to
log success unconditionally, so a full disk still printed *"Backup complete"*
next to a file size of zero.

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

### When a restore fails

A restore that hits a constraint violation stops and says so, leaving the
database as it was:

```
  [✗] Restore failed:
ERROR:  new row for relation "qsos" violates check constraint "qsos_mode_check"
DETAIL:  Failing row contains (…, K1XYZ, 20m, SSTV, …).
```

This is worth knowing because it did not always behave that way. `psql` fed a
script on stdin exits `0` even when a statement failed, unless
`ON_ERROR_STOP=1` is set — so a failed restore used to print *"Restore
complete"* and then render the error text through the results table. If you
have a backup you restored before this was fixed, check the event actually
came back rather than trusting the message.

The event count shown before you confirm is read from **this** machine's
disk, not the database server's. That matters when `DATABASE_URL` points at
another host, as [Deployment](deployment.md) describes: the count used to go
through `pg_read_file()`, which reads the *server's* filesystem, and so failed
on a file the restore beneath it would have read perfectly well.

## Updating the application

**Update application** runs `git pull` in `EZFD_REPO_DIR`, rebuilds, and
restarts the service — the same work `deploy.sh` does, without re-checking the
system packages.

If `EZFD_REPO_DIR` isn't set in `/opt/ezfd/.env`, the action can't find the
source. Add it, or re-run `deploy.sh`, which writes it.

The steps run in this order, and each one stops the update if it fails:

1. `git pull` — nothing else runs if the working tree or the network is bad.
   If the commit hasn't moved, the update stops here rather than rebuilding.
2. `npm ci`, then `npm run build`.
3. **Check `/opt/ezfd/.env` exists**, before anything is copied over the
   running install.
4. **Apply `db/schema.sql`**, while the old build is still the one on disk.
5. `rsync` the build into `/opt/ezfd`.
6. `systemctl restart ezfd`, then confirm the service came back.

Steps 3 and 4 are deliberately ahead of step 5. The schema is additive and
idempotent — CI applies it twice to prove it — so the running build carries on
against the new schema quite happily, and a schema error aborts with nothing
deployed:

```
  [✗] Database migration failed — nothing has been deployed.
ERROR:  syntax error at or near "…"
  The running install is untouched. Fix the schema error and re-run.
```

The old order rsynced first and sent the migration's errors to `/dev/null`
behind a `|| true`, then restarted regardless — so a new build met an old
schema and failed on its first query, with nothing on screen to say why.

## Notes on the script itself

If you extend it, `AGENTS.md` documents the conventions. The important one:
it deliberately uses `set -uo pipefail` **without** `-e`, because `-e`
terminates interactive menus on the first non-zero return — and a menu that
exits when you pick the wrong option is worse than useless. Related: use
`[[ ]]` rather than `(( ))` for comparisons, since `(( ))` returns exit 1 on a
false result.

Three more that are easy to get wrong:

**Query through `PG()` or `PGS()`, not a bare `psql`.** Both set the field
separator to an ASCII unit separator (`\x1f`) rather than psql's default pipe,
and every row reader splits on `$FS` to match:

```bash
local row=""; row=$(PG -c "SELECT club_name, location FROM events WHERE id='$uuid';")
IFS="$FS" read -r club_name location <<< "$row"
```

`psql -A` does not escape its separator inside a value, and club names,
locations and SES descriptions are free text an operator types. With the
default pipe, a club called `Pipe|Name Club` split into two fields and shifted
every following column of that row one place right — the event table printed
the created date under "Class". `scripts/test-restore.sh` fails if an
`IFS='|' read` reappears.

**Use `PGS()` when a failure must not be reported as success.** It adds
`ON_ERROR_STOP=1`. This is not optional dressing: `psql -c` reports a SQL
error in its exit status, but a script fed on **stdin** exits `0` regardless,
which is exactly how the restore came to print "Restore complete" over a
constraint violation.

**Pad with ASCII in aligned tables.** `printf "%-4s"` pads by byte, not by
display width, so a multi-byte character in a column knocks every following
column of that row out of line. The event table's placeholder for a special
event's absent class is `-`, not `—`, for that reason.
