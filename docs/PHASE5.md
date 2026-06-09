# Phase 5 — Closeout & Decisions

_2026-06-06 · tsc clean + vite build green (2482 modules)._

## Delivered — tabs as environments
- **Per-tab session + permission model** (`src/types.ts`, `src/lib/perms.ts`):
  every task tab carries a `TabSession { id, caps }`. `effectiveGates(global,
  caps)` makes a tab able to **tighten but never loosen** the global gates
  (effective = global AND tab-cap). Per-tab gate scope, realized.
- **Shared supervised pools** (`src/lib/pools.ts`): browser-context and agent
  pools capped by `systemConfig.pools`, with `lease`/`release`/`releaseAll`,
  **one isolated slot reused per tab**, and subscribe/snapshot. N tabs do not
  spawn N browsers.
- **Isolation wiring** (`AppState`): new tabs get their own session + caps; the
  WebMCP guard now resolves **per-tab effective tools** (not just global); pool
  leases are released when a tab closes.
- **Browser Harness seam** (`browser.open` WebMCP tool): requires the tab's
  BROWSER capability, leases a context from the shared pool, then forwards to the
  sidecar Browser Harness over A2A (stub message when the sidecar is offline).
- **Permission-aware shared memory and ingestion**: the KG stays global; tab
  agents write and ingest through gated + audited paths, now scoped by the tab's
  effective filesystem permission.
- **EnvironmentBar** UI (left pane, under the tabs): session id, per-tab
  capability toggles (BROWSER/TOOLS/NET/FS), and live shared-pool usage.

## Rule realized
Tabs **share infrastructure** (one browser pool, one agent pool, one KG) but
**not unapproved state**: each tab has its own session, isolated pool slot, and
gate scope. Capabilities bind to tabs; the supervisor satisfies them from pools.

## Decisions
1. **Coordination layer in TS, execution in the sidecar.** Pools + leases +
   permission checks live in the app; real Chrome contexts / ADK runtimes are
   acquired in the sidecar (Phase 3 seam). `browser.open` is the bridge point.
2. **Tighten-only per-tab scope.** A tab can revoke a capability but never grant
   one the global gate has closed — single source of truth stays the global gates.
3. **One pool slot per tab, reused.** Prevents per-call browser churn; matches
   "isolated context per tab" without N-browser blowup.

## Deferred / refine (needs the live sidecar)
- Real Browser Harness CDP execution + result surfacing (the `browser.open` seam
  forwards to the sidecar; wiring the actual harness tool lands with ADK).
- Idle-eviction timer on pools (currently lease/release on use + tab close).
- Per-tab A2UI payloads (still global from Phase 4).

## Exit criteria — met
- Two tabs run off shared pools with isolated sessions + distinct gate scopes. ✅
- Browser action requires tab permission + a pool lease. ✅
- Tab agents read/write and ingest into the global KG under permission + audit. ✅
- Typechecks + builds. ✅

**Next:** Phase 6 — hardening: local-first degradation checks, audit-ledger
surfacing, LOD/pool tuning, packaging.
