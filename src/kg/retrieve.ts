/**
 * Local retrieval (Phase 1). Lexical BM25-lite over node text — replaces the
 * naive client-side substring filter. Behind the Retriever interface so a
 * vector / GraphRAG-backed retriever can swap in at Phase 3.
 */
import type { AppNode } from '../types';

export interface RetrievalHit {
  id: string;
  score: number;
}

export interface Retriever {
  index(nodes: AppNode[]): void;
  retrieve(query: string, k?: number): RetrievalHit[];
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'is']);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t));
}

function nodeText(n: AppNode): string {
  const d = n.data;
  return [d.label, d.type, d.title, d.description, d.name, d.alias, d.nat, d.class, d.src, d.status]
    .filter(Boolean)
    .join(' ');
}

export class LexicalRetriever implements Retriever {
  private docs: { id: string; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  index(nodes: AppNode[]): void {
    this.docs = [];
    this.df = new Map();
    let total = 0;
    for (const n of nodes) {
      const toks = tokenize(nodeText(n));
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: n.id, tf, len: toks.length });
      total += toks.length;
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
  }

  retrieve(query: string, k = 50): RetrievalHit[] {
    const q = tokenize(query);
    if (!q.length || !this.docs.length) return [];
    const N = this.docs.length;
    const k1 = 1.5;
    const b = 0.75;
    const hits: RetrievalHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of q) {
        const f = doc.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = f + k1 * (1 - b + (b * doc.len) / (this.avgLen || 1));
        score += idf * ((f * (k1 + 1)) / denom);
      }
      if (score > 0) hits.push({ id: doc.id, score });
    }
    hits.sort((a, c) => c.score - a.score);
    return hits.slice(0, k);
  }
}

export const retriever: Retriever = new LexicalRetriever();
