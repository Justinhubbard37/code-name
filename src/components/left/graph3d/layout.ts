/**
 * 3D layout for the knowledge graph (Phase 2).
 * x,y come from the existing 2D positions (centered + scaled); z is layered by
 * community so the cloud reads like a neural-net topology with meaningful depth.
 */
import type { AppNode, Edge } from '../../../types';
import { detectCommunities } from '../../../kg/communities';

export type Vec3 = [number, number, number];

const SCALE = 90;
const LAYER_GAP = 7;

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function layout3D(nodes: AppNode[], edges: Edge[]): {
  map: Map<string, Vec3>;
  communities: Map<string, number>;
  communityCount: number;
} {
  const communities = detectCommunities(nodes, edges);
  let cx = 0;
  let cy = 0;
  for (const n of nodes) {
    cx += n.position.x;
    cy += n.position.y;
  }
  const N = nodes.length || 1;
  cx /= N;
  cy /= N;

  const commSet = new Set(communities.values());
  const commCount = commSet.size || 1;
  const zCenter = ((commCount - 1) * LAYER_GAP) / 2;

  const map = new Map<string, Vec3>();
  for (const n of nodes) {
    const c = communities.get(n.id) ?? 0;
    const x = (n.position.x - cx) / SCALE;
    const y = -(n.position.y - cy) / SCALE;
    const jitter = ((hashId(n.id) % 100) / 100 - 0.5) * 3;
    const z = c * LAYER_GAP - zCenter + jitter;
    map.set(n.id, [x, y, z]);
  }
  return { map, communities, communityCount: commCount };
}
