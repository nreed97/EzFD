'use client';

// A 24-hour time picker: two numeric HH/MM inputs (never AM/PM, unlike a
// native <input type="time"> whose display format follows the browser's
// locale) plus a click-or-drag analog clock face for picking visually.
// Modeled on the Material Design 24h clock: hours 0-11 sit on the outer
// ring, 12-23 on the inner ring; picking an hour advances to minutes.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const CX = 100;
const CY = 100;
const FACE_R = 96;
const OUTER_R = 76;
const INNER_R = 46;
const MINUTE_R = 76;

// Angle (degrees, 0 = up, clockwise) from the clock center to a client point.
function angleFromCenter(svg: SVGSVGElement, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 200;
  const y = ((clientY - rect.top) / rect.height) * 200;
  const dx = x - CX;
  const dy = y - CY;
  const dist = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * (180 / Math.PI) + 90 + 360) % 360;
  return { angle, dist };
}

function ClockFace({
  hour,
  minute,
  onPick,
}: {
  hour: number;
  minute: number;
  onPick: (h: number, m: number, commit: boolean) => void;
}) {
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const valueFromEvent = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const { angle, dist } = angleFromCenter(svg, clientX, clientY);
    if (mode === 'hour') {
      const idx = Math.round(angle / 30) % 12;
      const outer = dist > (OUTER_R + INNER_R) / 2;
      const h = outer ? idx : idx === 0 ? 12 : idx + 12;
      return { hour: h, minute };
    }
    const m = Math.round(angle / 6) % 60;
    return { hour, minute: m };
  }, [mode, hour, minute]);

  function handleDown(e: React.PointerEvent<SVGSVGElement>) {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const v = valueFromEvent(e.clientX, e.clientY);
    if (v) onPick(v.hour, v.minute, false);
  }
  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    const v = valueFromEvent(e.clientX, e.clientY);
    if (v) onPick(v.hour, v.minute, false);
  }
  function handleUp(e: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const v = valueFromEvent(e.clientX, e.clientY);
    if (v) onPick(v.hour, v.minute, true);
    if (mode === 'hour') setMode('minute');
  }

  const positions: { label: string; angleDeg: number; r: number; active: boolean }[] = [];
  if (mode === 'hour') {
    for (let i = 0; i < 12; i++) {
      const angleDeg = i * 30;
      positions.push({ label: pad2(i), angleDeg, r: OUTER_R, active: hour === i });
      const h2 = i === 0 ? 12 : i + 12;
      positions.push({ label: pad2(h2), angleDeg, r: INNER_R, active: hour === h2 });
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const m = i * 5;
      positions.push({ label: pad2(m), angleDeg: i * 30, r: MINUTE_R, active: minute === m });
    }
  }

  const handAngle = mode === 'hour'
    ? (hour % 12) * 30
    : minute * 6;
  const handR = mode === 'hour' ? (hour < 12 ? OUTER_R : INNER_R) : MINUTE_R;
  const handX = CX + handR * Math.sin((handAngle * Math.PI) / 180);
  const handY = CY - handR * Math.cos((handAngle * Math.PI) / 180);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1 text-sm text-zinc-500">
        <button
          type="button"
          onClick={() => setMode('hour')}
          className={mode === 'hour' ? 'font-semibold text-amber-400' : 'hover:text-zinc-300'}
        >
          Hour
        </button>
        <span>&middot;</span>
        <button
          type="button"
          onClick={() => setMode('minute')}
          className={mode === 'minute' ? 'font-semibold text-amber-400' : 'hover:text-zinc-300'}
        >
          Minute
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="h-56 w-56 touch-none select-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <circle cx={CX} cy={CY} r={FACE_R} className="fill-zinc-800 light:fill-zinc-100" />
        <line x1={CX} y1={CY} x2={handX} y2={handY} className="stroke-amber-400" strokeWidth={2} />
        <circle cx={CX} cy={CY} r={3} className="fill-amber-400" />
        <circle cx={handX} cy={handY} r={13} className="fill-amber-400/20" />
        {positions.map(p => {
          const rad = (p.angleDeg * Math.PI) / 180;
          const x = CX + p.r * Math.sin(rad);
          const y = CY - p.r * Math.cos(rad);
          return (
            <text
              key={`${p.r}-${p.angleDeg}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className={`pointer-events-none text-[13px] font-mono ${
                p.active ? 'fill-zinc-900 font-bold' : 'fill-zinc-300 light:fill-zinc-600'
              }`}
            >
              {p.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function ClockTimePicker({
  value,
  onChange,
  label,
  className = '',
  compact = false,
}: {
  /** 24-hour "HH:MM", or "" for unset. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  /** Smaller footprint for dense panels like SES call checkout. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [h, m] = value ? value.split(':').map(n => parseInt(n, 10)) : [0, 0];
  const hour = Number.isFinite(h) ? h : 0;
  const minute = Number.isFinite(m) ? m : 0;

  // Popover width the panel below is given explicitly (w-64) so this can
  // clamp against it exactly, and it's positioned `fixed` from the trigger's
  // own viewport rect rather than `absolute` under it — a field near the
  // right edge of a narrow column (the two-up Starts/Ends row, or the SES
  // sidebar) would otherwise push the clock face off the page.
  const POPOVER_W = 256;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    function reposition() {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const left = clamp(rect.left, margin, Math.max(margin, window.innerWidth - POPOVER_W - margin));
      const top = clamp(rect.bottom + 4, margin, Math.max(margin, window.innerHeight - margin));
      setPos({ top, left });
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function setHour(newHour: string) {
    const n = clamp(parseInt(newHour, 10) || 0, 0, 23);
    onChange(`${pad2(n)}:${pad2(minute)}`);
  }
  function setMinute(newMinute: string) {
    const n = clamp(parseInt(newMinute, 10) || 0, 0, 59);
    onChange(`${pad2(hour)}:${pad2(n)}`);
  }

  const wrapperClass = compact
    ? 'flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[11px] text-zinc-300 light:border-zinc-300 light:bg-white light:text-zinc-700'
    : 'input flex items-center gap-1 py-1';
  const digitWidth = compact ? 'w-5' : 'w-7';
  const iconSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className={wrapperClass}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={value ? pad2(hour) : ''}
          placeholder="HH"
          onChange={e => setHour(e.target.value.replace(/\D/g, ''))}
          aria-label={label ? `${label} hour (24h)` : 'Hour (24h)'}
          className={`${digitWidth} border-0 bg-transparent p-0 text-center font-mono focus:outline-none`}
        />
        <span className="text-zinc-500">:</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={value ? pad2(minute) : ''}
          placeholder="MM"
          onChange={e => setMinute(e.target.value.replace(/\D/g, ''))}
          aria-label={label ? `${label} minute` : 'Minute'}
          className={`${digitWidth} border-0 bg-transparent p-0 text-center font-mono focus:outline-none`}
        />
        {!compact && <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-500">24h</span>}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label="Open clock picker"
          className={`${compact ? '' : 'ml-1'} rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-amber-400 light:hover:bg-zinc-200`}
        >
          <svg viewBox="0 0 24 24" className={iconSize} fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && pos && (
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_W }}
          className="z-50 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-xl light:border-zinc-300 light:bg-white"
        >
          <ClockFace
            hour={hour}
            minute={minute}
            onPick={(newHour, newMinute) => onChange(`${pad2(newHour)}:${pad2(newMinute)}`)}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 w-full rounded-lg bg-amber-400 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-amber-300"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
