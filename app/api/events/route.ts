import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function POST(request: Request) {
  const body = await request.json();
  const { club_name, club_call, event_year, class: fdClass, arrl_section, location, qrz_username, qrz_password } = body;

  if (!club_name || !club_call || !fdClass || !arrl_section) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const pool = getPool();

  // Collision-resistant join code
  let join_code = generateJoinCode();
  for (let i = 0; i < 10; i++) {
    const { rows } = await pool.query('SELECT id FROM events WHERE join_code = $1', [join_code]);
    if (rows.length === 0) break;
    join_code = generateJoinCode();
  }

  const { rows } = await pool.query(
    `INSERT INTO events
       (join_code, club_name, club_call, event_year, class, arrl_section, location, qrz_username, qrz_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
      qrz_password ?? null,
    ]
  );

  return NextResponse.json(rows[0]);
}
