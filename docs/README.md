# EzFD documentation

EzFD is a self-hosted, real-time, multi-operator logger for ARRL Field Day,
Winter Field Day, and special event stations. Every operator logs into one
shared log, and every QSO appears on every other device within milliseconds.

Start with whichever describes you.

## I'm just here to operate

| Guide | What it covers |
|---|---|
| [Quick start](quick-start.md) | You have a join code and a radio. Nothing to install, nothing to administer |

## I want to run an event

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | From an empty server to a logged QSO — install included |
| [Operating](operating.md) | The logging screen in depth — entry, QSY, dupes, offline |
| [Field Day](field-day.md) | Classes, the exchange, scoring, bonuses, submitting your entry |
| [Rules reference](rules-reference.md) | The scoring rules for both contests, transcribed from the official documents |
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

## Keeping up

| Guide | What it covers |
|---|---|
| [Changelog](changelog.md) | What changed, newest first, and which guide covers each change |

Worth reading in both directions: before an update, to see what is about to
change; and after one, when a score or an export has moved and you want to
know why. Every entry links to the guide covering it.

## Reading these in the app

Every guide here is also served by a running EzFD instance at **`/docs`** —
linked from the footer of the home page and from **Docs** in the logging
header. That matters for a field server with no internet, where the operator
who needs the troubleshooting page is exactly the one who can't reach GitHub.

The app renders the same files from this directory, so there is one copy of
each guide and no second version to drift. Its sidebar is grouped by the
headings on this page and ordered by these tables, so this file decides both
what the app lists and where — a guide moved between sections here moves in
the app too. Each guide also carries previous and next links following the
same order, so the whole set can be read straight through.

## Conventions used here

Commands prefixed `$` run on your own machine; commands prefixed `#` run as
root on the server. Callsigns in examples are illustrative.

Times are UTC throughout the application, because contest logs are. Where a
field accepts a local time, this documentation says so explicitly.
