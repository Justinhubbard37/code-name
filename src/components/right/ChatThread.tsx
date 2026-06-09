import { useEffect, useRef } from 'react';
import { useApp } from '../../state/AppState';
import type { ChatMessage } from '../../types';

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'system') {
    return (
      <div className="text-[10px] font-mono text-neutral-600 italic border-l-2 border-neutral-800 pl-2 py-1">
        {m.content}
      </div>
    );
  }
  const user = m.role === 'user';
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 text-xs whitespace-pre-wrap break-words border ${
          user
            ? 'bg-neutral-800/80 border-neutral-700 text-neutral-100'
            : 'bg-neutral-900/60 border-neutral-800 text-neutral-300 font-mono'
        }`}
      >
        {!user && (
          <div className="text-[8px] text-emerald-500/70 font-mono uppercase tracking-widest mb-1">
            response
          </div>
        )}
        {m.content}
        {m.streaming && <span className="inline-block w-1.5 h-3 ml-0.5 bg-emerald-400 animate-pulse align-middle" />}
      </div>
    </div>
  );
}

export function ChatThread() {
  const { activeTask } = useApp();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeTask.messages]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
      {activeTask.messages.length === 0 && (
        <div className="h-full flex items-center justify-center text-neutral-700 font-mono text-[10px] uppercase tracking-widest">
          isolated context · awaiting input
        </div>
      )}
      {activeTask.messages.map((m) => (
        <Bubble key={m.id} m={m} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
