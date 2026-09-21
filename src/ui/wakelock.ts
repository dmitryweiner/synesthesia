// Screen Wake Lock: don't let a phone dim the screen while the piece is
// running (ported from formula-synth, plus re-acquiring when the tab comes
// back — a lock is released automatically whenever the page is hidden).
// Silently degrades where the API is missing (Firefox) or refused.
let lock: WakeLockSentinel | null = null;
let wanted = false;
let listening = false;

export function isScreenAwake(): boolean {
  return lock !== null;
}

async function request(): Promise<boolean> {
  if (!wanted || lock || document.visibilityState !== 'visible') return false;
  if (!('wakeLock' in navigator)) return false;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    return true;
  } catch {
    return false; // not allowed (no gesture yet, low battery, …)
  }
}

/**
 * Keeps the screen awake from now on, re-acquiring after the tab was hidden.
 * Call it from a user gesture: some browsers only grant the lock then.
 */
export async function keepScreenAwake(): Promise<boolean> {
  wanted = true;
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', () => { void request(); });
  }
  return request();
}

export async function releaseScreenAwake(): Promise<void> {
  wanted = false;
  const current = lock;
  lock = null;
  if (current) await current.release().catch(() => {});
}
