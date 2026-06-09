import { HardDrive, Globe, Wrench, Lock, Unlock } from 'lucide-react';
import { useApp } from '../../state/AppState';
import type { SecurityGates as Gates } from '../../types';

const GATES: { key: keyof Gates; label: string; icon: typeof HardDrive; desc: string }[] = [
  { key: 'filesystem', label: 'FILE SYSTEM', icon: HardDrive, desc: 'local ingest + disk reads' },
  { key: 'network', label: 'NETWORK', icon: Globe, desc: 'outward / cloud requests' },
  { key: 'tools', label: 'TOOL EXEC', icon: Wrench, desc: 'agent tool invocations' },
];

export function SecurityGates() {
  const { gates, toggleGate } = useApp();

  return (
    <div className="space-y-2">
      <div className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
        Capability Gates
      </div>
      {GATES.map(({ key, label, icon: Icon, desc }) => {
        const on = gates[key];
        return (
          <button
            key={key}
            onClick={() => toggleGate(key)}
            className={`w-full flex items-center gap-2 px-2 py-2 border text-left transition-colors ${
              on
                ? 'border-emerald-500/40 bg-emerald-500/5'
                : 'border-red-500/40 bg-red-500/5'
            }`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-emerald-400' : 'text-red-400'}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-[10px] font-mono tracking-wider ${on ? 'text-neutral-200' : 'text-neutral-400'}`}>
                {label}
              </div>
              <div className="text-[8px] text-neutral-600 font-mono truncate">{desc}</div>
            </div>
            {/* Hard gate: closing the toggle severs the bridge at the harness layer. */}
            <span
              className={`flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded-full ${
                on ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
              }`}
            >
              {on ? <Unlock className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
              {on ? 'OPEN' : 'SEVERED'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
