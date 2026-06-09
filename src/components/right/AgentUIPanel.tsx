import { useEffect, useState } from 'react';
import { Layout, X } from 'lucide-react';
import { subscribeAgentUI, getAgentUI, setAgentUI } from './a2ui/bus';
import { A2UIRenderer } from './a2ui/A2UIRenderer';
import type { A2UIPayload } from './a2ui/types';
import { executeTool } from '../../lib/webmcp';
import { useApp } from '../../state/AppState';

/**
 * Renders agent-generated A2UI into the right pane — subordinate to the native
 * UI, which stays final authority (Phase 4 ownership map).
 */
export function AgentUIPanel() {
  const { sendMessage } = useApp();
  const [ui, setUi] = useState<A2UIPayload | null>(getAgentUI());
  useEffect(() => subscribeAgentUI(setUi), []);
  if (!ui) return null;
  return (
    <div className="shrink-0 border-b border-neutral-800 bg-neutral-900/40 max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-neutral-500">
        <span className="flex items-center gap-1">
          <Layout className="w-3 h-3" /> Agent UI · A2UI
        </span>
        <button
          onClick={() => setAgentUI(null)}
          className="text-neutral-600 hover:text-neutral-300 flex items-center gap-1"
        >
          <X className="w-3 h-3" /> dismiss
        </button>
      </div>
      <div className="px-3 pb-3">
        <A2UIRenderer
          payload={ui}
          onAction={(a) => {
            if (a.tool) executeTool(a.tool);
            else if (a.prompt) sendMessage(a.prompt);
          }}
        />
      </div>
    </div>
  );
}
