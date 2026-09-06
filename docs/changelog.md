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

## 2026-09-06

### Added

- **The map fills sections instead of pinning them** `Display` — Sections are
  drawn as their real boundaries and fill amber once worked, so what you have
  and where the gaps are is one glance rather than a count of label boxes. 81
  of the 85 have a boundary; Ontario's four are carved by census division
  under RAC rather than ARRL rules and ship as one dashed outline until those
  are transcribed, which is honest rather than a guessed line drawn as
  confidently as a real one. The boundaries are a file the app ships, so they
  draw on a field server with no internet — only the basemap under them needs
  the network. ([#92])
  Docs: [Operating → The Map view](operating.md#the-map-view)

## 2026-09-05

### Added

- **Merge an event that ran in two places into one log** `Setup` — A field
  server at the site and the hosted instance can both hold real contacts from
  the same weekend. Importing that export used to make a *third* event, so the
  two logs had to be reconciled by hand. `POST /api/import/event?merge_into=`
  now reconciles them: contacts you don't have are added, duplicate flags are
  recomputed across the whole log — each instance computed its own against a
  different subset, so both were wrong for the union — and the roster and
  checkout history come across. It reports what it did rather than just
  succeeding, and it will not resolve a contact edited on both sides, undo a
  deletion, or change the event's settings. Running it twice is safe.
  ([#90])
  Docs: [Administration → Merging two instances of one event](administration.md#merging-two-instances-of-one-event), [API → POST /api/import/event](api.md#post-apiimportevent)
- **Rig control is a button in the header** `Display` — It shows whether a
  radio is connected and what it is tuned to, and with none connected it reads
  `Rig off` and opens the panel you connect from. That panel used to be
  reachable only from the band list further down, which is not where anyone
  looks for "how do I hook up my radio". ([#86])
  Docs: [Operating → Reading the header](operating.md#reading-the-header), [Rig control → Setup](rig-control.md#setup)
- **One menu, behind ☰** `Display` — Everything you can *do* on the logger and
  the dashboard now lives in a slide-out menu, grouped and with a line under
  each entry saying what it is. The header keeps only what you read at a
  glance. On a phone the dashboard header was four rows of buttons before the
  filter bar even started; it is two now. ([#84])
  Docs: [Operating → The menu](operating.md#the-menu)
- **Who worked what** `Display` — A new **Operators** view on the dashboard,
  reading the log you already have: contacts, points, best hour, bands,
  sections, and which sections that operator was the first to reach. Sort by
  any column. The totals row is meant to be checked against the scoreboard, so
  contacts imported without an operator get their own row rather than
  disappearing out of the count. The per-hour average stays blank until an
  operator's contacts span an hour, since dividing by less than one projects a
  partial hour out to a whole one. ([#82])
  Docs: [Operating → The Operators view](operating.md#the-operators-view)
- **A read of the log before you submit** `Scoring` `Display` — The summary
  sheet now opens with anything worth settling first: unrecognised sections, a
  station that sent two different exchanges, a bonus claimed that rule 7.3
  does not list for your class, and Winter Field Day objectives the log
  contradicts — those multiply, so a wrong tick moves the whole score. It does
  not check callsigns against any list: Field Day brings out operators no
  contest list has heard of, and flagging them would bury the findings that
  are real. ([#81])
  Docs: [Field Day → Before you submit](field-day.md#before-you-submit)
- **The GOTA station is a real station now** `Scoring` `Exports` `Display` —
  Set a GOTA callsign on the event and operators can sign in there; their
  contacts are signed with that call, count for the entry as normal, and earn
  their 5 bonus points each from the log rather than from a number somebody
  remembers to type. There is no cap and no per-operator limit — the app used
  to apply a 1,000-point cap that was never in the rules. ([#80], closes [#23])
  Docs: [Field Day → The GOTA station](field-day.md#the-gota-station), [Database → qsos](database.md#qsos)

### Changed

- **Text is a size larger, and the small sizes are one size** `Display` — The
  body of the interface goes from 12px to 13px and headings from 14 to 15,
  while the four near-identical sizes below 12px — 9, 10, 10.5 and 11 —
  become one. Thirteen distinct sizes, nine now. Easier to read outdoors at
  two in the morning, and the side panel still fits a 1366x768 laptop without
  a scrollbar. ([#87])
- **Every control on a phone is thumb-sized** `Display` — Eleven were under
  44px, some as small as 15px tall. They are all at least 44px now on a
  touchscreen, and unchanged on a laptop, where a logger wants the density and
  a mouse can hit a small button. ([#87])
- **The logging screen's side panel fits without scrolling** `Display` — On a
  1366x768 laptop it ran 307px past the bottom of the screen. The score panel
  now shows the mode split and the score, with the full breakdown on the
  dashboard, and the call checkout starts folded on a contest, where claiming
  a band is opt-in. It stays open on a special event, and a claim you hold is
  shown either way. ([#86])
  Docs: [Operating → The dashboard](operating.md#the-dashboard)
- **Quick Log is offered on special events only** `Exports` — It logs a
  contact straight from the callsign box, which is what a special event wants
  and what a contest cannot use: Field Day and Winter Field Day need a class
  and section from every station, and logging without them filed whatever was
  left in the boxes. With a callsign the call-history file knew, that was a
  *plausible* exchange the station never sent, and it went to Cabrillo
  unchallenged. ([#86])
  Docs: [Special event stations → Quick Log](special-events.md#quick-log)
- **The rig control panel is short now** `Display` — Status, a connect button
  and the three steps that start the bridge. The per-platform install walls and
  the troubleshooting section it used to carry are in the rig control guide,
  linked from the panel. ([#86])
  Docs: [Rig control → Setup](rig-control.md#setup)
- **Every control is reachable at every screen size** `Display` — Which
  controls you got used to depend on how wide your browser was, and not on
  purpose. The guides were reachable **only** on a phone; **Import ADIF**, both
  exports and the second-radio window **only** at tablet width and up. If you
  have been logging from a phone and could not find the export, that is why.
  ([#84])
  Docs: [Operating → The menu](operating.md#the-menu)
- **The rate beside each operator is now their best hour** `Display` — The
  dashboard's Operators panel divided an operator's contacts by however long
  they had been sitting there, so a good run read lower and lower as the band
  went quiet around it. It now shows the most they worked in any 60 minutes,
  which is the same figure the new Operators view prints — the two would
  otherwise have disagreed on the same screen. ([#82])
  Docs: [Operating → The Operators view](operating.md#the-operators-view)

### Fixed

- **The map draws again** `Display` — Every tile read "API key required". The
  map came from CARTO's basemap CDN, which used to be open to anyone and is
  not any more, and the refusal arrives as a *picture* rather than an error —
  so the map still drew, still put every section in the right place, and said
  nothing about why it was unreadable. It now uses OpenStreetMap's own tiles,
  which need no account and no key, so there is nothing to configure and a
  field server with no credentials works the same as a hosted one. Dark mode
  filters the tiles rather than loading a second style. ([#91])
  Docs: [Troubleshooting → The map says "API key required" on every tile](troubleshooting.md#the-map-says-api-key-required-on-every-tile)
- **The dashboard scrolls like a page on a phone** `Display` — It was two
  stacked panes that each scrolled inside a screen that did not: a window onto
  the log, and under it a window about two lines tall onto the score, bonuses,
  sections worked, operators and the join code. The page scrolls now, with the
  view tabs pinned at the top, and only the log and the operators table keep a
  scroll of their own. Nothing changes on a laptop. ([#88])
  Docs: [Operating → The dashboard](operating.md#the-dashboard)
- **Field Day says band coordination, not call checkout** `Display` — The
  logging panel was worded for a special event whatever the event was, so a
  Field Day screen offered to "check out" the callsign and reported that
  "nobody has the call checked out" — about a callsign nobody was competing
  for, since every station sends the club call all weekend. It now says what
  is actually being coordinated on a contest: the transmitter, one signal per
  band and mode, held by a station rather than a person. Claiming is still
  optional there, and the panel no longer prints an empty list saying so.
  ([#89])
  Docs: [Operating → Claiming a band and mode](operating.md#claiming-a-band-and-mode), [Quick start → Pick where you're operating](quick-start.md#pick-where-youre-operating)
- **A busy club no longer pushes the logging panel off the screen** `Display` —
  The Operators list grew with the roster: ten people signed in made it 368px
  tall and ran the side panel 143px past the bottom of a 900px display. It
  shows five at a time and scrolls inside itself now, with you on top.
  ([#87])
  Docs: [Operating → Who else is on](operating.md#who-else-is-on)
- **The CW keying button came back to the header** `Display` — Opening the
  keying window is something you do at the start of a CW shift, so putting it
  in the menu made it look as though it had been removed. It is a button again,
  beside Rig, and whether it appears comes from the same rule the menu uses.
  ([#86])
  Docs: [Operating → Reading the header](operating.md#reading-the-header)
- **The header printed `\u00d7` instead of `×`** `Display` — Between the
  sections worked and the score. A unicode escape had been written into the
  markup as text rather than as the character it stands for. ([#86])
- **The logger kept two disagreeing copies of its own controls** — One for the
  header and one for a phone bar, each hand-maintained, which is why the two
  had drifted apart. There is one list now, read by both screens, and a test
  fails if a second copy appears or an entry is added that nothing wires up.
  ([#84])
- **Changelog entries citing a pull request rendered as literal text** — A
  citation like `[#80]` needs a matching definition at the foot of this file to
  become a link; two entries were missing theirs and showed the brackets
  instead. The link test now checks citations as well as guide anchors.
  ([#82])

---

## 2026-08-30

### Added

- **Rig control without installing anything, on Chromium** `Display` — Chrome
  and Edge can open the radio's CAT port directly, so band and mode follow the
  VFO with no Python, no Hamlib and no second process to keep running — and a
  second radio needs no second bridge. Kenwood and Elecraft commands for now,
  which also covers FlexRadio SmartCAT, and reading only: CW keying still uses
  the bridge. The bridge is unchanged and stays the default, and is still the
  only option on Firefox, Safari, iOS and a plain-HTTP server. ([#79])
  Docs: [Rig control → Two ways to connect](rig-control.md#two-ways-to-connect)

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

[#23]: https://github.com/nreed97/EzFD/issues/23
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
[#79]: https://github.com/nreed97/EzFD/pull/79
[#80]: https://github.com/nreed97/EzFD/pull/80
[#81]: https://github.com/nreed97/EzFD/pull/81
[#82]: https://github.com/nreed97/EzFD/pull/82
[#84]: https://github.com/nreed97/EzFD/pull/84
[#86]: https://github.com/nreed97/EzFD/pull/86
[#87]: https://github.com/nreed97/EzFD/pull/87
[#88]: https://github.com/nreed97/EzFD/pull/88
[#89]: https://github.com/nreed97/EzFD/pull/89
[#90]: https://github.com/nreed97/EzFD/pull/90
[#91]: https://github.com/nreed97/EzFD/pull/91
[#92]: https://github.com/nreed97/EzFD/pull/92
