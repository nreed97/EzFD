# Quick start: running an event

You're the one setting up the log for your club. This is the whole job, start
to finish. It assumes somebody already has EzFD running — if that's also you,
[Getting started](getting-started.md) covers the server first.

## Before the event

### Create it

**Create Event** on the home page. Pick the type first, because it decides
everything else on the form:

| Type | Exchange | Scored |
|---|---|---|
| ARRL Field Day | Class + ARRL/RAC section | Yes |
| Winter Field Day | Category + ARRL/RAC section | Yes |
| Special Event Station | None — RST, name, QTH instead | No |

![Creating a Field Day event](images/create-event-fd.png)

For Field Day you need four things: **club name and callsign**, **class**
(transmitters plus a letter, like `3A`), **your section**, and **power
category**. Power is the score multiplier — HIGH ×1, LOW ×2, QRP ×5 — so it's
worth getting right.

You get a **six-character join code**. That code is the whole access story:
anyone with it can log. Share it with your operators and nobody else.

### Tell your operators

They need three things: the address of your server, the join code, and their
own callsigns. Point them at [Quick start: operating](quick-start-operating.md)
— it's a five-minute read and covers everything they'll touch.

On a `2A` or larger entry, tell each operator **which station number** they're
at. That number becomes the transmitter number in your submission.

## During the event

Open the **Dashboard** on a spare screen. It's read-only and updates live —
score, rate, sections worked, who's on which band.

![The dashboard during a Field Day event](images/dashboard.png)

There's a **Visitor mode** link too: the same live stats with no callsign and
no ability to log. Good for a screen visitors can see.

### If you're running a special event

The dashboard gets a **Checkouts** tab instead of the section views — a
schedule of who has which band and mode, and who has booked what later.

![The checkout board: a timeline of who is on, and the band/mode grid](images/checkout-board.png)

The top half is the timeline; the bottom half is the live grid, where **+
Take** claims a band and mode. One operator per band and mode at a time,
enforced by the database rather than by trust. See
[Special event stations](special-events.md) for how it behaves under pressure.

## After the event

Three things, in this order:

1. **Check the summary sheet.** Dashboard → **Summary**. This is the sheet you
   transcribe onto your ARRL entry: QSO points, the power multiplier, bonuses,
   and the claimed score. Read it before you submit anything.

   ![The Field Day summary sheet](images/summary-sheet.png)

2. **Export.** **Cabrillo** is what ARRL wants for a contest entry. **ADIF**
   is what your logging program and LoTW want. Both are one click.

3. **Take a backup.** Dashboard → **Backup** downloads the whole event as one
   JSON file — every contact, the roster, the checkouts, and the deleted
   contacts too. Keep it. It restores into any EzFD instance from the home
   page, which is also how you move an event off a field server.

## Things worth knowing before the weekend

- **Deleting a contact doesn't destroy it.** It moves to *Deleted contacts*
  under the log, with who deleted it, and **Restore** brings it back. There's
  no authentication beyond the join code, so this is deliberate.
- **Everything is UTC**, because contest logs are.
- **The server stamps the time**, not the operators' laptops — one clock for
  the whole log. If the server's clock is wrong, every contact is wrong, so
  the app warns you when it disagrees with a browser.
- **Nothing is lost to a bad network.** Contacts are saved in each browser
  before they're sent, and sync themselves when things recover.

## Where to go deeper

| If you want | Read |
|---|---|
| Classes, bonuses, scoring, submitting | [Field Day](field-day.md) |
| One callsign, many operators | [Special event stations](special-events.md) |
| CAT control and CW macros | [Rig control and CW](rig-control.md) |
| FT8 and friends | [Digital modes](digital-modes.md) |
| Something's broken | [Troubleshooting](troubleshooting.md) |
