import type {
  Endpoint,
  ConfigProfile,
  SecurityGates,
  WorkTask,
} from '../types';

/**
 * Local-first endpoint registry. Local loopback engines come first and are the
 * default route; cloud is registered but secondary. The harness is model
 * agnostic — every entry is probed and selectable.
 */
export const defaultEndpoints: Endpoint[] = [
  {
    id: 'agent-sidecar',
    label: 'Agent Sidecar (A2A)',
    kind: 'a2a',
    baseUrl: 'http://127.0.0.1:0',
    model: 'adk-agent',
    isLocal: true,
    status: 'offline',
  },
  {
    id: 'ollama-local',
    label: 'Ollama (local)',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1',
    isLocal: true,
    status: 'offline',
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    kind: 'ollama',
    baseUrl: 'https://ollama.com',
    model: 'gpt-oss:120b',
    isLocal: false,
    usesCloud: true,
    apiKeyEnv: 'OLLAMA_API_KEY',
    status: 'offline',
  },
  {
    id: 'lmstudio-local',
    label: 'LM Studio (local)',
    kind: 'lmstudio',
    baseUrl: 'http://localhost:1234',
    model: 'local-model',
    isLocal: true,
    status: 'offline',
  },
  {
    id: 'custom-openai',
    label: 'Custom OpenAI-compatible',
    kind: 'custom',
    baseUrl: 'http://localhost:8000',
    model: 'default',
    isLocal: true,
    status: 'offline',
  },
  {
    id: 'gemini-cloud',
    label: 'Gemini (cloud · secondary)',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.0-flash',
    isLocal: false,
    apiKeyEnv: 'GEMINI_API_KEY',
    status: 'offline',
  },
];

export const defaultProfiles: ConfigProfile[] = [
  {
    id: 'profile-balanced',
    name: 'BALANCED',
    endpointId: 'ollama-local',
    temperature: 0.7,
    contextWindow: 8192,
  },
  {
    id: 'profile-precise',
    name: 'PRECISE',
    endpointId: 'ollama-local',
    temperature: 0.2,
    contextWindow: 16384,
  },
  {
    id: 'profile-creative',
    name: 'CREATIVE',
    endpointId: 'lmstudio-local',
    temperature: 1.0,
    contextWindow: 8192,
  },
];

export const defaultGates: SecurityGates = {
  filesystem: true,
  network: true,
  tools: true,
};

export const initialTask: WorkTask = {
  id: 'task-primary',
  name: 'PRIMARY ANALYSIS',
  kind: 'analysis',
  agent: 'ANALYST-0',
  messages: [
    {
      id: 'sys-0',
      role: 'system',
      content:
        'Execution canvas online. Local-first routing engaged. Drop a codebase or document onto the left pane to ingest, or query a connected model below.',
      ts: Date.now(),
    },
  ],
  activity: [],
  session: { id: 'sess-primary', caps: { browser: true, tools: true, network: true, filesystem: true } },
};
