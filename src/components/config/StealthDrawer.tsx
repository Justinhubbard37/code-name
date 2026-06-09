import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SlidersStub } from './SlidersStub';
import { SecurityGates } from './SecurityGates';
import { SecretsPanel } from './SecretsPanel';
import { useApp } from '../../state/AppState';

/**
 * CONFIGURATION & CAPABILITY GOVERNANCE.
 * A low-profile tab in the bottom-left corner. It slides open a parameter tray:
 * named presets (add / rename / delete), the routed endpoint, a model picker,
 * temperature & context sliders, and the hard capability gates. Clicking outside
 * the tray (or pressing Escape) closes it.
 */
export function StealthDrawer() {
  const [open, setOpen] = useState(false);
  const {
    profiles,
    activeProfileId,
    setActiveProfileId,
    activeProfile,
    updateProfile,
    addProfile,
    deleteProfile,
    endpoints,
    activeEndpoint,
    setEndpointModel,
  } = useApp();

  const trayRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close when clicking outside the tray (but not on the trigger), or on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (trayRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {/* Trigger tab — absolute bottom-left corner of the window */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-0 left-0 z-[60] w-6 h-7 flex items-center justify-center bg-neutral-900 border-t border-r border-neutral-700 text-emerald-500 font-mono text-sm hover:bg-neutral-800"
        title="Configuration tray"
      >
        {open ? '<' : '>'}
      </button>

      {/* Sliding tray */}
      <div
        ref={trayRef}
        className={`fixed bottom-0 left-0 z-[55] w-72 bg-neutral-950/95 border-t border-r border-neutral-700 backdrop-blur-sm transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ maxHeight: '85vh', overflowY: 'auto' }}
      >
        <div className="p-3 pl-7 space-y-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-400/80 border-b border-neutral-800 pb-2">
            Parameter Tray
          </div>

          {/* Presets (saved parameter sets) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
                Presets
              </div>
              <div className="flex gap-1">
                <button
                  onClick={addProfile}
                  title="New preset (copies the current one)"
                  className="flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-mono border border-neutral-700 text-neutral-400 hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <Plus className="w-2.5 h-2.5" /> NEW
                </button>
                <button
                  onClick={() => deleteProfile(activeProfileId)}
                  disabled={profiles.length <= 1}
                  title="Delete the current preset"
                  className="flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-mono border border-neutral-700 text-neutral-400 hover:border-red-500/50 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-2.5 h-2.5" /> DEL
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveProfileId(p.id)}
                  className={`px-1.5 py-1 text-[9px] font-mono border ${
                    p.id === activeProfileId
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                      : 'border-neutral-800 text-neutral-500 hover:border-neutral-600'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <input
              value={activeProfile.name}
              onChange={(e) => updateProfile(activeProfile.id, { name: e.target.value })}
              placeholder="preset name"
              className="w-full bg-neutral-900 border border-neutral-800 text-neutral-300 text-[10px] font-mono p-1.5 outline-none focus:border-neutral-600"
            />
          </div>

          {/* Endpoint binding for the active preset */}
          <div className="space-y-1.5">
            <div className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              Routed Endpoint
            </div>
            <select
              value={activeProfile.endpointId}
              onChange={(e) => updateProfile(activeProfile.id, { endpointId: e.target.value })}
              className="w-full bg-neutral-900 border border-neutral-800 text-neutral-300 text-[10px] font-mono p-1.5 outline-none focus:border-neutral-600"
            >
              {endpoints.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label} {e.isLocal ? '· local' : '· cloud'}
                </option>
              ))}
            </select>
          </div>

          {/* Model picker for the routed endpoint */}
          <div className="space-y-1.5">
            <div className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
              Model
            </div>
            {activeEndpoint.models && activeEndpoint.models.length > 0 ? (
              <select
                value={activeEndpoint.model}
                onChange={(e) => setEndpointModel(activeEndpoint.id, e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 text-neutral-300 text-[10px] font-mono p-1.5 outline-none focus:border-neutral-600"
              >
                {activeEndpoint.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-[9px] font-mono text-neutral-600 border border-neutral-800 p-1.5 leading-relaxed">
                {activeEndpoint.model}
                <br />
                no installed models detected — start the model server, then press the ⟳ button on
                the status pill (top-right) to probe.
              </div>
            )}
          </div>

          {/* API keys in the OS keychain */}
          <SecretsPanel />

          {/* Hardware sliders (temperature + context window) */}
          <SlidersStub />

          {/* Capability gates */}
          <SecurityGates />
        </div>
      </div>
    </>
  );
}

// Re-export to keep a single import surface (sliders live in their own file).
export { SlidersStub };
