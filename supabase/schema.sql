-- EzFD Field Day Logger Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code            TEXT UNIQUE NOT NULL,
  club_name            TEXT NOT NULL,
  club_call            TEXT NOT NULL,
  event_year           INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  class                TEXT NOT NULL,        -- e.g., "3A", "2A", "1D"
  arrl_section         TEXT NOT NULL,        -- e.g., "EPA"
  location             TEXT,
  qrz_username         TEXT,
  qrz_password         TEXT,                 -- TODO: encrypt at rest in production
  qrz_session_key      TEXT,
  qrz_session_expires  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qsos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  callsign       TEXT NOT NULL,
  band           TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('PH', 'CW', 'DIG')),
  datetime_utc   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_class     TEXT,
  sent_section   TEXT,
  rcvd_class     TEXT,
  rcvd_section   TEXT,
  operator_call  TEXT,
  station_number INTEGER NOT NULL DEFAULT 1,
  is_dupe        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS qsos_event_id_idx  ON qsos(event_id);
CREATE INDEX IF NOT EXISTS qsos_dupe_idx      ON qsos(event_id, callsign, band, mode);
CREATE INDEX IF NOT EXISTS qsos_datetime_idx  ON qsos(event_id, datetime_utc DESC);

-- Enable Realtime for the qsos table
ALTER PUBLICATION supabase_realtime ADD TABLE qsos;
