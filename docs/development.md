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

Four suites, all runnable locally against any database with the schema
applied, all run by CI.

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
restore. It extracts the restore SQL from `ezfd-admin.sh` rather than copying
it, so the test can't drift from the code it covers. It substitutes only the
`pg_read_file()` call, which reads the *server's* filesystem — right in
production, impossible against a containerised CI database.

**`scripts/test-e2e.sh`** drives the API against a running server: checkout
conflicts, both enforcement modes, the offline replay bypass, roster approval,
per-operator ADIF, and Field Day regressions.

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
| `build` | Typecheck, build, then the end-to-end suite against the built server |
| `schema` | Schema applied twice for idempotency, then the constraint, query and restore suites |
| `shell` | `bash -n` on every tracked `.sh`; `shellcheck` advisory |

Lint and `shellcheck` are deliberately not gated — both report pre-existing
findings that would fail every PR. Tracked as an issue; the jobs are wired so
enabling them is a one-line change once the backlogs clear.

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
