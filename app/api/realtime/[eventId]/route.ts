import { Client } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  // pg_notify channel — UUID hyphens are fine in text channel names
  const channel = `qsos_${eventId}`;

  const encoder = new TextEncoder();
  let pgClient: Client | null = null;
  let keepaliveId: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (keepaliveId) clearInterval(keepaliveId);
    if (pgClient) {
      pgClient.query('UNLISTEN *').finally(() => pgClient!.end()).catch(() => {});
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      pgClient = new Client({ connectionString: process.env.DATABASE_URL });

      try {
        await pgClient.connect();
        // Double-quote the channel name so hyphens in the UUID are safe
        await pgClient.query(`LISTEN "${channel}"`);

        // Initial heartbeat so the browser knows the stream is live
        controller.enqueue(encoder.encode(': connected\n\n'));

        // Keep the connection alive through proxies every 25s
        keepaliveId = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'));
        }, 25_000);

        pgClient.on('notification', (msg) => {
          if (closed || !msg.payload) return;
          controller.enqueue(encoder.encode(`event: qso\ndata: ${msg.payload}\n\n`));
        });

        pgClient.on('error', () => cleanup());
      } catch {
        cleanup();
        controller.close();
      }
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener('abort', cleanup);

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // tell nginx not to buffer SSE
    },
  });
}
