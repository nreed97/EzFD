# Troubleshooting

Symptom first. Where a problem is a known bug rather than a misconfiguration,
it says so.

## QSOs don't appear on other screens

Live updates run over Server-Sent Events backed by PostgreSQL `LISTEN`/
`NOTIFY`. Three things break it:

**A connection pooler in transaction mode.** PgBouncer's default silently
discards `LISTEN`. Nothing errors; updates just never arrive. Use session mode
or connect directly.

**nginx buffering the stream.** The app sets `X-Accel-Buffering: no` and the
deployed config disables proxy buffering. If you replaced that config, updates
arrive in bursts or not at all.

**The browser lost the stream.** SSE reconnects automatically, but a reload
confirms it. The QSO list is fetched fresh on load, so a reload also resyncs.

Check the server is publishing at all:

```bash
# sudo -u postgres psql -d ezfd -c "SELECT COUNT(*) FROM qsos WHERE event_id='<uuid>';"
```

If the count rises but screens don't update, it's the transport.

## The pending counter won't clear

QSOs are queued in browser local storage and flush when the server accepts
them. A stuck counter means submissions are failing.

Click the pending badge to retry and watch for an error. Common causes are an
expired TLS certificate, the service being down, or — on a special event with
`HARD` enforcement — a rejection.

Queued QSOs are **not** lost while this persists. They stay in local storage
until accepted. Don't clear site data.

## "Nobody has checked out 20m PH right now"

A special event with checkout enforcement. Either check the band and mode out
from the Call Checkout panel, or ask the coordinator to switch enforcement to
warn-only in the admin console.

Under warn-only the QSO logs anyway and this is only a banner.

## "W0AAA already holds 20m PH until 02:26Z"

Someone else has that band and mode. This is the constraint working as
intended — special event rules generally permit one signal per band per mode.

Options: pick a different band or mode, wait for the slot to end, or ask them
to release it early.

## "W0AAA is not yet approved to operate this event"

The event requires roster approval and this operator is pending. A coordinator
approves them in the admin console: **List / manage events** → open the event
→ **Manage operator roster** → **Toggle approval**.

## "This server's clock is N ahead of / behind this device"

The server and the browser disagree about the time by more than a minute. QSOs
are timestamped by the server, so contacts logged while this is showing carry
that wrong time.

Usually the server is the wrong one — a field server with no real-time clock
and no NTP. Fix it from the admin console: `bash ezfd-admin.sh` → **Server time
/ clock**. See [Administration](administration.md#server-time).

It can also be the operator's device that's wrong, if their laptop has been
offline a long time. If one operator sees the banner and the others don't, it's
that device.

Either way, **QSOs already logged keep the timestamps they were given.** Fixing
the clock only corrects contacts from that point on.

## A section is rejected as invalid

The entry form warns when a received section isn't one of the 85 current
ARRL/RAC sections. The QSO still logs and the exchange is stored exactly as
typed, so nothing is lost — but the section won't count toward Worked All
Sections or appear on the map.

Usually this is a typo. The other cause is an abbreviation RAC has retired:
Maritime (`MAR`) is now `NB` / `NS` / `PE`, plain Ontario (`ON`) is now `ONE` /
`ONN` / `ONS` / `GH`, `GTA` was renamed `GH`, and Yukon is part of Northern
Territories (`NT`) rather than a section of its own. Log the current
abbreviation.

Logs recorded before EzFD tracked the current list may contain those retired
abbreviations. They export as recorded, but they no longer match a section, so
a very old log can show a lower worked-section count than it did at the time.

## Cabrillo claimed score looks wrong

**Known bug.** The `CLAIMED-SCORE` header is computed separately from the rest
of the app and is wrong three ways: it multiplies by sections worked, ignores
the power multiplier, and omits bonus points.

The score in the app is correct. Correct the header by hand before
submitting. Tracked as [#12](https://github.com/nreed97/EzFD/issues/12).

## Rig control

**No `● RIG` indicator.** The bridge must run on the same machine as the
browser — it connects to `localhost:4575`. Check the bridge window for errors.

**Frequency readings are wrong or offset.** Restart the bridge. A misread byte
on the polling connection permanently offsets every later reading by one
field, and it doesn't self-correct.

**No CW button.** The radio didn't report CAT keying support. Some rigs need
it enabled in a menu; many don't have it at all.

**CW sends "VFO" as text.** A VFO argument is reaching the keying command.
`rigctld` only accepts one when started with `--vfo`; without it the literal
word gets keyed, which sounds like "4FO" on the air.

**Permission denied on the serial port.** On Linux, add yourself to `dialout`
and log back in.

More detail in [Rig control](rig-control.md#troubleshooting).

## Duplicate QSOs after importing

Imports are idempotent — matched on callsign, band, mode and a ±2 minute
window — so a re-import should skip rather than insert. If you have genuine
duplicates from before that behaviour existed, the admin console's **Clear all
dupes** marks flagged ones as non-duplicate, but it won't remove extra rows.

Note the distinction: a *flagged duplicate* is the same station worked twice
on the air. An *actually duplicated row* is the same QSO recorded twice.

## Event creation fails

**"Invalid admin key"** — the server sets `EZFD_ADMIN_KEY` and the form value
doesn't match.

**"Server encryption key not configured"** — you supplied QRZ credentials but
`EZFD_ENCRYPTION_KEY` isn't set. Set it, or create the event without QRZ.

**Warnings about call databases** — the event was created; only the optional
prefill degraded. Upstream was slow or unreachable.

## Restore fails or loses data

Both known failure modes are fixed, but if you're running an older build:

- Restoring an event with **no QSOs** used to fail outright, because
  `json_agg` over zero rows serialises as JSON `null` and `COALESCE` doesn't
  catch a scalar.
- A special event's roster used to be dropped entirely, taking the per-
  operator locations the ADIF `MY_*` fields depend on with it.

Update before relying on restore. `scripts/test-restore.sh` verifies both.

## Service won't start

```bash
# journalctl -u ezfd -n 50
```

**Database connection refused** — check PostgreSQL is running and
`DATABASE_URL` in `/opt/ezfd/.env` is right.

**Port in use** — something else has the port; nginx proxies to localhost.

**Build artefacts missing** — re-run `deploy.sh`.

## Out of memory during deploy

`next build` needs more than 1 GB. `deploy.sh` adds swap for this, but if you
disabled it or are building by hand, add swap or build elsewhere and copy the
output.
