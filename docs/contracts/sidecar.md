# Contract — Sidecar bind + auth (P0.2, LOCKED)

**Goal:** only the Tauri shell can reach the Python agent sidecar.

## Bind
- Sidecar binds **`127.0.0.1`** only (never `0.0.0.0`).
- Port is **OS-assigned ephemeral** (`port 0`). No fixed port (avoids collisions
  and squatting).

## Handshake
1. Rust supervisor spawns the sidecar.
2. Sidecar mints a **per-launch random token** and binds its port.
3. Sidecar prints a single JSON line on **stdout** matching `SidecarHandshake`
   (`src/types.ts`): `{ ready, host, port, token, protocol:'a2a', specVersion, pid }`.
4. Rust reads that line to learn the port + token; nothing is hard-coded.

## Auth
- Every A2A call from the Rust shell carries `Authorization: Bearer <token>`.
- The webview invokes Rust commands and does not receive the bearer token.
- If an official A2A SDK is adopted later, its authentication hook must live on
  the shell/sidecar boundary, not in React state.
- Sidecar rejects any request without the exact token (401).

## Defense in depth
- Loopback-only bind **plus** per-session token: other local processes and
  webview code cannot drive the sidecar through an unauthenticated direct call
  even though the port is local.
- Token lives only in shell memory for the process lifetime; new token per launch.

## Gate coupling
- Closing the **network** or **tools** gate severs/limits the sidecar bridge at
  the Rust command layer, not just the UI.
