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
  arrl_section         TEXT        NOT NULL,        -- e.g. "MN"
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
-- Get On The Air (rule 7.3.13.1). A GOTA station signs a different callsign
-- from the parent and its contacts earn 5 bonus points each, with no cap and
-- no per-operator limit — both were removed from the rules, and the 1,000
-- point cap this app used to apply was never in them at all.
--
-- Flagged on the contact rather than split into a separate event, because
-- rule 4.1.1.5 says a GOTA QSO counts *twice*: full QSO credit for the parent
-- entry AND the bonus. A separate log would have to be merged back to score
-- correctly, and excluding these from qso_points — which the original plan
-- for this proposed — deflates the claimed score by a point per phone contact
-- and two per CW or digital one.
ALTER TABLE events ADD COLUMN IF NOT EXISTS gota_call TEXT;
ALTER TABLE qsos   ADD COLUMN IF NOT EXISTS is_gota BOOLEAN NOT NULL DEFAULT FALSE;

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
  PRIMARY KEY (event_id, op_call, station)
);

-- One operator running two radios is one callsign in two windows, each on its
-- own band. With the station out of the key they overwrite each other's row,
-- so the band activity panel could only ever show one of the two — and going
-- QRT on either radio cleared both. Widening the key is safe on existing data:
-- rows unique on (event_id, op_call) stay unique with a column added.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'presence'::regclass AND i.indisprimary
       AND i.indnatts = 2
  ) THEN
    ALTER TABLE presence DROP CONSTRAINT presence_pkey;
    ALTER TABLE presence ADD PRIMARY KEY (event_id, op_call, station);
  END IF;
END
$$;

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

-- Which activation this event *is*, as opposed to which row it is.
--
-- Restoring an export creates a new event with a new id and a new join code,
-- which is right when a copy is a copy. It is wrong when the two rows are the
-- same weekend running in two places — a field server at the site and the
-- hosted instance — and both hold real contacts that have to become one log.
-- Merging those needs an identity that survives the round trip, and the
-- primary key does not.
--
-- NULL means "this event is its own origin", so every event that already
-- exists gets a stable identity for free rather than needing a backfill:
-- readers use COALESCE(origin_event_id, id), and an export taken before this
-- column existed still carries its `id`, which is that same value. So the
-- retrofit this issue warned about costs nothing: the identity was always
-- there, it just had no name.
ALTER TABLE events ADD COLUMN IF NOT EXISTS origin_event_id UUID;

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
      e.gota_call,
      -- Resolved, not raw: an event that has never been imported is its own
      -- origin, so the export always states an identity rather than leaving
      -- the reader to work it out.
      COALESCE(e.origin_event_id, e.id) AS origin_event_id,
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
                        slot_enforcement, slot_minutes, dupe_rule, require_operator_approval,
                        gota_call, origin_event_id)
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
      COALESCE((ev->>'require_operator_approval')::boolean, false),
      ev->>'gota_call',
      -- The copy inherits the original's identity, which is what later lets
      -- ezfd_merge_event() tell "the same activation, twice" apart from "two
      -- different events". Falls back to the source row's own id so an export
      -- taken before origin_event_id existed still round-trips an identity.
      COALESCE(NULLIF(ev->>'origin_event_id','')::uuid,
               NULLIF(ev->>'id','')::uuid,
               v_new_id)
    );

    n := 0;
    FOR qso IN SELECT * FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(ev->'qsos') = 'array' THEN ev->'qsos' ELSE '[]'::jsonb END) LOOP
      INSERT INTO qsos (id, event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
                        rcvd_class, rcvd_section, operator_call, station_number, is_dupe, created_at,
                        rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment,
                        adif_mode, freq_khz,
                        updated_at, updated_by, deleted_at, deleted_by, is_gota)
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
        NULLIF(qso->>'deleted_at','')::timestamptz, qso->>'deleted_by',
        COALESCE((qso->>'is_gota')::boolean, false)
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

-- ---------------------------------------------------------------------------
-- Dupe recomputation
--
-- Dupe detection is normally a per-row decision made at insert time against
-- the rows already present (see isDupeQSO in lib/events.ts). That is correct
-- while contacts only ever arrive in time order into one log, and wrong the
-- moment two logs are combined: each instance computed its flags against a
-- different subset, so both are wrong for the union, and a contact that was
-- first in one copy may be second in the merged whole.
--
-- So this is a whole-table pass rather than a per-row decision, and it is the
-- step most easily forgotten after a merge. Earliest contact wins; created_at
-- then id break ties so the result is deterministic rather than dependent on
-- physical row order.
--
-- Soft-deleted contacts are excluded, so deleting the first contact promotes
-- the second to being the one that counts — which is what an operator
-- deleting a mistaken entry expects. Their own is_dupe flag is left alone;
-- every read path filters them out anyway.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ezfd_recompute_dupes(p_event_id uuid)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_rule text;
  n int;
BEGIN
  SELECT COALESCE(dupe_rule, 'EVENT') INTO v_rule FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such event: %', p_event_id;
  END IF;

  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY callsign, band, mode,
               -- NULL for EVENT and NONE, which groups the whole event into
               -- one partition; DAY partitions by UTC date, since working the
               -- same station again next weekend is normal for a special
               -- event rather than a mistake.
               CASE WHEN v_rule = 'DAY'
                    THEN (datetime_utc AT TIME ZONE 'UTC')::date
                    ELSE NULL END
             ORDER BY datetime_utc, created_at, id
           ) AS rn
      FROM qsos
     WHERE event_id = p_event_id AND deleted_at IS NULL
  ), want AS (
    SELECT id, CASE WHEN v_rule = 'NONE' THEN false ELSE rn > 1 END AS is_dupe FROM ranked
  )
  UPDATE qsos q SET is_dupe = w.is_dupe
    FROM want w
   WHERE q.id = w.id AND q.is_dupe IS DISTINCT FROM w.is_dupe;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- Merge one export into an existing event
--
-- Restoring an export recreates an event. That is enough while an activation
-- only ever lives in one place at a time. It is not enough for the case a
-- field server creates: the same weekend ran on a Pi at the site *and* on the
-- hosted instance, and both hold real contacts that have to become one log.
--
-- Deliberately narrow, and one-shot. This is post-event reconciliation, not
-- replication: no continuous sync, no bidirectional anything, and nothing is
-- resolved silently that a human might disagree with.
--
-- What it does:
--   * refuses unless both sides are the same activation (see origin_event_id)
--   * adds contacts not already present, preserving their ids so running the
--     merge twice is a no-op rather than a doubling
--   * recomputes is_dupe across the union
--   * adds roster entries that are missing, never overwriting ones that exist
--   * files the incoming checkout history as RELEASED
--   * reports what it did, including what it refused to decide
--
-- What it deliberately does NOT do:
--   * resolve a contact edited on both sides. Last-write-wins is *available*
--     now that qsos carries updated_at, and it is still the wrong default:
--     silently overwriting one operator's correction with another's is the
--     exact shape of failure this codebase keeps hitting — the person losing
--     the edit has no way to notice. Conflicts are reported and left alone.
--   * change the target event's own settings. If the bonuses or the class
--     were edited on both sides, that is reported too, and left to a human.
--   * resurrect a soft-deleted contact. A merge is bulk and automatic, unlike
--     an ADIF import, which is a file somebody deliberately chose — so where
--     the ADIF route treats a deleted contact as absent and brings it back,
--     this one reports the collision and leaves the deletion standing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ezfd_merge_event(
  p_target_id uuid,
  payload jsonb,
  p_window_seconds int DEFAULT 120,
  p_allow_different_origin boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  raw jsonb;
  ev  jsonb;
  qso jsonb;
  op  jsonb;
  res jsonb;
  v_target events%ROWTYPE;
  v_target_origin uuid;
  v_incoming_origin uuid;
  v_qid uuid;
  v_owner uuid;
  v_match uuid;
  v_match_deleted boolean;
  v_mine jsonb;
  v_theirs jsonb;
  v_diff text[];
  v_added int := 0;
  v_by_id int := 0;
  v_by_time int := 0;
  v_deleted_skipped int := 0;
  v_roster_added int := 0;
  v_roster_present int := 0;
  v_res_added int := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_settings text[] := '{}';
  v_dt timestamptz;
  v_dupes int;
BEGIN
  SELECT * INTO v_target FROM events WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such event: %', p_target_id;
  END IF;

  raw := payload;
  IF jsonb_typeof(raw) = 'array' THEN
    IF jsonb_array_length(raw) <> 1 THEN
      RAISE EXCEPTION 'merge takes exactly one event, got % — restore creates events, merge reconciles one', jsonb_array_length(raw);
    END IF;
    ev := raw->0;
  ELSIF jsonb_typeof(raw) = 'object' THEN
    ev := raw;
  ELSE
    RAISE EXCEPTION 'merge payload must be an object or a one-element array, got %', jsonb_typeof(raw);
  END IF;

  -- Same activation, or refuse. An export taken before origin_event_id
  -- existed still carries its own id, which is the same value, so old
  -- exports match too.
  v_target_origin   := COALESCE(v_target.origin_event_id, v_target.id);
  v_incoming_origin := COALESCE(NULLIF(ev->>'origin_event_id','')::uuid,
                                NULLIF(ev->>'id','')::uuid);
  IF v_incoming_origin IS NULL THEN
    RAISE EXCEPTION 'the export carries no event identity, so it cannot be proved to be the same activation';
  END IF;
  IF v_incoming_origin <> v_target_origin AND NOT p_allow_different_origin THEN
    RAISE EXCEPTION 'that export is a different activation (% vs %) — merging it would combine two events into one log',
      v_incoming_origin, v_target_origin;
  END IF;

  -- Settings edited on both sides. Reported, never applied: the target is the
  -- instance somebody chose to merge *into*, so its settings stand.
  IF (ev->>'class')        IS DISTINCT FROM v_target.class          THEN v_settings := array_append(v_settings, 'class'); END IF;
  IF (ev->>'arrl_section') IS DISTINCT FROM v_target.arrl_section   THEN v_settings := array_append(v_settings, 'arrl_section'); END IF;
  IF (ev->>'power')        IS DISTINCT FROM v_target.power          THEN v_settings := array_append(v_settings, 'power'); END IF;
  IF (ev->>'dupe_rule')    IS DISTINCT FROM v_target.dupe_rule      THEN v_settings := array_append(v_settings, 'dupe_rule'); END IF;
  IF (ev->>'gota_call')    IS DISTINCT FROM v_target.gota_call      THEN v_settings := array_append(v_settings, 'gota_call'); END IF;
  IF COALESCE(ev->'bonuses','{}'::jsonb) IS DISTINCT FROM COALESCE(v_target.bonuses,'{}'::jsonb)
                                                                    THEN v_settings := array_append(v_settings, 'bonuses'); END IF;

  FOR qso IN SELECT * FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(ev->'qsos') = 'array' THEN ev->'qsos' ELSE '[]'::jsonb END) LOOP

    v_qid := NULLIF(qso->>'id','')::uuid;
    v_dt  := COALESCE(NULLIF(qso->>'datetime_utc','')::timestamptz, NOW());
    v_match := NULL;
    v_match_deleted := false;

    -- 1. Exact identity. A contact that came from this very row is the same
    --    contact, whatever its timestamp has since been edited to.
    IF v_qid IS NOT NULL THEN
      SELECT event_id INTO v_owner FROM qsos WHERE id = v_qid;
      IF FOUND AND v_owner = p_target_id THEN
        v_match := v_qid;
      ELSIF FOUND THEN
        -- Same id, different event. Cannot preserve it; fall through to the
        -- time window and insert under a fresh id if that finds nothing.
        v_qid := NULL;
      END IF;
    END IF;

    -- 2. Same contact logged independently in both places. The ±window is the
    --    rule the ADIF import already uses and is here for the same reason:
    --    two instances stamp the same contact seconds apart.
    IF v_match IS NULL THEN
      SELECT id, deleted_at IS NOT NULL INTO v_match, v_match_deleted
        FROM qsos
       WHERE event_id = p_target_id
         AND callsign = qso->>'callsign'
         AND band     = qso->>'band'
         AND mode     = qso->>'mode'
         AND ABS(EXTRACT(EPOCH FROM (datetime_utc - v_dt))) <= p_window_seconds
       ORDER BY deleted_at NULLS FIRST, datetime_utc
       LIMIT 1;
    ELSE
      SELECT deleted_at IS NOT NULL INTO v_match_deleted FROM qsos WHERE id = v_match;
    END IF;

    IF v_match IS NOT NULL THEN
      IF v_qid IS NOT NULL AND v_match = v_qid THEN v_by_id := v_by_id + 1;
      ELSE                                          v_by_time := v_by_time + 1;
      END IF;

      -- A contact deleted here and live there is not a conflict to resolve,
      -- it is a deletion to respect. Counted separately so it is visible.
      IF v_match_deleted AND NULLIF(qso->>'deleted_at','') IS NULL THEN
        v_deleted_skipped := v_deleted_skipped + 1;
      END IF;

      -- Only the fields that change what gets submitted or scored. A comment
      -- or a name differing between two copies is not worth a human's time;
      -- a received section differing decides what the ARRL is told.
      SELECT jsonb_strip_nulls(jsonb_build_object(
               'callsign', q.callsign, 'band', q.band, 'mode', q.mode,
               'datetime_utc', to_jsonb(q.datetime_utc),
               'rcvd_class', q.rcvd_class, 'rcvd_section', q.rcvd_section,
               'operator_call', q.operator_call, 'station_number', q.station_number,
               'is_gota', q.is_gota, 'deleted', q.deleted_at IS NOT NULL))
        INTO v_mine FROM qsos q WHERE q.id = v_match;

      v_theirs := jsonb_strip_nulls(jsonb_build_object(
               'callsign', qso->>'callsign', 'band', qso->>'band', 'mode', qso->>'mode',
               'datetime_utc', to_jsonb(v_dt),
               'rcvd_class', qso->>'rcvd_class', 'rcvd_section', qso->>'rcvd_section',
               'operator_call', qso->>'operator_call',
               'station_number', COALESCE((qso->>'station_number')::int, 1),
               'is_gota', COALESCE((qso->>'is_gota')::boolean, false),
               'deleted', NULLIF(qso->>'deleted_at','') IS NOT NULL));

      IF v_mine IS DISTINCT FROM v_theirs THEN
        v_diff := ARRAY(
          SELECT k FROM (
            SELECT jsonb_object_keys(v_mine || v_theirs) AS k
          ) ks WHERE v_mine->k IS DISTINCT FROM v_theirs->k);
        v_conflicts := v_conflicts || jsonb_build_object(
          'qso_id', v_match, 'callsign', qso->>'callsign',
          'band', qso->>'band', 'mode', qso->>'mode',
          'fields', to_jsonb(v_diff), 'here', v_mine, 'theirs', v_theirs);
      END IF;
      CONTINUE;
    END IF;

    -- 3. New to this instance. The id is preserved when it is free, which is
    --    what makes a second run of the same merge find it in step 1 rather
    --    than adding it again.
    INSERT INTO qsos (id, event_id, callsign, band, mode, datetime_utc, sent_class, sent_section,
                      rcvd_class, rcvd_section, operator_call, station_number, is_dupe, created_at,
                      rst_sent, rst_rcvd, rcvd_name, rcvd_qth, rcvd_grid, comment,
                      adif_mode, freq_khz,
                      updated_at, updated_by, deleted_at, deleted_by, is_gota)
    VALUES (
      COALESCE(v_qid, gen_random_uuid()), p_target_id,
      qso->>'callsign', qso->>'band', qso->>'mode', v_dt,
      qso->>'sent_class', qso->>'sent_section',
      qso->>'rcvd_class', qso->>'rcvd_section',
      qso->>'operator_call', COALESCE((qso->>'station_number')::int, 1),
      -- Whatever the other instance decided is not authoritative for the
      -- union; the recompute below settles it.
      false,
      COALESCE(NULLIF(qso->>'created_at','')::timestamptz, NOW()),
      qso->>'rst_sent', qso->>'rst_rcvd', qso->>'rcvd_name',
      qso->>'rcvd_qth', qso->>'rcvd_grid', qso->>'comment',
      qso->>'adif_mode', NULLIF(qso->>'freq_khz','')::int,
      NULLIF(qso->>'updated_at','')::timestamptz, qso->>'updated_by',
      -- A contact deleted over there arrives deleted. The merge carries the
      -- audit trail across rather than laundering it into a live contact.
      NULLIF(qso->>'deleted_at','')::timestamptz, qso->>'deleted_by',
      COALESCE((qso->>'is_gota')::boolean, false)
    );
    v_added := v_added + 1;
  END LOOP;

  -- Roster: add what is missing, never overwrite what is here. An operator's
  -- grid and state are the only source for the ADIF MY_* fields, and the
  -- target's copy is the one somebody has been correcting.
  FOR op IN SELECT * FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(ev->'ses_operators') = 'array' THEN ev->'ses_operators' ELSE '[]'::jsonb END) LOOP
    INSERT INTO ses_operators (event_id, op_call, op_name, grid, state, county, dxcc, approved, created_at)
    VALUES (
      p_target_id, op->>'op_call', op->>'op_name', op->>'grid', op->>'state',
      op->>'county', NULLIF(op->>'dxcc','')::int,
      COALESCE((op->>'approved')::boolean, true),
      COALESCE(NULLIF(op->>'created_at','')::timestamptz, NOW())
    )
    ON CONFLICT (event_id, op_call) DO NOTHING;
    IF FOUND THEN v_roster_added := v_roster_added + 1;
    ELSE          v_roster_present := v_roster_present + 1;
    END IF;
  END LOOP;

  -- Checkout history, filed as RELEASED.
  --
  -- Reservations describe who was transmitting when; nobody submits them. Two
  -- instances can each legitimately hold 20m PH at the same moment, because
  -- the exclusion constraint only ever guaranteed that *within* one database.
  -- Importing them as RELEASED keeps that history — the constraint's WHERE
  -- clause excludes released rows, so it cannot reject the merge — where
  -- dropping the remote set would silently lose the record of half the event.
  FOR res IN SELECT * FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(ev->'ses_reservations') = 'array' THEN ev->'ses_reservations' ELSE '[]'::jsonb END) LOOP
    CONTINUE WHEN NULLIF(res->>'starts_at','') IS NULL;
    INSERT INTO ses_reservations (event_id, op_call, band, mode, during,
                                  planned_freq, note, status, created_at, station_number)
    SELECT
      p_target_id, res->>'op_call', res->>'band', res->>'mode',
      tstzrange((res->>'starts_at')::timestamptz,
                COALESCE(NULLIF(res->>'ends_at','')::timestamptz,
                         (res->>'starts_at')::timestamptz + interval '2 hours'), '[)'),
      res->>'planned_freq', res->>'note', 'RELEASED',
      COALESCE(NULLIF(res->>'created_at','')::timestamptz, NOW()),
      NULLIF(res->>'station_number','')::int
    -- Skipped when the identical span is already filed, so a second run of
    -- the same merge does not stack duplicate history.
    WHERE NOT EXISTS (
      SELECT 1 FROM ses_reservations x
       WHERE x.event_id = p_target_id
         AND x.op_call IS NOT DISTINCT FROM res->>'op_call'
         AND x.band = res->>'band' AND x.mode = res->>'mode'
         AND lower(x.during) = (res->>'starts_at')::timestamptz);
    IF FOUND THEN v_res_added := v_res_added + 1; END IF;
  END LOOP;

  -- The step most easily forgotten. Both instances computed their flags
  -- against a different subset, so both are wrong for the union.
  v_dupes := ezfd_recompute_dupes(p_target_id);

  RETURN jsonb_build_object(
    'target_join_code', v_target.join_code,
    'origin_event_id', v_target_origin,
    'origin_matched', v_incoming_origin = v_target_origin,
    'qsos_added', v_added,
    'already_present_by_id', v_by_id,
    'already_present_by_time', v_by_time,
    'skipped_deleted_here', v_deleted_skipped,
    'conflicts', v_conflicts,
    'roster_added', v_roster_added,
    'roster_already_present', v_roster_present,
    'reservations_added', v_res_added,
    'dupe_flags_changed', v_dupes,
    'settings_differ', to_jsonb(v_settings)
  );
END;
$$;
