/** A2UI declarative UI payload (Phase 4). Flat component list + root id. */
export interface A2UIComponent {
  id: string;
  type: string;
  properties?: Record<string, unknown>;
  children?: string[];
}

export interface A2UIPayload {
  root: string;
  components: A2UIComponent[];
}
