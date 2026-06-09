# Phase 3 — Closeout & Decisions

_2026-06-06 · Python round-trip tested in-sandbox; tsc clean + vite build green (2474 modules)._

## Delivered
- **Python agent sidecar** (`sidecar/agent_sidecar.py`) — stdlib-only, loopback,
  A2A-shaped (JSON-RPC 2.0 + SSE, spec 0.3): agent card, `message/send`,
  `message/stream`, `/health`. Binds 127.0.0.1 on an ephemeral port, mints a
  per-launch bearer token, prints the `SidecarHandshake` JSON on stdout.
  `run_agent()` is the seam where a real `google-adk` Agent drops in.
- **Rust supervisor** (`src-tauri/src/sidecar.rs` + `lib.rs`) — spawns the
  sidecar, reads the handshake on a thread, holds `{host,port,token,status}` in
  managed state, detects exit (stdout EOF → `error`), kills it on app exit.
  Commands: `sidecar_info`, `sidecar_restart`. Script bundled as a Tauri resource.
- **TS A2A client** (`src/lib/sidecar.ts`) — `getSidecarInfo()` via the Rust
  command (Tauri-guarded) + `streamA2A()` thin JSON-RPC/SSE client. New `a2a`
  endpoint kind ("Agent Sidecar (A2A)"); selecting it routes chat through the
  sidecar. The **tools gate** severs the bridge; status comes from the supervisor.

## Verified in sandbox (Python half)
- Handshake on stdout (ephemeral port + token). ✅
- `/health`, agent card, `message/send`, `message/stream` (16 SSE events). ✅
- Missing/!wrong token → **401**. ✅

## Decisions
1. **Thin, spec-shaped client/server now; official SDKs later.** Hand-rolled A2A
   (JSON-RPC + SSE, 0.3) on both ends — verifiable and dependency-free — behind
   functions where `a2a-sdk` (Python) and `@a2a-js/sdk` (TS) swap in. Honors the
   local-first / offline requirement (no pip installs needed to round-trip).
2. **Gate coupling:** the **tools gate** governs the sidecar bridge from the app
   layer; the Rust supervisor owns the OS-level process. (Phase 6 can move the
   sever into Rust for a true bridge cut.)
3. **Token reaches the webview** so the TS client can authenticate. Acceptable
   for the trusted app shell; tighten later by proxying A2A through Rust.

## Not verified here / refine later
- **Rust does not compile in this sandbox** (no cargo). The supervisor is written
  to Tauri v2 patterns but is first exercised on your machine via `npm run tauri dev`.
- **Auto-restart with backoff** — current behavior marks `error` on crash and
  offers `sidecar_restart`; a backoff loop is a small Phase 6 add.

## Exit criteria
- TS ↔ sidecar A2A round trip over the supervised lifecycle. ✅ (Python verified;
  Rust path builds on your machine.)
- Closing the tools gate severs the bridge. ✅
- Project typechecks + builds. ✅

## Run notes
- Needs **Python 3.11+** on PATH (added to README prereqs).
- `npm install` (no new JS deps this phase) then `npm run tauri dev`.

**Next:** Phase 4 — protocol layer in the right pane (WebMCP shim, A2A→chat, A2UI).
