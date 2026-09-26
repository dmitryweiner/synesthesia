// Screen Wake Lock: don't let a phone dim the screen while the piece is
// running (ported from formula-synth). A lock is released whenever the page
// is hidden (the screen locks, the app switches), so it has to be taken
// again when the page comes back. Silently degrades where the API is
// missing (Firefox) or refused.
//
// User report (2026-09-26): after locking and unlocking the phone the screen
// dimmed again until the page was reloaded. Two holes, both closed here:
// - The browser marks the old lock `released` at once but may fire its
//   `release` event later — after the page is visible again. The old code
//   trusted the event, still "held" the dead lock at that moment, skipped
//   the request, and never tried again. Now `sentinel.released` decides,
//   and a late event from an old lock can't clear a newer one.
// - A request refused right after unlocking (a browser that wants focus or
//   a gesture first) was swallowed, and the gesture listener had already
//   fired once. Now every touch/key, focus and pageshow retries, cheaply,
//   whenever no lock is held.

export interface WakeSentinel {
  readonly released: boolean;
  addEventListener(type: 'release', fn: () => void): void;
  release(): Promise<void>;
}

export interface WakeLockEnv {
  readonly supported: boolean;
  visible(): boolean;
  request(): Promise<WakeSentinel>;
  /** visibilitychange / focus / pageshow / pointerdown / keydown */
  on(type: string, fn: () => void): void;
}

export function browserWakeLockEnv(): WakeLockEnv {
  return {
    supported: 'wakeLock' in navigator,
    visible: () => document.visibilityState === 'visible',
    request: () => navigator.wakeLock.request('screen'),
    on: (type, fn) => {
      if (type === 'focus' || type === 'pageshow') window.addEventListener(type, fn);
      else document.addEventListener(type, fn, { capture: true, passive: true });
    },
  };
}

const RETRY_EVENTS = ['visibilitychange', 'focus', 'pageshow', 'pointerdown', 'keydown'];

export class ScreenAwake {
  private lock: WakeSentinel | null = null;
  private pending: Promise<boolean> | null = null;
  private wanted = false;
  private listening = false;

  constructor(private readonly env: WakeLockEnv, private readonly onChange?: (awake: boolean) => void) {}

  get awake(): boolean {
    return this.lock !== null && !this.lock.released;
  }

  /** Keep the screen awake from now on. Call it from a user gesture first. */
  keep(): Promise<boolean> {
    this.wanted = true;
    if (!this.listening && this.env.supported) {
      this.listening = true;
      for (const ev of RETRY_EVENTS) this.env.on(ev, () => { void this.ensure(); });
    }
    return this.ensure();
  }

  async release(): Promise<void> {
    this.wanted = false;
    const current = this.lock;
    this.lock = null;
    if (current && !current.released) await current.release().catch(() => {});
    this.onChange?.(false);
  }

  private ensure(): Promise<boolean> {
    if (!this.wanted || !this.env.supported || !this.env.visible()) return Promise.resolve(false);
    if (this.awake) return Promise.resolve(true);
    if (this.pending) return this.pending;
    this.pending = this.env.request().then(
      (sentinel) => {
        this.pending = null;
        if (!this.wanted) {
          void sentinel.release().catch(() => {});
          return false;
        }
        this.lock = sentinel;
        sentinel.addEventListener('release', () => {
          if (this.lock !== sentinel) return; // an old lock's late event
          this.lock = null;
          this.onChange?.(false);
        });
        this.onChange?.(true);
        return true;
      },
      () => {
        this.pending = null;
        return false; // refused (no gesture yet, low battery, …): the next event retries
      },
    );
    return this.pending;
  }
}
