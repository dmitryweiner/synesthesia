// localStorage that never fails in silence.
//
// The quota is per *origin*, so every app on dmitryweiner.github.io shares
// one budget; a write can be refused because of data this app never wrote.
// Blocked or private-mode storage can also accept a write that vanishes, so
// every write is read back.
export type SaveResult = { ok: true } | { ok: false; reason: 'full' | 'blocked' };

export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): SaveResult {
  const json = JSON.stringify(value);
  try {
    localStorage.setItem(key, json);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    const full = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
    return { ok: false, reason: full ? 'full' : 'blocked' };
  }
  try {
    if (localStorage.getItem(key) !== json) return { ok: false, reason: 'blocked' };
  } catch {
    return { ok: false, reason: 'blocked' };
  }
  return { ok: true };
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to do: the key is unreachable either way
  }
}
