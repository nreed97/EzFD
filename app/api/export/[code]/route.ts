import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { generateADIF, type OperatorLocations } from '@/lib/adif';
import { generateCabrillo } from '@/lib/cabrillo';
import { EVENT_COLUMNS } from '@/lib/events';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'adif';
  // Filters let a single operator pull just their own contacts (to upload to
  // their own LoTW account), or a coordinator pull one weekend out of a
  // multi-week special event.
  const opFilter   = url.searchParams.get('op')?.toUpperCase().trim() || null;
  const fromFilter = url.searchParams.get('from') || null;
  const toFilter   = url.searchParams.get('to')   || null;

  const pool = getPool();

  const { rows: evRows } = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE join_code=$1`,
    [code.toUpperCase()]
  );
  if (!evRows[0]) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const event = evRows[0];
  const isSes = event.event_type === 'SES';

  const conditions = ['event_id = $1'];
  const values: unknown[] = [event.id];
  if (opFilter) {
    values.push(opFilter);
    conditions.push(`operator_call = $${values.length}`);
  }
  if (fromFilter) {
    values.push(fromFilter);
    conditions.push(`datetime_utc >= $${values.length}::timestamptz`);
  }
  if (toFilter) {
    values.push(toFilter);
    conditions.push(`datetime_utc <= $${values.length}::timestamptz`);
  }

  const { rows: qsos } = await pool.query(
    `SELECT * FROM qsos WHERE ${conditions.join(' AND ')} ORDER BY datetime_utc ASC`,
    values
  );

  // Filename stem: the event call, plus whatever narrowed the export, so a
  // coordinator collecting per-operator logs doesn't end up with a directory
  // of identically-named files.
  const suffix = [
    isSes ? `SES${event.event_year}` : `${event.event_type === 'WFD' ? 'WFD' : 'FD'}${event.event_year}`,
    opFilter ? opFilter.replace(/[^A-Z0-9]/g, '') : null,
  ].filter(Boolean).join('_');
  const stem = `${event.club_call.replace(/[^A-Za-z0-9]/g, '')}_${suffix}`;

  if (format === 'cabrillo') {
    // Cabrillo is a contest submission format. A special event station has no
    // contest, no exchange and no score, so there is nothing to submit.
    if (isSes) {
      return NextResponse.json(
        { error: 'Cabrillo export does not apply to a special event station — use ADIF.' },
        { status: 400 }
      );
    }
    const content = generateCabrillo(event, qsos);
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${stem}.log"`,
      },
    });
  }

  // Per-operator station locations for the ADIF MY_* fields. Only an SES
  // needs them — a Field Day club is all at one site.
  let operatorLocations: OperatorLocations = {};
  if (isSes) {
    const { rows: ops } = await pool.query(
      'SELECT op_call, grid, state, county, dxcc FROM ses_operators WHERE event_id=$1',
      [event.id]
    );
    operatorLocations = Object.fromEntries(
      ops.map(o => [o.op_call, { grid: o.grid, state: o.state, county: o.county, dxcc: o.dxcc }])
    );
  }

  const content = generateADIF(event, qsos, operatorLocations);
  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${stem}.adi"`,
    },
  });
}
