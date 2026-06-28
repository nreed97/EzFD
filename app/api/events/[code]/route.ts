import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('events')
    .select('id, join_code, club_name, club_call, event_year, class, arrl_section, location, qrz_username, created_at')
    .eq('join_code', code.toUpperCase())
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
