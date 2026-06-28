import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

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

  const supabase = createServiceClient();

  let join_code = generateJoinCode();
  let attempts = 0;

  while (attempts < 10) {
    const { data: existing } = await supabase.from('events').select('id').eq('join_code', join_code).maybeSingle();
    if (!existing) break;
    join_code = generateJoinCode();
    attempts++;
  }

  const { data, error } = await supabase
    .from('events')
    .insert({
      join_code,
      club_name: club_name.trim(),
      club_call: club_call.toUpperCase().trim(),
      event_year: event_year ?? new Date().getFullYear(),
      class: fdClass.toUpperCase().trim(),
      arrl_section: arrl_section.toUpperCase().trim(),
      location: location?.trim() ?? null,
      qrz_username: qrz_username?.trim() ?? null,
      qrz_password: qrz_password ?? null,
    })
    .select('id, join_code')
    .single();

  if (error) {
    console.error('Event creation error:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }

  return NextResponse.json(data);
}
