import { getPool } from '@/lib/db';
import DashboardClient from '@/components/DashboardClient';
import { redirect } from 'next/navigation';

export default async function DashboardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const pool = getPool();

  const { rows: evRows } = await pool.query(
    `SELECT id, join_code, club_name, club_call, event_year, class, arrl_section,
            location, qrz_username, created_at
     FROM events WHERE join_code=$1`,
    [code.toUpperCase()]
  );
  if (!evRows[0]) redirect('/');

  const { rows: qsos } = await pool.query(
    'SELECT * FROM qsos WHERE event_id=$1 ORDER BY datetime_utc ASC',
    [evRows[0].id]
  );

  return <DashboardClient event={evRows[0]} initialQSOs={qsos} />;
}
