# Changelog

What changed in EzFD, newest first. Read from the top down to the date you
last updated.

There are no version numbers — EzFD is deployed by pulling the repository — so
entries are dated by when they landed on `master`.

Each entry says what the change does for you, grouped by whether it **added**
something, **fixed** something, **changed** existing behaviour, **removed**
something, or was a **security** update. Entries that affect what you submit or
see also carry a tag:

| Tag | Meaning |
|---|---|
| `Scoring` | A claimed score moves. If you already submitted, check the number |
| `Exports` | A Cabrillo, ADIF, summary sheet or backup file changes |
| `Display` | An operator sees or does something different on screen |
| `Setup` | Deployment, the admin console, or how the server is run |

Untagged entries are internal — tests, refactors, CI — and safe to skip if you
only run events.

---

## 2026-08-30

### Added

- **A `LICENSE` file** — The licence was stated in the README and nowhere a
  tool looks, so GitHub reported the project as unlicensed and anyone checking
  before deploying it at a club found nothing. The text is unchanged and now
  lives in the file that governs, with CI failing if the README's copy drifts
  from it. ([#78])
- **Every changelog entry points at its documentation** — Each entry now names
  the guide and the section covering it, so reading about a change and reading
  how to use it is one click rather than a search. A test checks every link and
  every anchor, because a renamed section silently leaves the link resolving to
  the top of the page. ([#76])
  Docs: [Development → Tests](development.md#tests)

- **The documentation sidebar is grouped, and shows where you are** `Display` —
  It listed all seventeen guides alphabetically with nothing to say which was
  yours and no mark on the one you were reading. It now follows the index's own
  audience grouping, highlights the current guide, and carries previous/next
  links so the set can be read straight through. On a phone it collapses, so a
  guide starts at the top of the screen rather than below a list of links.
  ([#77])
  Docs: [EzFD documentation → Reading these in the app](README.md#reading-these-in-the-app)

### Fixed

- **The development guide described a CI that no longer existed** — It said
  lint and `shellcheck` were "deliberately not gated" and listed four test
  suites. Both are gated and there are twelve. A contributor reading it would
  have expected a pull request to pass that CI now fails. ([#76])
  Docs: [Development → Tests](development.md#tests), [Development → CI](development.md#ci)
- **Links to a section whose heading has an apostrophe** `Display` — At `/docs`
  those headings were given an id with a stray `39` in it, so every link to one
  opened the right page at the top rather than at the section. It worked on
  GitHub and failed only in the app, which is the direction nothing was
  watching. ([#76])
  Docs: [Development → Tests](development.md#tests)
- **Links to the documentation index** `Display` — A guide pointing at the
  index sent a reader to `/docs/README`, which is not a page. The index is
  served at `/docs`. ([#76])
  Docs: [EzFD documentation](README.md)

---

## 2026-08-28

### Added

- **The station number in the logger header** `Display` — The station you pick
  at sign-in is now shown beside your callsign, in the main window and the CW
  keying window alike. Nothing on screen used to confirm it, so a mis-click at
  sign-in tagged a whole shift's contacts with the wrong transmitter and the
  first sign of it was the Cabrillo export. ([#72])
  Docs: [Operating → Reading the header](operating.md#reading-the-header)
- **The operating position picker opens on a band** `Display` — Rather than
  forty-five blank buttons, it preselects one you have checked out, or failing
  that the band this browser was last logging on, and says which of the two it
  used. Clicking any other band changes it. The memory is per station and
  survives signing out, so the next operator at a club laptop is offered the
  radio's own band. ([#73])
  Docs: [Quick start → Pick where you're operating](quick-start.md#pick-where-youre-operating), [Operating → Getting to the logger](operating.md#getting-to-the-logger)

### Fixed

- **Checkouts appear in the position picker as they happen** `Display` — The
  picker refreshed on a timer, so for up to fifteen seconds it could show a
  band as free that somebody had already taken — the exact window in which two
  operators pick the same one. It now listens on the same live stream the
  logging screen uses. Its clock was the other half: a checkout made *this
  second* was arriving and being drawn as not yet started. ([#74])
  Docs: [Operating → Getting to the logger](operating.md#getting-to-the-logger), [Architecture → Real-time updates](architecture.md#real-time-updates)
- **Leaving visitor mode goes home** `Display` — **← Exit** on a visitor
  dashboard landed on the event's operator sign-in, the one screen a visitor
  had deliberately not chosen — and if the browser still held a sign-in for
  that event, it went straight on into a logging window. ([#75])
  Docs: [Getting started → While it runs](getting-started.md#while-it-runs)

---

## 2026-08-25

### Added

- **An operating position step when you sign in** `Display` — After your
  callsign you are asked where you are sitting, with every band and mode shown
  as free, on air, or checked out, and the option to claim it there. The logger
  used to open on a hard-coded 20m phone, which on a busy site is a guess — and
  on a special event could put you on a band somebody else had booked. ([#71])
  Docs: [Quick start → Pick where you're operating](quick-start.md#pick-where-youre-operating), [Operating → Getting to the logger](operating.md#getting-to-the-logger)
- **Dashboard log view** `Display` — Every contact in one table, narrowed by
  operator, station, band, mode, section, time or duplicates, with the columns
  you choose. Answers a question about the log without exporting it mid-event,
  and gives a club something worth putting on a screen at the site. ([#66])
  Docs: [Operating → The Log view](operating.md#the-log-view)
- **This changelog** — So you can tell at a glance whether an update moves a
  score, changes an export or alters the screen, instead of reading commits.
  ([#67], [#68])

### Changed

- **The dashboard opens on the log** `Display` — Contacts arriving is what a
  dashboard is usually put up to show, and the log is the only view that
  answers a question about a specific QSO. The map and rate chart are one tab
  away. ([#70])
  Docs: [Operating → The dashboard](operating.md#the-dashboard)
- **Changelog layout** — Entries are grouped by what they did (added, fixed,
  changed, removed, security) with the subject in front, so a date's worth of
  work can be skimmed rather than read. Adds a `Setup` tag for deployment and
  admin-console changes. ([#69])

---

## 2026-08-24

### Added

- **Contest rules reference** — [`rules-reference.md`](rules-reference.md)
  transcribes the scoring rules for both contests with their rule numbers, so a
  value can be checked against the source rather than against the code that
  uses it. ([#60])
  Docs: [Contest rules reference](rules-reference.md)
- **Documentation as part of every change** — `AGENTS.md` records which guide
  owns which kind of change, so a feature and its documentation land together.
  ([#62])
  Docs: [Development → Conventions](development.md#conventions)

### Fixed

- **Winter Field Day scoring** `Scoring` `Display` — WFD was scored with Field
  Day's formula, which the WFD rules cannot produce by any route. It uses
  `QSO points × (Objective Multiplier + 1)`, with no bonus points and no power
  multiplier; the bonus panel is now an objectives list. ([#60], closes [#58])
  Docs: [Field Day → Winter Field Day](field-day.md#winter-field-day), [Contest rules reference → Scoring](rules-reference.md#scoring-a-different-model-entirely)
- **Field Day bonus schedule** `Scoring` `Exports` — Ten of eighteen bonus
  values were wrong, three were missing, and two were awarded that no rule
  contains. Any entry claiming bonuses was submitting a wrong total, and
  emergency power alone was over-claiming by thousands of points on a large
  log. ([#59])
  Docs: [Field Day → Bonus points](field-day.md#bonus-points), [Contest rules reference → Bonus points (7.3)](rules-reference.md#bonus-points-73)
- **Mobile stations in Winter Field Day** `Display` — Class `M` was missing
  from the entry form's copy of the WFD class letters, so every contact with a
  mobile station was flagged as an invalid class. ([#60])
  Docs: [Contest rules reference → Exchange and classes](rules-reference.md#exchange-and-classes)
- **The `MX` exchange** `Display` — Mexican stations send it in WFD, and it was
  being counted as a probable typo. ([#60])
  Docs: [Contest rules reference → Exchange and classes](rules-reference.md#exchange-and-classes)
- **Stale Cabrillo guidance** `Exports` — The guides told clubs to hand-correct
  the claimed score months after that bug was fixed. Following them would have
  introduced the error they warned about. ([#57])
  Docs: [Field Day → Submitting](field-day.md#submitting), [Troubleshooting → Cabrillo claimed score looks wrong](troubleshooting.md#cabrillo-claimed-score-looks-wrong)
- **Admin console event list** `Setup` — A long list was unusable, and some
  failed actions printed success. ([#63])
  Docs: [Administration → The event list](administration.md#the-event-list)
- **README licence and AI disclaimer** — Both were lost when the file was
  rewritten rather than edited. ([#61])

### Removed

- **The Worked All Sections bonus** `Scoring` — Field Day has never had one,
  and the 100 points it awarded went onto entries that never earned them.
  Sections are still counted, still shown, and still worth chasing — they just
  score nothing. ([#59])
  Docs: [Field Day → Bonus points](field-day.md#bonus-points), [Contest rules reference → Bonus points (7.3)](rules-reference.md#bonus-points-73)

---

## 2026-08-23

### Added

- **Documentation inside the app** `Display` — Served at `/docs`. The operator
  who needs the troubleshooting page on a field server with no internet is
  exactly the one who cannot reach GitHub. ([#54])
  Docs: [EzFD documentation → Reading these in the app](README.md#reading-these-in-the-app)
- **Band and mode coordination for contests** `Display` — A station can claim a
  band and mode, and another is warned rather than silently doubling up.
  ([#47])
  Docs: [Operating → Who else is on](operating.md#who-else-is-on)
- **Operator quick start** `Display` — For someone who has a join code and a
  radio and nothing to administer. ([#56])
  Docs: [Quick start](quick-start.md)

### Changed

- **New events default to section MN** `Display` — Matching the example
  callsign rather than an unrelated section. ([#55])

### Fixed

- **Contacts lost during a CW run** — The CW keying window logged straight to
  the server with no local copy, so an outage destroyed contacts rather than
  delaying them. It now shares the offline queue. ([#51])
  Docs: [Rig control → CW keying](rig-control.md#cw-keying), [Operating → Working offline](operating.md#working-offline)
- **The offline queue after a server-only outage** — A restart or a brief 502
  leaves the browser's own connection up, so nothing told the queue to retry.
  Contacts sat unsent until somebody noticed the badge. ([#49])
  Docs: [Operating → Working offline](operating.md#working-offline), [Troubleshooting → The pending counter won't clear](troubleshooting.md#the-pending-counter-wont-clear)
- **WSJT-X contacts the server refused** — The relay printed an error and moved
  on. It now spools them to disk and retries. ([#52])
  Docs: [Digital modes → If the server goes away](digital-modes.md#if-the-server-goes-away)
- **Two radios, one operator** `Display` — Presence and call checkouts are
  keyed per radio, so a second logging window no longer overwrites the first's
  band or releases its slot. ([#53])
  Docs: [Special event stations → Running two radios at once](special-events.md#running-two-radios-at-once)

---

## 2026-08-22

### Added

- **Recoverable deletes with an audit trail** `Display` `Exports` — A contact
  missing from the log could not be distinguished from one never logged.
  Deletes are now reversible and record who made them. ([#45])
  Docs: [Operating → Editing and deleting](operating.md#editing-and-deleting), [Troubleshooting → A QSO was deleted by mistake](troubleshooting.md#a-qso-was-deleted-by-mistake)
- **Event export and import over HTTP** `Setup` — Moving an event between
  instances no longer needs shell access on the server. ([#44])
  Docs: [HTTP API → Import and export](api.md#import-and-export), [Administration → Restoring from JSON](administration.md#restoring-from-json)
- **Server clock skew detection** `Display` — A field server with no RTC and no
  NTP stamps every contact with a plausible-looking wrong time, which is
  invisible unless something checks. ([#33])
  Docs: [Administration → Server time](administration.md#server-time), [Troubleshooting → The server's clock](troubleshooting.md#this-servers-clock-is-n-ahead-of-behind-this-device)
- **Unit suites for scoring, exports and the section list** — The
  highest-consequence logic in the project was covered only indirectly.
  ([#39], [#43])
  Docs: [Development → Tests](development.md#tests)
- **Lint and shellcheck as CI gates** — A backlog of findings was cleared and
  the gates turned on, so the next one fails a pull request rather than
  accumulating. ([#38], [#40])
  Docs: [Development → CI](development.md#ci)

### Fixed

- **Cabrillo claimed score and transmitter numbers** `Scoring` `Exports` — The
  header ignored the power multiplier, dropped bonus points entirely, and
  stamped every contact with the same transmitter. ([#31])
  Docs: [Field Day → Submitting](field-day.md#submitting), [Troubleshooting → Cabrillo claimed score looks wrong](troubleshooting.md#cabrillo-claimed-score-looks-wrong)
- **Typos counting as sections** `Scoring` — A handful of unrecognised
  exchanges could read as a clean sweep. `DX` is accepted as a valid exchange
  without being counted as a section. ([#36])
  Docs: [Field Day → Sections](field-day.md#sections), [Troubleshooting → A section is rejected as invalid](troubleshooting.md#a-section-is-rejected-as-invalid)
- **The ARRL/RAC section list** `Scoring` — RAC's recent splits and renames
  were missing, so the sections-worked denominator was wrong. ([#33])
  Docs: [Field Day → Sections](field-day.md#sections)

### Security

- **Next.js updated** `Setup` — Clears four high-severity CVEs. ([#42])
  Docs: [Deployment → Updating](deployment.md#updating)

---

## 2026-08-21

### Added

- **Special event station support** `Display` — One callsign across many
  operators, with band and mode checkout enforced by a database constraint
  rather than by convention.
  Docs: [Special event stations](special-events.md)
- **Full documentation under `docs/`, with screenshots** — Guides for
  operating, deployment, administration and the API, replacing a single
  README. ([#25], [#26])
  Docs: [EzFD documentation](README.md)
- **24-hour clock pickers and a schedule timeline** `Display` — Event start
  and end times are set on a UTC clock rather than typed, and the schedule is
  shown as a timeline. ([#27], [#28], [#29])
  Docs: [Special event stations → The call checkout](special-events.md#the-call-checkout)

---

Earlier history is in the commit log. This file starts where the work became
continuous enough to be worth summarising.

[#25]: https://github.com/nreed97/EzFD/pull/25
[#26]: https://github.com/nreed97/EzFD/pull/26
[#27]: https://github.com/nreed97/EzFD/pull/27
[#28]: https://github.com/nreed97/EzFD/pull/28
[#29]: https://github.com/nreed97/EzFD/pull/29
[#31]: https://github.com/nreed97/EzFD/pull/31
[#33]: https://github.com/nreed97/EzFD/pull/33
[#36]: https://github.com/nreed97/EzFD/pull/36
[#38]: https://github.com/nreed97/EzFD/pull/38
[#39]: https://github.com/nreed97/EzFD/pull/39
[#40]: https://github.com/nreed97/EzFD/pull/40
[#42]: https://github.com/nreed97/EzFD/pull/42
[#43]: https://github.com/nreed97/EzFD/pull/43
[#44]: https://github.com/nreed97/EzFD/pull/44
[#45]: https://github.com/nreed97/EzFD/pull/45
[#47]: https://github.com/nreed97/EzFD/pull/47
[#49]: https://github.com/nreed97/EzFD/pull/49
[#51]: https://github.com/nreed97/EzFD/pull/51
[#52]: https://github.com/nreed97/EzFD/pull/52
[#53]: https://github.com/nreed97/EzFD/pull/53
[#54]: https://github.com/nreed97/EzFD/pull/54
[#55]: https://github.com/nreed97/EzFD/pull/55
[#56]: https://github.com/nreed97/EzFD/pull/56
[#57]: https://github.com/nreed97/EzFD/pull/57
[#58]: https://github.com/nreed97/EzFD/issues/58
[#59]: https://github.com/nreed97/EzFD/pull/59
[#60]: https://github.com/nreed97/EzFD/pull/60
[#61]: https://github.com/nreed97/EzFD/pull/61
[#62]: https://github.com/nreed97/EzFD/pull/62
[#63]: https://github.com/nreed97/EzFD/pull/63
[#66]: https://github.com/nreed97/EzFD/pull/66
[#67]: https://github.com/nreed97/EzFD/pull/67
[#68]: https://github.com/nreed97/EzFD/pull/68
[#69]: https://github.com/nreed97/EzFD/pull/69
[#70]: https://github.com/nreed97/EzFD/pull/70
[#71]: https://github.com/nreed97/EzFD/pull/71
[#72]: https://github.com/nreed97/EzFD/pull/72
[#73]: https://github.com/nreed97/EzFD/pull/73
[#74]: https://github.com/nreed97/EzFD/pull/74
[#75]: https://github.com/nreed97/EzFD/pull/75
[#76]: https://github.com/nreed97/EzFD/pull/76
[#77]: https://github.com/nreed97/EzFD/pull/77
[#78]: https://github.com/nreed97/EzFD/pull/78
