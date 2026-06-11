import { describe, expect, it } from 'vitest';
import { makeDeniedSecurityAudit } from './securityAudit';

describe('denied security audit records', () => {
  it('creates a non-KG denied audit record with stable shape', () => {
    const r = makeDeniedSecurityAudit({
      category: 'endpoint',
      reason: 'malformed endpoint URL',
      actor: { kind: 'user', id: 'director', taskId: 'task-1' },
      targetId: 'model_stream',
    });

    expect(r.action).toBe('endpoint-deny');
    expect(r.target).toEqual({ kind: 'security', id: 'model_stream' });
    expect(r.decision.allowed).toBe(false);
    expect(r.decision.gate).toBe('endpoint');
    expect(r.decision.reason).toMatch(/malformed/);
    expect(typeof r.ts).toBe('number');
  });

  it('redacts secret-like values in audit reasons', () => {
    const r = makeDeniedSecurityAudit({
      category: 'secret',
      reason: 'Bearer xyz.abc.123 token=abc123 password=hunter2 sk-abcdefghijklmnopqrstuvwxyz',
    });

    const text = `${r.decision.reason} ${r.diff}`;
    expect(text).toContain('Bearer [REDACTED]');
    expect(text).toContain('token=[REDACTED]');
    expect(text).toContain('password=[REDACTED]');
    expect(text).toContain('sk-[REDACTED]');
    expect(text).not.toContain('xyz.abc.123');
    expect(text).not.toContain('abc123');
    expect(text).not.toContain('hunter2');
  });

  it('does not include full endpoint/model message content', () => {
    const tail = 'UNIQUE_FULL_MODEL_MESSAGE_TAIL';
    const full = `message content is too long ${'x'.repeat(300)}${tail}`;
    const r = makeDeniedSecurityAudit({ category: 'endpoint', reason: full });

    expect(r.action).toBe('endpoint-deny');
    expect(r.decision.reason).not.toContain(tail);
    expect(r.diff).not.toContain(tail);
  });

  it('does not include full sidecar prompt content', () => {
    const tail = 'UNIQUE_FULL_SIDECAR_PROMPT_TAIL';
    const full = `sidecar message is too long ${'p'.repeat(300)}${tail}`;
    const r = makeDeniedSecurityAudit({ category: 'sidecar', reason: full });

    expect(r.action).toBe('sidecar-deny');
    expect(r.decision.reason).not.toContain(tail);
    expect(r.diff).not.toContain(tail);
  });

  it('uses stable action categories for denied tools and A2UI', () => {
    expect(makeDeniedSecurityAudit({ category: 'tool', reason: 'unknown WebMCP tool' }).action).toBe(
      'tool-deny',
    );
    expect(
      makeDeniedSecurityAudit({ category: 'a2ui', reason: 'A2UI duplicate component id' }).action,
    ).toBe('a2ui-deny');
  });
});
