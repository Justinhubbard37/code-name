import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  left: ReactNode;
  right: ReactNode;
}

const SNAP = 0.1; // hard-snap lock points every 10%
const MIN = 0.2;
const MAX = 0.8;

/**
 * Two-pane horizontal workspace. Default 50/50. The center divider drags
 * freely but hard-snaps to the nearest 10% increment on release-tracking,
 * terminating at lock points across the layout.
 */
export function ResizableSplit({ left, right }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.5);
  const [dragging, setDragging] = useState(false);

  const onMove = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const raw = (clientX - rect.left) / rect.width;
    const snapped = Math.round(raw / SNAP) * SNAP;
    setRatio(Math.min(MAX, Math.max(MIN, snapped)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onMove(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, onMove]);

  const pct = Math.round(ratio * 100);

  return (
    <div ref={containerRef} className="flex w-screen h-screen overflow-hidden bg-neutral-950">
      <div style={{ width: `${pct}%` }} className="relative h-full min-w-0">
        {left}
      </div>

      {/* Divider */}
      <div
        onPointerDown={() => setDragging(true)}
        onDoubleClick={() => setRatio(0.5)}
        className={`group relative w-px h-full shrink-0 cursor-col-resize bg-neutral-800 ${
          dragging ? 'bg-emerald-500/60' : 'hover:bg-neutral-600'
        }`}
        title="Drag to resize · double-click to reset 50/50"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 px-[2px] py-2 rounded-sm border ${
            dragging
              ? 'border-emerald-500/60 bg-neutral-900'
              : 'border-neutral-700 bg-neutral-900 group-hover:border-neutral-500'
          }`}
        >
          {[0, 1, 2].map((i) => (
            <span key={i} className="block w-[2px] h-[2px] rounded-full bg-neutral-500" />
          ))}
        </div>
        {dragging && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-emerald-400 bg-neutral-950 px-1.5 py-0.5 border border-emerald-500/40 whitespace-nowrap">
            {pct} / {100 - pct}
          </div>
        )}
      </div>

      <div style={{ width: `${100 - pct}%` }} className="relative h-full min-w-0">
        {right}
      </div>
    </div>
  );
}
