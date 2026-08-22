import { getPool } from '@/lib/db';
import { EVENT_COLUMNS } from '@/lib/events';
import CwLoggingClient from '@/components/CwLoggingClient';
import { redirect } from 'next/navigation';

export default async function CwPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ op?: string; station?: string }>;
}) {
  const { code } = await params;
  const { op, station } = await searchParams;
  const stationNumber = Math.max(1, parseInt(station ?? '1', 10) || 1);
  const pool = getPool();

  const { rows: evRows } = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE join_code=$1`,
    [code.toUpperCase()]
  );
  if (!evRows[0]) redirect('/');
  if (!op) redirect(`/event/${code}`);

  const { rows: qsos } = await pool.query(
    'SELECT * FROM qsos WHERE event_id=$1 ORDER BY datetime_utc DESC LIMIT 50',
    [evRows[0].id]
  );

  return (
    <CwLoggingClient
      event={evRows[0]}
      initialQSOs={qsos}
      operatorCall={op.toUpperCase()}
      stationNumber={stationNumber}
    />
  );
}
