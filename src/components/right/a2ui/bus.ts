import type { A2UIPayload } from './types';

/** Module bus carrying the current agent-generated UI payload (Phase 4). */
type Sub = (p: A2UIPayload | null) => void;
const subs = new Set<Sub>();
let current: A2UIPayload | null = null;

export function setAgentUI(p: A2UIPayload | null): void {
  current = p;
  subs.forEach((s) => s(current));
}
export function getAgentUI(): A2UIPayload | null {
  return current;
}
export function subscribeAgentUI(fn: Sub): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
