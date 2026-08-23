# EzFD documentation

EzFD is a self-hosted, real-time, multi-operator logger for ARRL Field Day,
Winter Field Day, and special event stations. Every operator logs into one
shared log, and every QSO appears on every other device within milliseconds.

Start with whichever describes you.

## Just tell me what to do

Short, task-shaped, no server administration.

| Guide | What it covers |
|---|---|
| [Quick start: operating](quick-start-operating.md) | You were handed a join code and sat at a radio |
| [Quick start: running an event](quick-start-event.md) | Setting up the log for your club, and closing it out |

## I want to run an event

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | From an empty server to a logged QSO — install included |
| [Operating](operating.md) | The logging screen in depth — entry, QSY, dupes, offline |
| [Field Day](field-day.md) | Classes, the exchange, scoring, bonuses, submitting your entry |
| [Special event stations](special-events.md) | One callsign across many operators, and how the checkout works |
| [Rig control and CW](rig-control.md) | CAT via Hamlib, automatic band/mode tracking, macro keying |
| [Digital modes](digital-modes.md) | WSJT-X and JTDX auto-logging, ADIF import |
| [Troubleshooting](troubleshooting.md) | Symptom, cause, fix |

## I run the server

| Guide | What it covers |
|---|---|
| [Deployment](deployment.md) | One-command install on a VPS, TLS, updates |
| [Administration](administration.md) | `ezfd-admin.sh`, backups, restores, recovery |
| [Configuration](configuration.md) | Every environment variable |

## I want to work on the code

| Guide | What it covers |
|---|---|
| [Development](development.md) | Local setup, the test suite, conventions |
| [Architecture](architecture.md) | How the real-time, offline and coordination pieces fit |
| [Database](database.md) | Schema reference and the constraints that matter |
| [HTTP API](api.md) | Every endpoint |

## Reading these in the app

Every guide here is also served by a running EzFD instance at **`/docs`** —
linked from the footer of the home page and from **Docs** in the logging
header. That matters for a field server with no internet, where the operator
who needs the troubleshooting page is exactly the one who can't reach GitHub.

The app renders the same files from this directory, so there is one copy of
each guide and no second version to drift.

## Conventions used here

Commands prefixed `$` run on your own machine; commands prefixed `#` run as
root on the server. Callsigns in examples are illustrative.

Times are UTC throughout the application, because contest logs are. Where a
field accepts a local time, this documentation says so explicitly.
