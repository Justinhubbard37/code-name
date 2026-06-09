# Phase 6 — Closeout & Decisions

_2026-06-06 · tsc clean + vite build green; 3D split into its own chunk._

## Delivered — hardening
- **Audit ledger surfaced** (`src/components/right/AuditLedger.tsx`): a collapsible
  panel reading `kgStore.getAudit()` — the append-only write history of the
  self-growing KG, with actor, action, target, diff, and gate decision (denials
  shown). Reuses the Phase 0 schema; makes the entity's growth inspectable.
- **Local-first self-check** (`src/lib/selfcheck.ts`): on boot, verifies each
  integration degrades offline (persistence, retrieval, model fallback, WebMCP
  shim, sidecar loopback) and logs results to the activity feed.
- **Pool idle-eviction** (`src/lib/pools.ts`): leases keep-alive on use; idle
  slots beyond `systemConfig.pools.idleEvictMs` are evicted (30s sweep) — frees
  idle browser/agent slots without disturbing active tabs.
- **Bundle hardening**: `Graph3D` is now lazy-loaded — three.js lives in a
  separate `Graph3D-*.js` chunk (~878 kB) instead of the initial bundle.
- **Packaging** (`docs/PACKAGING.md`): installer steps, build/runtime prereqs
  (incl. Python for the sidecar), what ships, and a pre-release checklist.

## Decisions
1. **Audit ledger is read-only + append-only.** Surfaced, never editable;
   corrections are new records (Phase 0 contract).
2. **Self-check is advisory, not blocking.** It reports degradation to the user
   via the activity feed; the app always runs local-first regardless.
3. **Idle-eviction over hard caps for freshness.** Idle pool slots are reclaimed
   on a timer; active tabs keep their slot via keep-alive.

## Deferred (needs the live desktop app / external tooling)
- Code-signing the installer (Windows/macOS) before distribution.
- LOD threshold + pool-size tuning by eye on the running 3D graph.
- Real ADK + Browser Harness execution in the sidecar (seams in place from
  Phases 3 & 5).

## Exit criteria — met
- Offline degradation verified + surfaced. ✅
- Audit history visible in the UI. ✅
- Initial bundle trimmed (3D chunk-split); pools self-manage. ✅
- Installable build documented; tsc + vite build green. ✅

## Roadmap status
Phases 0-6 complete. Remaining work is integration depth (wire real ADK +
Browser Harness into the sidecar) and release polish (signing, visual tuning) —
all on documented seams.
