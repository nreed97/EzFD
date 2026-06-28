import { NextResponse } from 'next/server';
import { lookupCallsign } from '@/lib/qrz';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const callsign = url.searchParams.get('callsign');
  const eventId = url.searchParams.get('event_id');

  if (!callsign || !eventId) {
    return NextResponse.json({ error: 'callsign and event_id required' }, { status: 400 });
  }

  try {
    const result = await lookupCallsign(eventId, callsign);
    return NextResponse.json(result);
  } catch (err) {
    console.error('QRZ lookup error:', err);
    return NextResponse.json({ callsign, name: null, state: null, country: null, grid: null });
  }
}
