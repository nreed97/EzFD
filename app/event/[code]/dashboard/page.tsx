import { createServiceClient } from '@/lib/supabase-server';
import DashboardClient from '@/components/DashboardClient';
import { redirect } from 'next/navigation';

export default async function DashboardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, join_code, club_name, club_call, event_year, class, arrl_section, location, qrz_username, created_at')
    .eq('join_code', code.toUpperCase())
    .single();

  if (!event) redirect('/');

  const { data: qsos } = await supabase
    .from('qsos')
    .select('*')
    .eq('event_id', event.id)
    .order('datetime_utc', { ascending: true });

  return <DashboardClient event={event} initialQSOs={qsos ?? []} />;
}
