'use client';

import type { SerialRigState } from '@/lib/useSerialRig';

/**
 * Rig control: what is connected, and how to connect one.
 *
 * This used to be a 341-line setup page — per-operating-system install steps,
 * example port names for three platforms, a troubleshooting section — read
 * inside a modal on top of the logging screen. All of it is in the rig control
 * guide, which is where a reader can search it, and none of it changed often
 * enough to justify a second copy that could drift from the first.
 *
 * What stays is what an operator needs *without* leaving the logger: whether a
 * radio is talking, the button that connects one, and the few lines of setup
 * that get the bridge running. Everything past that is a link.
 */

interface Props {
  /** The Python bridge's WebSocket connection. */
  rigConnected: boolean;
  canCw?: boolean;
  /** The browser-native path (#65). Offered alongside the bridge, never
   *  instead of it. */
  serial?: SerialRigState;
  onClose: () => void;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 light:bg-zinc-100 light:text-zinc-800">
      {children}
    </code>
  );
}

/** A link into the guide. Opens in a tab so a mid-event lookup never costs the
 *  operator their logging window — the same rule the menu's Guides entry uses. */
function Doc({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a
      href={`/docs/rig-control${to}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-amber-400 underline decoration-dotted underline-offset-2 hover:text-amber-300 light:text-amber-700"
    >
      {children} ↗
    </a>
  );
}

export default function RigControlHelp({ rigConnected, canCw, serial, onClose }: Props) {
  const serialOn = serial?.connected ?? false;
  const anyOn = rigConnected || serialOn;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/75 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Rig control"
        className="my-8 w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl light:border-zinc-200 light:bg-white"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-800 px-4 py-3 light:border-zinc-200">
          <div>
            <h2 className="font-bold text-zinc-100 light:text-zinc-900">Rig control</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Band and mode follow the VFO as you tune</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {/* ── Status ─────────────────────────────────────────────────── */}
          <div className={`rounded-lg border px-3 py-2 ${
            anyOn
              ? 'border-green-800 bg-green-900/20'
              : 'border-zinc-800 bg-zinc-800/40 light:border-zinc-200 light:bg-zinc-100'
          }`}>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${anyOn ? 'animate-pulse bg-green-400' : 'bg-zinc-600'}`} />
              <span className={`text-sm font-semibold ${anyOn ? 'text-green-300 light:text-green-700' : 'text-zinc-400 light:text-zinc-600'}`}>
                {rigConnected ? 'Connected through the bridge' : serialOn ? 'Connected over Web Serial' : 'No radio connected'}
              </span>
            </div>
            {serialOn && !rigConnected && (
              <p className="mt-1 font-mono text-xs text-green-400">
                {serial?.freq != null ? `${(serial.freq / 1e6).toFixed(4)} MHz` : 'reading…'}
                {serial?.band ? ` · ${serial.band}` : ''}
                {serial?.mode ? ` · ${serial.mode}` : ''}
              </p>
            )}
            {rigConnected && (
              <p className="mt-1 text-xs text-zinc-500">
                {canCw ? 'This radio can key CW — the CW button is in the header.' : 'This radio does not report CAT CW keying.'}
              </p>
            )}
          </div>

          {/* ── Connect in this browser ────────────────────────────────── */}
          {serial && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                In this browser
              </p>
              {serial.supported ? (
                <>
                  <p className="mb-2 text-xs text-zinc-400 light:text-zinc-600">
                    Nothing to install. Kenwood and Elecraft commands only, which
                    covers FlexRadio SmartCAT. Reading only — CW keying needs the
                    bridge. <Doc to="#connecting-directly">How this works</Doc>
                  </p>
                  {serial.connected ? (
                    <button
                      type="button"
                      onClick={() => { void serial.disconnect(); }}
                      className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-700 light:hover:bg-zinc-100"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void serial.connect(); }}
                      className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-amber-300"
                    >
                      Choose the radio&apos;s port
                    </button>
                  )}
                  {serial.error && <p className="mt-1.5 text-xs text-red-400">{serial.error}</p>}
                </>
              ) : (
                <p className="text-xs text-zinc-400 light:text-zinc-600">
                  {serial.unsupportedReason} The bridge below works everywhere.
                </p>
              )}
            </div>
          )}

          {/* ── The bridge ─────────────────────────────────────────────── */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              With the bridge
            </p>
            <p className="mb-2 text-xs text-zinc-400 light:text-zinc-600">
              Every browser, ~200 radios through Hamlib, and the only path that
              keys CW.
            </p>
            {/* The three lines that actually get it running. Anything more —
                per-platform commands, port names, flags — is in the guide. */}
            <ol className="space-y-1.5 text-xs text-zinc-300 light:text-zinc-700">
              <li>
                <span className="mr-1 font-bold text-amber-400">1.</span>
                <a href="/ezfd-rig-bridge.py" download className="text-amber-400 underline decoration-dotted underline-offset-2 hover:text-amber-300 light:text-amber-700">
                  Download ezfd-rig-bridge.py
                </a>
              </li>
              <li>
                <span className="mr-1 font-bold text-amber-400">2.</span>
                Plug the radio in, then run <Code>python3 ezfd-rig-bridge.py</Code>
              </li>
              <li>
                <span className="mr-1 font-bold text-amber-400">3.</span>
                Answer the radio model and port prompts once — it remembers them.
              </li>
            </ol>
            <p className="mt-2 text-[11px] text-zinc-500">
              It installs Hamlib if you need it. <Doc to="#setup">Full setup</Doc>
              {' · '}<Doc to="#options">Options</Doc>
            </p>
          </div>

          {/* ── Where to read more ─────────────────────────────────────── */}
          <div className="border-t border-zinc-800 pt-3 light:border-zinc-200">
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
              <Doc to="#cw-keying">CW keying and macros</Doc>
              <Doc to="#radio-specific-notes">Radio-specific notes</Doc>
              <Doc to="#troubleshooting">Troubleshooting</Doc>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
