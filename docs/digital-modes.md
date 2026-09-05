# Digital modes

Two ways to get FT8, FT4, RTTY and similar into the log: a live relay from
WSJT-X or JTDX, or a bulk ADIF import after the fact.

## Live relay from WSJT-X / JTDX

WSJT-X broadcasts every logged QSO over UDP. A small relay script listens for
those and posts them to EzFD, so digital QSOs appear in the shared log without
anyone retyping them.

### Windows

The logger offers a prepared `.bat` file with your event details already
filled in — click the **DIG** mode hint in the entry form, or the **Import
ADIF** dialog. Download and run it.

### macOS and Linux

Download `wsjtx-bridge.cjs` from the same place and run it with Node:

```bash
$ node wsjtx-bridge.cjs --event-id <uuid> --api-url https://your-server --operator W0AAA
```

| Flag | Environment variable | Default |
|---|---|---|
| `--event-id` | `EZFD_EVENT_ID` | *required* |
| `--api-url` | `EZFD_API_URL` | `http://localhost:3000` |
| `--operator` | `EZFD_OPERATOR` | *(empty)* |
| `--station` | `EZFD_STATION` | `1` |
| `--port` | `EZFD_UDP_PORT` | `2237` |
| `--spool` | `EZFD_SPOOL` | `~/.ezfd/wsjtx-queue-<event-id>.jsonl` |

### If the server goes away

WSJT-X keeps logging whether or not EzFD is reachable, so the relay keeps a
queue. A contact the server can't take is written to the spool file above and
retried — after 5s, then 10s, 30s, 60s and 2 minutes — until it lands. The
relay prints `queued (N waiting)` when that happens and `Synced N queued
contact(s)` when they go through.

The spool is a file, not memory: closing the relay or rebooting the machine
doesn't lose it, and the next start drains whatever is still there. So an EzFD
restart, an nginx reload or a flaky field network **delays** digital contacts
rather than dropping them.

The one thing it won't retry is a contact the server refuses on purpose — a
`4xx`, such as an event ID that doesn't exist. Retrying can't fix that, so the
relay says `rejected` and moves on; the contact is still in WSJT-X's own
`wsjtx_log.adi` and can be brought in with an ADIF import.

Queued contacts are stamped by the server when they finally arrive, not when
they were made, so a long outage shifts their times. If exact times matter for
a submission, import `wsjtx_log.adi` instead — ADIF carries the original.

### Configuring WSJT-X

In **Settings → Reporting**, enable UDP Server on `127.0.0.1` port `2237`
(the default) and tick "Accept UDP requests". The relay listens on that port.

Both WSJT-X and the relay must run on the same machine unless you point the
UDP server at the relay's address deliberately.

## ADIF import

**Import ADIF**, in the logger's **☰** menu under *This event*, accepts any `.adi` file — a WSJT-X log,
an N1MM export, N3FJP, or a hand-built file.

Records are matched to bands by the `BAND` field, falling back to `FREQ`.
Mode is mapped to the app's three buckets: `CW` stays CW, SSB/USB/LSB/FM/AM
become phone, everything else becomes digital. The Field Day exchange is read
from `CLASS` and `ARRL_SECT`, falling back to `SRX_STRING`.

Imports are **idempotent**. A record already in the log — matched on callsign,
band, mode and a ±2 minute window — is skipped rather than inserted, so
re-importing the same file or two operators importing overlapping exports
can't double the log. The result reports four counts:

| Count | Meaning |
|---|---|
| imported | New QSOs added |
| dupes | Added, but flagged as duplicates under the event's dupe rule |
| already in log | Skipped as already present |
| skipped | Unusable, usually an unrecognised band |

The ±2 minute window exists because ADIF only carries minute resolution and
loggers round differently.

## Which to use

The relay is better during an event: QSOs appear live for everyone, and the
band conflict and checkout views stay accurate. Import is better for merging a
log made offline — which for a distributed special event is a normal workflow.
See [Special event stations](special-events.md#merging-offline-logs).
