'use client';

import { useState } from 'react';

interface Props {
  rigConnected: boolean;
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

export default function RigControlHelp({ rigConnected, onClose }: Props) {
  const [showPlatform, setShowPlatform] = useState<'win' | 'mac' | 'linux'>('win');

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
              When prompted, enter your <strong className="text-zinc-200 light:text-zinc-800">rig model number</strong>.
              Not sure? Run <Code>rigctld --list</Code> in a terminal after Hamlib is installed
              and search for your rig by name.
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
              Leave the terminal window open. EzFD will connect automatically —
              look for the <span className="text-green-400 font-semibold">● RIG</span> badge in the header.
              Settings are saved to <Code>~/.ezfd-rig.json</Code> so future runs need no prompts.
            </Step>
          </div>

          <p className="text-xs text-zinc-600 light:text-zinc-500">
            Rig control is completely optional. Operators without it can set band and mode manually as usual.
            The bridge script only runs on your local machine and never sends data to the EzFD server.
          </p>

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
