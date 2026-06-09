import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useApp } from '../../../state/AppState';
import { systemConfig } from '../../../config/system';
import { layout3D } from './layout';
import { Node3D } from './Node3D';
import { Edges3D } from './Edges3D';
import { NodeDetailsPanel } from '../../NodeDetailsPanel';
import type { AppNode } from '../../../types';

/**
 * 3D interactive knowledge graph (Phase 2). Cards-as-nodes in depth, neural-net
 * style, with screen-space LOD. Replaces the flat 2D canvas.
 */
export function Graph3D() {
  const { nodes, edges, selectedNodeId, setSelectedNodeId, updateNodeData } = useApp();
  const { map } = useMemo(() => layout3D(nodes, edges), [nodes, edges]);
  const selected = (nodes.find((n) => n.id === selectedNodeId) ?? null) as AppNode | null;

  return (
    <div className="absolute inset-0">
      <Canvas
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 42], fov: 50, near: 0.1, far: 4000 }}
        style={{ background: 'transparent' }}
        onPointerMissed={(e) => {
          // Only clear selection when the empty 3D canvas itself is clicked — not
          // when a node card/label (DOM overlay) or the inspector panel is clicked.
          if (e.target instanceof HTMLCanvasElement) setSelectedNodeId(null);
        }}
      >
        <Edges3D edges={edges} map={map} />
        {nodes.map((n) => {
          const p = map.get(n.id);
          if (!p) return null;
          return (
            <Node3D
              key={n.id}
              node={n}
              pos={p}
              selected={n.id === selectedNodeId}
              lod={systemConfig.lod}
              onSelect={setSelectedNodeId}
            />
          );
        })}
        <OrbitControls makeDefault enablePan enableRotate enableZoom zoomSpeed={0.8} rotateSpeed={0.6} />
      </Canvas>

      {selected && (
        <NodeDetailsPanel
          node={selected}
          onClose={() => setSelectedNodeId(null)}
          onUpdate={updateNodeData}
        />
      )}
    </div>
  );
}
