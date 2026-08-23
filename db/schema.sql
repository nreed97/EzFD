-- EzFD Field Day Logger — PostgreSQL schema
-- Run once on a fresh database (docker-entrypoint-initdb.d auto-runs this on first start)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code            TEXT        UNIQUE NOT NULL,
  club_name            TEXT        NOT NULL,
  club_call            TEXT        NOT NULL,
  event_year           INTEGER     NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  class                TEXT        NOT NULL,        -- e.g. "3A", "2A", "1D"
  arrl_section         TEXT        NOT NULL,        -- e.g. "EPA"
  location             TEXT,
  qrz_username         TEXT,
  qrz_password         TEXT,                        -- stored plaintext for now; restrict DB access instead
  qrz_session_key      TEXT,
  qrz_session_expires  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- QSOs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qsos (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  callsign       TEXT        NOT NULL,
  band           TEXT        NOT NULL,
  mode           TEXT        NOT NULL CHECK (mode IN ('PH', 'CW', 'DIG')),
  datetime_utc   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_class     TEXT,
  sent_section   TEXT,
  rcvd_class     TEXT,
  rcvd_section   TEXT,
  operator_call  TEXT,
  station_number INTEGER     NOT NULL DEFAULT 1,
  is_dupe        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit trail. There is no authentication here — operator identity is a
-- callsign typed at join time, and anyone with the join code can edit or
-- delete any QSO. That is a deliberate trade for a club event, but it left
-- the log unable to answer "what happened to that contact?": a QSO in one
-- operator's paper backup and not in the log could have been deleted or never
-- logged, and there was no way to tell.
--
-- updated_by/deleted_by record who *claimed* to be editing, not a verified
-- identity. Useful; not evidence.
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS qsos_event_idx      ON qsos(event_id);
CREATE INDEX IF NOT EXISTS qsos_dupe_idx       ON qsos(event_id, callsign, band, mode);
CREATE INDEX IF NOT EXISTS qsos_datetime_idx   ON qsos(event_id, datetime_utc DESC);
-- Every read path filters deleted_at IS NULL, so the common case gets its own
-- partial index rather than filtering the full table each time.
CREATE INDEX IF NOT EXISTS qsos_live_idx       ON qsos(event_id, datetime_utc DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Presence  (band/mode per operator — TTL-based, cleaned up on read)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presence (
  event_id    UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  op_call     TEXT        NOT NULL,
  station     INTEGER     NOT NULL DEFAULT 1,
  band        TEXT        NOT NULL,
  mode        TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, op_call)
);

-- ---------------------------------------------------------------------------
-- pg_notify trigger — fires on every QSO INSERT or DELETE
-- Clients LISTEN on channel  "qsos_<event_id>"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_qso_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec    RECORD;
  chan   TEXT;
BEGIN
  rec  := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  chan := 'qsos_' || rec.event_id::text;
  PERFORM pg_notify(chan, json_build_object('op', TG_OP, 'record', row_to_json(rec))::text);
  RETURN rec;
END;
$$;

DROP TRIGGER IF EXISTS qso_notify ON qsos;
CREATE TRIGGER qso_notify
  AFTER INSERT OR UPDATE OR DELETE ON qsos
  FOR EACH ROW EXECUTE FUNCTION notify_qso_change();

-- ---------------------------------------------------------------------------
-- Grants — schema is applied as postgres superuser so tables are owned by
-- postgres. The ezfd app user needs explicit access.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ezfd') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON events, qsos, presence TO ezfd;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ezfd;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Migrations (idempotent — safe to re-run on existing installs)
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN IF NOT EXISTS bonuses    JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type TEXT  NOT NULL DEFAULT 'FD';
ALTER TABLE events ADD COLUMN IF NOT EXISTS power      TEXT  NOT NULL DEFAULT 'HIGH';
ALTER TABLE events ADD COLUMN IF NOT EXISTS use_call_history         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS use_master_callsign_file BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Call history — N1MM-format station exchange history, imported per-event
-- from the ARRL FD/WFD call history file (contest- and year-specific).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_history_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  callsign    TEXT NOT NULL,
  sent_class  TEXT,        -- FD/WFD "Exch1" column — the station's typical class (e.g. "3A")
  section     TEXT,
  name        TEXT,
  user_text   TEXT,
  UNIQUE (event_id, callsign)
);

CREATE INDEX IF NOT EXISTS call_history_event_idx ON call_history_entries(event_id);
ALTER TABLE call_history_entries ADD COLUMN IF NOT EXISTS sent_class TEXT;

-- ---------------------------------------------------------------------------
-- Master callsign file (Super Check Partial / MASTER.SCP) — a single shared,
-- global list of known callsigns, refreshed periodically and reused by every
-- event that opts in (not contest-specific, so it isn't scoped to event_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master_callsigns (
  callsign   TEXT        PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ezfd') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON call_history_entries, master_callsigns TO ezfd;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Special Event Station (SES) support — event_type = 'SES'
--
-- An SES is a distributed activation: many operators, in many different
-- physical locations, all signing one callsign over a date range. That breaks
-- three assumptions FD/WFD baked in:
--   1. class/arrl_section are meaningless (there is no contest exchange),
--   2. there is one site (so one MY_GRIDSQUARE) — there are N,
--   3. two ops on the same band+mode is a soft warning — here it is two
--      stations transmitting as the same callsign at once.
-- ---------------------------------------------------------------------------

-- An SES has no contest exchange, so these can't stay NOT NULL. Every read
-- path that used to assume they're present now has to null-guard.
ALTER TABLE events ALTER COLUMN class        DROP NOT NULL;
ALTER TABLE events ALTER COLUMN arrl_section DROP NOT NULL;

-- SES runs over an arbitrary date range, not a fixed contest weekend.
ALTER TABLE events ADD COLUMN IF NOT EXISTS starts_at        TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ends_at          TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ses_description  TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ses_qsl_info     TEXT;
-- SOFT: log the QSO and warn.  HARD: refuse it (offline replays always bypass).
ALTER TABLE events ADD COLUMN IF NOT EXISTS slot_enforcement TEXT NOT NULL DEFAULT 'SOFT';
ALTER TABLE events ADD COLUMN IF NOT EXISTS slot_minutes     INTEGER NOT NULL DEFAULT 120;
-- EVENT: once per band/mode for the whole event (the FD rule).
-- DAY:   once per band/mode per UTC day (sane for a multi-week SES).
-- NONE:  never flag a dupe.
ALTER TABLE events ADD COLUMN IF NOT EXISTS dupe_rule        TEXT NOT NULL DEFAULT 'EVENT';
-- Opt-in. Off by default so an existing event's behaviour is unchanged: the
-- join code stays the only gate unless a coordinator asks for more. When on,
-- an operator joining lands in the roster as unapproved and cannot log until
-- someone approves them in ezfd-admin.sh.
ALTER TABLE events ADD COLUMN IF NOT EXISTS require_operator_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- SES operator roster — per-operator station identity.
--
-- LoTW signs by station callsign *and* location, so a distributed SES has to
-- carry each operator's own grid/state/county through to the ADIF MY_* fields.
-- Taking these from events.location (one site) would produce a log that
-- doesn't upload cleanly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ses_operators (
  event_id   UUID    NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  op_call    TEXT    NOT NULL,
  op_name    TEXT,
  grid       TEXT,
  state      TEXT,
  county     TEXT,
  dxcc       INTEGER,
  approved   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, op_call)
);

-- ---------------------------------------------------------------------------
-- SES call checkout — one holder per (band, mode) at a time.
--
-- The overlap rule is enforced by an exclusion constraint rather than an
-- app-level check-then-insert, which would race between two operators
-- claiming the same slot at the same moment. A collision surfaces as
-- SQLSTATE 23P01 (exclusion_violation) and the API maps it to a 409.
--
-- btree_gist is what allows the plain `=` comparisons on uuid/text to sit
-- alongside the `&&` range overlap test inside a single GiST index.
--
-- Granularity is deliberately (band, mode) and must stay that way: special
-- event rules generally permit one signal per band per mode, so a finer
-- frequency-level slot would let the database bless something the rules
-- forbid. Operators who want to note a planned frequency use planned_freq,
-- which is free text and intentionally carries no exclusivity.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS ses_reservations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  op_call    TEXT        NOT NULL,
  band       TEXT        NOT NULL,
  mode       TEXT        NOT NULL,
  during     TSTZRANGE   NOT NULL,
  planned_freq TEXT,
  note       TEXT,
  status     TEXT        NOT NULL DEFAULT 'RESERVED',   -- RESERVED | RELEASED
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ses_no_overlap EXCLUDE USING gist (
    event_id WITH =,
    band     WITH =,
    mode     WITH =,
    during   WITH &&
  ) WHERE (status <> 'RELEASED')
);

-- The constraint above is declared inline in CREATE TABLE, which Postgres
-- skips entirely once the table exists — so re-applying this file would not
-- restore the constraint if it were ever dropped, or if the table were
-- created by a partial earlier run. deploy.sh and ezfd-admin.sh both re-apply
-- schema.sql as the repair path, so it has to be able to heal this: without
-- the guard below, the one invariant the whole feature rests on could stay
-- silently missing while every migration reported success.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint
    WHERE conname = 'ses_no_overlap'
      AND conrelid = 'ses_reservations'::regclass
  ) THEN
    ALTER TABLE ses_reservations ADD CONSTRAINT ses_no_overlap EXCLUDE USING gist (
      event_id WITH =,
      band     WITH =,
      mode     WITH =,
      during   WITH &&
    ) WHERE (status <> 'RELEASED');
  END IF;
END
$$;

-- Band/mode coordination for contests as well as special events. Field Day
-- has the same one-signal-per-band-per-mode rule, and a 3A club running three
-- transmitters has exactly the problem this table already solves — so the
-- table is reused rather than duplicated.
--
-- The unit that *holds* a slot differs by event type. On a special event one
-- operator holds the callsign for a band and mode. On Field Day station 2
-- holds 20m phone regardless of who is sitting at it, and operators rotate
-- through stations across the weekend. station_number records that holder and
-- is NULL for special events.
--
-- The table keeps its ses_ name: renaming a shipped table costs a migration
-- for no functional gain.
ALTER TABLE ses_reservations ADD COLUMN IF NOT EXISTS station_number INTEGER;

-- station_number is deliberately NOT part of ses_no_overlap. Adding it would
-- let the database accept station 1 and station 2 both holding 20m PH at the
-- same moment, which both ARRL Field Day and special event rules forbid — one
-- transmitted signal per band and mode. That is the same mistake as narrowing
-- the slot to a frequency: it would let the database permit something the
-- rules don't. The exclusivity stays (event_id, band, mode, during); the
-- station is who holds it, not an extra dimension of it.

CREATE INDEX IF NOT EXISTS ses_res_event_idx ON ses_reservations(event_id, during);
CREATE INDEX IF NOT EXISTS ses_res_op_idx    ON ses_reservations(event_id, op_call);

-- ---------------------------------------------------------------------------
-- SES exchange fields on qsos. All nullable — FD/WFD ignore them entirely,
-- and ADIF export gets richer for every event type for free.
--
-- Note adif_mode is deliberately a *separate* column rather than widening the
-- qsos.mode CHECK: scoring, dupe detection and the band/mode UI all rely on
-- the three-way PH/CW/DIG split, while ADIF export needs to emit the real
-- submode (FT8, RTTY, PSK31...).
-- ---------------------------------------------------------------------------
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS rst_sent   TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS rst_rcvd   TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS rcvd_name  TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS rcvd_qth   TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS rcvd_grid  TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS comment    TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS adif_mode  TEXT;
ALTER TABLE qsos ADD COLUMN IF NOT EXISTS freq_khz   INTEGER;

-- ---------------------------------------------------------------------------
-- pg_notify trigger for reservations — clients LISTEN on "ses_<event_id>"
-- alongside the existing "qsos_<event_id>" channel, so the coordination grid
-- is live rather than polled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_ses_reservation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec  RECORD;
  chan TEXT;
BEGIN
  rec  := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  chan := 'ses_' || rec.event_id::text;
  PERFORM pg_notify(chan, json_build_object('op', TG_OP, 'record', row_to_json(rec))::text);
  RETURN rec;
END;
$$;

DROP TRIGGER IF EXISTS ses_reservation_notify ON ses_reservations;
CREATE TRIGGER ses_reservation_notify
  AFTER INSERT OR UPDATE OR DELETE ON ses_reservations
  FOR EACH ROW EXECUTE FUNCTION notify_ses_reservation_change();

-- ---------------------------------------------------------------------------
-- Grants — the ezfd role gets DML only; postgres owns the tables.
-- Without this every SES query fails with "permission denied" at runtime.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ezfd') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ses_operators, ses_reservations TO ezfd;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Event portability — export and restore, as functions rather than SQL
-- embedded in a shell script.
--
-- These exist because the query had been copied three times and all three
-- copies had drifted: ezfd-admin.sh's --json mode listed explicit columns and
-- carried the SES tables; its interactive "Full JSON backup" used SELECT e.*
-- and carried neither, making it silently lossy for special events (the exact
-- failure AGENTS.md warns about, since the roster is the only source for the
-- ADIF MY_* fields); and the restore test carried a third variant of its own,
-- so it round-tripped a shape the menu action never produced.
--
-- One definition, called by ezfd-admin.sh, the HTTP API and the tests, is the
-- only way those cannot diverge again. CREATE OR REPLACE keeps schema.sql
-- idempotent, which both deploy.sh and ezfd-admin.sh rely on.
-- ---------------------------------------------------------------------------

-- Every event, or one by id. The column list is explicit and deliberately
-- omits qrz_username, qrz_password and qrz_session_key: the password is
-- encrypted with a key that is not in the backup, so it would restore as
-- unusable ciphertext, and an export reachable over HTTP must not carry
-- credentials at all. Excluded by construction here rather than by each
-- caller remembering to.
CREATE OR REPLACE FUNCTION ezfd_export_events(p_event_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM (
    SELECT
      e.id, e.join_code, e.club_name, e.club_call, e.event_year,
      e.class, e.arrl_section, e.event_type, e.power, e.location,
      e.bonuses, e.created_at,
      e.starts_at, e.ends_at, e.ses_description, e.ses_qsl_info,
      e.slot_enforcement, e.slot_minutes, e.dupe_rule, e.require_operator_approval,
      (SELECT COUNT(*) FROM qsos q WHERE q.event_id = e.id AND NOT q.is_dupe AND q.deleted_at IS NULL) AS qso_count,
      (SELECT COUNT(*) FROM qsos q WHERE q.event_id = e.id AND     q.is_dupe AND q.deleted_at IS NULL) AS dupe_count,
      (SELECT jsonb_agg(DISTINCT q.operator_call)
         FROM qsos q WHERE q.event_id = e.id AND q.operator_call IS NOT NULL AND q.deleted_at IS NULL
      ) AS operators,
      -- Deliberately NOT filtered on deleted_at: this is a backup, and an
      -- audit trail that a backup silently drops is not an audit trail. The
      -- ADIF and Cabrillo exports do exclude them, because those are
      -- submissions rather than archives.
      (SELECT jsonb_agg(to_jsonb(q) ORDER BY q.datetime_utc)
         FROM qsos q WHERE q.event_id = e.id
      ) AS qsos,
      -- The roster holds each operator's own grid/state, the only source for
      -- the ADIF MY_* fields. A backup without it restores an SES log that no
      -- longer uploads correctly.
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.op_call)
         FROM ses_operators o WHERE o.event_id = e.id
      ) AS ses_operators,
      -- during is a tstzrange, which does not survive a JSON round trip, so
      -- it is decomposed here and rebuilt on restore.
      (SELECT jsonb_agg(jsonb_build_object(
                'op_call', r.op_call, 'band', r.band, 'mode', r.mode,
                'starts_at', lower(r.during), 'ends_at', upper(r.during),
                'planned_freq', r.planned_freq, 'note', r.note,
                'status', r.status, 'created_at', r.created_at,
                'station_number', r.station_number) ORDER BY lower(r.during))
         FROM ses_reservations r WHERE r.event_id = e.id
      ) AS ses_reservations
    FROM events e
    WHERE p_event_id IS NULL OR e.id = p_event_id
    ORDER BY e.created_at
  ) t;
$$;

-- Recreate events from an export. Always creates NEW events with fresh join
-- codes — never overwrites or merges — so restoring is safe to try, and safe
-- to try twice. Accepts either a single event object or an array of them.
--
-- Takes the payload as a parameter rather than reading a file, so the same
-- definition serves the admin console (which passes pg_read_file output), the
-- import route (which passes a request body) and the tests.
CREATE OR REPLACE FUNCTION ezfd_restore_events(payload jsonb)
RETURNS TABLE(orig_code text, new_code text, qso_count int)
LANGUAGE plpgsql
AS $$
DECLARE
  raw jsonb;
  ev  jsonb;
  qso jsonb;
  op  jsonb;
  res jsonb;
  v_new_id uuid;
  v_new_code text;
  n int;
BEGIN
  raw := payload;
  IF jsonb_typeof(raw) = 'object' THEN
    raw := jsonb_build_array(raw);
  END IF;
  IF jsonb_typeof(raw) <> 'array' THEN
    RAISE EXCEPTION 'restore payload must be an object or an array, got %', jsonb_typeof(raw);
  END IF;

  -- json_agg over zero rows yields JSON null — a scalar, not SQL NULL — so
  -- COALESCE(...,'[]') does not catch it and jsonb_array_elements then fails
  -- with "cannot extract elements from a scalar". Every list below is
  -- therefore type-checked rather than COALESCEd.
  FOR ev IN SELECT * FROM jsonb_array_elements(raw) LOOP
    v_new_id := gen_random_uuid();
    v_new_code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

    INSERT INTO events (id, join_code, club_name, club_call, event_year, class, arrl_section,
                        location, bonuses, event_type, power, created_at,
                        starts_at, ends_at, ses_description, ses_qsl_info,
                        slot_enforcement, slot_minutes, dupe_rule, require_operator_approval)
    VALUES (
      v_new_id, v_new_code,
      COALESCE(ev->>'club_name',''), COALESCE(ev->>'club_call',''),
      COALESCE((ev->>'event_year')::int, EXTRACT(YEAR FROM NOW())::int),
      -- NULLIF, not COALESCE to '': a special event station stores NULL here,
      -- and restoring it as an empty string would put a blank MY_ARRL_SECT
      -- into every exported ADIF record.
      NULLIF(ev->>'class',''), NULLIF(ev->>'arrl_section',''),
      ev->>'location',
      COALESCE(ev->'bonuses','{}'::jsonb),
      COALESCE(ev->>'event_type','FD'),
      COALESCE(ev->>'power','HIGH'),
      COALESCE(NULLIF(ev->>'created_at','')::timestamptz, NOW()),
      NULLIF(ev->>'starts_at','')::timestamptz,
      NULLIF(ev->>'ends_at','')::timestamptz,
      ev->>'ses_description', ev->>'ses_qsl_info',
      COALESCE(ev->>'slot_enforcement','SOFT'),
      COALESCE((ev->>'slot_minutes')::int, 120),
      COALESCE(ev->>'dupe_rule','EVENT'),
      COALESCE((ev->>'require_operator_approval')::boolean, false)
    );

    n := 0;
    FOR qso IN SELECT * FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(ev->'qsos') = 'array' THEN ev->'qsos' ELSE '[]'::jsonb END) LOOP
      INSERT INTO qsos (id, event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
                        rcvd_class, rcvd_section, operator_call, station_number, is_dupe, created_at,
                        rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment,
                        adif_mode, freq_khz,
                        updated_at, updated_by, deleted_at, deleted_by)
      VALUES (
        gen_random_uuid(), v_new_id,
        qso->>'callsign', qso->>'band', qso->>'mode',
        COALESCE(NULLIF(qso->>'datetime_utc','')::timestamptz, NOW()),
        qso->>'sent_class', qso->>'sent_section',
        qso->>'rcvd_class', qso->>'rcvd_section',
        qso->>'operator_call', COALESCE((qso->>'station_number')::int, 1),
        COALESCE((qso->>'is_dupe')::boolean, false),
        COALESCE(NULLIF(qso->>'created_at','')::timestamptz, NOW()),
        qso->>'rst_sent', qso->>'rst_rcvd', qso->>'rcvd_name',
        qso->>'rcvd_qth', qso->>'rcvd_grid', qso->>'comment',
        qso->>'adif_mode', NULLIF(qso->>'freq_khz','')::int,
        NULLIF(qso->>'updated_at','')::timestamptz, qso->>'updated_by',
        NULLIF(qso->>'deleted_at','')::timestamptz, qso->>'deleted_by'
      );
      n := n + 1;
    END LOOP;

    -- Losing the roster strips the per-operator grid/state the ADIF MY_*
    -- fields are built from, leaving a restored SES log that no longer
    -- uploads correctly.
    FOR op IN SELECT * FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(ev->'ses_operators') = 'array' THEN ev->'ses_operators' ELSE '[]'::jsonb END) LOOP
      INSERT INTO ses_operators (event_id, op_call, op_name, grid, state, county, dxcc, approved, created_at)
      VALUES (
        v_new_id, op->>'op_call', op->>'op_name', op->>'grid', op->>'state',
        op->>'county', NULLIF(op->>'dxcc','')::int,
        COALESCE((op->>'approved')::boolean, true),
        COALESCE(NULLIF(op->>'created_at','')::timestamptz, NOW())
      )
      ON CONFLICT (event_id, op_call) DO NOTHING;
    END LOOP;

    -- Checkout history, rebuilt from the decomposed bounds the export stores.
    -- Skipped where a bound is missing rather than guessed at.
    FOR res IN SELECT * FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(ev->'ses_reservations') = 'array' THEN ev->'ses_reservations' ELSE '[]'::jsonb END) LOOP
      CONTINUE WHEN NULLIF(res->>'starts_at','') IS NULL;
      INSERT INTO ses_reservations (event_id, op_call, band, mode, during,
                                    planned_freq, note, status, created_at,
                                    station_number)
      VALUES (
        v_new_id, res->>'op_call', res->>'band', res->>'mode',
        tstzrange(
          (res->>'starts_at')::timestamptz,
          COALESCE(NULLIF(res->>'ends_at','')::timestamptz,
                   (res->>'starts_at')::timestamptz + interval '2 hours'),
          '[)'
        ),
        res->>'planned_freq', res->>'note',
        COALESCE(res->>'status','RELEASED'),
        COALESCE(NULLIF(res->>'created_at','')::timestamptz, NOW()),
        NULLIF(res->>'station_number','')::int
      );
    END LOOP;

    orig_code := ev->>'join_code';
    new_code  := v_new_code;
    qso_count := n;
    RETURN NEXT;
  END LOOP;
END;
$$;
