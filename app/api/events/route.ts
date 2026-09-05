import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { encryptField } from '@/lib/crypto';
import { refreshCallHistory } from '@/lib/callHistory';
import { refreshMasterCallsignsIfStale } from '@/lib/masterCallsigns';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    club_name, club_call, event_year, class: fdClass, arrl_section, location,
    qrz_username, qrz_password, admin_key, event_type, power,
    use_call_history, use_master_callsign_file,
    starts_at, ends_at, ses_description, ses_qsl_info,
    slot_enforcement, slot_minutes, dupe_rule, require_operator_approval,
    gota_call,
  } = body;

  const isSesEvent = event_type === 'SES';

  // A special event station has no contest exchange, so class and section
  // aren't just optional — they're meaningless and stored as NULL.
  if (!club_name || !club_call) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!isSesEvent && (!fdClass || !arrl_section)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const requiredKey = process.env.EZFD_ADMIN_KEY;
  if (requiredKey) {
    if (!admin_key || admin_key !== requiredKey) {
      return NextResponse.json({ error: 'Invalid admin key' }, { status: 403 });
    }
  }

  const pool = getPool();

  let join_code = generateJoinCode();
  for (let i = 0; i < 10; i++) {
    const { rows } = await pool.query('SELECT id FROM events WHERE join_code = $1', [join_code]);
    if (rows.length === 0) break;
    join_code = generateJoinCode();
  }

  let encryptedPassword: string | null = null;
  if (qrz_password) {
    try {
      encryptedPassword = encryptField(qrz_password);
    } catch {
      return NextResponse.json(
        { error: 'Server encryption key not configured. Ask the server administrator to set EZFD_ENCRYPTION_KEY.' },
        { status: 500 }
      );
    }
  }

  // The contest type is kept separately from the stored event_type: the call
  // history downloader only knows FD and WFD, and only ever runs for those.
  const contestType: 'FD' | 'WFD' = event_type === 'WFD' ? 'WFD' : 'FD';
  const resolvedEventType = isSesEvent ? 'SES' : contestType;
  const resolvedYear = event_year ?? new Date().getFullYear();

  // The N1MM call history file is contest- and year-specific (an FD/WFD
  // station's usual class and section), so it has nothing to offer an SES.
  // MASTER.SCP is evergreen and still useful for callsign validation.
  const wantCallHistory = !isSesEvent && !!use_call_history;

  function parseDate(value: unknown): Date | null {
    if (!value) return null;
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? null : d;
  }

  const { rows } = await pool.query(
    `INSERT INTO events
       (join_code, club_name, club_call, event_year, class, arrl_section, location,
        qrz_username, qrz_password, event_type, power, use_call_history,
        use_master_callsign_file, starts_at, ends_at, ses_description, ses_qsl_info,
        slot_enforcement, slot_minutes, dupe_rule, require_operator_approval,
        gota_call)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING id, join_code`,
    [
      join_code,
      club_name.trim(),
      club_call.toUpperCase().trim(),
      resolvedYear,
      // A special event station has no contest class, ever. Its section is
      // optional: plenty of special events run outside FD/WFD but are still
      // worth recording a section for, and it feeds ADIF MY_ARRL_SECT.
      isSesEvent ? null : fdClass.toUpperCase().trim(),
      isSesEvent
        ? (arrl_section?.toUpperCase().trim() || null)
        : arrl_section.toUpperCase().trim(),
      location?.trim() ?? null,
      qrz_username?.trim() ?? null,
      encryptedPassword,
      resolvedEventType,
      ['HIGH','LOW','QRP'].includes(power) ? power : 'HIGH',
      wantCallHistory,
      !!use_master_callsign_file,
      isSesEvent ? parseDate(starts_at) : null,
      isSesEvent ? parseDate(ends_at) : null,
      isSesEvent ? (ses_description?.trim() || null) : null,
      isSesEvent ? (ses_qsl_info?.trim() || null) : null,
      slot_enforcement === 'HARD' ? 'HARD' : 'SOFT',
      Number(slot_minutes) > 0 ? Math.round(Number(slot_minutes)) : 120,
      ['EVENT','DAY','NONE'].includes(dupe_rule) ? dupe_rule : (isSesEvent ? 'DAY' : 'EVENT'),
      isSesEvent && !!require_operator_approval,
      // Field Day only. Rule 7.3.13.1 lists the GOTA bonus for classes A and
      // F; Winter Field Day has no bonuses at all and a special event has no
      // contest structure, so storing a GOTA call on either would offer an
      // operator a station that can never score.
      resolvedEventType === 'FD' ? (gota_call?.toUpperCase().trim() || null) : null,
    ]
  );

  const event = rows[0];
  const warnings: string[] = [];

  // Best-effort downloads — a slow or unreachable upstream shouldn't block
  // event creation. Operators can still log without prefill; only the
  // convenience feature is degraded.
  if (wantCallHistory) {
    try {
      await refreshCallHistory(event.id, contestType, resolvedYear);
    } catch (err) {
      warnings.push(`Call history download failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
  if (use_master_callsign_file) {
    try {
      await refreshMasterCallsignsIfStale();
    } catch (err) {
      warnings.push(`Master callsign file download failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return NextResponse.json(warnings.length ? { ...event, warnings } : event);
}
