import { describe, expect, it } from 'vitest';
import {
  VALIDATION_LIMITS,
  redactSecrets,
  validateA2UIPayload,
  validateEndpointKind,
  validateEndpointUrl,
  validateModelRequestBounds,
  validateSecretName,
  validateWebMcpArgs,
  validateWebMcpToolName,
} from './securityValidation';

const validMessage = { role: 'user', content: 'hello' };

describe('endpoint validation', () => {
  it('accepts loopback endpoints for frontend-direct transport', () => {
    for (const raw of ['http://localhost:11434', 'http://127.0.0.1:1234', 'http://[::1]:8000']) {
      const r = validateEndpointUrl(raw);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.class).toBe('loopback');
        expect(r.value.frontendDirectAllowed).toBe(true);
      }
    }
  });

  it('rejects file URLs', () => {
    const r = validateEndpointUrl('file:///C:/secrets.txt');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/file/i);
  });

  it('rejects malformed URLs', () => {
    const r = validateEndpointUrl('not a url');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/malformed/i);
  });

  it('rejects credentialed URLs', () => {
    const r = validateEndpointUrl('https://user:pass@example.com/v1');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/credentials/i);
  });

  it('classifies remote HTTP and HTTPS as cloud, not frontend-direct', () => {
    for (const raw of ['http://192.168.1.10:8000', 'https://api.example.com/v1']) {
      const r = validateEndpointUrl(raw);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.class).toBe('remote');
        expect(r.value.frontendDirectAllowed).toBe(false);
      }
    }
  });

  it('rejects unknown endpoint kinds', () => {
    const r = validateEndpointKind('bogus');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/unknown/i);
  });
});

describe('model request bounds', () => {
  it('rejects oversized messages without echoing message content', () => {
    const secretText = `Bearer super-secret-token ${'x'.repeat(VALIDATION_LIMITS.maxMessageTextLength)}`;
    const r = validateModelRequestBounds({
      model: 'llama3.1',
      temperature: 0.7,
      contextWindow: 8192,
      messages: [{ role: 'user', content: secretText }],
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toMatch(/too long/i);
      expect(r.error).not.toContain('super-secret-token');
    }
  });

  it('rejects invalid temperature', () => {
    const r = validateModelRequestBounds({
      model: 'llama3.1',
      temperature: 3,
      contextWindow: 8192,
      messages: [validMessage],
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/temperature/i);
  });

  it('rejects invalid context window', () => {
    const r = validateModelRequestBounds({
      model: 'llama3.1',
      temperature: 0.7,
      contextWindow: 1,
      messages: [validMessage],
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/context/i);
  });
});

describe('secret validation and redaction', () => {
  it('rejects invalid secret names', () => {
    for (const name of ['../OPENAI_API_KEY', 'BAD KEY', 'TOKEN;rm -rf', 'x'.repeat(80)]) {
      const r = validateSecretName(name);
      expect(r.ok).toBe(false);
    }
  });

  it('redacts secret-like values from error text', () => {
    const raw =
      'HTTP 401 token=abc123SECRET password:"hunter2" Authorization: Bearer xyz.abc.123 sk-abcdefghijklmnopqrstuvwxyz';
    const redacted = redactSecrets(raw);
    expect(redacted).toContain('token=[REDACTED]');
    expect(redacted).toContain('password=[REDACTED]');
    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('sk-[REDACTED]');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('xyz.abc.123');
  });
});

describe('WebMCP validation', () => {
  it('rejects unknown WebMCP tools', () => {
    const r = validateWebMcpToolName('shell.exec');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/unknown/i);
  });

  it('rejects non-object WebMCP args', () => {
    for (const args of [null, 'x', 42, []]) {
      const r = validateWebMcpArgs(args);
      expect(r.ok).toBe(false);
    }
  });
});

describe('A2UI validation', () => {
  it('rejects duplicate component IDs', () => {
    const r = validateA2UIPayload({
      root: 'a',
      components: [
        { id: 'a', type: 'card' },
        { id: 'a', type: 'text', properties: { text: 'dup' } },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/duplicate/i);
  });

  it('rejects missing root components', () => {
    const r = validateA2UIPayload({
      root: 'missing',
      components: [{ id: 'a', type: 'card' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/root/i);
  });

  it('rejects unknown component types', () => {
    const r = validateA2UIPayload({
      root: 'a',
      components: [{ id: 'a', type: 'iframe' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/trusted/i);
  });

  it('rejects oversized props', () => {
    const r = validateA2UIPayload({
      root: 'a',
      components: [
        {
          id: 'a',
          type: 'text',
          properties: { text: 'x'.repeat(VALIDATION_LIMITS.maxA2UIStringLength + 1) },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toMatch(/size/i);
  });
});
