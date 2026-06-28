import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { generateADIF } from '@/lib/adif';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('join_code', code.toUpperCase())
    .single();

  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  const { data: qsos } = await supabase
    .from('qsos')
    .select('*')
    .eq('event_id', event.id)
    .order('datetime_utc', { ascending: true });

  const adif = generateADIF(event, qsos ?? []);
  const filename = `${event.club_call}_FD${event.event_year}.adi`;

  return new NextResponse(adif, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
