# Phase 4 — Closeout & Decisions

_2026-06-06 · tsc clean + vite build green (2479 modules)._

## Delivered — the protocol layer, under the ownership map
- **WebMCP shim** (`src/lib/webmcp.ts`) — implements the `document.modelContext`
  surface (`registerTool` / `getTools` / `executeTool`) with an in-memory
  registry. **Every `executeTool()` passes through a gate guard + activity
  logger** before running — we own the security boundary, not the browser.
- **Built-in gate-routed tools** (registered in `AppState`):
  - `graph.search` — lexical/GraphRAG retrieval over the KG.
  - `graph.note` — creates a KG node through the gated + audited commit chokepoint.
  - `ui.render` — pushes an A2UI payload to the Agent UI panel.
  The guard = the **tools gate**; closing it blocks every tool call and logs it.
- **A2UI renderer** (`src/components/right/a2ui/`) — declarative A2UI JSON ->
  React via a **trusted catalog only** (card/column/row/heading/text/badge/
  button/textfield/divider). Anything outside the catalog is ignored ("safe like
  data"). Payload flows over a module bus.
- **Right-pane wiring** (`ExecutionCanvas`): `AgentToolsBar` (lists callable
  WebMCP tools) under the agent header; `AgentUIPanel` (renders A2UI) above chat.
  Native UI hosts and can dismiss agent UI — **final authority**.
- **A2A** already drives chat from Phase 3 (sidecar route).

## Ownership map — now enforced
| Layer | Behavior in code |
| --- | --- |
| Native UI | hosts/dismisses all agent output; final authority |
| WebMCP | tools run only via `executeTool` -> gate guard + logger |
| A2A | agent messages stream into chat (Phase 3); does not drive UI |
| A2UI | renders only trusted catalog components, in a subordinate panel |
| KG writes | `graph.note` -> commit chokepoint (gated + audited) |

## Decisions
1. **We own the WebMCP boundary** via the shim (confirmed Phase 0 finding) — no
   reliance on a native API; a polyfill/native impl can swap in later.
2. **A2UI security = the catalog.** The renderer maps only known component types;
   the catalog *is* the trust boundary. Custom/iframe wrappers deferred.
3. **Agent UI is global (not per-task) for now** — a module bus. Per-task UI is a
   small refinement once needed.

## Deferred / refine
- Per-task A2UI payloads; richer catalog (forms with real input binding).
- Routing real agent (ADK) output that emits `ui.render`/A2UI over A2A — the
  seam exists; lands when ADK is wired into the sidecar.
- Tool-call results surfaced back into the chat thread (currently logged to the
  activity feed).

## Exit criteria — met
- An agent (or the user, via the shim) calls a **gated WebMCP tool**; closing the
  tools gate severs it. ✅
- A2UI payload renders in the right pane under native authority. ✅
- Typechecks + builds. ✅

**Next:** Phase 5 — tabs as environments: shared pools + per-tab isolation +
Browser Harness.
