import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Endpoint, EndpointKind } from '../../types';

const KINDS: EndpointKind[] = ['ollama', 'lmstudio', 'openai', 'custom', 'gemini', 'a2a'];
const inputCls =
  'w-full bg-neutral-950 border border-neutral-800 text-neutral-300 p-1.5 outline-none focus:border-neutral-600 font-mono text-[10px]';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[9px] text-neutral-500 uppercase tracking-wider">{label}</div>
      {children}
    </div>
  );
}

/**
 * Modal editor for one endpoint's connection settings. Saving persists via the
 * app's updateEndpoint (config is stored in local storage).
 */
export function EndpointEditor({
  endpoint,
  onClose,
  onSave,
}: {
  endpoint: Endpoint;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Endpoint>) => void;
}) {
  const [label, setLabel] = useState(endpoint.label);
  const [kind, setKind] = useState<EndpointKind>(endpoint.kind);
  const [baseUrl, setBaseUrl] = useState(endpoint.baseUrl);
  const [model, setModel] = useState(endpoint.model);
  const [isLocal, setIsLocal] = useState(endpoint.isLocal);
  const [apiKeyEnv, setApiKeyEnv] = useState(endpoint.apiKeyEnv ?? '');

  const save = () => {
    onSave(endpoint.id, {
      label: label.trim() || endpoint.label,
      kind,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      isLocal,
      apiKeyEnv: apiKeyEnv.trim() || undefined,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-80 bg-neutral-900 border border-neutral-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
          <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400/80">
            Edit Endpoint
          </span>
          <button onClick={onClose} className="text-neutral-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-3">
          <Field label="Name">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Type">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as EndpointKind)}
              className={inputCls}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base URL">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className={inputCls}
            />
          </Field>
          <Field label="Model">
            <input value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} />
          </Field>
          <Field label="API key env var (optional)">
            <input
              value={apiKeyEnv}
              onChange={(e) => setApiKeyEnv(e.target.value)}
              placeholder="e.g. OLLAMA_API_KEY"
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 text-[10px] font-mono text-neutral-400">
            <input
              type="checkbox"
              checked={isLocal}
              onChange={(e) => setIsLocal(e.target.checked)}
            />
            Local (not blocked by the Network gate)
          </label>
          <div className="text-[8px] font-mono text-neutral-600 leading-relaxed">
            Secret values are not stored in endpoint config. Save keys in the Secrets panel or OS
            keychain; this field names the key or env fallback only.
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="flex-1 py-1.5 text-[10px] font-mono border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            >
              SAVE
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-1.5 text-[10px] font-mono border border-neutral-700 text-neutral-400 hover:bg-neutral-800"
            >
              CANCEL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
