<!--
This template exists for agents (and humans) working on EzFD. Fill in every
section — delete a section only if it truly does not apply, and say why.
Do not delete the checklists.
-->

## Summary

<!-- 1-3 sentences: what changed and why. Link the issue/task if one exists. -->

## Root cause / motivation

<!--
For a bug fix: what was actually wrong, not just the symptom. AGENTS.md's
"Critical gotchas" section exists because past fixes patched symptoms first —
name the root cause here.
For a feature: what gap this closes.
-->

## Changes

<!-- Bullet list of the actual changes. Call out any file touched for a
     reason that isn't obvious from its name (e.g. "public/ezfd-rig-bridge.py
     synced from the root copy"). -->

-

## Area(s) touched

<!-- Check everything that applies — each one maps to a required check below. -->

- [ ] Frontend / React components (`components/`, `lib/useRigBridge.ts`)
- [ ] API routes (`app/api/**`)
- [ ] Database schema (`db/schema.sql`)
- [ ] SES routes/logic (checkout, reservations, `lib/ses.ts`)
- [ ] Scoring (`lib/scoring.ts`)
- [ ] ADIF / Cabrillo export (`lib/adif.ts`, `lib/cabrillo.ts`)
- [ ] Rig control / CW keying (`ezfd-rig-bridge.py`, `lib/useRigBridge.ts`)
- [ ] `ezfd-admin.sh` (backup/restore, admin console)
- [ ] `deploy.sh`
- [ ] Docs only

## Verification

<!-- Required for every PR, per AGENTS.md and docs/development.md. -->

- [ ] `npx tsc --noEmit` is clean
- [ ] `npm run build` is clean
- [ ] `docs/changelog.md` has a line for this change — one sentence on what it
      accomplishes, labelled `[Scoring]`, `[Exports]` and/or `[Display]` if a
      claimed score, an exported file or the screen changes

<!--
Required only for the areas checked above — CI runs all of these on every
PR regardless, but running them locally first catches failures before push.
Delete a row only if its "Area(s) touched" box above is unchecked.
-->

- [ ] `db/test-ses-constraint.sql` — schema/SES changes (asserts against a real DB)
- [ ] `scripts/test-queries.cjs` — schema or route SQL changes (casts the typechecker can't see)
- [ ] `scripts/test-restore.sh` — schema or `ezfd-admin.sh` changes (backup/restore round trip)
- [ ] `scripts/test-e2e.sh` — API route changes (full API flow, incl. Field Day regressions)

For a UI/frontend change, describe how you exercised it in a real browser
(not just typecheck/build) — golden path and edge cases, and whether you
checked for regressions in adjacent features:

<!-- e.g. "Ran npm run dev, logged 3 QSOs on 2 bands, confirmed BandActivity
     panel updated via SSE in a second tab." -->

## New tests added

<!-- If you added a test, confirm you broke the thing it guards and watched
     it fail, per AGENTS.md. If no test was added, say why (e.g. "covered by
     existing e2e suite", "docs-only change"). -->

## Gotchas checked

<!--
Skim AGENTS.md's "Critical gotchas" section against this diff. Check any
that are relevant to what you touched, or note "N/A" for the section as a
whole if none apply. This is the single biggest source of regressions in
this repo — most of these gotchas exist because a past PR missed one.
-->

- [ ] `pg` returns `TIMESTAMPTZ` as JS `Date`, not a string — any new date-handling code (esp. ADIF/Cabrillo export) handles both shapes
- [ ] Scoring stays `QSO points × power multiplier + bonus points` — sections are never a multiplier
- [ ] New/edited bash uses `set -uo pipefail` (no `-e`), `[[ ]]` not `(( ))`, and `local var=""` not bare `local var`
- [ ] `deploy.sh` rsync of `.next/standalone/` still excludes `.env`
- [ ] If `ezfd-rig-bridge.py` changed, `public/ezfd-rig-bridge.py` was updated with the same content (not symlinked — manual `cp`)
- [ ] `events.class` / `events.arrl_section` nullability (NULL for SES) is respected by any new reader
- [ ] SES checkout stays scoped to (band, mode) — never narrowed to frequency, never replaced with a SELECT-then-INSERT check
- [ ] Offline-queue replay (`replay: true`) still bypasses the SES gate unconditionally, and nothing was added that could reject a replayed QSO
- [ ] Any new `jsonb_agg`/array-consuming SQL guards against a zero-row `null` scalar (`jsonb_typeof(...) = 'array'`), not `COALESCE(...,'[]')`
- [ ] `ezfd-admin.sh` backup/restore still carries `ses_operators` and `ses_reservations` if either table's shape changed
- [ ] ADIF `MY_*` fields still come from `ses_operators` per QSO, never from `events.location`
- [ ] `qsos.mode` CHECK constraint (`PH`/`CW`/`DIG`) was not widened; new submodes go in `adif_mode`
- [ ] New bulk-clear SQL uses `DELETE FROM`, not `TRUNCATE` (the app DB role doesn't own the tables)
- [ ] N/A — none of the above apply to this change

## Screenshots / recordings

<!-- For UI changes. Delete this section for backend-only or docs-only PRs. -->

## Risk / rollout notes

<!-- Anything a reviewer or the deployer should know: migrations, required
     .env changes, whether this needs a coordinated deploy step, backward
     compatibility for in-flight events. "None" is a fine answer. -->
