import { v4 as uuidv4 } from 'uuid';
import type { AuditAction, AuditActor, AuditRecord, GateName } from '../types';
import { redactSecrets } from './securityValidation';

export type SecurityAuditCategory = 'endpoint' | 'secret' | 'sidecar' | 'tool' | 'a2ui' | 'browser';

export const SECURITY_DENY_ACTION: Record<SecurityAuditCategory, AuditAction> = {
  endpoint: 'endpoint-deny',
  secret: 'secret-deny',
  sidecar: 'sidecar-deny',
  tool: 'tool-deny',
  a2ui: 'a2ui-deny',
  browser: 'browser-deny',
};

const MAX_REASON_LENGTH = 240;
const DEFAULT_ACTOR: AuditActor = { kind: 'system', id: 'security-boundary' };

type Sink = (record: AuditRecord) => void | Promise<void>;
let sink: Sink | null = null;

export function setSecurityAuditSink(next: Sink | null): void {
  sink = next;
}

function sanitizeReason(reason: unknown): string {
  const redacted = redactSecrets(reason ?? 'denied');
  return redacted.length > MAX_REASON_LENGTH
    ? `${redacted.slice(0, MAX_REASON_LENGTH)}...`
    : redacted;
}

export function makeDeniedSecurityAudit(input: {
  category: SecurityAuditCategory;
  reason: unknown;
  actor?: AuditActor;
  gate?: GateName;
  targetId?: string;
}): AuditRecord {
  const reason = sanitizeReason(input.reason);
  const category = input.category;
  return {
    id: uuidv4().slice(0, 12),
    ts: Date.now(),
    actor: input.actor ?? DEFAULT_ACTOR,
    action: SECURITY_DENY_ACTION[category],
    target: { kind: 'security', id: input.targetId ?? category },
    decision: {
      allowed: false,
      gate: input.gate ?? category,
      reason,
    },
    diff: `${category} denied: ${reason}`,
  };
}

export function auditDeniedSecurityAction(input: {
  category: SecurityAuditCategory;
  reason: unknown;
  actor?: AuditActor;
  gate?: GateName;
  targetId?: string;
}): AuditRecord {
  const record = makeDeniedSecurityAudit(input);
  try {
    void sink?.(record);
  } catch {
    /* audit best-effort; never change denial behavior */
  }
  return record;
}
