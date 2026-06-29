import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { encryptField } from '@/lib/crypto';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function POST(request: Request) {
  const body = await request.json();
  const { club_name, club_call, event_year, class: fdClass, arrl_section, location, qrz_username, qrz_password, admin_key, event_type } = body;

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

  const { rows } = await pool.query(
    `INSERT INTO events
       (join_code, club_name, club_call, event_year, class, arrl_section, location, qrz_username, qrz_password, event_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, join_code`,
    [
      join_code,
      club_name.trim(),
      club_call.toUpperCase().trim(),
      event_year ?? new Date().getFullYear(),
      fdClass.toUpperCase().trim(),
      arrl_section.toUpperCase().trim(),
      location?.trim() ?? null,
      qrz_username?.trim() ?? null,
      encryptedPassword,
      event_type === 'WFD' ? 'WFD' : 'FD',
    ]
  );

  return NextResponse.json(rows[0]);
}
