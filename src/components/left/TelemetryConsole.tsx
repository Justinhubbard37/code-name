import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppState';

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function TelemetryConsole() {
  const { nodes, edges, endpoints, bootTs } = useApp();
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const ready = endpoints.filter((e) => e.status === 'ready').length;
  // Synthetic vector-store figure derived from indexed content (≈ chunks).
  const vectors = nodes.reduce(
    (acc, n) => acc + Math.max(1, Math.ceil((n.data.description?.length ?? 40) / 256)),
    0,
  );

  const rows: [string, string][] = [
    ['UPTIME', fmtUptime(Date.now() - bootTs)],
    ['KG NODES', String(nodes.length)],
    ['KG EDGES', String(edges.length)],
    ['VECTORS', String(vectors)],
    ['DB LOOPS', `${ready}/${endpoints.length}`],
  ];

  return (
    <div className="absolute bottom-10 left-2 z-20 w-44 pointer-events-auto text-[9px] font-mono">
      <div className="text-neutral-500 font-bold uppercase tracking-wider mb-1">Telemetry</div>
      <div className="bg-neutral-950/80 border border-neutral-800 backdrop-blur-sm p-2 grid grid-cols-2 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="text-neutral-600">{k}</span>
            <span className="text-right text-emerald-400/80">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
