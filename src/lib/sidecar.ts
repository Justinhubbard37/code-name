/**
 * TS-side bridge to the Rust-supervised Python agent sidecar (Phase 3).
 * - getSidecarInfo() reads {host,port,token,status} from the Rust command.
 * - streamA2A() is a thin A2A client (JSON-RPC message/stream over SSE) matching
 *   the sidecar + A2A 0.3 shape; swap in @a2a-js/sdk later behind this function.
 * All Tauri access is guarded so the app still runs in a plain browser.
 */
export interface SidecarInfo {
  status: string; // stopped | starting | ready | error
  host: string;
  port: number;
  /** Only present in tests; the live shell no longer exposes the token to the webview (Phase 1). */
  token?: string;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function getSidecarInfo(): Promise<SidecarInfo | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<SidecarInfo>('sidecar_info');
  } catch {
    return null;
  }
}

export async function restartSidecar(): Promise<SidecarInfo | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<SidecarInfo>('sidecar_restart');
  } catch {
    return null;
  }
}

/**
 * Send a chat to the sidecar THROUGH the Rust shell and return the whole reply.
 * The bearer token never leaves Rust (Phase 1). Desktop-only.
 */
export async function sendToSidecar(message: string): Promise<string> {
  if (!isTauri()) throw new Error('the agent sidecar runs only in the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<string>('sidecar_send', { message });
}

/**
 * Stream a chat reply from the sidecar THROUGH the Rust shell. Rust reads the
 * SSE stream and pushes each text chunk back over a Tauri Channel; the token
 * never leaves Rust (Phase 1). Resolves when the stream completes.
 */
export async function streamFromSidecar(
  message: string,
  onToken: (t: string) => void,
): Promise<void> {
  if (!isTauri()) throw new Error('the agent sidecar runs only in the desktop app');
  const { invoke, Channel } = await import('@tauri-apps/api/core');
  const channel = new Channel<string>();
  channel.onmessage = (t) => onToken(t);
  await invoke('sidecar_stream', { message, onEvent: channel });
}

/** Ask the shell to cancel an in-flight sidecar stream (STOP button). */
export async function cancelSidecar(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('sidecar_cancel');
  } catch {
    /* ignore */
  }
}

export interface A2ACallbacks {
  onToken: (t: string) => void;
  onActivity?: (kind: 'network' | 'system', t: string) => void;
  signal?: AbortSignal;
}

export async function streamA2A(
  info: SidecarInfo,
  text: string,
  cb: A2ACallbacks,
): Promise<string> {
  const url = `http://${info.host}:${info.port}/a2a`;
  cb.onActivity?.('network', `A2A → ${info.host}:${info.port} (token-auth)`);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'message/stream',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        messageId: crypto.randomUUID(),
        parts: [{ kind: 'text', text }],
      },
    },
  });
  const res = await fetch(url, {
    method: 'POST',
    signal: cb.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${info.token}` },
    body,
  });
  if (!res.ok || !res.body) throw new Error(`A2A HTTP ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  while (true) {
    if (cb.signal?.aborted) {
      reader.cancel().catch(() => {});
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!frame.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(frame.slice(5).trim());
        const r = ev.result;
        if (r?.kind === 'message') {
          const t = (r.parts ?? [])
            .map((p: { text?: string }) => p.text ?? '')
            .join('');
          if (t) {
            full += t;
            cb.onToken(t);
          }
        }
      } catch {
        /* ignore partial frame */
      }
    }
  }
  return full;
}
