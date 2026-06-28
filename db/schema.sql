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
