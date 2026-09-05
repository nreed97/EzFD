# Development

## Local setup

Requirements: Node 22+, PostgreSQL 16.

```bash
$ git clone https://github.com/nreed97/EzFD.git
$ cd EzFD
$ npm install

$ createdb ezfd
$ psql -d ezfd -f db/schema.sql

$ cat > .env.local <<'EOF'
DATABASE_URL=postgres://localhost:5432/ezfd
EZFD_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
EOF

$ npm run dev
```

The encryption key above is fine locally; generate a real one with
`openssl rand -hex 32` for anything else.

`db/schema.sql` is idempotent, so re-applying it after a schema change is the
normal workflow rather than a migration step.

## Before finishing a change

```bash
$ npx tsc --noEmit
$ npm run build
```

Both must be clean. This is the gate `AGENTS.md` sets and CI enforces.

## Tests

Fifteen suites, all run by CI. They come in two kinds, and the split is worth
knowing when you are deciding what to run before a commit.

**Eleven need nothing at all** — no database, no build, no server. They cover
pure functions, so they run in about a second and are the ones to reach for
first:

```bash
$ node scripts/test-sections.cjs        # the ARRL/RAC section list, in all three places
$ node scripts/test-scoring.cjs         # the ARRL formula, bonuses and their caps
$ node scripts/test-gota.cjs            # GOTA counts twice, and its count comes from the log
$ node scripts/test-preflight.cjs       # the pre-submission read, and rule 7.3's class column
$ node scripts/test-adif.cjs            # ADIF parse and export
$ node scripts/test-cabrillo.cjs        # Cabrillo submission
$ node scripts/test-log-filters.cjs     # the dashboard log view
$ node scripts/test-slot-board.cjs      # the operating position board
$ node scripts/test-last-position.cjs   # what the position picker preselects
$ node scripts/test-changelog-links.cjs # the changelog's links into these guides
$ node scripts/test-docs-nav.cjs        # the /docs sidebar and its reading order
```

**Four need a database, or a running server:**

```bash
# The SES overlap guarantee lives in a database constraint,
# so it's asserted against a real database
$ psql -d ezfd -v ON_ERROR_STOP=1 -f db/test-ses-constraint.sql

# Route SQL is built as strings, which the typechecker can't see into
$ DATABASE_URL=postgres://localhost/ezfd node scripts/test-queries.cjs

# ezfd-admin.sh backup/restore, round-tripped for SES, FD and empty events
$ PSQL="psql -h localhost -U postgres" bash scripts/test-restore.sh

# The API end to end, against a running server
$ BASE_URL=http://localhost:3000 bash scripts/test-e2e.sh
```

### What each is for

**`db/test-ses-constraint.sql`** asserts rather than prints, so a broken
constraint fails the build instead of scrolling past. Covers overlap
rejection, same-band-different-mode, extension into the next holder, early
release, and cancelling a not-yet-started slot.

**`scripts/test-queries.cjs`** exercises route SQL through the real `pg`
driver. These queries are assembled as strings, so an interval cast that only
works with a text parameter, or a range bound that returns a `Date` rather
than a string, fails at runtime and nowhere earlier.

**`scripts/test-restore.sh`** round-trips the admin console's backup and
restore. Export and restore are `ezfd_export_events()` and
`ezfd_restore_events()` in `db/schema.sql`, so the test exercises the shipped
definitions rather than a copy — the same ones the HTTP API and the console
call. It used to carry its own third variant of the backup query, and so
round-tripped a shape the console's menu action never produced, staying green
while that action silently dropped the SES roster.

It also greps `ezfd-admin.sh` for three things a round trip cannot see,
because each of them failed *silently*:

| Guard | Catches |
|---|---|
| No `SELECT e.*` | A hand-rolled export that leaks the encrypted QRZ credentials, as two of the four earlier copies did |
| No lax `PG -v payload=` | A payload call without `ON_ERROR_STOP`, which makes a failed restore exit `0` and report success |
| No `IFS='\|' read` | A row reader splitting on a pipe, which a club name containing one silently shifts out of alignment |

The middle one is worth a note on how to write this kind of guard. The first
version checked that `PGS` appeared *somewhere* in the file — and passed even
with the restore call reverted, because the count above it also uses `PGS` and
satisfied the grep on its own. A guard over a file with two call sites has to
assert the absence of the bad form, not the presence of the good one.

**`scripts/test-e2e.sh`** drives the API against a running server: checkout
conflicts, both enforcement modes, the offline replay bypass, roster approval,
per-operator ADIF, and Field Day regressions.

**`scripts/test-docs-nav.cjs`** covers the `/docs` sidebar, which is built by
reading the groups and their order back out of `docs/README.md` rather than
declaring them a second time. That keeps the index and the sidebar from
drifting, at the cost of one failure the old alphabetical list could not have:
a guide can fall out of the navigation altogether — a mistyped index row, a
reformatted table — and still exist, still be reachable by URL, and be
invisible in the app. The test asserts every guide appears exactly once.

**`scripts/test-changelog-links.cjs`** checks that every guide the changelog
points at exists and that every `#anchor` lands on a real heading. A renamed
section leaves the link resolving to the top of the page, which looks fine in
a diff and wastes the reader's time; nothing else in the repository would
notice. It reproduces the slug rules in `lib/docs.ts` so the anchors are
checked the way both GitHub and `/docs` will resolve them.

### Writing a test

**Check it can fail.** Break the thing it guards, watch it go red, put it
back. This isn't ceremony — doing it is what revealed that re-applying
`schema.sql` couldn't restore the overlap constraint, because `CREATE TABLE
IF NOT EXISTS` skips the whole statement including its inline constraints.

A test that has never been observed failing is a test you don't know works.

## CI

`.github/workflows/ci.yml`, three jobs:

| Job | Runs |
|---|---|
| `build` | The eleven pure suites, then lint, typecheck and build, then the end-to-end suite against the built server |
| `schema` | Schema applied twice for idempotency, then the constraint, query and restore suites |
| `shell` | `bash -n` on every tracked `.sh`, the rig-bridge copy check, then `shellcheck` |

**Everything is gated.** Lint and `shellcheck` were advisory for a while, held
back by a backlog of pre-existing findings that would have failed every pull
request. That backlog is cleared and both are enforced, so anything either one
reports now is something the change introduced.

The pure suites run first in `build` because they need no database and no
compile: a drifted section list or a broken scorer fails in seconds rather
than after the build and a server start.

## Conventions

`AGENTS.md` in the repository root is the authority and is worth reading
before changing anything non-obvious. The highlights:

**Next.js 16 App Router**, standalone output. Route handlers take
`params: Promise<...>` — await them.

**Tailwind v4**, dark by default. Light-mode styles use the `light:` prefix,
which is the opposite of the usual convention.

**Bash scripts use `set -uo pipefail` without `-e`.** `-e` terminates
interactive menus on the first non-zero return. Use `[[ ]]` rather than
`(( ))` for comparisons — `(( ))` returns exit 1 on a false result, which
under `-e`-style handling reads as failure. Always `local var=""`, never bare
`local var`, to avoid unbound-variable errors under `set -u`.

**`public/ezfd-rig-bridge.py` is a manual copy** of the root script, served
for direct download. They are not symlinked; copy the root file over the
public one after editing.

## Where things live

See [Architecture](architecture.md#layout) for the layout and the shared
modules in `lib/`.

## Gotchas that have cost real time

The full list is in `AGENTS.md`. The ones most likely to catch you:

- `pg` returns `TIMESTAMPTZ` as `Date` objects, not strings
- Sections do not multiply the Field Day score
- Inline arrow-function props retrigger child effects on every parent render,
  and the logging screen re-renders four times a second under rig control
- `json_agg` over zero rows is JSON `null`, a scalar, which `COALESCE` misses
- The SES checkout constraint must stay at band+mode granularity
