import { getPool } from '@/lib/db';
import { closeRealtime, subscribe } from '@/lib/realtime';
import { isUuid } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Every open stream, so a shutdown can end them. Next's SIGTERM handler closes
// the HTTP server and waits for each connection to finish — and an SSE stream
// never finishes while a tab is open, so `systemctl restart ezfd` sat there
// until systemd gave up and SIGKILLed at 90s, on every deploy. Ending the
// streams lets the close complete in milliseconds; each browser sees its
// stream drop, reconnects once the new process is up, and drains its offline
// queue on that reconnect, as it does after any outage.
// Held on globalThis so a dev reload of this module can't stack handlers or
// strand the streams opened before it.
const g = globalThis as { __ezfdOpenStreams?: Set<() => void> };
const openStreams = g.__ezfdOpenStreams ?? new Set<() => void>();
if (!g.__ezfdOpenStreams) {
  g.__ezfdOpenStreams = openStreams;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      for (const end of openStreams) end();
      closeRealtime();
    });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;

  // The id goes nowhere near SQL text until it is known to be a UUID that
  // names a real event. Unchecked, it was interpolated into LISTEN and ran as
  // SQL; unvalidated, any string held a stream (and once, a connection) open.
  if (!isUuid(eventId)) {
    return new Response('Not a valid event id', { status: 400 });
  }
  const { rows } = await getPool().query('SELECT 1 FROM events WHERE id = $1', [eventId]);
  if (!rows[0]) return new Response('Event not found', { status: 404 });

  // QSO inserts/updates/deletes, SES call checkouts and presence changes all
  // arrive on one stream, so the coordination grid and the band panel are
  // live rather than polled. The database side is shared — see lib/realtime.ts.
  const encoder = new TextEncoder();
  let keepaliveId: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  let endStream: (() => void) | null = null;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (endStream) openStreams.delete(endStream);
    if (keepaliveId) clearInterval(keepaliveId);
    unsubscribe?.();
  }

  const stream = new ReadableStream({
    async start(controller) {
      endStream = () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      };
      openStreams.add(endStream);

      try {
        unsubscribe = await subscribe(eventId, {
          deliver(name, payload) {
            if (closed) return;
            controller.enqueue(encoder.encode(`event: ${name}\ndata: ${payload}\n\n`));
          },
          end: () => endStream?.(),
        });
        // The browser may have gone while we were subscribing.
        if (closed) { unsubscribe(); return; }

        // Initial heartbeat so the browser knows the stream is live
        controller.enqueue(encoder.encode(': connected\n\n'));

        // Keep the connection alive through proxies every 25s
        keepaliveId = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'));
        }, 25_000);
      } catch {
        endStream();
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
