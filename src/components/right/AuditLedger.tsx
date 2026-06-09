import { useState, useEffect, useCallback } from 'react';
import { ScrollText, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { kgStore } from '../../kg/store';
import type { AuditRecord } from '../../types';

/**
 * Surfaces the append-only KG audit ledger (Phase 6) — the write history of the
 * self-growing knowledge graph. Reuses the Phase 0 AuditRecord schema.
 */
export function AuditLedger() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRecord[]>([]);

  const load = useCallback(async () => {
    try {
      const a = await kgStore.getAudit();
      a.sort((x, y) => y.ts - x.ts);
      setRows(a.slice(0, 80));
    } catch {
      /* store unavailable */
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <div className="shrink-0 border-b border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between px-3 py-1 text-[9px] font-mono uppercase tracking-wider text-neutral-500">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 hover:text-neutral-200">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <ScrollText className="w-3 h-3" /> Audit Ledger
          {rows.length > 0 && <span className="text-emerald-400/70">{rows.length}</span>}
        </button>
        {open && (
          <button onClick={load} className="text-neutral-600 hover:text-neutral-300" title="Refresh">
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-40 overflow-y-auto px-3 pb-2 font-mono text-[9px] leading-relaxed">
          {rows.length === 0 ? (
            <div className="text-neutral-600 italic">// no audited writes yet</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex gap-2">
                <span className="text-neutral-700 shrink-0">
                  {new Date(r.ts).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className={`shrink-0 w-12 ${r.decision.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                  [{r.action}]
                </span>
                <span className="text-neutral-500 shrink-0">
                  {r.actor.kind}:{r.actor.id}
                </span>
                <span className="text-neutral-400 break-all">
                  {r.target.kind}/{r.target.id}
                  {r.diff ? ` · ${r.diff}` : ''}
                  {r.decision.allowed ? '' : ` · DENIED(${r.decision.reason ?? ''})`}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
