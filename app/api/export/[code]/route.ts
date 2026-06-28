import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { generateADIF } from '@/lib/adif';
import { generateCabrillo } from '@/lib/cabrillo';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'adif';

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

  const allQSOs = qsos ?? [];

  if (format === 'cabrillo') {
    const content = generateCabrillo(event, allQSOs);
    const filename = `${event.club_call}_FD${event.event_year}.log`;
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const content = generateADIF(event, allQSOs);
  const filename = `${event.club_call}_FD${event.event_year}.adi`;
  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
