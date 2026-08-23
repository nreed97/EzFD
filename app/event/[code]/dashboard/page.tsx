import { getPool } from '@/lib/db';
import { EVENT_COLUMNS } from '@/lib/events';
import DashboardClient from '@/components/DashboardClient';
import { redirect } from 'next/navigation';

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ visitor?: string }>;
}) {
  const { code } = await params;
  const { visitor } = await searchParams;
  const pool = getPool();

  const { rows: evRows } = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE join_code=$1`,
    [code.toUpperCase()]
  );
  if (!evRows[0]) redirect('/');

  const { rows: qsos } = await pool.query(
    'SELECT * FROM qsos WHERE event_id=$1 AND deleted_at IS NULL ORDER BY datetime_utc ASC',
    [evRows[0].id]
  );

  return <DashboardClient event={evRows[0]} initialQSOs={qsos} isVisitor={visitor === '1'} />;
}
