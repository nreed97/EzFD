import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const body = await request.json();
  const { event_id, callsign, band, mode, rcvd_class, rcvd_section, operator_call, station_number } = body;

  if (!event_id || !callsign || !band || !mode) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('class, arrl_section')
    .eq('id', event_id)
    .single();

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // Dupe check: same callsign + band + mode in this event (excluding prior dupes)
  const { data: existing } = await supabase
    .from('qsos')
    .select('id')
    .eq('event_id', event_id)
    .eq('callsign', callsign.toUpperCase())
    .eq('band', band)
    .eq('mode', mode)
    .eq('is_dupe', false)
    .maybeSingle();

  const is_dupe = !!existing;

  const { data, error } = await supabase
    .from('qsos')
    .insert({
      event_id,
      callsign: callsign.toUpperCase().trim(),
      band,
      mode,
      datetime_utc: new Date().toISOString(),
      sent_class: event.class,
      sent_section: event.arrl_section,
      rcvd_class: rcvd_class?.toUpperCase().trim() ?? null,
      rcvd_section: rcvd_section?.toUpperCase().trim() ?? null,
      operator_call: operator_call?.toUpperCase().trim() ?? null,
      station_number: station_number ?? 1,
      is_dupe,
    })
    .select()
    .single();

  if (error) {
    console.error('QSO insert error:', error);
    return NextResponse.json({ error: 'Failed to log QSO' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('event_id');
  if (!eventId) return NextResponse.json({ error: 'event_id required' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('qsos')
    .select('*')
    .eq('event_id', eventId)
    .order('datetime_utc', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to fetch QSOs' }, { status: 500 });
  return NextResponse.json(data);
}
