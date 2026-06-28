import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { generateADIF } from '@/lib/adif';
import { generateCabrillo } from '@/lib/cabrillo';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'adif';
  const pool = getPool();

  const { rows: evRows } = await pool.query(
    'SELECT * FROM events WHERE join_code=$1',
    [code.toUpperCase()]
  );
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];

  const { rows: qsos } = await pool.query(
    'SELECT * FROM qsos WHERE event_id=$1 ORDER BY datetime_utc ASC',
    [event.id]
  );

  if (format === 'cabrillo') {
    const content = generateCabrillo(event, qsos);
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${event.club_call}_FD${event.event_year}.log"`,
      },
    });
  }

  const content = generateADIF(event, qsos);
  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${event.club_call}_FD${event.event_year}.adi"`,
    },
  });
}
