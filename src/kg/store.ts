/**
 * KnowledgeStore — persistent local store for the knowledge graph (Phase 1).
 * IndexedDB-backed (works in the Tauri webview and the browser), with an
 * in-memory fallback. Designed so a Tauri-SQLite adapter can replace the
 * backend later behind this same interface.
 */
import type { AppNode, Edge, AuditRecord } from '../types';

const DB_NAME = 'codename-kg';
const DB_VERSION = 1;
type StoreName = 'nodes' | 'edges' | 'audit';

const hasIDB = typeof indexedDB !== 'undefined';

const mem = {
  nodes: new Map<string, AppNode>(),
  edges: new Map<string, Edge>(),
  audit: [] as AuditRecord[],
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['nodes', 'edges', 'audit'] as StoreName[]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= openDB());

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  if (!hasIDB) {
    if (store === 'audit') return mem.audit as unknown as T[];
    return Array.from((mem[store] as Map<string, unknown>).values()) as T[];
  }
  const tx = (await db()).transaction(store, 'readonly');
  const req = tx.objectStore(store).getAll() as IDBRequest<T[]>;
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function putAll(store: 'nodes' | 'edges', items: { id: string }[]): Promise<void> {
  if (!hasIDB) {
    for (const it of items) (mem[store] as Map<string, unknown>).set(it.id, it);
    return;
  }
  const tx = (await db()).transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const it of items) os.put(it);
  return done(tx);
}

async function remove(store: 'nodes' | 'edges', id: string): Promise<void> {
  if (!hasIDB) {
    (mem[store] as Map<string, unknown>).delete(id);
    return;
  }
  const tx = (await db()).transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  return done(tx);
}

export class KnowledgeStore {
  getAllNodes() { return getAll<AppNode>('nodes'); }
  getAllEdges() { return getAll<Edge>('edges'); }
  getAudit() { return getAll<AuditRecord>('audit'); }
  putNodes(ns: AppNode[]) { return putAll('nodes', ns as { id: string }[]); }
  putEdges(es: Edge[]) { return putAll('edges', es as { id: string }[]); }
  deleteNode(id: string) { return remove('nodes', id); }
  deleteEdge(id: string) { return remove('edges', id); }
  async appendAudit(r: AuditRecord): Promise<void> {
    if (!hasIDB) { mem.audit.push(r); return; }
    const tx = (await db()).transaction('audit', 'readwrite');
    tx.objectStore('audit').put(r);
    return done(tx);
  }
  async counts() {
    const [n, e, a] = await Promise.all([this.getAllNodes(), this.getAllEdges(), this.getAudit()]);
    return { nodes: n.length, edges: e.length, audit: a.length };
  }
}

export const kgStore = new KnowledgeStore();
