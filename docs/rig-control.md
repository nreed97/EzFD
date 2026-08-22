# Rig control and CW keying

A small Python script on the operator's own machine bridges Hamlib's `rigctld`
to the browser over a local WebSocket. Band and mode then follow the VFO, and
if the rig supports CAT keying, a CW macro window becomes available.

**The EzFD server is never involved.** The bridge runs entirely on the
operator's computer and talks to the browser over `ws://localhost:4575`.
Nothing about the radio reaches the server; only logged QSOs do.

This is entirely optional. Operators who don't use it lose nothing but the
convenience.

## Setup

Download `ezfd-rig-bridge.py` from the logger (the **Rig** button in the
Operators panel links to it), connect the radio by USB or serial, and run:

```bash
$ python3 ezfd-rig-bridge.py
```

The script will:

1. Find `rigctld`, offering to install Hamlib if it's missing.
2. Start `rigctld` if it isn't already running, prompting for radio model and
   serial port the first time and remembering the answer.
3. Probe whether the rig supports CAT CW keying.
4. Open the WebSocket the browser connects to.

Open EzFD and the header shows `● RIG` with the live frequency.

### Options

| Flag | Default | Purpose |
|---|---|---|
| `--port` | `4575` | WebSocket port the browser connects to |
| `--rigctld-port` | `4532` | TCP port `rigctld` listens on |
| `--rigctld-host` | `localhost` | Host running `rigctld` |

`--rigctld-host` covers the case where `rigctld` already runs elsewhere on
your network — a shack PC, say — and you want the browser on a laptop.

## What it does

Band and mode are polled about four times a second and pushed to the browser,
so the QSY drawer tracks the radio without anyone touching it. Logging a QSO
records whatever the VFO was on.

Frequency is displayed in the header. On a special event you can also record a
planned frequency on your checkout, which is free text for other operators to
read.

## CW keying

If `rigctld` reports CAT keying support, a **⚡ CW** button appears. It opens a
separate window (`window.open`, so it can go on a second monitor) with:

- **F1–F12 macros**, editable, with separate sets for Run and S&P
- **Speed control** in WPM
- **Auto-CQ** with an adjustable repeat interval
- **ESM** (Enter Sends Message), N1MM-style: Enter in the callsign field sends
  the appropriate macro rather than only moving focus
- **Space or Escape** stops transmission instantly

The CW window is a full logger in its own right — it has the same entry form
and dupe checking, and shares the log live with the main tab.

### Macro placeholders

| Placeholder | Expands to |
|---|---|
| `{call}` | The callsign currently in the entry field |
| `{class}` | Their received class |
| `{section}` | Their received section |
| `{rst}` | The RST you're sending |
| `{name}` | Their name |
| `{mycall}` | The event's callsign |
| `{myclass}` | Your class |
| `{mysection}` | Your section |
| `{exch}` | Your full exchange |

On a special event, `{exch}` expands to the signal report rather than a class
and section, since there is no contest exchange to send.

## Radio-specific notes

These are the ones that have actually caused trouble:

**FlexRadio via SmartCAT** emulates a Kenwood TS-2000. Use Hamlib model
`2014`, not any FlexRadio-specific model — those are TCP-only and cannot open
a COM port at all.

**Virtual and software CAT ports** often don't implement RTS/CTS hardware
handshaking, which causes silent write failures. The bridge defaults serial
connections to `serial_handshake=None` for this reason. It's a safe default
for real hardware too.

**Capability detection is slow.** Asking a rig what it can do exercises real
CAT round-trips and can take several seconds with irregular gaps. The bridge
does this on a separate throwaway connection so it can't desynchronise the
polling connection — a lesson learned the hard way, because a misread byte
there permanently offsets every later frequency reading by one field.

## Troubleshooting

**No `● RIG` in the header.** Check the bridge is running and shows no errors.
The browser connects to `localhost`, so the bridge must be on the same machine
as the browser, not the server.

**Frequency reads are wrong or drift by one field.** Restart the bridge. This
is the desynchronisation described above and it doesn't self-correct.

**CW button never appears.** The rig didn't report CAT keying support. Not all
radios have it, and some need it enabled in a menu. The rest of rig control
still works.

**CW sends "VFO" as text.** A Hamlib invocation is passing a VFO argument to
the keying command. The bridge deliberately never does this, because `rigctld`
only accepts one when started with `--vfo` — and without it the word "VFO"
gets sent as Morse, which sounds confusingly like "4FO" on the air.

**Serial port permission denied on Linux.** Add yourself to the `dialout`
group and log back in.

More in [Troubleshooting](troubleshooting.md).
