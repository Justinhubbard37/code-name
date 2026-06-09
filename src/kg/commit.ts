/**
 * Gated + audited write chokepoint helpers (Phase 0/1 contract).
 * KG content writes require local persistence, so they are governed by the
 * filesystem gate. Every write — allowed or denied — produces an AuditRecord.
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  AuditAction,
  AuditActor,
  AuditRecord,
  GateDecision,
  SecurityGates,
  TabCaps,
} from '../types';
import { effectiveGates } from '../lib/perms';

export function evaluateKgWrite(gates: SecurityGates): GateDecision {
  if (!gates.filesystem) {
    return { allowed: false, gate: 'filesystem', reason: 'filesystem gate closed' };
  }
  return { allowed: true, gate: 'filesystem' };
}

export function evaluateScopedKgWrite(global: SecurityGates, caps: TabCaps): GateDecision {
  return evaluateKgWrite(effectiveGates(global, caps));
}

export function makeAudit(p: {
  actor: AuditActor;
  action: AuditAction;
  target: { kind: 'node' | 'edge'; id: string };
  decision: GateDecision;
  before?: unknown;
  after?: unknown;
  diff?: string;
  provenance?: { source?: string; ingestionId?: string };
}): AuditRecord {
  return { id: uuidv4().slice(0, 12), ts: Date.now(), ...p };
}
