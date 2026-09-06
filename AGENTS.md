<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# EzFD project notes

EzFD is a real-time, multi-operator ARRL Field Day / Winter Field Day logger. Next.js 16 App Router (standalone output, `node server.js`), PostgreSQL 16 with `pg_notify` → SSE for real-time updates, Tailwind v4 (`light:` prefix for light mode — dark is default). Deployed to Ubuntu/Debian VPS via `deploy.sh` (nginx + certbot + systemd). See `README.md` for full feature docs and usage.

## Before finishing a frontend change
Run `npm run lint`, `npx tsc --noEmit` and `npm run build` — all three must be clean.
CI gates on all of them, plus `shellcheck` for any shell change.

Changes touching the schema, the SES routes, `lib/scoring.ts`, `lib/adif.ts`,
`lib/cabrillo.ts` or `ezfd-admin.sh` should also run the relevant suite (CI runs all of them — see the Tests section in `README.md`):

| Script | Covers |
|---|---|
| `db/test-ses-constraint.sql` | The SES overlap constraint, asserted against a real database |
| `scripts/test-queries.cjs` | Route SQL through the `pg` driver — casts the typechecker can't see |
| `scripts/test-restore.sh` | `ezfd-admin.sh` backup/restore for SES, FD and empty events |
| `scripts/test-merge.cjs` | Merging two instances of one event — contacts added once, dupes recomputed across the union, deletions not undone, conflicts reported rather than resolved |
| `scripts/test-e2e.sh` | The API end to end, including Field Day regressions |
| `scripts/test-sections.cjs` | The ARRL/RAC section list — the three enumerations agree, no hardcoded totals |
| `scripts/test-scoring.cjs` | The ARRL scoring formula — multipliers, every rule-7.3 bonus and its cap, dupes, sections |
| `scripts/test-gota.cjs` | GOTA — a contact counts for QSO points *and* the bonus, the count comes from the log rather than a typed number, and there is no cap |
| `scripts/test-preflight.cjs` | The pre-submission read of the log, and that rule 7.3's class-eligibility column matches `docs/rules-reference.md` |
| `scripts/test-adif.cjs` | ADIF parse and export — the `Date`/string shapes, per-operator `MY_*`, SES vs contest exchange |
| `scripts/test-cabrillo.cjs` | Cabrillo submission — `CLAIMED-SCORE`, transmitter numbering, ordering, null class/section |
| `scripts/test-log-filters.cjs` | The dashboard log view — filters combine, an empty filter restricts nothing, column defaults per event type |
| `scripts/test-nav.cjs` | The menu behind the hamburger — one list for every surface and width, every action wired up, no component keeping its own copy |
| `scripts/test-op-stats.cjs` | Who worked what — the rows sum to the log, a dupe earns nothing, a section belongs to whoever reached it first, and rate is a rolling hour |
| `scripts/test-slot-board.cjs` | The operating position board — released/expired claims, station vs operator attribution, the contest band list, and that the contest vocabulary carries no callsign words |
| `scripts/test-last-position.cjs` | What the position picker preselects — a claim outranks a remembered position, and a remembered one is validated against the event's bands |
| `scripts/test-changelog-links.cjs` | Every guide and `#anchor` the changelog points at resolves — a renamed section is otherwise invisible — and every `[#nn]` citation has a definition, or it renders as literal brackets |
| `scripts/test-docs-nav.cjs` | The `/docs` sidebar — every guide appears exactly once, grouped and ordered by the index |
| `scripts/test-cat-protocol.cjs` | The Kenwood CAT decode — framing, mode letters, and that the native path's band and mode tables still match the bridge's |

When adding a test, check it can actually fail — break the thing it guards and
watch it go red. Doing that is what surfaced the missing self-heal on the
exclusion constraint.

## Documentation is part of the change, not a follow-up

A change is not finished until the documentation describes what the app now
does. This applies to additions, changes **and removals** — a deleted feature
whose guide survives is worse than one that was never documented, because the
guide now instructs an operator to do something impossible.

Stale docs here have already cost real accuracy. `docs/field-day.md` and
`docs/troubleshooting.md` carried a "known bug" notice telling clubs to
hand-correct the Cabrillo claimed score for months after that bug was fixed —
following the guide would have *introduced* the error it warned about. The
README rewrite silently dropped the licence and the AI disclaimer because the
file was replaced rather than edited. Neither had a test, and nothing caught
either one.

**Ask three questions of every change**, and act on each in the same PR:

1. **Does an operator do something differently now?** → the user-facing guide
2. **Does the shape of the system change?** → the architecture/reference guide
3. **Would a reader believe something that is no longer true?** → find and fix
   every place that says it, not just the obvious one

### Every change gets a changelog entry

Add one to `docs/changelog.md` in the same PR, under today's date and under the
heading for what the change did. Start whichever headings the date doesn't have
yet, and keep them in this order so every date reads the same way:

**Added** · **Changed** · **Fixed** · **Removed** · **Security**

The shape is a bold subject, any tags, then one or two sentences:

```markdown
- **Field Day bonus schedule** `Scoring` `Exports` — Ten of eighteen bonus
  values were wrong, three were missing, and two were awarded that no rule
  contains. Any entry claiming bonuses was submitting a wrong total. ([#59])
```

**The subject names the thing that changed; the sentence says what it does for
the reader — not what it edited.** Someone reads this deciding whether to
update their server before an event, or working out why a number moved since
last weekend. "Corrected the bonus table" tells them nothing; the example above
tells them whether it matters to them. An entry they cannot act on is noise.

### Point the entry at its documentation

**If the change touched a guide, the entry links to it** — the guide *and* the
section, on a `Docs:` line directly under the entry:

```markdown
- **The station number in the logger header** `Display` — The station you pick
  at sign-in is now shown beside your callsign. ([#72])
  Docs: [Operating → Reading the header](operating.md#reading-the-header)
```

Two or more guides are comma-separated on the one line. Write them
`[Guide title → Section](file.md#anchor)`, using the guide's own `#` title, so
the reader knows where they are going before they click.

Links are **relative and stay inside `docs/`**. `renderMarkdown()` rewrites
`foo.md#bar` to `/docs/foo#bar`, which is what makes one link work both on
GitHub and in the app; an absolute URL, a path with a `/` in it, or a `../`
escape out of `docs/` all break that. `AGENTS.md` and the root `README.md` are
outside `docs/` and cannot be linked this way — point at the guide that covers
the same ground instead.

The anchor must be a real `##`/`###`/`####` heading. `addHeadingIds()` only
gives ids to those, so a link to a page's `#` title has nothing to land on.
`scripts/test-changelog-links.cjs` checks every link and fails on a missing
file or a missing anchor; run it after renaming any heading, because a renamed
section leaves every link to it resolving silently to the top of the page.

**Omit the `Docs:` line only when there is genuinely nothing to point at** — a
test suite, a refactor, a CI gate, a change to the changelog itself. That is
the same set as the untagged entries, and it should be a small minority. If a
user-facing change has no guide to link, the missing documentation is the
finding, not the missing link. The test prints how many entries carry a link
out of how many exist, so the ratio dropping is visible.

Tag an entry when it affects what a reader submits or sees. Tags are inline
code, after the subject:

| Tag | Use when |
|---|---|
| `Scoring` | A claimed score moves — anyone who already submitted may have submitted a wrong number |
| `Exports` | An exported file changes — Cabrillo, ADIF, the summary sheet, a backup |
| `Display` | An operator sees or does something different on screen |
| `Setup` | Deployment, the admin console, or how the server is run |

Untagged is the default and is fine: a test suite, a refactor, a CI gate. Tag
sparingly, or the tags stop meaning anything. No emoji anywhere in the file —
words read the same in a terminal, a diff and a rendered page, and stay
greppable.

There are no version numbers — EzFD is deployed by pulling the repository — so
entries are dated by when they land on `master` rather than grouped into
releases. Don't rewrite or reorder existing entries; the file is a record of
what shipped, not a summary of the current state.

### Where each kind of change is documented

Match the change to the audience section in `docs/README.md`, not to whichever
file is easiest to edit:

| What changed | Update |
|---|---|
| The logging screen, entry flow, dupes, QSY, offline behaviour | `docs/operating.md`, and `docs/quick-start.md` if it affects the first five minutes |
| Scoring, bonuses, classes, the exchange, submission | `docs/field-day.md`; check the values against `docs/rules-reference.md` |
| A contest rule value | `docs/rules-reference.md` **first** — it is the transcription of the official documents, and the code is checked against it, never the reverse |
| SES checkout, the roster, per-operator ADIF | `docs/special-events.md` |
| Rig control, CAT, CW macros | `docs/rig-control.md` |
| WSJT-X, JTDX, ADIF import | `docs/digital-modes.md` |
| A new route, or a changed request/response shape | `docs/api.md` |
| A table, column, index or constraint | `docs/database.md` **and** the schema comment in `db/schema.sql` |
| Real-time, offline queue, coordination, how the pieces fit | `docs/architecture.md` |
| `deploy.sh`, TLS, systemd, nginx | `docs/deployment.md` |
| `ezfd-admin.sh`, backup, restore, recovery | `docs/administration.md` |
| An environment variable | `docs/configuration.md` — every one is listed there |
| Local setup, a new test suite, a convention | `docs/development.md`, and the test table above |
| A new failure mode an operator can hit | `docs/troubleshooting.md`, as symptom → cause → fix |
| A headline capability | `README.md` feature list — and check the screenshot gallery still matches |
| **Anything at all** | `docs/changelog.md` — one entry, every change, no exceptions |

**Adding a guide takes two edits, not one.** The file, and a row in the index
table in `docs/README.md` under the audience heading that fits.

The index is not just a page: `docsNav()` reads the `##` headings and the table
rows back out of it to build the `/docs` sidebar and the previous/next links,
so `docs/README.md` decides what the app lists, in what groups, in what order.
Move a guide between sections there and it moves in the app.

A guide with no index row is not lost — it appears under a **More** group,
because a forgotten row should degrade to "listed in an odd place" rather than
to "invisible in the app". That is a fallback, not the intended shape; the row
is still the edit to make. `scripts/test-docs-nav.cjs` asserts every guide in
`docs/` appears in the nav exactly once, which is the failure this design can
have and the flat alphabetical list could not.

### Screenshots and examples

Update a screenshot when the change alters what the reader sees in it. A guide
whose prose is current but whose picture shows the old layout is still wrong,
and it is the half a reader trusts most.

- Live in `docs/images/`, referenced as `images/foo.png` — relative, because
  the guides render on GitHub *and* at `/docs`, and `renderMarkdown()` rewrites
  them to absolute app paths.
- Capture against a **built** server with realistic fixture data. Screenshots
  taken against a bare fixture have shipped artefacts before: every QSO stamped
  with the same second, and a false red band-conflict banner from an operator
  with no presence row. Fix the fixture, not the image.
- Alt text describes what the picture *shows*, since it is what a screen reader
  and a broken-image reader get. Check the caption names the right screen — the
  quick start once showed the operator sign-in captioned as the join screen.
- Prefer a worked example with real numbers over prose for anything
  arithmetic. `docs/field-day.md`'s bonus table carries the rule number on
  every row so a reader can check a line against the source.

`scripts/test-e2e.sh` asserts the index renders, a guide renders, cross-links
are rewritten, heading anchors exist and the referenced screenshots are served.
That catches a broken link or a missing image — it cannot tell you the prose is
out of date. That part is on you.

## Critical gotchas

- **`pg` returns `TIMESTAMPTZ` as JS `Date` objects**, not strings. `lib/adif.ts` and `lib/cabrillo.ts` must handle both shapes.
- **ARRL scoring formula**: `QSO points × power multiplier + bonus points`. Sections do **not** multiply the score — that was a real bug once. Power mult: HIGH=×1, LOW=×2, QRP=×5. See `lib/scoring.ts`.
- **The bonus schedule lives in `lib/bonuses.ts` and nowhere else.** Values are transcribed from the official ARRL rules (Revised 4/2026) with the rule number on every row, so a reader checks a line against the source rather than against the code. It used to be written out three times — the arithmetic in `lib/scoring.ts`, the label and rate string in `BonusTracker`, and a third derivation in `SummarySheet` (a nested ternary over key names). They disagreed, which meant the sheet an operator transcribes onto their ARRL entry could itemise a bonus at a different number from the claimed score printed beneath it. Same failure as the section list in two components and the backup query in four. Nearly every value was also simply wrong against the rules: emergency power **doubled the whole base score** instead of paying 100 per transmitter (rule 7.3.1, capped at 20 transmitters / 2,000 points), which on a 5,000-point base over-claimed by thousands; GOTA was 10 per contact instead of 5 (7.3.13.1, and *uncapped* — the old 1,000 cap was invented); the safety officer, social media and elected-official bonuses were at a quarter, a half and a half of their real values; the youth cap was missing; and 7.3.12 was a per-representative tally rather than one 100-point bonus. Bonus points are added **after** the multiplier and are never multiplied — 7.3.13.1 says so explicitly for GOTA and it holds for all of them.
- **A GOTA contact scores twice, and excluding it from QSO points is the bug.** Rule 4.1.1.5: "QSOs made by this station may be claimed for credit by its primary Field Day operation. In addition, bonus points may be earned by this station under rule 7.3.13." So a contact flagged `is_gota` earns its normal QSO points *and* 5 bonus points under 7.3.13.1. The intuitive reading — that a contact scoring as a bonus shouldn't also score as a QSO — is what this feature's own plan proposed, and it deflates a claimed score by a point per phone contact and two per CW or digital one. There is **no cap** on the bonus and **no per-operator limit**; the 1,000-point cap the app applied for several releases appears nowhere in the rules. The count is derived from the log (`Score.gota_qsos`) and the typed `gota_qsos` is only used when the log has none — never summed with it, or a club that both logs and types claims every contact twice.
- **There is no Worked All Sections bonus, and there never was one in Field Day.** Rule 7.3 runs 7.3.1 through 7.3.18 and none of them concerns sections; the app awarded 100 points for a clean sweep for several releases. Sections are still counted, still shown and still worth chasing — `SectionsNeeded`, the grid and the map all stay — but they earn nothing, and `scripts/test-sections.cjs` fails if `ARRL_SECTIONS.length` reappears in the scorer. The same goes for `all_licensed`: no such Field Day rule exists, so it is Winter Field Day only.
- **Winter Field Day is a different scoring model, not a different set of numbers.** WFD is run by the Winter Field Day Association, not the ARRL. It has **no bonus points and no power multiplier**: every station is capped at 100 W PEP, running QRP is an *objective* worth OM 4, and the score is `QSO points × (Objective Multiplier + 1)`. The completed objectives' OM values sum and one is added — the `+1` is why a station that completes nothing still scores its contacts, and dropping it would zero every such log. `WFD_OBJECTIVES` lives in `lib/bonuses.ts` alongside `FD_BONUSES`; `bonusDefs()` returns an empty list for WFD precisely so an objective can never be summed into a bonus total that does not exist. The app ran Field Day's formula over WFD for several releases, producing a claimed score the WFD rules cannot arrive at by any route. Both rule sets are transcribed in `docs/rules-reference.md` — check a value against that, not against the code.
- **WFD has a fourth class letter and a fifth exchange.** Classes are `H` home, `I` indoor, `O` outdoor and **`M` mobile**; Field Day has no `M`. `QSOForm` kept its own copy of the letter set missing `M`, while `app/event/new/page.tsx` had a second copy that included it — so every contact with a mobile WFD station drew a false "invalid class" warning. WFD also accepts **`MX`** (Mexico) as a location identifier, which Field Day does not; `validExchangesFor(eventType)` is what forms must call, never the bare `VALID_EXCHANGES`. Neither `DX` nor `MX` is a section, and neither may ever enter `ARRL_SECTIONS`.
- **The pre-submission check never consults an outside callsign list, and that is deliberate.** `lib/preflight.ts` reads the log, the event's own claims, and rules transcribed in `docs/rules-reference.md` — nothing else. The obvious missing check is "this call is not in `MASTER.SCP`", and it is absent for two compounding reasons: the file is fetched best-effort and refreshed on a staleness check, so an offline field server has an *empty* table and would flag every contact in the log while looking authoritative; and `MASTER.SCP` is built from contest logs, while Field Day exists to bring out people who never enter contests, so a large share of good Field Day calls are not in it. Beyond the false positives, a report that cries wolf gets skimmed, which costs the findings that are worth reading. `NOT_CHECKED` names what nothing looked at, so a quiet report is not mistaken for a clean bill of health. `severity: 'fix'` is reserved for a claim the log flatly contradicts; everything a human might legitimately disagree with is a `'check'`.
- **The ARRL/RAC section list lives in `lib/` only** — `ARRL_SECTIONS` (`lib/types.ts`), `SECTION_DATA` (`lib/sections.ts`, adds map coordinates) and `SECTION_GROUPS` (`lib/sections.ts`, the call-area layout every grid panel renders). They must cover the same 85 sections; `scripts/test-sections.cjs` fails if they drift, and also fails if any file outside those two grows its own array of section abbreviations. That last check exists because the layout used to be duplicated in `SectionGrid` *and* `SectionsNeeded`: correcting the list updated one of them, and the panel operators read to know what to chase kept listing retired sections for a release. Never write the total out as a literal — derive it from `ARRL_SECTIONS.length`, which is what the "sections needed" display does. A hardcoded `84` in the summary sheet against a list of 81 meant the sheet an operator transcribes onto their ARRL entry disagreed with the log it was summarising. RAC's recent changes are the usual source of a stale list: `MAR` → `NB`/`NS`/`PE`, `ON` → `ONE`/`ONN`/`ONS`/`GH` (`GTA` renamed to `GH`), and Yukon folded into `NT`.
- **`DX` is a valid exchange but not a section.** Field Day stations outside the US and Canada send it. It belongs in `VALID_EXCHANGES` (what the entry form accepts) and never in `ARRL_SECTIONS` (the sections-worked denominator) — adding it there would quietly move the target to 86. `score.sections` holds recognised sections only; `score.unknown_sections` holds logged exchanges that are neither a section nor `DX`, so the UI can flag them as likely typos. Counting raw exchange strings let a handful of typos read as a clean sweep.
- **`psql -A` does not escape its field separator inside a value.** `ezfd-admin.sh` reads rows with `IFS=... read`, so with psql's default pipe a club called `Pipe|Name Club` split into two fields and shifted every following column of that row one place right — the event table printed the created date under "Class". `PG()` therefore passes `-F $'\x1f'` and every reader splits on that unit separator; `scripts/test-restore.sh` fails if an `IFS='|' read` reappears. Club names, locations and SES descriptions are all free text an operator types. For the same reason the table's placeholders are ASCII `-`, not an em dash: `printf %-4s` pads by byte, so a 3-byte character in a column knocks the rest of the row out of line.
- **psql fed on stdin exits 0 even when a statement failed.** `-c` reports a SQL error in its exit status; a heredoc does not, unless `ON_ERROR_STOP=1` is set. `ezfd-admin.sh`'s restore had drifted away from that, so a restore that died on a constraint violation printed "Restore complete" and rendered the error text through the results table. `PGS()` is the wrapper that sets it — use it for anything whose failure must not be reported as success, and note that a grep for `PGS` *somewhere* in the file is not a test when there are two such call sites (that is why the guard looks for a lax `PG -v payload=` instead).
- **Bash `set -e` breaks interactive menus** — `ezfd-admin.sh` uses `set -uo pipefail` only, no `-e`. Any new interactive bash needs the same. Use `[[ ]]` comparisons, not `(( ))` (returns exit 1 on false, triggers `-e`-style failures). Always `local var=""`, never bare `local var`, to avoid unbound-variable errors under `set -u`.
- **`deploy.sh`'s rsync of `.next/standalone/` must keep `--exclude='.env'`** — without it, `rsync --delete` wipes the live secrets file on every redeploy.
- **`public/ezfd-rig-bridge.py` is a manual duplicate** of the root `ezfd-rig-bridge.py`, served for direct browser download. They are NOT symlinked — always `cp` the root file over the public copy after editing the bridge script. CI's `shell` job fails if the two drift.
- **`EZFD_REPO_DIR`** (in `/opt/ezfd/.env`, written by `deploy.sh`) tells `ezfd-admin.sh`'s "Update application" action where to `git pull` from.
- **N1MM call history files are contest-year-specific**, unlike `MASTER.SCP` (evergreen). `lib/callHistory.ts` builds the download URL from `event_type`+`event_year` against N1MM's `{fd|wfd}_{year}-LAST.txt` slug and falls back to the prior year if that year's file isn't published yet — override with `EZFD_FD_CALL_HISTORY_URL`/`EZFD_WFD_CALL_HISTORY_URL` (supports a `{year}` placeholder) if N1MM changes their URL scheme. The FD/WFD file's `Exch1` column is the station's **sent class** (e.g. `3A`), not a generic exchange field — mapped to `sent_class` and used to prefill Rcvd Class, alongside `Sect` → Rcvd Section. `MASTER.SCP` header/comment lines start with `!` or `#` (not `;`). Both downloads are best-effort at event creation — a failed fetch must never block event creation, only degrade the prefill/lookup feature (each fetch carries an `AbortSignal.timeout`, since the create request awaits them).
- **`events.class` and `events.arrl_section` are nullable** — they are NULL for every `event_type='SES'` row (a special event station has no contest exchange). Anything reading them needs a null guard; `lib/cabrillo.ts`, `lib/adif.ts`, `components/SummarySheet.tsx` and the QSO insert paths already have one. Cabrillo export is refused outright for SES.
- **Band/mode checkout serves contests too, and `station_number` is the holder — never an exclusivity term.** `ses_reservations.station_number` is NULL on a special event (the operator holds the slot) and set on a contest (station 2 holds 20m phone regardless of who is sitting at it). It is deliberately *not* in `ses_no_overlap`: adding it would let the database accept station 1 and station 2 both holding 20m PH at once, which ARRL Field Day forbids exactly as special event rules do — one transmitted signal per band and mode. Same mistake as narrowing the slot to a frequency. Claiming is opt-in on a contest, so `checkSlot`'s `requireClaim` is false there and an unclaimed band produces no warning; enforcement also stays `SOFT`, because refusing a contact that already happened on the air is worse than a warning.
- **SES checkout granularity is (band, mode) and must not be narrowed to frequency.** Special event rules generally allow one signal per band per mode, so frequency-level slots would let the database permit something the rules forbid. `ses_reservations.planned_freq` is free text for humans and deliberately carries no exclusivity.
- **SES call checkout is enforced by a database constraint, not application code.** `ses_reservations` carries `EXCLUDE USING gist (event_id WITH =, band WITH =, mode WITH =, during WITH &&) WHERE (status <> 'RELEASED')`, which needs the `btree_gist` extension for the `=` comparisons. Never replace it with a SELECT-then-INSERT check: two operators claiming the same slot in the same instant is exactly the case it exists to prevent. A collision arrives as SQLSTATE **`23P01`** and the routes translate it to a 409 naming the holder. Releasing a slot clamps the range with `GREATEST(lower(during), NOW())` — clamping to `NOW()` alone inverts the range when a not-yet-started slot is cancelled.
- **QSOs are stamped by the server (`NOW()` in the insert), and that stays true.** Multi-operator logs need one clock; trusting each browser trades a visible problem for an invisible one where operators disagree with each other. The failure mode it does have is a field server with no RTC and no NTP, which stamps every contact with a plausible-looking wrong time. `GET /api/time` reports the app *and* database clocks (they can be different hosts) so `lib/useClockSkew.ts` can compare against the browser and `ClockSkewBanner` can say so; `ezfd-admin.sh` → **Server time / clock** sets it. Halve the round trip when comparing, or a slow link reads as skew. Setting the clock does **not** rewrite QSOs already logged.
- **Offline-queue replays must never be rejected.** `POST /api/qso` takes a `replay: true` flag that bypasses the SES band/mode gate unconditionally, and `LoggingClient`'s `flushQueue` sets it. By reconnect time the slot has always expired; a contact that already happened on the air must not be dropped because the network blipped. For the same reason `flushQueue` only dequeues once `result.qso` is present — checking the wrapper object instead silently discarded QSOs whenever a submit failed.
- **`navigator.onLine` is not a signal that the *server* is reachable.** It tracks this machine's link, which stays up across a server restart, an nginx reload or a 502 — so the online-transition effect that drains the offline queue never fires in exactly the outage operators actually hit in the field. `LoggingClient` therefore drains on two further signals: the SSE `onopen` that follows an `onerror` (the earliest evidence the server is back, ~2s), and a self-rescheduling retry timer backing off 5s→10s→20s→40s→60s. The backoff is not decoration: a queued contact that can never be accepted — the event was deleted — would otherwise retry at a fixed interval for as long as the tab stays open, so `flushQueue` reports whether it dequeued anything and only progress resets the delay. Both signals reach it through a ref, never a dependency, for the auto-CQ reason below.
- **Every window that logs goes through `lib/useQsoQueue.ts`.** The CW popout is a second document logging the same event, and it used to POST straight to `/api/qso` with no local copy — so a server outage during a run *destroyed* contacts rather than delaying them: the fetch failed, `QSOForm` cleared the fields anyway (it resets unconditionally after `onSubmit`, having no idea whether the submit worked), and nothing anywhere remembered them. The queue, the drain, the online-transition effect and the retry timer live in that one hook; a component adds a logging surface by calling it, never by writing a second copy. Each window still owns its own `EventSource` and calls `noteReconnect()` from `onopen`, since the two documents hold separate connections. `scripts/wsjtx-bridge.cjs` is a separate process and can't use the hook, so it carries the same idea on disk: a contact the server didn't take goes to a JSONL spool under `~/.ezfd/` (override with `--spool`/`EZFD_SPOOL`) and is retried with a backoff, and an existing spool is adopted on the next start. It drops a contact only on a **4xx** — the server refusing on purpose, which retrying never fixes — and those stay in WSJT-X's own `wsjtx_log.adi` for a manual ADIF import. Replays go up with `replay: true` like the browser's, so the expired SES slot can't refuse them.
- **Presence and SES claims are keyed per *radio*, not per person.** One operator running two rigs is one callsign in two logging windows, each on its own band — a real special event pattern the reservation model always allowed. `presence` is `PRIMARY KEY (event_id, op_call, station)`; keyed on the operator alone the second window overwrote the first's row, so the band panel could only show one rig, and the QRT `DELETE` cleared both. SES claims record `station_number` too (contest claims already did, from #21) — not to change who *holds* the call, which is still the operator, but so two windows can be told apart: with it NULL both windows matched the same reservation, and leaving the shared 20m/PH default in one window released the slot the other was transmitting on. `describeHolder(holder, isSes)` therefore still names an SES holder by callsign and a contest holder as `Station N`. A second radio is a second window at `?station=N`, and each needs its own bridge process — `rigPortForStation()` maps station N to port 4574+N so they don't fight over one WebSocket.
- **`json_agg` over zero rows serialises as JSON `null`, a scalar — not SQL NULL.** `COALESCE(ev->'qsos','[]'::jsonb)` therefore does *not* catch it, and `jsonb_array_elements` then fails with "cannot extract elements from a scalar". `ezfd-admin.sh`'s restore guards every list with `jsonb_typeof(...) = 'array'` instead. This bit the QSO loop too: restoring an event with no QSOs used to error out.
- **QSOs are soft-deleted, and every read path must filter `deleted_at IS NULL`.** `DELETE /api/qso/{id}` marks the row rather than removing it, so the log can answer "what happened to that contact?" — there is no authentication here, anyone with the join code can delete anything, and a hard delete left a missing QSO indistinguishable from one never logged. Missing the filter on one read path is how a deleted contact reappears in a submission: the ADIF and Cabrillo exports, scoring, the dupe rule, the ADIF-import idempotency window, the logger/CW/dashboard page queries and every `ezfd-admin.sh` count all carry it. The **full-event backup deliberately does not** — an audit trail a backup drops is not one. `POST /api/qso/{id}` restores. A soft delete reaches other windows as an SSE **`UPDATE`**, not a `DELETE`, so list updates go through `applyQsoEvent` in `lib/qsoStream.ts` rather than each component branching on `op` — otherwise a deleted contact stays on screen for everyone except whoever deleted it.
- **Event export/restore lives in `db/schema.sql` as `ezfd_export_events()` and `ezfd_restore_events()`** — called by `ezfd-admin.sh`, `GET /api/export/{code}?format=json`, `POST /api/import/event` and the tests. It used to be SQL embedded in the shell script, copied three times: the `--json` mode listed explicit columns and carried the SES tables, the interactive **Full JSON backup** used `SELECT e.*` and carried neither, and `test-restore.sh` had a third variant — so the test round-tripped a shape the menu action never produced and stayed green while that action silently dropped the roster. Never add a fourth copy. The export omits `qrz_username`/`qrz_password`/`qrz_session_key` **by construction**: the password is encrypted with a key the backup doesn't contain, and the export is reachable over HTTP with only a join code.
- **An event's identity is `COALESCE(origin_event_id, id)`, and merging is not restoring.** Restoring an export creates a new event with a new id and join code, which is right until the two rows are the same weekend running in two places — a field server at the site and the hosted instance — and both hold real contacts. `ezfd_merge_event()` reconciles those into one log and refuses an export it cannot prove is the same activation. The identity needed no backfill: an event with a NULL `origin_event_id` is its own origin, and an export taken before the column existed still carries its `id`, which is that same value. Four things the merge deliberately will not decide, each because deciding silently is the failure mode this codebase keeps hitting: a contact edited on both sides is **reported, never resolved** (last-write-wins is *available* now that `qsos` has `updated_at`, and overwriting one operator's correction with another's leaves the loser nothing to notice); event settings that differ are reported and the target's kept; a contact deleted here is **not resurrected** by a copy that still has it live — the opposite of the ADIF import, which treats a deletion as absent on purpose because importing a chosen file is a deliberate act while a merge is bulk and automatic; and incoming checkout history is filed as `RELEASED`, since two instances can each legitimately have held 20m PH at once and the exclusion constraint only ever guaranteed that within one database. **`ezfd_recompute_dupes()` after any merge is not optional** — each instance computed `is_dupe` against a different subset, so both are wrong for the union, and it is the step the issue itself predicted would be forgotten. The ±2 minute window is `MERGE_WINDOW_SECONDS` in `lib/events.ts`, read by the ADIF import and passed into the SQL function, never a second copy; `scripts/test-merge.cjs` fails if the function's default drifts from it.
- **`ezfd-admin.sh`'s backup and restore must carry `ses_operators` and `ses_reservations`.** The roster holds each operator's grid/state, which is the only source for the ADIF `MY_*` fields — dropping it makes a restored special event log silently unuploadable. Reservations are stored as a `tstzrange`, which doesn't survive a JSON round-trip, so the backup decomposes it into `starts_at`/`ends_at` and the restore rebuilds it. Restore uses `NULLIF(...,'')` for `class`/`arrl_section`, never `COALESCE(...,'')`, so an SES comes back with NULL rather than an empty string.
- **ADIF `MY_*` fields come from `ses_operators`, per QSO — not from `events.location`.** A distributed SES has one location per operator, and LoTW signs by station callsign *and* location. `STATION_CALLSIGN` is the event call, `OPERATOR` is the individual. Sourcing the location from the event would stamp every operator's contacts with the same wrong location.
- **`qsos.mode` keeps its `CHECK (mode IN ('PH','CW','DIG'))`** — scoring, dupe detection and the band/mode UI all rely on that three-way split. The real submode (FT8, RTTY, …) goes in the separate nullable `adif_mode` column, which ADIF export prefers when present. Don't widen the CHECK.
- **The app's DB role (`ezfd`) is granted DML only, not table ownership** — `db/schema.sql` is applied as the `postgres` superuser by both `deploy.sh` and `ezfd-admin.sh`, so `postgres` owns every table. `TRUNCATE` needs ownership and fails with "permission denied" at runtime; use `DELETE FROM` for bulk clears (`lib/masterCallsigns.ts` refreshes the whole list this way, inside a transaction so a mid-import failure can't leave a partial list carrying a fresh `updated_at`).

## Rig control / CW keying (`ezfd-rig-bridge.py`, `lib/useRigBridge.ts`)

**The Python bridge is the default transport and is not going away.** `lib/useSerialRig.ts`
adds a browser-native read path over Web Serial (#65), which is Chromium-only,
needs a secure context — so it is unavailable on the plain-HTTP field servers
this app supports — and speaks only the Kenwood/Elecraft dialect. It does
nothing at all until an operator picks a port by hand, so any setup that does
not use it behaves exactly as it did. Removing the bridge is not on the table.

- **A Kenwood `MD` value above 9 arrives as a letter.** Hamlib reads it as
  `modebuf[offs] - 'A' + 10`, so `MDA` is mode 10 (PSK). Parsing that field as
  "a digit" — the obvious reading of one character — turns every data mode on a
  newer rig into a decode failure, and the symptom is the mode quietly ceasing
  to update rather than an error.
- **Poll `FR` before reading the frequency.** `FA` is VFO A specifically, so
  reading it unconditionally reports the wrong frequency whenever the operator
  is on VFO B or working split. A wrong frequency picks a wrong band, and the
  band is what the contact is logged and scored on — a plausible-looking number
  with nothing on screen to say it is wrong.
- **`lib/catProtocol.ts`'s tables are transcribed, not invented.** The mode
  table comes from Hamlib's `kenwood_mode_table`, and the band edges and mode
  classification from the bridge's own `BANDS` and `MODE_MAP`.
  `scripts/test-cat-protocol.cjs` reads those back out of `ezfd-rig-bridge.py`
  and fails if the two drift: an operator must not see a different band or mode
  depending on which transport they happened to connect with.

A local Python script bridges Hamlib `rigctld` ↔ WebSocket (`ws://localhost:4575`) ↔ browser. Runs entirely on the operator's machine; the EzFD server is never involved. `lib/useRigBridge.ts` is a shared hook used independently by both `LoggingClient` (main tab) and `CwLoggingClient` (CW popout) — each opens its own WS connection.

Hard-won fixes worth knowing before touching this code:

- **No VFO argument on `\send_morse`/`\stop_morse`** unless rigctld was started with `--vfo` (this bridge never does). Passing one sends the literal word "VFO" as CW text (audibly confusable with "4FO").
- **`\dump_caps` (CW-support detection) is not a fast local-only command** — it exercises real CAT round-trips over the serial link and can take several seconds with irregular gaps. It runs on a **separate throwaway TCP connection** (`probe_cw_support()`), never the polling connection — otherwise misread bytes permanently desync every later `get_freq`/`get_mode` response by one field.
- **Serial connections default to `--set-conf=serial_handshake=None`** — virtual/software CAT ports (e.g. FlexRadio SmartCAT) commonly don't implement RTS/CTS hardware handshake, causing silent write failures otherwise. Safe default for real hardware too.
- **FlexRadio SmartCAT emulates Kenwood TS-2000 CAT**, not FlexRadio's native protocol — use Hamlib model `2014`, not the FlexRadio-specific models (which are TCP-only and can't open a COM port at all).
- **All rigctld I/O is guarded by one `asyncio.Lock`** — polling (`get_freq`/`get_mode`) and CW commands share a single connection and must not interleave.

- **Chrome is one list, not one per breakpoint.** Everything an operator can *do* comes from `lib/nav.ts` and renders through `components/NavDrawer.tsx`; the header keeps only status. The logger used to hand-maintain two copies — a desktop header and a phone bar — and they drifted into contradictions nobody chose: the guides were reachable **only** below 640px, while `Import ADIF`, both exports and the second-radio window were reachable **only** at 768px and up. A `hidden sm:` is a layout decision and must never be the thing that decides whether a feature exists. `scripts/test-nav.cjs` fails if `lib/nav.ts` grows a width or device term, if a component grows its own copy of an item the menu already offers, or if an entry is added that no surface wires up — the last of which would render a menu row that silently does nothing. Filter on what the event and the hardware *are* (an SES has no Cabrillo, a rig that cannot key CW has no CW window, a visitor gets no files), never on the viewport.

- **Font sizes come from three tokens, and `.tap` is how a control gets thumb-sized.** `text-2xs` (11px), `text-xs` (13px) and `text-sm` (15px) are defined in `app/globals.css`; anything larger is a display number. The interface had grown thirteen distinct sizes, four of them within two pixels of each other below 12px, which is noise rather than hierarchy — `scripts/test-nav.cjs` fails on any arbitrary `text-[Npx]`, and on a token defined without its `--text-*--line-height` (Tailwind v4 ties each line height to its own size, so overriding the size alone leaves the old leading behind). Density is deliberate on a laptop and wrong on a phone, so `.tap` raises a control to 44px **only under `pointer: coarse`** rather than at a width breakpoint — the question is what the person is touching it with, not how wide their window is.
- **A phone scrolls the page; a desktop scrolls its panes.** The dashboard is a fixed two-pane shell on a desktop — `md:h-screen md:overflow-hidden`, each pane scrolling inside a document that does not. Stacking that same shape on a phone produced two peepholes and no page scroll at all: a 413px window onto the log, and under it a **194px** window onto 1170px of rate, score, bonuses, sections, operators and the join code, so reading the join code meant scrolling a box two lines tall. Below `md` the root is `min-h-screen` and the document scrolls, the header is `sticky top-0` so the view tabs stay reachable, and the sidebar has no scroll of its own. A content pane keeps an inner scroll only when its content is *unbounded* — the log, the operators table, the checkout board — because a thousand contacts at natural height is a 27,000px document on a handset; a bounded view like the section grid just renders. The map and the rate chart are the opposite case and need a definite box, having no intrinsic height. Nested scrolling inside a scrolling page is the thing to avoid, not scrolling itself.
- **Field Day coordinates a transmitter; a special event checks out a callsign.** Same table, same exclusion constraint, two different things to the person reading the screen. On an SES there is one call and many operators, often in different places, and checking it out for a (band, mode) window is what stops two of them signing it at once. On FD and WFD nothing about the call is in question — every station sends it all weekend — and what rule 6.9 forbids is two transmitted signals on one band and mode; the holder is the *transmitter*. The logging panel shipped the SES wording to both, so a Field Day operator opened a panel headed **Call Checkout** that told them "Nobody has the call checked out" about a callsign nobody was competing for, two steps after a position picker that had the contest wording right. Every user-visible string for this now comes from `lib/slotWords.ts` — never an inline `isSes ? … : …` in a component, which is exactly how the two drifted. `scripts/test-slot-board.cjs` fails if a contest string acquires "call", "checkout" or "checked out"; `scripts/test-nav.cjs` fails if a surface writes one of these strings itself instead of reading the table. Claiming stays **opt-in on a contest** and the empty-state line is deliberately `null` there: an unclaimed band is the normal case, and the presence-driven Operators panel already answers "is anyone on 20m phone" with no discipline required.
- **A panel that lists people needs a bound.** The logging screen's Operators list grew with the roster: ten operators signed in made it 368px and pushed the whole side panel 143px off the bottom of a 900px screen, which is the scrollbar that pane is shaped to avoid. It is capped at five rows with its own scroll, and the operator running the window sorts first so the row that matters is always in view. Any list fed by presence, a roster or a claim history has the same failure waiting in it — size it for the club, not for the fixture.

## React gotchas from this project

- **`react-hooks/set-state-in-effect` cannot see through an async boundary.** It flags `useEffect(() => { load(); })` where `load` is async exactly as it flags a synchronous `setState`, even though the state update happens in a promise continuation and cannot cascade. Those sites carry a per-site disable with that reasoning; a *synchronous* setState in an effect is a real finding and should be fixed, not disabled.
- **Browser-only values belong in `useSyncExternalStore`, not in an effect.** `lib/useLightMode.ts`, `lib/useOnline.ts` and `lib/useStoredFlag.ts` exist because reading the theme class, `navigator.onLine` or a `localStorage` preference in an effect renders the wrong value once and then corrects it — a visible flicker. `useStoredFlag` also syncs across documents, which matters because the CW keying window is a separate `window.open`.
- **Don't read the clock during render.** `lib/useNow.ts` returns a ticking timestamp from state. Beyond the purity rule, `Date.now()` in render means "is this slot active" only updates when something *else* re-renders the component, so an expired checkout could sit on screen looking live.

- **Inline arrow-function props recreate identity every render.** If a parent re-renders often (e.g. every rig frequency tick, ~4/sec) and passes `foo={() => ...}` to a child whose `useCallback`/`useEffect` depends on it, that effect keeps re-firing — this once prevented an auto-CQ timer from ever completing its interval. Fix: memoize with `useCallback(..., [])` in the parent, and/or read the latest value via a ref inside long-lived timers instead of depending on the function directly.
- **`QSOForm` exposes an imperative handle** (`QSOFormHandle` via `forwardRef`/`useImperativeHandle`) for reading live field values without lifting state — used by `CwMacroPanel` for `{call}`/`{exch}` macro placeholder expansion.

## Key files

| File | Purpose |
|---|---|
| `components/LoggingClient.tsx` | Main logging tab |
| `components/CwLoggingClient.tsx` | CW keying popout (separate window, `window.open`) |
| `components/QSOForm.tsx` | Shared entry form — ESM nav, Tab loop, used by both windows |
| `components/CwMacroPanel.tsx` | F1–F12 macros, Run/S&P modes, ESM, auto-CQ |
| `components/BandActivity.tsx` | Presence/conflict panel — QRT, QSY occupancy |
| `lib/useRigBridge.ts` | Shared rig WebSocket hook |
| `lib/useSerialRig.ts` | Browser-native CAT over Web Serial — read path, additive to the bridge |
| `lib/catProtocol.ts` | Kenwood/Elecraft CAT decoding, transcribed from Hamlib and the bridge |
| `lib/useQsoQueue.ts` | Offline QSO queue — enqueue/submit, drain, retry; used by both logging windows |
| `components/SlotCoordination.tsx` | The logging screen's slot panel — claim/extend/release a band+mode |
| `lib/slotWords.ts` | The two vocabularies — call checkout on an SES, band coordination on a contest |
| `lib/ses.ts` | SES slot queries, `23P01` constant, UTC slot-time formatting |
| `lib/events.ts` | Shared event SELECT column list + configurable dupe rule |
| `lib/scoring.ts` | ARRL scoring formula (FD/WFD only — SES has no score) |
| `lib/bonuses.ts` | The bonus schedule — one table, read by the scorer, the tracker and the summary sheet |
| `components/LogView.tsx` | Dashboard log — filtering, column choice, arrival highlight |
| `lib/logFilters.ts` | Log filtering, pure over an already-loaded array |
| `lib/nav.ts` | The menu — one table, read by the logger and the dashboard alike |
| `components/NavDrawer.tsx` | The hamburger and its slide-out panel |
| `lib/opStats.ts` | Per-operator figures — the one derivation, read by the dashboard tab and the sidebar panel |
| `components/OperatorStats.tsx` | The dashboard's Operators view |
| `lib/logColumns.ts` | The log column table and per-event-type defaults |
| `components/OperatingPosition.tsx` | Sign-in step two — pick a band/mode, optionally check it out |
| `lib/slotBoard.ts` | What each band/mode is doing, from claims plus presence |
| `lib/lastPosition.ts` | What the picker preselects — the remembered position and the claim that outranks it |
| `lib/bands.ts` | Which bands an event offers — WARC excluded for contests |
| `lib/callHistory.ts` | N1MM call history file download/parse, per-event prefill lookup |
| `lib/masterCallsigns.ts` | `MASTER.SCP` (Super Check Partial) download/parse, shared known-callsign lookup |
| `ezfd-admin.sh` | Interactive server admin console |
| `deploy.sh` | VPS deploy/update script |
| `ezfd-rig-bridge.py` | Local rig control bridge (keep `public/` copy in sync) |
