import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';

import type {
  ActivityKind,
  AppNode,
  AuditAction,
  AuditActor,
  ChatMessage,
  ConfigProfile,
  Endpoint,
  GateName,
  NodeData,
  QuarantineItem,
  SecurityGates,
  TabCaps,
  WorkTask,
} from '../types';
import { initialNodes, initialEdges } from '../store';
import {
  defaultEndpoints,
  defaultGates,
  defaultProfiles,
  initialTask,
} from '../config/defaults';
import {
  loadEndpoints,
  loadProfiles,
  loadActiveProfileId,
  loadGates,
  saveConfig,
} from '../config/persist';
import { hashFile } from '../lib/hash';
import { pingEndpoint, streamChat, listModels, reachesNetwork, type ChatTurn } from '../lib/llm';
import { kgStore } from '../kg/store';
import { evaluateKgWrite, evaluateScopedKgWrite, makeAudit } from '../kg/commit';
import { retriever } from '../kg/retrieve';
import { getSidecarInfo, streamFromSidecar, cancelSidecar } from '../lib/sidecar';
import { installWebMcp, setToolGuard, setToolLogger, registerTool } from '../lib/webmcp';
import { setAgentUI } from '../components/right/a2ui/bus';
import type { A2UIPayload } from '../components/right/a2ui/types';
import { validateA2UIPayload } from '../lib/securityValidation';
import {
  auditDeniedSecurityAction,
  setSecurityAuditSink,
  type SecurityAuditCategory,
} from '../lib/securityAudit';
import { effectiveGates, FULL_CAPS } from '../lib/perms';
import { runSelfCheck } from '../lib/selfcheck';
import { lease as poolLease, releaseAll as poolReleaseAll } from '../lib/pools';

const NODE_STYLE: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.8)',
  border: '1px solid #333',
  color: '#ccc',
  borderRadius: '2px',
  fontFamily: 'monospace',
  fontSize: '10px',
  padding: '8px',
  boxShadow: '0 0 10px rgba(0,0,0,0.5)',
};

interface AppStateValue {
  /* graph */
  nodes: AppNode[];
  edges: Edge[];
  onNodesChange: (c: NodeChange<AppNode>[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection | Edge) => void;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  updateNodeData: (id: string, data: NodeData) => void;
  graphQuery: string;
  setGraphQuery: (q: string) => void;
  runGraphQuery: (q: string) => void;

  /* tasks */
  tasks: WorkTask[];
  activeTaskId: string;
  activeTask: WorkTask;
  setActiveTaskId: (id: string) => void;
  addTask: (kind: WorkTask['kind']) => void;
  closeTask: (id: string) => void;
  setTabCap: (taskId: string, cap: keyof TabCaps, value: boolean) => void;

  /* chat */
  sending: boolean;
  sendMessage: (text: string) => void;
  abort: () => void;
  showActivity: boolean;
  setShowActivity: (v: boolean) => void;
  /** model the server last confirmed it actually ran (empty until first reply) */
  runningModel: string;

  /* endpoints / profiles / gates */
  endpoints: Endpoint[];
  profiles: ConfigProfile[];
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  activeProfile: ConfigProfile;
  activeEndpoint: Endpoint;
  updateProfile: (id: string, patch: Partial<ConfigProfile>) => void;
  setEndpointModel: (endpointId: string, model: string) => void;
  updateEndpoint: (id: string, patch: Partial<Endpoint>) => void;
  addProfile: () => void;
  deleteProfile: (id: string) => void;
  refreshEndpoints: () => void;
  gates: SecurityGates;
  toggleGate: (k: keyof SecurityGates) => void;

  /* ingestion */
  quarantine: QuarantineItem[];
  ingestFiles: (files: File[]) => void;
  resolveConflict: (id: string, action: 'overwrite' | 'skip' | 'fork') => void;
  clearLedger: () => void;

  /* telemetry */
  bootTs: number;
}

const Ctx = createContext<AppStateValue | null>(null);

export function useApp(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppStateProvider');
  return v;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const bootTs = useRef(Date.now()).current;

  /* ---- graph ---- */
  const [nodes, setNodes] = useState<AppNode[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges as Edge[]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graphQuery, setGraphQuery] = useState('');

  const onNodesChange = useCallback(
    (c: NodeChange<AppNode>[]) => setNodes((nds) => applyNodeChanges(c, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (c: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(c, eds)),
    [],
  );
  const onConnect = useCallback(
    (c: Connection | Edge) =>
      setEdges((eds) => {
        const next = addEdge({ ...c, animated: true, style: { stroke: '#666' } } as Edge, eds);
        // Edges are KG content: persist + audit the link (best-effort).
        const decision = evaluateKgWrite(gatesRef.current);
        kgStore.appendAudit(
          makeAudit({
            actor: { kind: 'user', id: 'director' },
            action: 'link',
            target: { kind: 'edge', id: 'edge' },
            decision,
          }),
        ).catch(() => {});
        if (decision.allowed) kgStore.putEdges(next).catch(() => {});
        return next;
      }),
    [],
  );

  const runGraphQuery = useCallback((q: string) => {
    const query = q.trim();
    setNodes((nds) => {
      if (!query) return nds.map((n) => ({ ...n, hidden: false }));
      retriever.index(nds);
      const hits = new Set(retriever.retrieve(query).map((r) => r.id));
      return nds.map((n) => ({ ...n, hidden: !hits.has(n.id) }));
    });
  }, []);

  // Hydrate the knowledge graph from the local store on boot (Phase 1).
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    (async () => {
      try {
        const [pn, pe] = await Promise.all([kgStore.getAllNodes(), kgStore.getAllEdges()]);
        if (pn.length) {
          setNodes(pn);
          setEdges(pe);
        } else {
          await kgStore.putNodes(initialNodes);
          await kgStore.putEdges(initialEdges as Edge[]);
        }
      } catch {
        /* store unavailable — continue in-memory */
      }
    })();
  }, []);

  /* ---- tasks ---- */
  const [tasks, setTasks] = useState<WorkTask[]>([initialTask]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [activeTaskId, setActiveTaskId] = useState(initialTask.id);
  const activeTaskIdRef = useRef(activeTaskId);
  activeTaskIdRef.current = activeTaskId;
  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId) ?? tasks[0],
    [tasks, activeTaskId],
  );

  const patchTask = useCallback((id: string, fn: (t: WorkTask) => WorkTask) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const addTask = useCallback((kind: WorkTask['kind']) => {
    const id = `task-${uuidv4().slice(0, 6)}`;
    const names: Record<WorkTask['kind'], string> = {
      analysis: 'DOC ANALYSIS',
      research: 'RESEARCH THREAD',
      codegen: 'CODE WORKSPACE',
    };
    const agents: Record<WorkTask['kind'], string> = {
      analysis: 'ANALYST',
      research: 'SCOUT',
      codegen: 'ARTIFICER',
    };
    const task: WorkTask = {
      id,
      name: names[kind],
      kind,
      agent: `${agents[kind]}-${Math.floor(Math.random() * 9) + 1}`,
      messages: [],
      activity: [],
      session: {
        id: `sess-${uuidv4().slice(0, 6)}`,
        caps: { browser: true, tools: true, network: true, filesystem: true },
      },
    };
    setTasks((ts) => [...ts, task]);
    setActiveTaskId(id);
  }, []);

  const setTabCap = useCallback((taskId: string, cap: keyof TabCaps, value: boolean) => {
    setTasks((ts) =>
      ts.map((t) =>
        t.id === taskId
          ? { ...t, session: { ...t.session, caps: { ...t.session.caps, [cap]: value } } }
          : t,
      ),
    );
  }, []);

  const closeTask = useCallback(
    (id: string) => {
      poolReleaseAll(id);
      setTasks((ts) => {
        if (ts.length <= 1) return ts;
        const next = ts.filter((t) => t.id !== id);
        if (id === activeTaskId) setActiveTaskId(next[0].id);
        return next;
      });
    },
    [activeTaskId],
  );

  /* ---- endpoints / profiles / gates (persisted) ---- */
  const [endpoints, setEndpoints] = useState<Endpoint[]>(() => loadEndpoints());
  const endpointsRef = useRef(endpoints);
  endpointsRef.current = endpoints;
  const [profiles, setProfiles] = useState<ConfigProfile[]>(() => loadProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string>(() => loadActiveProfileId());
  const [gates, setGates] = useState<SecurityGates>(() => loadGates());
  const gatesRef = useRef(gates);
  gatesRef.current = gates;

  const taskEffectiveGates = useCallback((taskId: string): SecurityGates => {
    const task = tasksRef.current.find((t) => t.id === taskId);
    return effectiveGates(gatesRef.current, task?.session.caps ?? FULL_CAPS);
  }, []);

  useEffect(() => {
    setSecurityAuditSink((record) => kgStore.appendAudit(record).catch(() => {}));
    return () => setSecurityAuditSink(null);
  }, []);

  const auditDenied = useCallback(
    (
      category: SecurityAuditCategory,
      reason: unknown,
      opts?: { targetId?: string; gate?: GateName },
    ) => {
      const taskId = activeTaskIdRef.current;
      const task = tasksRef.current.find((t) => t.id === taskId);
      auditDeniedSecurityAction({
        category,
        reason,
        targetId: opts?.targetId,
        gate: opts?.gate,
        actor: {
          kind: 'user',
          id: 'director',
          taskId,
          sessionId: task?.session.id,
        },
      });
    },
    [],
  );

  // Save config (endpoints, presets, active preset, gates) whenever it changes.
  useEffect(() => {
    saveConfig({ endpoints, profiles, activeProfileId, gates });
  }, [endpoints, profiles, activeProfileId, gates]);

  // Mirror the gate state into the Rust shell so it enforces the gates at the
  // process level (Phase 1.3), not just in the UI. No-op in a plain browser.
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    import('@tauri-apps/api/core')
      .then(({ invoke }) =>
        invoke('set_gates', {
          filesystem: gates.filesystem,
          network: gates.network,
          tools: gates.tools,
        }),
      )
      .catch(() => {});
  }, [gates]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0],
    [profiles, activeProfileId],
  );
  const activeEndpoint = useMemo(
    () => endpoints.find((e) => e.id === activeProfile.endpointId) ?? endpoints[0],
    [endpoints, activeProfile],
  );

  const updateProfile = useCallback((id: string, patch: Partial<ConfigProfile>) => {
    setProfiles((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const setEndpointModel = useCallback((endpointId: string, model: string) => {
    setEndpoints((eps) => eps.map((e) => (e.id === endpointId ? { ...e, model } : e)));
  }, []);

  const updateEndpoint = useCallback((id: string, patch: Partial<Endpoint>) => {
    setEndpoints((eps) => eps.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const addProfile = useCallback(() => {
    const id = `profile-${uuidv4().slice(0, 6)}`;
    setProfiles((ps) => {
      const base = ps.find((p) => p.id === activeProfileId) ?? ps[0];
      return [...ps, { ...base, id, name: 'NEW PRESET' }];
    });
    setActiveProfileId(id);
  }, [activeProfileId]);

  const deleteProfile = useCallback(
    (id: string) => {
      setProfiles((ps) => {
        if (ps.length <= 1) return ps; // always keep at least one preset
        const next = ps.filter((p) => p.id !== id);
        if (id === activeProfileId) setActiveProfileId(next[0].id);
        return next;
      });
    },
    [activeProfileId],
  );

  const toggleGate = useCallback((k: keyof SecurityGates) => {
    setGates((g) => ({ ...g, [k]: !g[k] }));
  }, []);

  const refreshEndpoints = useCallback(async () => {
    setEndpoints((eps) => eps.map((e) => ({ ...e, status: 'configuring' as const })));
    type Probe = {
      id: string;
      status: Endpoint['status'];
      detail: string;
      models?: string[];
      model?: string;
    };
    const results: Probe[] = await Promise.all(
      endpointsRef.current.map(async (e): Promise<Probe> => {
        if (e.kind === 'a2a') {
          const info = await getSidecarInfo();
          const ready = !!info && info.status === 'ready';
          return {
            id: e.id,
            status: ready ? 'ready' : 'offline',
            detail: info?.status ?? 'sidecar (desktop only)',
          };
        }
        if (!gates.network && reachesNetwork(e)) {
          auditDenied('endpoint', 'network gate closed', {
            gate: 'network',
            targetId: `endpoint:${e.id}`,
          });
          return { id: e.id, status: 'offline', detail: 'network gate closed' };
        }
        const r = await pingEndpoint(e);
        if (!r.ok) {
          auditDenied('endpoint', r.detail, {
            gate: 'endpoint',
            targetId: `endpoint:${e.id}`,
          });
          return { id: e.id, status: 'error', detail: r.detail };
        }
        // Reachable — find out which models are actually installed and make sure
        // the selected one exists. A missing model is the #1 cause of "READY but
        // it won't answer" (the probe hits /api/tags, which is fine even when the
        // configured model isn't downloaded).
        const list = await listModels(e);
        let model: string | undefined;
        let detail = r.detail;
        if (list.length) {
          const current = e.model;
          model = list.includes(current) ? current : list[0];
          detail = `${list.length} model(s)`;
        }
        return {
          id: e.id,
          status: 'ready',
          detail,
          models: list.length ? list : undefined,
          model,
        };
      }),
    );
    setEndpoints((eps) =>
      eps.map((e) => {
        const r = results.find((x) => x.id === e.id);
        if (!r) return e;
        return {
          ...e,
          status: r.status,
          detail: r.detail,
          ...(r.models ? { models: r.models } : {}),
          ...(r.model ? { model: r.model } : {}),
        };
      }),
    );
  }, [auditDenied, gates.network]);

  /* ---- chat ---- */
  const [sending, setSending] = useState(false);
  const [showActivity, setShowActivity] = useState(true);
  const [runningModel, setRunningModel] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const pushActivity = useCallback(
    (taskId: string, kind: ActivityKind, text: string) => {
      patchTask(taskId, (t) => ({
        ...t,
        activity: [
          ...t.activity,
          { id: uuidv4().slice(0, 8), ts: Date.now(), kind, text },
        ].slice(-60),
      }));
    },
    [patchTask],
  );

  /* ---- KG write chokepoint (gated + audited, Phase 1) ---- */
  const commit = useCallback(
    (spec: {
      action: AuditAction;
      node?: AppNode;
      removeNodeId?: string;
      actor: AuditActor;
      diff?: string;
      provenance?: { source?: string; ingestionId?: string };
    }): boolean => {
      const targetId = spec.node?.id ?? spec.removeNodeId ?? 'unknown';
      const taskId = spec.actor.taskId ?? activeTaskIdRef.current;
      const activeTaskId = taskId;
      const task = tasksRef.current.find((t) => t.id === taskId);
      const decision = task
        ? evaluateScopedKgWrite(gatesRef.current, task.session.caps)
        : evaluateKgWrite(gatesRef.current);
      kgStore
        .appendAudit(
          makeAudit({
            actor: spec.actor,
            action: spec.action,
            target: { kind: 'node', id: targetId },
            decision,
            diff: spec.diff,
            provenance: spec.provenance,
          }),
        )
        .catch(() => {});
      if (!decision.allowed) {
        pushActivity(activeTaskId, 'system', `KG write denied — ${decision.reason}`);
        return false;
      }
      if (spec.removeNodeId) {
        const rid = spec.removeNodeId;
        setNodes((nds) => nds.filter((n) => n.id !== rid));
        kgStore.deleteNode(rid).catch(() => {});
      }
      if (spec.node) {
        const nn = spec.node;
        setNodes((nds) =>
          nds.some((n) => n.id === nn.id) ? nds.map((n) => (n.id === nn.id ? nn : n)) : nds.concat(nn),
        );
        kgStore.putNodes([nn]).catch(() => {});
      }
      return true;
    },
    [pushActivity],
  );

  const updateNodeData = useCallback(
    (id: string, data: NodeData) => {
      const cur = nodesRef.current.find((n) => n.id === id);
      if (!cur) return;
      commit({
        action: 'update',
        node: { ...cur, data },
        actor: { kind: 'user', id: 'director', taskId: activeTaskId },
        diff: `edit ${cur.data.label}`,
      });
    },
    [commit, activeTaskId],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      const taskId = activeTaskId;
      const ep = activeEndpoint;

      const userMsg: ChatMessage = {
        id: uuidv4().slice(0, 8),
        role: 'user',
        content: trimmed,
        ts: Date.now(),
      };
      const asstId = uuidv4().slice(0, 8);
      const asstMsg: ChatMessage = {
        id: asstId,
        role: 'assistant',
        content: '',
        ts: Date.now(),
        streaming: true,
      };

      patchTask(taskId, (t) => ({ ...t, messages: [...t.messages, userMsg, asstMsg] }));
      setSending(true);
      pushActivity(taskId, 'query', `routing to ${ep.label} (${ep.kind})`);

      const baseTask = tasks.find((t) => t.id === taskId);
      const turns: ChatTurn[] = (baseTask?.messages ?? [])
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));
      turns.push({ role: 'user', content: trimmed });
      // Tell the model its TRUE identity — the exact model we route to, which the
      // app also verifies the server actually ran. Accurate self-knowledge, not a
      // hardcoded guess. (Some local models otherwise parrot Qwen/NVIDIA/etc.)
      turns.unshift({
        role: 'system',
        content:
          `You are "${ep.model}", a large language model running locally through the ` +
          `CODE NAME desktop app. If asked what model or AI you are, identify yourself as ` +
          `"${ep.model}". Do not claim to be a different model, company, or product.`,
      });

      const ctl = new AbortController();
      abortRef.current = ctl;

      if (!gates.network && reachesNetwork(ep)) {
        auditDenied('endpoint', 'network gate closed', {
          gate: 'network',
          targetId: `model:${ep.id}`,
        });
        patchTask(taskId, (t) => ({
          ...t,
          messages: t.messages.map((m) =>
            m.id === asstId
              ? {
                  ...m,
                  streaming: false,
                  content:
                    '[BLOCKED] Network gate is closed. Outbound cloud routing is severed at the bridge. Re-open the Network gate in the stealth drawer or switch to a local endpoint.',
                }
              : m,
          ),
        }));
        pushActivity(taskId, 'system', 'network gate closed — cloud route severed');
        setSending(false);
        abortRef.current = null;
        return;
      }

      // Route to the local agent sidecar over A2A when that endpoint is active.
      if (ep.kind === 'a2a') {
        if (!gates.tools) {
          auditDenied('sidecar', 'tools gate closed', {
            gate: 'tools',
            targetId: 'sidecar_stream',
          });
          patchTask(taskId, (t) => ({
            ...t,
            messages: t.messages.map((m) =>
              m.id === asstId
                ? {
                    ...m,
                    streaming: false,
                    content:
                      '[BLOCKED] Tool-execution gate is closed. The agent sidecar bridge is severed. Re-open the Tools gate to route to the sidecar.',
                  }
                : m,
            ),
          }));
          pushActivity(taskId, 'system', 'tools gate closed — sidecar bridge severed');
          setSending(false);
          abortRef.current = null;
          return;
        }
        try {
          const info = await getSidecarInfo();
          if (!info || info.status !== 'ready') throw new Error('sidecar not ready');
          pushActivity(taskId, 'network', `A2A → ${info.host}:${info.port} (token held in shell)`);
          await streamFromSidecar(trimmed, (tok) =>
            patchTask(taskId, (t) => ({
              ...t,
              messages: t.messages.map((m) =>
                m.id === asstId ? { ...m, content: m.content + tok } : m,
              ),
            })),
          );
        } catch (err) {
          auditDenied('sidecar', err instanceof Error ? err.message : 'sidecar unavailable', {
            gate: 'sidecar',
            targetId: 'sidecar_stream',
          });
          patchTask(taskId, (t) => ({
            ...t,
            messages: t.messages.map((m) =>
              m.id === asstId
                ? {
                    ...m,
                    content:
                      m.content ||
                      `[SIDECAR OFFLINE] ${err instanceof Error ? err.message : 'unavailable'}. Run the desktop app (npm run tauri dev) so the Rust supervisor can launch the Python sidecar.`,
                  }
                : m,
            ),
          }));
        } finally {
          patchTask(taskId, (t) => ({
            ...t,
            messages: t.messages.map((m) => (m.id === asstId ? { ...m, streaming: false } : m)),
          }));
          setSending(false);
          abortRef.current = null;
        }
        return;
      }

      let servedModel = '';
      try {
        await streamChat(ep, activeProfile, turns, {
          signal: ctl.signal,
          onActivity: (kind, t) => pushActivity(taskId, kind, t),
          onModel: (m) => {
            servedModel = m;
            setRunningModel(m);
          },
          onDenied: (_category, reason) =>
            auditDenied('endpoint', reason, {
              gate: 'endpoint',
              targetId: `model:${ep.id}`,
            }),
          onToken: (tok) =>
            patchTask(taskId, (t) => ({
              ...t,
              messages: t.messages.map((m) =>
                m.id === asstId ? { ...m, content: m.content + tok } : m,
              ),
            })),
        });
      } finally {
        patchTask(taskId, (t) => ({
          ...t,
          messages: t.messages.map((m) => (m.id === asstId ? { ...m, streaming: false } : m)),
        }));
        setSending(false);
        abortRef.current = null;
      }
      // Truth check: confirm the server actually ran the model we requested. If it
      // substituted a different one (e.g. LM Studio serving its already-loaded
      // model), say so plainly instead of pretending — the chosen model must be
      // the one that actually runs.
      const wanted = ep.model.toLowerCase();
      const got = servedModel.toLowerCase();
      if (servedModel && got !== wanted && !got.includes(wanted) && !wanted.includes(got)) {
        pushActivity(
          taskId,
          'system',
          `model mismatch — requested "${ep.model}", server ran "${servedModel}"`,
        );
        patchTask(taskId, (t) => ({
          ...t,
          messages: [
            ...t.messages,
            {
              id: uuidv4().slice(0, 8),
              role: 'system' as const,
              content:
                `⚠ Model mismatch: you selected "${ep.model}", but the server actually ran ` +
                `"${servedModel}" — the reply above came from "${servedModel}", not your choice. ` +
                `To run the model you pick: in LM Studio turn on "Just-In-Time model loading" (or load ` +
                `"${ep.model}" there). Ollama loads the requested model automatically.`,
              ts: Date.now(),
            },
          ],
        }));
      }
    },
    [sending, activeTaskId, activeEndpoint, activeProfile, gates.network, gates.tools, patchTask, pushActivity, tasks, auditDenied],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    cancelSidecar();
  }, []);

  /* ---- ingestion ---- */
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const quarantineRef = useRef(quarantine);
  quarantineRef.current = quarantine;

  const createDocNode = useCallback(
    (name: string, text: string, hash: string, taskId = activeTaskIdRef.current): string => {
      const id = `doc-${uuidv4().slice(0, 8)}`;
      const node: AppNode = {
        id,
        type: 'doc',
        position: { x: 200 + Math.random() * 320, y: 160 + Math.random() * 320 },
        data: {
          label: `DOC_${id.slice(4).toUpperCase()}`,
          type: 'INGEST',
          title: name,
          description: text,
          class: 'UNCLASSIFIED',
          hash,
          currentVersion: 1,
          history: [
            {
              version: 1,
              timestamp: Date.now(),
              changes: 'Gated ingestion',
              snap: { title: name, class: 'UNCLASSIFIED', hash },
            },
          ],
        },
        style: NODE_STYLE,
      };
      commit({
        action: 'create',
        node,
        actor: { kind: 'system', id: 'ingest', taskId },
        diff: `ingest ${name}`,
        provenance: { source: name, ingestionId: id },
      });
      return id;
    },
    [commit],
  );

  // Install the WebMCP shim and register built-in, gate-routed tools (Phase 4).
  useEffect(() => {
    installWebMcp();
    setToolGuard(() => {
      const task = tasksRef.current.find((t) => t.id === activeTaskIdRef.current);
      const caps = task?.session.caps ?? FULL_CAPS;
      const eff = effectiveGates(gatesRef.current, caps);
      return eff.tools ? { allowed: true } : { allowed: false, reason: 'tools gate/scope closed' };
    });
    setToolLogger((name, allowed, detail) => {
      if (!allowed) {
        auditDenied('tool', detail ?? 'tool denied', {
          gate: 'tool',
          targetId: name,
        });
      }
      pushActivity(
        activeTaskIdRef.current,
        'tool',
        `${allowed ? 'tool' : 'tool blocked'}: ${name}${detail ? ` (${detail})` : ''}`,
      );
    });
    const ctl = new AbortController();
    registerTool(
      {
        name: 'graph.search',
        description: 'Search the knowledge graph (lexical / GraphRAG retrieval).',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        execute: (args) => {
          retriever.index(nodesRef.current);
          const hits = retriever.retrieve(String(args.query ?? ''), 8).map((h) => {
            const n = nodesRef.current.find((x) => x.id === h.id);
            return n ? `${n.data.label}: ${n.data.title ?? n.data.name ?? ''}` : h.id;
          });
          return { content: [{ type: 'text', text: hits.length ? hits.join('\n') : 'no matches' }] };
        },
      },
      { signal: ctl.signal },
    );
    registerTool(
      {
        name: 'graph.note',
        description: 'Create a note node in the knowledge graph (gated + audited).',
        inputSchema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title'] },
        execute: (args) => {
          const id = createDocNode(String(args.title ?? 'NOTE'), String(args.text ?? ''), `note:${Date.now()}`);
          return { content: [{ type: 'text', text: `created ${id}` }] };
        },
      },
      { signal: ctl.signal },
    );
    registerTool(
      {
        name: 'ui.render',
        description: 'Render an A2UI payload into the Agent UI panel.',
        inputSchema: { type: 'object', properties: { root: { type: 'string' }, components: { type: 'array' } }, required: ['root', 'components'] },
        execute: (args) => {
          const payload = validateA2UIPayload(args);
          if (payload.ok === false) {
            auditDenied('a2ui', payload.error, {
              gate: 'a2ui',
              targetId: 'ui.render',
            });
            return { content: [{ type: 'text', text: `[blocked] ${payload.error}` }] };
          }
          setAgentUI(payload.value as A2UIPayload);
          return { content: [{ type: 'text', text: 'rendered' }] };
        },
      },
      { signal: ctl.signal },
    );
    registerTool(
      {
        name: 'browser.open',
        description: 'Open a URL via the shared Browser Harness pool (per-tab isolated context).',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        execute: async (args) => {
          const taskId = activeTaskIdRef.current;
          const task = tasksRef.current.find((t) => t.id === taskId);
          if (!task?.session.caps.browser) {
            auditDenied('browser', 'this tab lacks BROWSER permission', {
              gate: 'browser',
              targetId: 'browser.open',
            });
            return { content: [{ type: 'text', text: '[blocked] this tab lacks BROWSER permission' }] };
          }
          const lz = poolLease('browser', taskId);
          if (!lz.ok) {
            auditDenied('browser', lz.reason, {
              gate: 'browser',
              targetId: 'browser.open',
            });
            return { content: [{ type: 'text', text: `[blocked] ${lz.reason}` }] };
          }
          pushActivity(taskId, 'tool', `browser ctx ${lz.id} → ${String(args.url)}`);
          // SEAM: forward to the sidecar Browser Harness (CDP) over A2A.
          const info = await getSidecarInfo();
          if (!info || info.status !== 'ready') {
            return {
              content: [
                {
                  type: 'text',
                  text: `[browser pool ${lz.id}] leased an isolated context; Browser Harness runs in the desktop app. Target: ${String(args.url)}`,
                },
              ],
            };
          }
          return { content: [{ type: 'text', text: `[browser pool ${lz.id}] queued ${String(args.url)} via Browser Harness` }] };
        },
      },
      { signal: ctl.signal },
    );
    // Local-first degradation self-check -> activity feed (Phase 6).
    runSelfCheck().then((rs) =>
      rs.forEach((r) =>
        pushActivity(activeTaskIdRef.current, 'system', `selfcheck ${r.ok ? 'ok' : 'warn'}: ${r.name} — ${r.detail}`),
      ),
    );
    return () => ctl.abort();
  }, [createDocNode, pushActivity, auditDenied]);

  const ingestFiles = useCallback(
    async (files: File[]) => {
      const taskId = activeTaskIdRef.current;
      const activeTaskId = taskId;
      const eff = taskEffectiveGates(taskId);
      if (!eff.filesystem) {
        pushActivity(activeTaskId, 'system', 'filesystem gate closed — ingestion blocked');
        const blocked: QuarantineItem = {
          id: uuidv4().slice(0, 8),
          name: `${files.length} file(s)`,
          size: 0,
          hash: '—',
          status: 'rejected',
          note: 'Filesystem gate closed',
        };
        setQuarantine((q) => [blocked, ...q].slice(0, 50));
        return;
      }

      for (const file of files) {
        const itemId = uuidv4().slice(0, 8);
        const staged: QuarantineItem = {
          id: itemId,
          name: file.name,
          size: file.size,
          hash: '…',
          status: 'checking',
        };
        setQuarantine((q) => [staged, ...q].slice(0, 50));
        pushActivity(activeTaskId, 'tool', `staging ${file.name}`);

        const hash = await hashFile(file);
        let text = '';
        try {
          if (file.type.startsWith('text/') || /\.(txt|md|json|csv|js|ts|tsx|py)$/i.test(file.name)) {
            text = (await file.text()).slice(0, 4000);
          } else {
            text = `[binary asset · ${file.type || 'unknown'} · ${file.size} bytes]`;
          }
        } catch {
          text = '[unreadable]';
        }

        const conflict = nodesRef.current.find(
          (n) => n.data.hash === hash || n.data.title === file.name,
        );

        if (conflict) {
          setQuarantine((q) =>
            q.map((it) =>
              it.id === itemId
                ? { ...it, hash, status: 'conflict', conflictWith: conflict.id, note: text.slice(0, 120) }
                : it,
            ),
          );
          pushActivity(activeTaskId, 'system', `redundancy detected: ${file.name} ↔ ${conflict.data.label}`);
        } else {
          const nodeId = createDocNode(file.name, text, hash, taskId);
          setQuarantine((q) =>
            q.map((it) => (it.id === itemId ? { ...it, hash, status: 'indexed', note: nodeId } : it)),
          );
          pushActivity(activeTaskId, 'tool', `indexed ${file.name} → graph`);
        }
      }
    },
    [createDocNode, pushActivity, taskEffectiveGates],
  );

  const resolveConflict = useCallback(
    (id: string, action: 'overwrite' | 'skip' | 'fork') => {
      const item = quarantineRef.current.find((it) => it.id === id);
      if (!item) return;

      if (action === 'skip') {
        pushActivity(activeTaskId, 'system', `discarded ${item.name}`);
        setQuarantine((q) => q.map((it) => (it.id === id ? { ...it, status: 'skipped' } : it)));
        return;
      }

      if (action === 'overwrite' && item.conflictWith) {
        const cur = nodesRef.current.find((n) => n.id === item.conflictWith);
        if (cur) {
          const nextVer = (cur.data.currentVersion ?? 1) + 1;
          const updated: AppNode = {
            ...cur,
            data: {
              ...cur.data,
              title: item.name,
              hash: item.hash,
              description: item.note,
              currentVersion: nextVer,
              history: [
                {
                  version: nextVer,
                  timestamp: Date.now(),
                  changes: 'Overwritten via ingestion',
                  snap: { title: item.name, hash: item.hash },
                },
                ...(cur.data.history ?? []),
              ],
            },
          };
          commit({
            action: 'update',
            node: updated,
            actor: { kind: 'system', id: 'ingest', taskId: activeTaskId },
            diff: `overwrite ${cur.data.label}`,
            provenance: { source: item.name },
          });
        }
        pushActivity(activeTaskId, 'tool', `overwrote graph copy with ${item.name}`);
        setQuarantine((q) => q.map((it) => (it.id === id ? { ...it, status: 'indexed' } : it)));
        return;
      }

      if (action === 'fork') {
        const nodeId = createDocNode(`${item.name} (fork)`, item.note ?? '', item.hash);
        pushActivity(activeTaskId, 'tool', `forked ${item.name} → ${nodeId}`);
        setQuarantine((q) => q.map((it) => (it.id === id ? { ...it, status: 'indexed' } : it)));
        return;
      }
    },
    [activeTaskId, commit, createDocNode, pushActivity],
  );

  const clearLedger = useCallback(() => {
    setQuarantine((q) => q.filter((it) => it.status === 'conflict' || it.status === 'checking'));
  }, []);

  const value: AppStateValue = {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectedNodeId,
    setSelectedNodeId,
    updateNodeData,
    graphQuery,
    setGraphQuery,
    runGraphQuery,
    tasks,
    activeTaskId,
    activeTask,
    setActiveTaskId,
    addTask,
    closeTask,
    setTabCap,
    sending,
    sendMessage,
    abort,
    showActivity,
    setShowActivity,
    runningModel,
    endpoints,
    profiles,
    activeProfileId,
    setActiveProfileId,
    activeProfile,
    activeEndpoint,
    updateProfile,
    setEndpointModel,
    updateEndpoint,
    addProfile,
    deleteProfile,
    refreshEndpoints,
    gates,
    toggleGate,
    quarantine,
    ingestFiles,
    resolveConflict,
    clearLedger,
    bootTs,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
