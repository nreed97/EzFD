import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const scriptPath = join(process.cwd(), 'scripts', 'wsjtx-bridge.cjs');
    const content = readFileSync(scriptPath, 'utf8');
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="wsjtx-bridge.cjs"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Script not found' }, { status: 404 });
  }
}
