import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase.from('qsos').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete QSO' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
