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
  } = body;

  if (!club_name || !club_call || !fdClass || !arrl_section) {
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

  const resolvedEventType = event_type === 'WFD' ? 'WFD' : 'FD';
  const resolvedYear = event_year ?? new Date().getFullYear();

  const { rows } = await pool.query(
    `INSERT INTO events
       (join_code, club_name, club_call, event_year, class, arrl_section, location, qrz_username, qrz_password, event_type, power, use_call_history, use_master_callsign_file)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, join_code`,
    [
      join_code,
      club_name.trim(),
      club_call.toUpperCase().trim(),
      resolvedYear,
      fdClass.toUpperCase().trim(),
      arrl_section.toUpperCase().trim(),
      location?.trim() ?? null,
      qrz_username?.trim() ?? null,
      encryptedPassword,
      resolvedEventType,
      ['HIGH','LOW','QRP'].includes(power) ? power : 'HIGH',
      !!use_call_history,
      !!use_master_callsign_file,
    ]
  );

  const event = rows[0];
  const warnings: string[] = [];

  // Best-effort downloads — a slow or unreachable upstream shouldn't block
  // event creation. Operators can still log without prefill; only the
  // convenience feature is degraded.
  if (use_call_history) {
    try {
      await refreshCallHistory(event.id, resolvedEventType, resolvedYear);
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
