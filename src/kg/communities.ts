/**
 * Community detection placeholder (Phase 1) for the 3D cluster LOD tier.
 * Connected-components via union-find for now; Phase 3 replaces this with
 * GraphRAG's own community hierarchy (see docs/STRATEGY.md).
 */
import type { AppNode, Edge } from '../types';

export function detectCommunities(nodes: AppNode[], edges: Edge[]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    if (parent.has(e.source) && parent.has(e.target)) union(e.source, e.target);
  }

  const roots = new Map<string, number>();
  const out = new Map<string, number>();
  let next = 0;
  for (const n of nodes) {
    const r = find(n.id);
    if (!roots.has(r)) roots.set(r, next++);
    out.set(n.id, roots.get(r)!);
  }
  return out;
}
