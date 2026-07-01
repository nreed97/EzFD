'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Band, Mode } from '@/lib/types';

interface Options {
  onBand?: (b: Band) => void;
  onMode?: (m: Mode) => void;
}

const RIG_WS = 'ws://localhost:4575';

export function useRigBridge({ onBand, onMode }: Options = {}) {
  const [connected, setConnected] = useState(false);
  const [freq, setFreq] = useState<number | null>(null);
  const [canCw, setCanCw] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onBandRef = useRef(onBand);
  const onModeRef = useRef(onMode);
  onBandRef.current = onBand;
  onModeRef.current = onMode;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      ws = new WebSocket(RIG_WS);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'caps') { setCanCw(!!msg.can_cw); return; }
          if (msg.type === 'cw_error') { return; }
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
  }, []);

  const sendCw = useCallback((text: string, wpm: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'send_cw', text, wpm }));
    }
  }, []);

  const stopCw = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop_cw' }));
    }
  }, []);

  return { connected, freq, canCw, sendCw, stopCw };
}
