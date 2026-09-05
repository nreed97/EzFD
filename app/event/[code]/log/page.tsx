import { getPool } from '@/lib/db';
import { EVENT_COLUMNS } from '@/lib/events';
import LoggingClient from '@/components/LoggingClient';
import { redirect } from 'next/navigation';

export default async function LogPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ op?: string; station?: string; band?: string; mode?: string; gota?: string }>;
}) {
  const { code } = await params;
  const { op, station, band, mode, gota } = await searchParams;
  const stationNumber = Math.max(1, parseInt(station ?? '1', 10) || 1);
  const pool = getPool();

  const { rows: evRows } = await pool.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE join_code=$1`,
    [code.toUpperCase()]
  );
  if (!evRows[0]) redirect('/');
  if (!op) redirect(`/event/${code}`);

  const { rows: qsos } = await pool.query(
    'SELECT * FROM qsos WHERE event_id=$1 AND deleted_at IS NULL ORDER BY datetime_utc DESC LIMIT 500',
    [evRows[0].id]
  );

  // Resolved here rather than in the client so a pending operator is told up
  // front, instead of finding out when their first QSO comes back a 403.
  let approvalPending = false;
  if (evRows[0].event_type === 'SES' && evRows[0].require_operator_approval) {
    const { rows: opRows } = await pool.query(
      'SELECT approved FROM ses_operators WHERE event_id=$1 AND op_call=$2',
      [evRows[0].id, op.toUpperCase()]
    );
    approvalPending = opRows[0]?.approved !== true;
  }

  return (
    <LoggingClient
      event={evRows[0]}
      initialQSOs={qsos}
      operatorCall={op.toUpperCase()}
      stationNumber={stationNumber}
      approvalPending={approvalPending}
      // Resolved against the event, not taken from the URL: a stale bookmark
      // must not flag contacts for a GOTA station this event does not run,
      // which would claim a bonus out of nothing.
      isGota={gota === '1' && evRows[0].event_type === 'FD' && !!evRows[0].gota_call}
      initialBand={band}
      initialMode={mode}
    />
  );
}
