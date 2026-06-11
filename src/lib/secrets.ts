import { auditDeniedSecurityAction } from './securityAudit';

/**
 * Secrets bridge (Phase 2.4). Reads/writes API keys in the OS keychain through
 * the Rust shell. All access is Tauri-guarded so the app still runs in a plain
 * browser (where keychain access simply isn't available).
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Read a secret from the OS keychain. Returns null if unset or unavailable. */
export async function getSecret(name: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('secret_get', { name });
  } catch (err) {
    auditDeniedSecurityAction({
      category: 'secret',
      targetId: 'secret_get',
      reason: err instanceof Error ? err.message : 'secret lookup rejected',
      actor: { kind: 'user', id: 'director' },
    });
    return null;
  }
}

/** Store a secret in the OS keychain. Returns true on success. */
export async function setSecret(name: string, value: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secret_set', { name, value });
    return true;
  } catch (err) {
    auditDeniedSecurityAction({
      category: 'secret',
      targetId: 'secret_set',
      reason: err instanceof Error ? err.message : 'secret set rejected',
      actor: { kind: 'user', id: 'director' },
    });
    return false;
  }
}

/** Remove a secret from the OS keychain. */
export async function deleteSecret(name: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secret_delete', { name });
  } catch (err) {
    auditDeniedSecurityAction({
      category: 'secret',
      targetId: 'secret_delete',
      reason: err instanceof Error ? err.message : 'secret delete rejected',
      actor: { kind: 'user', id: 'director' },
    });
    /* ignore */
  }
}
