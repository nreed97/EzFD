'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Band, Mode } from '@/lib/types';

interface Options {
  onBand?: (b: Band) => void;
  onMode?: (m: Mode) => void;
  /** WebSocket port of this radio's bridge. See rigPortForStation(). */
  port?: number;
}

const RIG_WS_DEFAULT_PORT = 4575;

/** Each radio needs its own bridge process, and each bridge binds its own
 *  port (`ezfd-rig-bridge.py --port`). Station 1 uses the default so the
 *  single-radio setup needs no arguments; station 2 talks to 4576, and so on.
 *  Without this the second window would fight the first for one connection. */
export function rigPortForStation(station: number): number {
  return RIG_WS_DEFAULT_PORT + Math.max(0, (station || 1) - 1);
}

export function useRigBridge({ onBand, onMode, port = RIG_WS_DEFAULT_PORT }: Options = {}) {
  const [connected, setConnected] = useState(false);
  const [freq, setFreq] = useState<number | null>(null);
  const [canCw, setCanCw] = useState(false);
  const [cwError, setCwError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // The callbacks live in refs, not in the socket effect's dependency list.
  // LoggingClient re-renders on every rig frequency tick (~4/sec), so an
  // inline arrow prop gets a fresh identity that often; depending on it
  // directly would tear down and reopen the WebSocket each time. AGENTS.md
  // records this pattern because losing it once stopped an auto-CQ timer from
  // ever completing its interval.
  //
  // The assignment belongs in an effect rather than in the render body — the
  // same shape SlotCoordination already uses for activeRef. Writing a ref
  // during render is what `react-hooks/refs` objects to, and it makes the
  // render non-idempotent under StrictMode's double-invoke.
  const onBandRef = useRef(onBand);
  const onModeRef = useRef(onMode);
  useEffect(() => { onBandRef.current = onBand; }, [onBand]);
  useEffect(() => { onModeRef.current = onMode; }, [onMode]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      ws = new WebSocket(`ws://localhost:${port}`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'caps') { setCanCw(!!msg.can_cw); return; }
          if (msg.type === 'cw_error') { setCwError(String(msg.error ?? 'Unknown CW send error')); return; }
          const { band, mode, freq: f } = msg as { band?: Band; mode?: string; freq?: number };
          if (band) onBandRef.current?.(band);
          if (mode === 'PH' || mode === 'CW' || mode === 'DIG') onModeRef.current?.(mode);
          if (f) setFreq(f);
        } catch { /* ignore malformed frames */ }
      };

      ws.onclose = () => {
        setConnected(false);
        setFreq(null);
        setCanCw(false);
        // Retry every 10 s so the rig can be plugged in mid-session
        retryTimer = setTimeout(connect, 10_000);
      };

      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [port]);

  const sendCw = useCallback((text: string, wpm: number) => {
    setCwError(null);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'send_cw', text, wpm }));
    } else {
      setCwError('Not connected to the rig bridge');
    }
  }, []);

  const stopCw = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop_cw' }));
    }
  }, []);

  return { connected, freq, canCw, cwError, sendCw, stopCw };
}
