'use client';

import { useState } from 'react';

interface Props {
  rigConnected: boolean;
  canCw?: boolean;
  onClose: () => void;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-200 light:bg-zinc-100 light:text-zinc-800">
      {children}
    </code>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="text-sm text-zinc-300 light:text-zinc-700">
      <span className="text-amber-400 font-bold mr-1.5">{n}.</span>
      {children}
    </p>
  );
}

export default function RigControlHelp({ rigConnected, canCw, onClose }: Props) {
  const [showPlatform, setShowPlatform] = useState<'win' | 'mac' | 'linux'>('win');
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);

  const runCmd = showPlatform === 'win' ? 'python ezfd-rig-bridge.py' : 'python3 ezfd-rig-bridge.py';

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/75 p-4 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl my-8 light:border-zinc-200 light:bg-white">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 light:border-zinc-200">
          <div>
            <h2 className="font-bold text-zinc-100 light:text-zinc-900">Rig Control</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Auto-follow your VFO — band and mode update as you tune</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl leading-none px-1 light:hover:text-zinc-800">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4">

          {/* Status */}
          <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
            rigConnected
              ? 'border-green-700 bg-green-900/20 light:border-green-400 light:bg-green-50'
              : 'border-zinc-700 bg-zinc-800/40 light:border-zinc-300 light:bg-zinc-50'
          }`}>
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${rigConnected ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'}`} />
            <div>
              <p className={`text-sm font-semibold ${rigConnected ? 'text-green-300 light:text-green-700' : 'text-zinc-400 light:text-zinc-600'}`}>
                {rigConnected ? 'Connected — following your VFO' : 'Not connected'}
              </p>
              <p className="text-xs text-zinc-500 light:text-zinc-500 mt-0.5">
                {rigConnected
                  ? 'Band and mode update automatically as you tune. The bridge checks every 250 ms.'
                  : 'Run the bridge script on this computer to enable rig control.'}
              </p>
            </div>
          </div>

          {/* Download */}
          <a
            href="/ezfd-rig-bridge.py"
            download="ezfd-rig-bridge.py"
            className="flex items-center justify-center gap-2 rounded-lg border border-amber-600 bg-amber-400/10 py-2.5 text-sm font-bold text-amber-400 hover:bg-amber-400/20 transition-colors light:border-amber-500 light:text-amber-700 light:hover:bg-amber-50"
          >
            <span>↓</span>
            <span>Download ezfd-rig-bridge.py</span>
          </a>

          {/* Setup steps */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-4 flex flex-col gap-3 light:border-zinc-200 light:bg-zinc-50">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Setup</p>

            <Step n={1}>
              Make sure <strong className="text-zinc-200 light:text-zinc-800">Python 3</strong> is installed.
              Open a terminal and run <Code>python3 --version</Code> (Mac/Linux) or{' '}
              <Code>python --version</Code> (Windows). If not installed:{' '}
              <span className="text-zinc-400 light:text-zinc-600">python.org/downloads</span>
            </Step>

            <Step n={2}>
              Connect your rig to this computer via USB or serial cable and power it on.
            </Step>

            <Step n={3}>
              Run the bridge script — it will check for Hamlib, offer to install it if
              needed, then prompt for your rig model and serial port:
            </Step>

            {/* Platform tabs */}
            <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-xs font-semibold light:border-zinc-300">
              {(['win', 'mac', 'linux'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setShowPlatform(p)}
                  className={`flex-1 py-1.5 transition-colors ${
                    showPlatform === p
                      ? 'bg-zinc-700 text-zinc-100 light:bg-zinc-200 light:text-zinc-800'
                      : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 light:bg-white light:text-zinc-500 light:hover:text-zinc-700'
                  }`}
                >
                  {p === 'win' ? 'Windows' : p === 'mac' ? 'macOS' : 'Linux'}
                </button>
              ))}
            </div>

            <div className="rounded border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-400 flex flex-col gap-1.5 light:border-zinc-200 light:bg-zinc-100">
              {showPlatform === 'win' && (
                <>
                  <p>Open <strong className="text-zinc-300">Command Prompt</strong> or <strong className="text-zinc-300">PowerShell</strong>, navigate to where you saved the file, then run:</p>
                  <p className="font-mono text-zinc-200 bg-zinc-800 rounded px-2 py-1 light:bg-zinc-200 light:text-zinc-800">python ezfd-rig-bridge.py</p>
                  <p className="text-zinc-600">Tip: type <Code>cd Downloads</Code> if you saved it there.</p>
                </>
              )}
              {showPlatform === 'mac' && (
                <>
                  <p>Open <strong className="text-zinc-300">Terminal</strong>, navigate to where you saved the file, then run:</p>
                  <p className="font-mono text-zinc-200 bg-zinc-800 rounded px-2 py-1 light:bg-zinc-200 light:text-zinc-800">python3 ezfd-rig-bridge.py</p>
                  <p className="text-zinc-600">Tip: <Code>cd ~/Downloads && python3 ezfd-rig-bridge.py</Code></p>
                </>
              )}
              {showPlatform === 'linux' && (
                <>
                  <p>Open a terminal, navigate to where you saved the file, then run:</p>
                  <p className="font-mono text-zinc-200 bg-zinc-800 rounded px-2 py-1 light:bg-zinc-200 light:text-zinc-800">python3 ezfd-rig-bridge.py</p>
                  <p className="text-zinc-600">You can also make it executable: <Code>chmod +x ezfd-rig-bridge.py && ./ezfd-rig-bridge.py</Code></p>
                </>
              )}
            </div>

            <Step n={4}>
              When prompted for a <strong className="text-zinc-200 light:text-zinc-800">rig model</strong>, type{' '}
              <Code>s</Code> to search — enter your manufacturer or model name (e.g.{' '}
              <Code>icom</Code>, <Code>kenwood</Code>, <Code>ft-991</Code>, <Code>flex</Code>) and pick
              from a numbered list. Already know your model number? Type it directly instead.
            </Step>

            <Step n={5}>
              Enter your <strong className="text-zinc-200 light:text-zinc-800">serial port</strong>.
              Common values:
            </Step>

            <div className="rounded border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-zinc-500 light:border-zinc-200 light:bg-zinc-50">
              {showPlatform === 'win' && (
                <p><Code>COM3</Code> <Code>COM4</Code> <Code>COM5</Code> <span className="text-zinc-600 ml-1">— check Device Manager if unsure which port</span></p>
              )}
              {showPlatform === 'mac' && (
                <p><Code>/dev/cu.usbserial-*</Code> <span className="text-zinc-600 mx-1">or</span> <Code>/dev/cu.SLAB_USBtoUART</Code> <span className="text-zinc-600 ml-1">— run <code className="text-zinc-400">ls /dev/cu.*</code> to list available ports</span></p>
              )}
              {showPlatform === 'linux' && (
                <p><Code>/dev/ttyUSB0</Code> <span className="text-zinc-600 mx-1">or</span> <Code>/dev/ttyACM0</Code> <span className="text-zinc-600 ml-1">— run <code className="text-zinc-400">ls /dev/tty{'{USB,ACM}'}*</code> to list available ports</span></p>
              )}
            </div>

            <Step n={6}>
              If your model can connect either way (e.g. FlexRadio SmartSDR), you&apos;ll be
              asked to choose <strong className="text-zinc-200 light:text-zinc-800">serial/USB or network IP</strong>.
              A SmartCAT virtual COM port counts as serial — pick serial and use the{' '}
              <strong className="text-zinc-200 light:text-zinc-800">Kenwood TS-2000</strong> model
              instead of the FlexRadio-specific one, since SmartCAT emulates Kenwood CAT.
            </Step>

            <Step n={7}>
              Leave the terminal window open. EzFD will connect automatically —
              look for the <span className="text-green-400 font-semibold">● RIG</span> badge in the header.
              Settings are saved to <Code>~/.ezfd-rig.json</Code> so future runs need no prompts.
            </Step>
          </div>

          {/* CW keying */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-4 flex flex-col gap-2 light:border-zinc-200 light:bg-zinc-50">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">CW Macros &amp; Keying</p>
              {rigConnected && (
                <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                  canCw
                    ? 'bg-green-900/40 text-green-400 light:bg-green-100 light:text-green-700'
                    : 'bg-zinc-700 text-zinc-400 light:bg-zinc-200 light:text-zinc-600'
                }`}>
                  {canCw ? 'AVAILABLE' : 'NOT SUPPORTED'}
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-300 light:text-zinc-700">
              If your rig supports CAT-based CW sending, the bridge script detects it automatically
              at startup and a{' '}
              <span className="text-amber-400 font-semibold">⚡ CW</span> button appears in EzFD&apos;s
              header. Click it to pop out a separate keying window — sized and positioned like an
              N1MM entry window — with its own callsign/exchange fields, F1–F12 macro buttons, a
              speed control, and full QSO logging.
            </p>
            <ul className="text-xs text-zinc-400 light:text-zinc-600 list-disc pl-4 flex flex-col gap-1">
              <li><strong className="text-zinc-300 light:text-zinc-700">RUN / S&amp;P toggle</strong> — separate macro sets for calling CQ versus hunting for stations; each remembers its own F1–F12</li>
              <li><strong className="text-zinc-300 light:text-zinc-700">ESM</strong> (Enter Sends Message, N1MM-style) — with an empty callsign, Enter sends CQ (RUN mode); with a callsign but no exchange yet, Enter sends your call/exchange macro; once the exchange fields are filled, Enter sends TU and logs the QSO in one keystroke</li>
              <li>Click EDIT to open all 12 macro slots at once — SAVE or CANCEL when done, saved per operator in this browser</li>
              <li>Placeholders: <Code>{'{call}'}</Code> worked station, <Code>{'{class}'}</Code>/<Code>{'{section}'}</Code> their exchange, <Code>{'{mycall}'}</Code> the event/club callsign, <Code>{'{exch}'}</Code> your own class+section</li>
              <li>F1–F12 keys on your keyboard fire the matching macro; <strong>Space bar</strong> aborts mid-send</li>
              <li>Not all rigs expose CAT CW sending — Icom, Elecraft, Yaesu (most models), and FlexRadio
                  generally support it; older or CAT-only interfaces often don&apos;t. If your rig doesn&apos;t
                  support it, band/mode auto-follow and logging still work fine — you&apos;ll just key by hand.</li>
            </ul>
          </div>

          <p className="text-xs text-zinc-600 light:text-zinc-500">
            Rig control is completely optional. Operators without it can set band and mode manually as usual.
            The bridge script only runs on your local machine and never sends data to the EzFD server.
          </p>

          {/* Troubleshooting */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-800/20 p-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowTroubleshoot(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-zinc-500 text-sm">Troubleshooting</span>
              <span className="text-zinc-600 text-sm shrink-0 ml-2">{showTroubleshoot ? '▲' : '▼'}</span>
            </button>
            {showTroubleshoot && (
              <div className="flex flex-col gap-2 pt-1 text-xs text-zinc-500">
                <p>
                  <strong className="text-zinc-300">Rig connects but band/mode never update:</strong>{' '}
                  the port opened but the rig isn&apos;t responding. Run rigctld directly with{' '}
                  <Code>-vvvvv</Code> to see the raw traffic — a repeating <Code>write_block failed</Code>{' '}
                  error usually means hardware handshake is enabled on a virtual port that doesn&apos;t
                  support it. The bridge script now disables handshake by default for serial connections,
                  so this mainly affects configs saved before that fix — delete{' '}
                  <Code>~/.ezfd-rig.json</Code> and reconfigure to pick it up.
                </p>
                <p>
                  <strong className="text-zinc-300">Wrong model picked from search:</strong>{' '}
                  some manufacturer-specific models (e.g. FlexRadio&apos;s native models) only work over
                  the network, never a COM port, regardless of what port you give them. If serial doesn&apos;t
                  work, try the Kenwood TS-2000 emulation instead — many virtual CAT ports speak that
                  protocol even for other-brand radios.
                </p>
                <p>
                  <strong className="text-zinc-300">CW macro panel doesn&apos;t appear:</strong>{' '}
                  the bridge checks CW support once at startup and prints whether it found it. Check the
                  terminal running the bridge script for a line saying whether CW keying is available.
                </p>
              </div>
            )}
          </div>

        </div>

        <div className="flex justify-end border-t border-zinc-800 px-5 py-3 light:border-zinc-200">
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
