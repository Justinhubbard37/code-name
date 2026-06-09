import { describe, it, expect } from 'vitest';
import { evaluateKgWrite, evaluateScopedKgWrite, makeAudit } from './commit';
import type { SecurityGates, TabCaps } from '../types';

const open: SecurityGates = { filesystem: true, network: true, tools: true };
const fsClosed: SecurityGates = { filesystem: false, network: true, tools: true };
const fullCaps: TabCaps = { browser: true, filesystem: true, network: true, tools: true };

describe('evaluateKgWrite (the gated KG-write chokepoint)', () => {
  it('allows a write when the filesystem gate is open', () => {
    const d = evaluateKgWrite(open);
    expect(d.allowed).toBe(true);
    expect(d.gate).toBe('filesystem');
  });

  it('denies and explains the write when the filesystem gate is closed', () => {
    const d = evaluateKgWrite(fsClosed);
    expect(d.allowed).toBe(false);
    expect(d.gate).toBe('filesystem');
    expect(d.reason ?? '').toMatch(/filesystem/i);
  });

  it('denies when the active tab revokes filesystem even if global filesystem is open', () => {
    const d = evaluateScopedKgWrite(open, { ...fullCaps, filesystem: false });
    expect(d.allowed).toBe(false);
    expect(d.gate).toBe('filesystem');
    expect(d.reason ?? '').toMatch(/filesystem/i);
  });

  it('does not let a tab reopen a globally closed filesystem gate', () => {
    const d = evaluateScopedKgWrite(fsClosed, fullCaps);
    expect(d.allowed).toBe(false);
    expect(d.gate).toBe('filesystem');
  });
});

describe('makeAudit', () => {
  it('stamps an id + timestamp and preserves the supplied fields', () => {
    const r = makeAudit({
      actor: { kind: 'user', id: 'director' },
      action: 'create',
      target: { kind: 'node', id: 'n1' },
      decision: { allowed: true, gate: 'filesystem' },
      diff: 'created n1',
    });
    expect(r.id).toBeTruthy();
    expect(typeof r.ts).toBe('number');
    expect(r.action).toBe('create');
    expect(r.target.id).toBe('n1');
    expect(r.decision.allowed).toBe(true);
    expect(r.diff).toBe('created n1');
  });

  it('records denied scoped writes with actor, action, and decision evidence', () => {
    const decision = evaluateScopedKgWrite(open, { ...fullCaps, filesystem: false });
    const r = makeAudit({
      actor: { kind: 'system', id: 'ingest', taskId: 'task-denied' },
      action: 'create',
      target: { kind: 'node', id: 'blocked' },
      decision,
      diff: 'ingest blocked.md',
    });

    expect(r.actor).toEqual({ kind: 'system', id: 'ingest', taskId: 'task-denied' });
    expect(r.action).toBe('create');
    expect(r.decision.allowed).toBe(false);
    expect(r.decision.reason).toMatch(/filesystem/i);
    expect(r.diff).toBe('ingest blocked.md');
  });
});
