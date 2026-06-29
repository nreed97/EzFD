'use client';

import { useState, useEffect } from 'react';

interface Props {
  joinCode: string;
  operatorCall: string;
  stationNumber: number;
  onClose: () => void;
}

export default function WsjtxSetupHelp({ joinCode, operatorCall, stationNumber, onClose }: Props) {
  const [apiUrl, setApiUrl] = useState('');
  const [showAdif, setShowAdif] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => { setApiUrl(window.location.origin); }, []);

  const relayUrl = apiUrl
    ? `/api/download/relay?join_code=${encodeURIComponent(joinCode)}&operator=${encodeURIComponent(operatorCall)}&station=${stationNumber}&api_url=${encodeURIComponent(apiUrl)}`
    : '#';

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/75 p-4 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl my-8">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="font-bold text-zinc-100">Digital Mode Setup</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Auto-log WSJT-X and JTDX QSOs into EzFD</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl leading-none px-1">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* ── WINDOWS RELAY — hero option ── */}
          <div className="rounded-lg border border-amber-700/60 bg-amber-900/10 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-800/60 border border-amber-600 px-2 py-0.5 text-xs font-bold text-amber-300">
                Recommended · Windows
              </span>
              <span className="font-semibold text-zinc-100">One-click relay — runs in the background</span>
            </div>

            <p className="text-sm text-zinc-300">
              Download a pre-configured program for your computer. Double-click it before you start operating
              and every QSO you log in WSJT-X or JTDX will appear in EzFD automatically.
            </p>

            <p className="text-xs text-zinc-500">
              No installation required — uses PowerShell, which is already on your computer.
              {operatorCall && (
                <> Pre-configured for <span className="font-mono text-zinc-300">{operatorCall}</span>.</>
              )}
            </p>

            <a
              href={relayUrl}
              download="ezfd-wsjt-relay.bat"
              className={`flex items-center justify-center gap-2 rounded-lg bg-amber-400 py-2.5 font-bold text-zinc-900 text-sm hover:bg-amber-300 transition-colors ${!apiUrl ? 'pointer-events-none opacity-50' : ''}`}
            >
              <span>↓</span>
              <span>Download Relay for Windows</span>
            </a>

            <div className="rounded border border-zinc-700 bg-zinc-900 p-3 text-xs flex flex-col gap-2 text-zinc-400">
              <p className="font-semibold text-zinc-300">After downloading:</p>
              <p>
                <span className="text-amber-400 font-bold">1.</span>{' '}
                Save the file somewhere easy to find — your Desktop is fine.
              </p>
              <p>
                <span className="text-amber-400 font-bold">2.</span>{' '}
                Double-click <span className="font-mono text-zinc-200">ezfd-wsjt-relay.bat</span> — a small window will open.
                Leave it running.
              </p>
              <p>
                <span className="text-amber-400 font-bold">3.</span>{' '}
                Operate in WSJT-X or JTDX as normal. QSOs appear in EzFD within a second or two.
              </p>
              <p>
                <span className="text-amber-400 font-bold">4.</span>{' '}
                Close the window when you&apos;re done for the session.
              </p>
              <p className="text-zinc-600 pt-1">
                If Windows asks &ldquo;Do you want to allow this app to make changes?&rdquo; — click <strong>Yes</strong>.
                This is normal for .bat files.
              </p>
            </div>
          </div>

          {/* ── ADIF IMPORT — no-setup fallback ── */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowAdif(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-700 border border-zinc-600 px-2 py-0.5 text-xs font-bold text-zinc-300">
                  No setup needed
                </span>
                <span className="font-semibold text-zinc-200 text-sm">Import your log after operating</span>
              </div>
              <span className="text-zinc-500 text-sm shrink-0 ml-2">{showAdif ? '▲' : '▼'}</span>
            </button>

            {showAdif && (
              <div className="flex flex-col gap-3 pt-1">
                <p className="text-sm text-zinc-400">
                  WSJT-X and JTDX save every QSO to a file as you operate.
                  Upload that file to EzFD any time — even multiple times. Duplicates are detected automatically.
                </p>

                <div className="flex flex-col gap-1.5 text-sm text-zinc-400">
                  <p><span className="text-amber-400 font-bold">1.</span> Operate normally.</p>
                  <p>
                    <span className="text-amber-400 font-bold">2.</span>{' '}
                    Click <span className="font-mono bg-zinc-800 px-1 rounded text-xs text-zinc-200">Import ADIF</span> in the EzFD toolbar.
                  </p>
                  <p><span className="text-amber-400 font-bold">3.</span> Open the log file from one of these locations:</p>
                </div>

                <div className="rounded border border-zinc-700 bg-zinc-900 p-3 text-xs flex flex-col gap-1.5">
                  <div>
                    <span className="text-zinc-400 font-semibold">Windows: </span>
                    <span className="font-mono text-zinc-300">%LOCALAPPDATA%\WSJT-X\wsjtx_log.adi</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 font-semibold">Mac: </span>
                    <span className="font-mono text-zinc-300">~/Library/Application Support/WSJT-X/wsjtx_log.adi</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 font-semibold">Linux: </span>
                    <span className="font-mono text-zinc-300">~/.local/share/WSJT-X/wsjtx_log.adi</span>
                  </div>
                  <p className="text-zinc-600 mt-0.5">JTDX: same paths but in a <span className="font-mono">JTDX</span> folder.</p>
                </div>
              </div>
            )}
          </div>

          {/* ── ADVANCED: Node.js UDP bridge ── */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-800/20 p-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-xs text-zinc-500">
                  Advanced
                </span>
                <span className="text-zinc-500 text-sm">Node.js UDP bridge (Mac / Linux / technical users)</span>
              </div>
              <span className="text-zinc-600 text-sm shrink-0 ml-2">{showAdvanced ? '▲' : '▼'}</span>
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-3 pt-1 text-xs text-zinc-500">
                <p>
                  Requires <span className="text-zinc-300">Node.js</span> (nodejs.org) and uses the WSJT-X UDP protocol
                  for lower latency than the file watcher. In WSJT-X: File → Settings → Reporting → enable UDP Server (port 2237).
                </p>
                <div className="flex gap-2 flex-wrap">
                  <a
                    href="/api/download/wsjtx-bridge"
                    download="wsjtx-bridge.cjs"
                    className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                  >
                    ↓ wsjtx-bridge.cjs
                  </a>
                </div>
                {apiUrl && (
                  <div className="rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-zinc-500 break-all">
                    {`node wsjtx-bridge.cjs --join-code ${joinCode}${operatorCall ? ` --operator ${operatorCall}` : ''} --api-url ${apiUrl}`}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
