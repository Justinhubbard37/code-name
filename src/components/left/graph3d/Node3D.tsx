import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AppNode, LodConfig } from '../../../types';
import type { Vec3 } from './layout';

type Tier = 'card' | 'label' | 'dot';
const CARD_WORLD_H = 1.4; // approx world height a node occupies

function Row({ k, v }: { k: string; v?: string | number }) {
  if (v === undefined || v === null || v === '') return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-neutral-600">{k}</span>
      <span className="text-neutral-300 truncate max-w-[100px]">{v}</span>
    </div>
  );
}

export function Node3D({
  node,
  pos,
  selected,
  lod,
  onSelect,
}: {
  node: AppNode;
  pos: Vec3;
  selected: boolean;
  lod: LodConfig;
  onSelect: (id: string) => void;
}) {
  const [tier, setTier] = useState<Tier>('dot');
  const tierRef = useRef<Tier>('dot');
  const v = useRef(new THREE.Vector3(pos[0], pos[1], pos[2])).current;

  useFrame(({ camera, size }) => {
    const d = camera.position.distanceTo(v);
    const fov = ((camera as THREE.PerspectiveCamera).fov ?? 50) * (Math.PI / 180);
    const px = (CARD_WORLD_H * size.height) / (2 * Math.max(d, 0.001) * Math.tan(fov / 2));
    const t: Tier =
      selected || px >= lod.fullCardMinPx ? 'card' : px >= lod.labelMinPx ? 'label' : 'dot';
    if (t !== tierRef.current) {
      tierRef.current = t;
      setTier(t);
    }
  });

  const d = node.data;
  const pick = () => onSelect(node.id);

  return (
    <group position={pos} onClick={(e) => { e.stopPropagation(); pick(); }}>
      {tier === 'card' && (
        <Html center distanceFactor={10} zIndexRange={[20, 0]} style={{ pointerEvents: 'auto' }}>
          <div
            onPointerDown={(e) => { e.stopPropagation(); pick(); }}
            className={`select-none cursor-pointer w-44 bg-neutral-950/95 border p-2 font-mono text-[10px] text-neutral-300 shadow-xl backdrop-blur-sm ${
              selected ? 'border-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.25)]' : 'border-neutral-700'
            }`}
          >
            <div className="text-neutral-100 font-bold tracking-wider mb-1">{d.label}</div>
            <div className="border-t border-neutral-800 pt-1 space-y-0.5">
              <Row k="TYPE" v={d.type} />
              <Row k="TITLE" v={d.title} />
              <Row k="NAME" v={d.name} />
              <Row k="ALIAS" v={d.alias} />
              <Row k="CLASS" v={d.class} />
            </div>
          </div>
        </Html>
      )}

      {tier === 'label' && (
        <Html center distanceFactor={16} style={{ pointerEvents: 'auto' }}>
          <div
            onPointerDown={(e) => { e.stopPropagation(); pick(); }}
            className={`select-none cursor-pointer px-1.5 py-0.5 font-mono text-[9px] whitespace-nowrap border bg-neutral-950/90 ${
              selected ? 'border-emerald-400 text-emerald-300' : 'border-neutral-700 text-neutral-400'
            }`}
          >
            {d.label}
          </div>
        </Html>
      )}

      {tier === 'dot' && (
        <mesh>
          <sphereGeometry args={[0.2, 12, 12]} />
          <meshBasicMaterial color={selected ? '#34d399' : '#6b7280'} />
        </mesh>
      )}
    </group>
  );
}
