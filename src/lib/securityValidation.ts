import type { EndpointKind } from '../types';
import type { A2UIPayload } from '../components/right/a2ui/types';

export type ValidationResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type EndpointUrlClass = 'loopback' | 'remote';

export interface EndpointUrlPolicy {
  url: URL;
  class: EndpointUrlClass;
  frontendDirectAllowed: boolean;
}

export const KNOWN_ENDPOINT_KINDS: readonly EndpointKind[] = [
  'ollama',
  'openai',
  'lmstudio',
  'gemini',
  'custom',
  'a2a',
];

export const KNOWN_WEBMCP_TOOLS = [
  'graph.search',
  'graph.note',
  'ui.render',
  'browser.open',
] as const;

export const TRUSTED_A2UI_COMPONENT_TYPES = [
  'card',
  'column',
  'row',
  'heading',
  'text',
  'badge',
  'button',
  'textfield',
  'divider',
] as const;

export const VALIDATION_LIMITS = {
  maxMessages: 64,
  maxMessageTextLength: 20_000,
  minTemperature: 0,
  maxTemperature: 2,
  minContextWindow: 512,
  maxContextWindow: 262_144,
  maxModelNameLength: 128,
  maxSecretNameLength: 64,
  maxA2UIComponents: 100,
  maxA2UIIdLength: 80,
  maxA2UIStringLength: 2_000,
  maxA2UIPropertiesBytes: 12_000,
} as const;

const KIND_SET = new Set<string>(KNOWN_ENDPOINT_KINDS);
const TOOL_SET = new Set<string>(KNOWN_WEBMCP_TOOLS);
const A2UI_TYPE_SET = new Set<string>(TRUSTED_A2UI_COMPONENT_TYPES);
const MODEL_NAME_RE = /^[A-Za-z0-9._:/@+-]+$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

const KNOWN_SECRET_NAMES = new Set([
  'OLLAMA_API_KEY',
  'OPENAI_API_KEY',
  'LMSTUDIO_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
]);

function invalid(error: string): ValidationResult<never> {
  return { ok: false, error };
}

export function validateEndpointKind(kind: unknown): ValidationResult<EndpointKind> {
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) {
    return invalid('unknown endpoint kind');
  }
  return { ok: true, value: kind as EndpointKind };
}

export function validateEndpointUrl(raw: unknown): ValidationResult<EndpointUrlPolicy> {
  if (typeof raw !== 'string' || !raw.trim()) return invalid('endpoint URL is required');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid('malformed endpoint URL');
  }

  if (url.username || url.password) return invalid('endpoint URL must not include credentials');
  if (url.protocol === 'file:') return invalid('file URLs are not allowed for endpoints');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return invalid('endpoint URL must use http or https');
  }

  const host = url.hostname.toLowerCase();
  const normalizedHost = host.replace(/^\[|\]$/g, '');
  const isLoopback =
    normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '::1';

  if (isLoopback && url.protocol !== 'http:') {
    return invalid('loopback endpoints must use http');
  }

  return {
    ok: true,
    value: {
      url,
      class: isLoopback ? 'loopback' : 'remote',
      frontendDirectAllowed: isLoopback && url.protocol === 'http:',
    },
  };
}

export interface ModelMessageInput {
  role?: unknown;
  content?: unknown;
}

export interface ModelRequestInput {
  model?: unknown;
  temperature?: unknown;
  contextWindow?: unknown;
  messages?: unknown;
}

export function validateModelRequestBounds(req: ModelRequestInput): ValidationResult {
  const model = req.model;
  if (typeof model !== 'string' || model.length === 0) return invalid('model name is required');
  if (model.length > VALIDATION_LIMITS.maxModelNameLength) return invalid('model name is too long');
  if (!MODEL_NAME_RE.test(model)) return invalid('model name contains unsupported characters');

  if (typeof req.temperature !== 'number' || !Number.isFinite(req.temperature)) {
    return invalid('temperature must be a finite number');
  }
  if (
    req.temperature < VALIDATION_LIMITS.minTemperature ||
    req.temperature > VALIDATION_LIMITS.maxTemperature
  ) {
    return invalid('temperature is outside the allowed range');
  }

  if (typeof req.contextWindow !== 'number' || !Number.isInteger(req.contextWindow)) {
    return invalid('context window must be an integer');
  }
  if (
    req.contextWindow < VALIDATION_LIMITS.minContextWindow ||
    req.contextWindow > VALIDATION_LIMITS.maxContextWindow
  ) {
    return invalid('context window is outside the allowed range');
  }

  if (!Array.isArray(req.messages)) return invalid('messages must be an array');
  if (req.messages.length > VALIDATION_LIMITS.maxMessages) return invalid('too many messages');

  for (const msg of req.messages as ModelMessageInput[]) {
    if (!msg || typeof msg !== 'object') return invalid('message must be an object');
    if (typeof msg.content !== 'string') return invalid('message content must be text');
    if (msg.content.length > VALIDATION_LIMITS.maxMessageTextLength) {
      return invalid('message content is too long');
    }
  }

  return { ok: true, value: undefined };
}

export function validateSecretName(name: unknown): ValidationResult<string> {
  if (typeof name !== 'string' || !name) return invalid('secret name is required');
  if (name.length > VALIDATION_LIMITS.maxSecretNameLength) return invalid('secret name is too long');
  if (!ENV_NAME_RE.test(name)) return invalid('secret name must be env-var style');
  if (KNOWN_SECRET_NAMES.has(name) || ENV_NAME_RE.test(name)) return { ok: true, value: name };
  return invalid('secret name is not allowed');
}

export function validateWebMcpToolName(name: unknown): ValidationResult<string> {
  if (typeof name !== 'string' || !TOOL_SET.has(name)) return invalid('unknown WebMCP tool');
  return { ok: true, value: name };
}

export function validateWebMcpArgs(args: unknown): ValidationResult<Record<string, unknown>> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return invalid('WebMCP args must be an object');
  }
  return { ok: true, value: args as Record<string, unknown> };
}

export function validateA2UIPayload(payload: unknown): ValidationResult<A2UIPayload> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('A2UI payload must be an object');
  }
  const p = payload as Partial<A2UIPayload>;
  if (typeof p.root !== 'string' || !p.root) return invalid('A2UI root is required');
  if (!Array.isArray(p.components)) return invalid('A2UI components must be an array');
  if (p.components.length > VALIDATION_LIMITS.maxA2UIComponents) {
    return invalid('A2UI component count exceeds limit');
  }

  const ids = new Set<string>();
  for (const component of p.components) {
    if (!component || typeof component !== 'object') return invalid('A2UI component must be an object');
    if (typeof component.id !== 'string' || !component.id) return invalid('A2UI component id is required');
    if (component.id.length > VALIDATION_LIMITS.maxA2UIIdLength) {
      return invalid('A2UI component id is too long');
    }
    if (ids.has(component.id)) return invalid('A2UI duplicate component id');
    ids.add(component.id);
    if (typeof component.type !== 'string' || !A2UI_TYPE_SET.has(component.type)) {
      return invalid('A2UI component type is not trusted');
    }
    if (component.children !== undefined) {
      if (!Array.isArray(component.children)) return invalid('A2UI children must be an array');
      for (const child of component.children) {
        if (typeof child !== 'string') return invalid('A2UI child reference must be text');
      }
    }
    const propCheck = validateA2UIProperties(component.properties);
    if (propCheck.ok === false) return { ok: false, error: propCheck.error };
  }

  if (!ids.has(p.root)) return invalid('A2UI root component is missing');
  for (const component of p.components) {
    for (const child of component.children ?? []) {
      if (!ids.has(child)) return invalid('A2UI child reference is missing');
    }
  }

  return { ok: true, value: p as A2UIPayload };
}

function validateA2UIProperties(properties: unknown): ValidationResult {
  if (properties === undefined) return { ok: true, value: undefined };
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return invalid('A2UI properties must be an object');
  }
  const encoded = JSON.stringify(properties);
  if (encoded.length > VALIDATION_LIMITS.maxA2UIPropertiesBytes) {
    return invalid('A2UI properties exceed size limit');
  }
  const stack: unknown[] = [properties];
  while (stack.length) {
    const cur = stack.pop();
    if (typeof cur === 'string' && cur.length > VALIDATION_LIMITS.maxA2UIStringLength) {
      return invalid('A2UI string property exceeds size limit');
    }
    if (Array.isArray(cur)) {
      stack.push(...cur);
    } else if (cur && typeof cur === 'object') {
      stack.push(...Object.values(cur));
    }
  }
  return { ok: true, value: undefined };
}

export function redactSecrets(input: unknown): string {
  let text = String(input);
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/\b(sk-[A-Za-z0-9]{10,})\b/g, 'sk-[REDACTED]');
  text = text.replace(/\b(AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_API_KEY]');
  text = text.replace(
    /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"',\s)]+["']?/gi,
    '$1=[REDACTED]',
  );
  return text;
}
