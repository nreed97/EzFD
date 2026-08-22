# Getting started

This walks from an empty server to a logged QSO. If someone else runs the
server and you just want to operate, skip to [Joining an event](#joining-an-event).

## Install the server

You need a Ubuntu or Debian machine with a public hostname pointing at it. A
1 GB VPS is enough; `deploy.sh` adds swap because `next build` will otherwise
be OOM-killed at that size.

```bash
# git clone https://github.com/nreed97/EzFD.git /opt/ezfd-src
# cd /opt/ezfd-src
# bash deploy.sh
```

The script asks for a domain and an email for the TLS certificate, then
installs Node, PostgreSQL, nginx and certbot, creates the database, applies
the schema, builds the app, and registers a systemd service. Full detail in
[Deployment](deployment.md).

When it finishes, the app is at `https://your-domain`.

To try it locally instead, see [Development](development.md).

## Create an event

Open the site and choose **Create Event**. The form branches on the event type
you pick, because the three types genuinely differ:

| Type | Use it for | Key fields |
|---|---|---|
| **ARRL Field Day** | The June contest | Class (e.g. `3A`), ARRL section, power category |
| **Winter Field Day** | The January contest | Class with the WFD letters (`H`/`O`/`I`), section, power |
| **Special Event** | A callsign activated over a date range, often by operators in different places | Date range, checkout rules, optional section |

Fill in the club or event name and the callsign that will be signed on the
air. Everything else has a working default.

Optional, and all safe to skip:

- **QRZ lookup** — a QRZ.com XML subscription auto-fills name and state as
  operators type a callsign. Credentials are encrypted at rest and shared by
  every operator on the event, so nobody needs their own.
- **Call databases** — the N1MM call history file prefills a known station's
  class and section; `MASTER.SCP` flags whether a callsign is recognised.
  Both download at event creation and are best-effort: a failed download
  degrades the hint, never blocks the event.
- **Admin key** — if the server sets `EZFD_ADMIN_KEY`, event creation requires
  it. See [Configuration](configuration.md).

Submitting gives you a **six-character join code**. That code is how operators
get in — there are no accounts.

## Joining an event

Operators go to the site, enter the join code, and type their own callsign.
That's the whole sign-in. The callsign identifies who logged each QSO; the
event's callsign is what goes on the air.

On a special event, operators also enter their own grid and state, because a
distributed activation has one location per operator rather than one per
event. See [Special event stations](special-events.md).

There is also **Visitor mode** — read-only live stats, no callsign, no
logging. Good for a screen in the corner of the room.

## Log a QSO

The entry form is built for one-handed operation at speed:

1. Type the callsign. Press **Enter**.
2. Type the received exchange. **Enter** moves between fields.
3. **Enter** on the last field logs the QSO and returns focus to the callsign.

**Tab** from the last field wraps back to the callsign rather than escaping
into the rest of the page, so you never have to reach for the mouse.

The QSO appears immediately on every other operator's screen. If the network
is down it is written to local storage and syncs when connectivity returns —
nothing is lost, and you can keep logging.

[Operating](operating.md) covers the rest of the screen: band and mode
switching, duplicate handling, band conflicts and the score display.

## Finish the event

From the dashboard:

- **ADIF** — for LoTW, QRZ Logbook, or any log manager.
- **Cabrillo** — for ARRL contest submission (Field Day and Winter Field Day
  only; a special event has no contest to submit to).
- **Summary** — a printable worksheet mirroring the ARRL entry form.

Back the event up before you tear anything down:

```bash
# bash ezfd-admin.sh      # → List / manage events → Export full backup
```

See [Administration](administration.md).

## Next steps

- Connect a radio so band and mode follow the VFO: [Rig control](rig-control.md)
- Auto-log FT8: [Digital modes](digital-modes.md)
- Understand scoring before you rely on it: [Field Day](field-day.md)
