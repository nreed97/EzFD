'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import type { Band, Mode } from '@/lib/types';

interface StationPresence {
  op_call: string;
  station: number;
  band: Band;
  mode: Mode;
}

interface Props {
  eventId: string;
  myOpCall: string;
  myStation: number;
  currentBand: Band;
  currentMode: Mode;
}

const MODE_COLORS: Record<Mode, string> = {
  PH:  'text-blue-400',
  CW:  'text-yellow-400',
  DIG: 'text-green-400',
};

export default function BandActivity({ eventId, myOpCall, myStation, currentBand, currentMode }: Props) {
  const [stations, setStations] = useState<StationPresence[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = supabase.channel(`presence-${eventId}`, {
      config: { presence: { key: `${myStation}-${myOpCall}` } },
    });

    channelRef.current = channel as typeof channelRef.current;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const active: StationPresence[] = [];
        for (const presences of Object.values(state)) {
          for (const p of presences as unknown as StationPresence[]) {
            active.push(p);
          }
        }
        setStations(active);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ op_call: myOpCall, station: myStation, band: currentBand, mode: currentMode });
        }
      });

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, myOpCall, myStation]);

  // Re-track whenever band/mode changes
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.track({ op_call: myOpCall, station: myStation, band: currentBand, mode: currentMode }).catch(() => {});
  }, [currentBand, currentMode, myOpCall, myStation]);

  const others = stations.filter(s => !(s.op_call === myOpCall && s.station === myStation));

  if (others.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Other Stations
      </h3>
      <div className="flex flex-col gap-1">
        {others
          .sort((a, b) => a.station - b.station)
          .map(s => {
            const conflict = s.band === currentBand && s.mode === currentMode;
            return (
              <div
                key={`${s.station}-${s.op_call}`}
                className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                  conflict ? 'border border-red-700 bg-red-900/30' : 'bg-zinc-800/50'
                }`}
              >
                <span className="font-mono text-zinc-400">
                  STN{s.station} <span className="text-zinc-300">{s.op_call}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-zinc-200">{s.band}</span>
                  <span className={`font-mono font-bold ${MODE_COLORS[s.mode]}`}>{s.mode}</span>
                  {conflict && <span className="text-red-400 font-bold">!</span>}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
