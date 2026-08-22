-- Assertions for the SES call-checkout guarantee.
--
-- The rule "two operators must never sign the same callsign on the same band
-- and mode at once" is enforced entirely by the ses_no_overlap exclusion
-- constraint, not by application code — so it needs a test that exercises the
-- database. Run against a database with db/schema.sql applied.
--
-- Every check raises an exception on failure, so psql -v ON_ERROR_STOP=1
-- exits non-zero and fails CI.

DO $$
DECLARE
  ev       UUID;
  slot     UUID;
  rejected BOOLEAN;
BEGIN
  INSERT INTO events (join_code, club_name, club_call, event_type, class, arrl_section)
  VALUES ('CITST0', 'CI Special Event', 'W0CI', 'SES', NULL, NULL)
  RETURNING id INTO ev;

  RAISE NOTICE '1. an SES event stores NULL class/section';
  IF (SELECT class FROM events WHERE id = ev) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: SES event should have NULL class';
  END IF;

  RAISE NOTICE '2. first checkout of 20m PH succeeds';
  INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
  VALUES (ev, 'W0AAA', '20m', 'PH', tstzrange(NOW(), NOW() + interval '2 hours', '[)'))
  RETURNING id INTO slot;

  RAISE NOTICE '3. an overlapping checkout of the same band/mode is rejected';
  rejected := FALSE;
  BEGIN
    INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
    VALUES (ev, 'W1BBB', '20m', 'PH', tstzrange(NOW() + interval '1 hour', NOW() + interval '3 hours', '[)'));
  EXCEPTION WHEN exclusion_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'FAIL: two operators were allowed to hold 20m PH at once';
  END IF;

  RAISE NOTICE '4. the same window on a different mode is allowed';
  INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
  VALUES (ev, 'W1BBB', '20m', 'CW', tstzrange(NOW(), NOW() + interval '2 hours', '[)'));

  RAISE NOTICE '5. the same window on a different band is allowed';
  INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
  VALUES (ev, 'W2CCC', '40m', 'PH', tstzrange(NOW(), NOW() + interval '2 hours', '[)'));

  RAISE NOTICE '6. a non-overlapping later slot on the same band/mode is allowed';
  INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
  VALUES (ev, 'W3DDD', '20m', 'PH', tstzrange(NOW() + interval '2 hours', NOW() + interval '4 hours', '[)'));

  RAISE NOTICE '7. extending into the next holder''s slot is rejected';
  rejected := FALSE;
  BEGIN
    UPDATE ses_reservations
    SET during = tstzrange(lower(during), NOW() + interval '3 hours', '[)')
    WHERE id = slot;
  EXCEPTION WHEN exclusion_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'FAIL: a slot was extended over the next holder''s window';
  END IF;

  RAISE NOTICE '8. releasing frees the band/mode for someone else';
  UPDATE ses_reservations
  SET status = 'RELEASED', during = tstzrange(lower(during), GREATEST(lower(during), NOW()), '[)')
  WHERE id = slot;
  INSERT INTO ses_reservations (event_id, op_call, band, mode, during)
  VALUES (ev, 'W1BBB', '20m', 'PH', tstzrange(NOW(), NOW() + interval '90 minutes', '[)'));

  RAISE NOTICE '9. cancelling a not-yet-started slot does not invert its range';
  -- Without GREATEST(), clamping a future slot's upper bound to NOW() would
  -- put the upper bound below the lower bound and Postgres would reject it.
  UPDATE ses_reservations
  SET status = 'RELEASED', during = tstzrange(lower(during), GREATEST(lower(during), NOW()), '[)')
  WHERE op_call = 'W3DDD';

  RAISE NOTICE '10. the ezfd app role has DML on the SES tables';
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ezfd') THEN
    IF NOT has_table_privilege('ezfd', 'ses_reservations', 'INSERT')
    OR NOT has_table_privilege('ezfd', 'ses_operators', 'INSERT') THEN
      RAISE EXCEPTION 'FAIL: the ezfd role is missing DML on the SES tables';
    END IF;
  END IF;

  DELETE FROM events WHERE id = ev;
  RAISE NOTICE 'All SES constraint assertions passed.';
END
$$;
