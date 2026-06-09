/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CODE NAME: |  —  Agent harness shell.
 * Two-pane governed workspace over a local-first knowledge ecosystem
 * (Knowledge Graph · GraphRAG · Vector store) with a model-agnostic
 * execution canvas. Built to the OnTheLLow blueprint.
 */
import { useEffect } from 'react';
import { AppStateProvider, useApp } from './state/AppState';
import { ResizableSplit } from './components/layout/ResizableSplit';
import { MissionControl } from './components/left/MissionControl';
import { ExecutionCanvas } from './components/right/ExecutionCanvas';
import { StealthDrawer } from './components/config/StealthDrawer';

function Shell() {
  const { refreshEndpoints } = useApp();

  // Probe the endpoint matrix once on boot.
  useEffect(() => {
    refreshEndpoints();
  }, [refreshEndpoints]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-neutral-950 text-neutral-300">
      <ResizableSplit left={<MissionControl />} right={<ExecutionCanvas />} />
      <StealthDrawer />

      {/* Screen corner crosshairs */}
      <div className="pointer-events-none absolute top-1 left-1 w-3 h-3 border-t border-l border-neutral-800 z-[70]" />
      <div className="pointer-events-none absolute top-1 right-1 w-3 h-3 border-t border-r border-neutral-800 z-[70]" />
      <div className="pointer-events-none absolute bottom-1 right-1 w-3 h-3 border-b border-r border-neutral-800 z-[70]" />
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
