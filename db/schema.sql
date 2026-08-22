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

CREATE INDEX IF NOT EXISTS qsos_event_idx      ON qsos(event_id);
CREATE INDEX IF NOT EXISTS qsos_dupe_idx       ON qsos(event_id, callsign, band, mode);
CREATE INDEX IF NOT EXISTS qsos_datetime_idx   ON qsos(event_id, datetime_utc DESC);

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
