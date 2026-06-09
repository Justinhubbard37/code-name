/** Per-tab permission resolution (Phase 5). A tab may TIGHTEN but never loosen
 *  the global gates: effective = global AND tab-capability. */
import type { SecurityGates, TabCaps } from '../types';

export const FULL_CAPS: TabCaps = {
  browser: true,
  tools: true,
  network: true,
  filesystem: true,
};

export function effectiveGates(global: SecurityGates, caps: TabCaps): SecurityGates {
  return {
    filesystem: global.filesystem && caps.filesystem,
    network: global.network && caps.network,
    tools: global.tools && caps.tools,
  };
}
