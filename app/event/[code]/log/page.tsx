import { createServiceClient } from '@/lib/supabase-server';
import LoggingClient from '@/components/LoggingClient';
import { redirect } from 'next/navigation';

export default async function LogPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ op?: string; station?: string }>;
}) {
  const { code } = await params;
  const { op, station } = await searchParams;

  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, join_code, club_name, club_call, event_year, class, arrl_section, location, qrz_username, created_at')
    .eq('join_code', code.toUpperCase())
    .single();

  if (!event) redirect('/');

  // If no op set, redirect back to join page
  if (!op) redirect(`/event/${code}`);

  const { data: qsos } = await supabase
    .from('qsos')
    .select('*')
    .eq('event_id', event.id)
    .order('datetime_utc', { ascending: false })
    .limit(500);

  return (
    <LoggingClient
      event={event}
      initialQSOs={qsos ?? []}
      operatorCall={op.toUpperCase()}
      stationNumber={parseInt(station ?? '1', 10)}
    />
  );
}
