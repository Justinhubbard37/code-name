import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  isLoopbackEndpoint,
  reachesNetwork,
  requiresRustModelProxy,
  streamChat,
  usesDirectFrontendTransport,
} from './llm';
import type { ConfigProfile, Endpoint } from '../types';

function ep(partial: Partial<Endpoint>): Endpoint {
  return {
    id: 'x',
    label: 'x',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1',
    isLocal: true,
    status: 'offline',
    ...partial,
  };
}

describe('reachesNetwork (what the Network gate governs)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a pure local model does NOT reach the network', () => {
    expect(reachesNetwork(ep({ kind: 'ollama', isLocal: true, model: 'gemma4:26b' }))).toBe(false);
  });

  it('a non-local (cloud) endpoint reaches the network', () => {
    expect(
      reachesNetwork(ep({ kind: 'gemini', isLocal: false, model: 'gemini-2.0-flash' })),
    ).toBe(true);
  });

  it('an explicit usesCloud flag reaches the network even when marked local', () => {
    expect(reachesNetwork(ep({ isLocal: true, usesCloud: true }))).toBe(true);
  });

  it('an Ollama "-cloud" model on the local daemon reaches the network', () => {
    expect(
      reachesNetwork(ep({ kind: 'ollama', isLocal: true, model: 'gpt-oss:120b-cloud' })),
    ).toBe(true);
  });

  it('allows direct frontend transport only for pure loopback local endpoints', () => {
    const localHosts = ['http://localhost:11434', 'http://127.0.0.1:1234', 'http://[::1]:8000'];
    for (const baseUrl of localHosts) {
      const endpoint = ep({ kind: 'lmstudio', baseUrl, isLocal: true, model: 'local-model' });
      expect(isLoopbackEndpoint(endpoint)).toBe(true);
      expect(usesDirectFrontendTransport(endpoint)).toBe(true);
      expect(requiresRustModelProxy(endpoint)).toBe(false);
    }
  });

  it('routes non-loopback local-looking endpoints through the Rust model proxy', () => {
    const endpoint = ep({
      kind: 'custom',
      baseUrl: 'http://192.168.1.10:8000',
      isLocal: true,
      model: 'remote-compatible',
    });
    expect(isLoopbackEndpoint(endpoint)).toBe(false);
    expect(usesDirectFrontendTransport(endpoint)).toBe(false);
    expect(requiresRustModelProxy(endpoint)).toBe(true);
  });

  it('routes cloud endpoints through Rust instead of frontend fetch or VITE secrets', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const endpoint = ep({
      kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      isLocal: false,
      model: 'gemini-2.0-flash',
      apiKeyEnv: 'GEMINI_API_KEY',
    });
    const profile: ConfigProfile = {
      id: 'p',
      name: 'P',
      endpointId: endpoint.id,
      temperature: 0.2,
      contextWindow: 4096,
    };
    const tokens: string[] = [];
    const denials: string[] = [];

    await streamChat(endpoint, profile, [{ role: 'user', content: 'hello' }], {
      onToken: (t) => tokens.push(t),
      onDenied: (category, reason) => denials.push(`${category}:${reason}`),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tokens.join('')).toMatch(/LOCAL SYNTHETIC NODE/);
    expect(denials.some((d) => d.startsWith('endpoint:'))).toBe(true);
  });
});
