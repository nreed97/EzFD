'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Band, Mode } from './types';
import {
  freqCommandFor, freqToBand, parseFrame, splitFrames,
  type VfoLetter,
} from './catProtocol';

/**
 * Browser-native CAT control over Web Serial (#65) — the read path.
 *
 * An **additional** transport, never a replacement. `ezfd-rig-bridge.py` and
 * the WebSocket path in `useRigBridge` are untouched and remain the default:
 * Web Serial is Chromium-only, needs a secure context, and speaks only the
 * dialects implemented here, while the bridge goes through Hamlib and handles
 * some 200 radios on any browser. A club on Firefox, on iOS, or on a
 * plain-HTTP field server — a deployment this app explicitly supports — must
 * see no change at all, which is why nothing here runs until an operator picks
 * a port by hand.
 *
 * What it removes for the setups it does fit: Python, Hamlib, a second process
 * kept alive next to the browser, and a second bridge on another port for the
 * second radio. Each browser window grants its own port, so two radios need no
 * port arithmetic on this path.
 *
 * Read only, deliberately. Keying is a Hamlib feature (`\send_morse`) with
 * per-radio equivalents to discover, and the issue's own advice is to answer
 * the cheap question — can this read frequency and mode reliably — before
 * committing to more.
 */

/** How often to ask the radio where it is. The bridge polls at 4 Hz. */
const POLL_MS = 250;

/** Give up on a reply and re-ask; a rig that is off answers nothing at all. */
const REPLY_TIMEOUT_MS = 1_000;

export interface SerialRigOptions {
  /** Called when the radio reports a new band, mirroring `useRigBridge`. */
  onBand?: (b: Band) => void;
  onMode?: (m: Mode) => void;
}

export interface SerialRigState {
  /** The browser exposes Web Serial and the page may use it. */
  supported: boolean;
  /** Why it cannot be used here, for a message an operator can act on. */
  unsupportedReason: string | null;
  connected: boolean;
  freq: number | null;
  band: Band | null;
  mode: Mode | null;
  error: string | null;
  /** Must be called from a user gesture — the browser requires one. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

// Web Serial is not in this project's DOM lib. Only what is used is declared,
// rather than pulling in a types package for one prototype path.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}
function serialOf(nav: Navigator): SerialLike | null {
  return (nav as unknown as { serial?: SerialLike }).serial ?? null;
}

/* Availability is a browser fact, so it is read through the store rather than
   in an effect — the same reason `useOnline` exists. Rendering "not supported"
   for one frame and then correcting it would flash the fallback message at
   every Chromium operator. */
const subscribeNever = () => () => {};
const getSupport = (): string => {
  if (typeof navigator === 'undefined' || !serialOf(navigator)) {
    return 'This browser has no Web Serial support. Chrome, Edge and other ' +
           'Chromium browsers have it; Firefox and Safari do not, and neither ' +
           'does any browser on iOS.';
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Web Serial needs a secure context. This page is served over plain ' +
           'HTTP, so the browser will not offer serial ports.';
  }
  return '';
};
// The server has neither navigator nor window; report unsupported so the
// markup matches what an unsupported client renders and hydration is quiet.
const getServerSupport = () => 'Checking browser support…';

export function useSerialRig({ onBand, onMode }: SerialRigOptions = {}): SerialRigState {
  const reason = useSyncExternalStore(subscribeNever, getSupport, getServerSupport);
  const supported = reason === '';

  const [connected, setConnected] = useState(false);
  const [freq, setFreq] = useState<number | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Callbacks live in refs, not in any dependency list — the same reason
  // `useRigBridge` does it. The logging screen re-renders on every frequency
  // tick, so an inline arrow prop gets a fresh identity several times a
  // second; depending on it would tear down the read loop that often.
  const onBandRef = useRef(onBand);
  const onModeRef = useRef(onMode);
  useEffect(() => { onBandRef.current = onBand; }, [onBand]);
  useEffect(() => { onModeRef.current = onMode; }, [onMode]);

  const portRef = useRef<SerialPortLike | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const stopRef = useRef(false);

  const teardown = useCallback(async () => {
    stopRef.current = true;
    try { await readerRef.current?.cancel(); } catch { /* already gone */ }
    try { readerRef.current?.releaseLock(); } catch { /* not held */ }
    try { writerRef.current?.releaseLock(); } catch { /* not held */ }
    try { await portRef.current?.close(); } catch { /* already closed */ }
    readerRef.current = null;
    writerRef.current = null;
    portRef.current = null;
    setConnected(false);
    setFreq(null);
    setBand(null);
    setMode(null);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const serial = typeof navigator === 'undefined' ? null : serialOf(navigator);
    if (!serial) { setError(getSupport()); return; }

    let port: SerialPortLike;
    try {
      // Requires a user gesture, and the grant is per-port and per-origin.
      port = await serial.requestPort();
      await port.open({ baudRate: 38400 });
    } catch (e) {
      // A cancelled picker is the commonest outcome and is not a failure.
      const msg = e instanceof Error ? e.message : String(e);
      setError(/No port selected|cancelled|aborted/i.test(msg) ? null : `Could not open the port: ${msg}`);
      return;
    }

    portRef.current = port;
    stopRef.current = false;
    setConnected(true);

    const encoder = new TextEncoder();
    const writer = port.writable?.getWriter() ?? null;
    const reader = port.readable?.getReader() ?? null;
    writerRef.current = writer;
    readerRef.current = reader;
    if (!writer || !reader) {
      setError('The port opened but offers no read/write stream.');
      await teardown();
      return;
    }

    // Whichever VFO the radio last said it was receiving on. Polling this is
    // what stops the frequency being read off VFO A while the operator works
    // split on B — a wrong frequency picks a wrong band, and the band is what
    // the contact is logged and scored on.
    let vfo: VfoLetter = 'A';
    let buffer = '';

    const pump = async () => {
      const decoder = new TextDecoder();
      try {
        while (!stopRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = splitFrames(buffer);
          buffer = rest;
          for (const raw of frames) {
            const f = parseFrame(raw);
            if (!f) continue;                       // rigs volunteer plenty
            if (f.kind === 'vfo') { if (f.vfo !== 'MEM') vfo = f.vfo; continue; }
            if (f.kind === 'mode') { setMode(f.mode); onModeRef.current?.(f.mode); continue; }
            if (f.kind === 'freq' && f.vfo === vfo) {
              setFreq(f.hz);
              const b = freqToBand(f.hz);
              setBand(b);
              // Out-of-band reads leave the form's band alone rather than
              // clearing it: a rig parked on 10.1 MHz between contacts should
              // not wipe the band the operator was just working.
              if (b) onBandRef.current?.(b);
            }
          }
        }
      } catch (e) {
        if (!stopRef.current) {
          setError(`Lost the serial connection: ${e instanceof Error ? e.message : String(e)}`);
          void teardown();
        }
      }
    };

    const ask = async () => {
      let quiet = 0;
      while (!stopRef.current) {
        try {
          await writer.write(encoder.encode(`FR;${freqCommandFor(vfo)}MD;`));
          quiet = 0;
        } catch {
          quiet += POLL_MS;
          if (quiet > REPLY_TIMEOUT_MS && !stopRef.current) {
            setError('The radio stopped responding.');
            void teardown();
            return;
          }
        }
        await new Promise(r => setTimeout(r, POLL_MS));
      }
    };

    void pump();
    void ask();
  }, [teardown]);

  const disconnect = useCallback(async () => { await teardown(); }, [teardown]);

  // A port left open survives the component but not the tab, and an operator
  // who closes the logging window should not have to unplug the radio for the
  // next window to claim it.
  useEffect(() => () => { void teardown(); }, [teardown]);

  return {
    supported,
    unsupportedReason: supported ? null : reason,
    connected, freq, band, mode, error,
    connect, disconnect,
  };
}
