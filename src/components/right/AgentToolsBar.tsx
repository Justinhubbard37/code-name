import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { getTools, onToolChange, type ToolMeta } from '../../lib/webmcp';

/** Lists the WebMCP tools the agent may call (Phase 4). */
export function AgentToolsBar() {
  const [tools, setTools] = useState<ToolMeta[]>(getTools());
  useEffect(() => onToolChange(() => setTools(getTools())), []);
  if (!tools.length) return null;
  return (
    <div className="shrink-0 border-b border-neutral-800 bg-neutral-950 px-3 py-1 flex items-center gap-2 overflow-x-auto no-scrollbar">
      <Wrench className="w-3 h-3 text-neutral-500 shrink-0" />
      <span className="text-[9px] font-mono text-neutral-600 uppercase tracking-wider shrink-0">WebMCP</span>
      {tools.map((t) => (
        <span
          key={t.name}
          title={t.description}
          className="text-[9px] font-mono text-sky-400/80 border border-neutral-800 px-1.5 py-0.5 whitespace-nowrap"
        >
          {t.name}
        </span>
      ))}
    </div>
  );
}
