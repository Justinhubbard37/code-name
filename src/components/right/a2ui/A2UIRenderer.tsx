import type { ReactNode } from 'react';
/**
 * A2UI renderer (Phase 4). Maps a declarative A2UI payload to React using a
 * TRUSTED catalog only — the agent can render nothing outside this set, which is
 * the security boundary ("safe like data"). Output is subordinate to the native
 * UI that hosts it.
 */
import type { A2UIComponent, A2UIPayload } from './types';

const TRUSTED = new Set([
  'card', 'column', 'row', 'heading', 'text', 'badge', 'button', 'textfield', 'divider',
]);

function str(v: unknown, d = ''): string {
  return typeof v === 'string' ? v : v == null ? d : String(v);
}

export function A2UIRenderer({
  payload,
  onAction,
}: {
  payload: A2UIPayload;
  onAction?: (action: { prompt?: string; tool?: string }) => void;
}) {
  const byId = new Map(payload.components.map((c) => [c.id, c]));

  const renderId = (id: string, depth = 0): ReactNode => {
    if (depth > 32) return null;
    const c = byId.get(id);
    if (!c || !TRUSTED.has(c.type)) return null;
    return <Node key={id} c={c} render={(cid) => renderId(cid, depth + 1)} onAction={onAction} />;
  };

  return <div className="space-y-2">{renderId(payload.root)}</div>;
}

function Node({
  c,
  render,
  onAction,
}: {
  c: A2UIComponent;
  render: (id: string) => ReactNode;
  onAction?: (a: { prompt?: string; tool?: string }) => void;
}) {
  const p = c.properties ?? {};
  const kids = (c.children ?? []).map(render);

  switch (c.type) {
    case 'card':
      return (
        <div className="border border-neutral-700 bg-neutral-900/60 p-3 space-y-2">{kids}</div>
      );
    case 'column':
      return <div className="flex flex-col gap-2">{kids}</div>;
    case 'row':
      return <div className="flex flex-row gap-2 items-center flex-wrap">{kids}</div>;
    case 'heading':
      return <div className="text-neutral-100 font-bold text-sm tracking-wide">{str(p.text)}</div>;
    case 'text':
      return <div className="text-neutral-300 text-xs whitespace-pre-wrap">{str(p.text)}</div>;
    case 'badge':
      return (
        <span className="inline-block px-1.5 py-0.5 text-[9px] font-mono border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
          {str(p.text)}
        </span>
      );
    case 'divider':
      return <div className="border-t border-neutral-800 my-1" />;
    case 'textfield':
      return (
        <input
          readOnly
          value={str(p.value)}
          placeholder={str(p.placeholder)}
          className="w-full bg-neutral-950 border border-neutral-800 text-neutral-300 text-xs px-2 py-1 font-mono"
        />
      );
    case 'button':
      return (
        <button
          onClick={() => onAction?.({ prompt: p.prompt as string, tool: p.tool as string })}
          className="px-2 py-1 text-[10px] font-mono border border-neutral-600 text-neutral-200 hover:bg-neutral-800"
        >
          {str(p.label, 'Action')}
        </button>
      );
    default:
      return null;
  }
}
