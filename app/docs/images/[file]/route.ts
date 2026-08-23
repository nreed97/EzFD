import { NextResponse } from 'next/server';
import { readDocImage } from '@/lib/docs';

/**
 * Screenshots referenced from the guides.
 *
 * The guides write them as `images/foo.png`, which is correct on GitHub and,
 * because every guide renders under `/docs/`, resolves to this route in the
 * app as well. Neither the markdown nor the image needs a second copy.
 */
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const data = readDocImage(file);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
