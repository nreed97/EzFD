# Changelog

What changed in EzFD, newest first. One line per change, saying what it does
for you rather than which files moved.

There are no version numbers — EzFD is deployed by pulling the repository, so
entries are dated by when they landed on `master`. Read from the top down to
the date you last updated.

**Changes that alter a claimed score, a submitted file, or what an operator
sees on screen are marked.** Everything else is internal: worth knowing if you
work on the code, safe to skip if you just run events.

> ⚠️ **Scoring** · 📋 **Exports** · 👁 **Operator-visible**

---

## 2026-08-25

- **This changelog exists** ([#67]) — so you can tell at a glance whether an
  update changes a score, an export or the screen, instead of reading commits.

## 2026-08-24

- ⚠️ 👁 **Winter Field Day is scored by its own rules** ([#60]) — WFD uses
  `QSO points × (Objective Multiplier + 1)` with no bonus points and no power
  multiplier, so a WFD claimed score is now a number the WFDA rules can
  actually produce; the bonus panel becomes an objectives list. Closes [#58].
- 👁 **Winter Field Day mobile stations log without a false warning** ([#60]) —
  class `M` was missing from the entry form's copy of the WFD class letters, so
  every contact with a mobile station was flagged invalid.
- 👁 **`MX` is accepted as a Winter Field Day exchange** ([#60]) — Mexican
  stations send it, and it was being counted as a probable typo.
- ⚠️ 📋 **The Field Day bonus schedule matches the official rules** ([#59]) —
  ten of eighteen bonus values were wrong, three were missing and two were
  awarded that no rule contains, so any entry claiming bonuses was submitting a
  wrong total; emergency power alone was over-claiming by thousands of points
  on a large log.
- ⚠️ **There is no Worked All Sections bonus** ([#59]) — Field Day has never had
  one, and the 100 points it awarded went onto entries that never earned them;
  sections are still counted and still worth chasing, they just score nothing.
- **The scoring rules for both contests are recorded in the repository**
  ([#60]) — [`rules-reference.md`](rules-reference.md) transcribes them with
  rule numbers, so a value can be checked against the source rather than
  against the code that uses it.
- 👁 **The admin console pages its event list and reports failures honestly**
  ([#63]) — a long event list was unusable, and some failed actions printed
  success.
- **The README's licence and AI disclaimer are back** ([#61]) — both were lost
  when the file was rewritten rather than edited.
- **Documentation is now part of every change** ([#62]) — `AGENTS.md` records
  which guide owns which kind of change, so a feature and its documentation
  land together.

## 2026-08-23

- 📋 **The guides no longer tell you to hand-correct the Cabrillo claimed
  score** ([#57]) — that bug was fixed months earlier, and following the notice
  would have introduced the error it warned about.
- 👁 **The documentation is served by the app at `/docs`** ([#54]) — the
  operator who needs the troubleshooting page on a field server with no
  internet is exactly the one who cannot reach GitHub.
- 👁 **One operator can run two radios** ([#53]) — presence and call checkouts
  are keyed per radio, so a second logging window no longer overwrites the
  first's band or releases its slot.
- **WSJT-X contacts the server cannot take are queued, not lost** ([#52]) — the
  relay spools them to disk and retries instead of printing an error and moving
  on.
- **The CW keying window logs through the offline queue** ([#51]) — a server
  outage during a CW run used to destroy contacts outright rather than delay
  them.
- **The offline queue drains after a server-only outage** ([#49]) — a restart
  or a brief 502 leaves the browser's connection up, so nothing told the queue
  to retry and contacts sat unsent until someone noticed.
- 👁 **Band and mode coordination works for contests** ([#47]) — a station can
  claim a band and mode, and another is warned rather than silently doubling
  up.
- 👁 **A new event defaults to section MN** ([#55]) — matching the example
  callsign, instead of an unrelated section.
- 👁 **There is an operator quick start** ([#56]) — for someone who has a join
  code and a radio and nothing to administer.

## 2026-08-22

- 👁 📋 **Deleted contacts are recoverable and leave an audit trail** ([#45]) —
  a QSO missing from the log could previously not be distinguished from one
  never logged; deletes are now reversible and record who made them.
- **An event can be exported and imported over HTTP** ([#44]) — moving an event
  between instances no longer needs shell access on the server.
- ⚠️ 📋 **Cabrillo carries the correct claimed score and transmitter numbers**
  ([#31]) — the header ignored the power multiplier, dropped bonus points
  entirely, and stamped every contact with the same transmitter.
- ⚠️ **Only real sections count toward the sections total** ([#36]) — a handful
  of typos could otherwise read as a clean sweep; `DX` is accepted as a valid
  exchange without being counted as a section.
- ⚠️ **The ARRL/RAC section list is current** ([#33]) — RAC's recent splits and
  renames were missing, so the sections-worked denominator was wrong.
- 👁 **Server clock skew is detected and shown** ([#33]) — a field server with
  no RTC and no NTP stamps every contact with a plausible-looking wrong time,
  which is invisible without something checking.
- **Security: Next.js updated to clear four high-severity CVEs** ([#42]).
- **The scoring formula, export formats and section list have unit suites**
  ([#39], [#43]) — the highest-consequence logic in the project was only
  covered indirectly.
- **Lint and shellcheck gate CI** ([#38], [#40]).

## 2026-08-21

- 👁 **Special event station support** — one callsign across many operators,
  with band and mode checkout enforced by the database rather than by
  convention.
- 👁 **Full documentation under `docs/`, with screenshots** ([#25], [#26]).
- 👁 **24-hour clock pickers and a schedule timeline** ([#27], [#28], [#29]).

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
[#67]: https://github.com/nreed97/EzFD/pull/67
