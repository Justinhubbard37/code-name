/**
 * Shared supervised pools (Phase 5). Browser contexts and agent runtimes are
 * shared and capped (systemConfig.pools); tabs lease their own isolated slot —
 * N tabs do NOT spawn N browsers. The real Chrome contexts / ADK runtimes live
 * in the sidecar; this is the coordination + accounting layer.
 */
import { systemConfig } from '../config/system';

export type PoolKind = 'browser' | 'agent';

interface Lease {
  kind: PoolKind;
  taskId: string;
  id: string;
  ts: number;
}

const leases: Lease[] = [];
const subs = new Set<() => void>();

function emit() {
  subs.forEach((s) => s());
}

export function subscribePools(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

function capacity(kind: PoolKind): number {
  return kind === 'browser'
    ? systemConfig.pools.maxBrowserContexts
    : systemConfig.pools.maxAgents;
}

export interface LeaseResult {
  ok: boolean;
  id?: string;
  reason?: string;
}

export function lease(kind: PoolKind, taskId: string): LeaseResult {
  const existing = leases.find((l) => l.kind === kind && l.taskId === taskId);
  if (existing) {
    existing.ts = Date.now(); // keep-alive
    return { ok: true, id: existing.id }; // one isolated slot per tab, reused
  }
  const used = leases.filter((l) => l.kind === kind).length;
  if (used >= capacity(kind)) {
    return { ok: false, reason: `${kind} pool exhausted (${used}/${capacity(kind)})` };
  }
  const id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
  leases.push({ kind, taskId, id, ts: Date.now() });
  emit();
  return { ok: true, id };
}

export function release(kind: PoolKind, taskId: string): void {
  const i = leases.findIndex((l) => l.kind === kind && l.taskId === taskId);
  if (i >= 0) {
    leases.splice(i, 1);
    emit();
  }
}

export function releaseAll(taskId: string): void {
  let changed = false;
  for (let i = leases.length - 1; i >= 0; i--) {
    if (leases[i].taskId === taskId) {
      leases.splice(i, 1);
      changed = true;
    }
  }
  if (changed) emit();
}

export function poolSnapshot() {
  return {
    browser: { used: leases.filter((l) => l.kind === 'browser').length, cap: capacity('browser') },
    agent: { used: leases.filter((l) => l.kind === 'agent').length, cap: capacity('agent') },
    leases: [...leases],
  };
}

/** Evict pool slots idle beyond systemConfig.pools.idleEvictMs (Phase 6). */
export function evictIdle(now = Date.now()): number {
  const max = systemConfig.pools.idleEvictMs;
  let removed = 0;
  for (let i = leases.length - 1; i >= 0; i--) {
    if (now - leases[i].ts > max) {
      leases.splice(i, 1);
      removed++;
    }
  }
  if (removed) emit();
  return removed;
}

if (typeof window !== 'undefined') {
  setInterval(() => evictIdle(), 30_000);
}
