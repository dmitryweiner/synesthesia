// The screen must stay awake after the phone was locked and unlocked
// (user report, 2026-09-26: only a page reload brought the wake lock back).
import { ScreenAwake } from '../src/ui/wakelock';
import type { WakeLockEnv, WakeSentinel } from '../src/ui/wakelock';

class FakeSentinel implements WakeSentinel {
  released = false;
  private listeners: (() => void)[] = [];
  addEventListener(_type: 'release', fn: () => void): void {
    this.listeners.push(fn);
  }
  async release(): Promise<void> {
    this.drop();
    this.fire();
  }
  /** What the browser does when the page is hidden: the flag at once, the event later. */
  drop(): void {
    this.released = true;
  }
  fire(): void {
    for (const fn of this.listeners) fn();
  }
}

class FakeEnv implements WakeLockEnv {
  visibleNow = true;
  grant = true;
  sentinels: FakeSentinel[] = [];
  private handlers = new Map<string, (() => void)[]>();
  supported = true;
  visible = (): boolean => this.visibleNow;
  request = async (): Promise<WakeSentinel> => {
    if (!this.grant || !this.visibleNow) throw new Error('NotAllowedError');
    const s = new FakeSentinel();
    this.sentinels.push(s);
    return s;
  };
  on = (type: string, fn: () => void): void => {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  };
  async emit(type: string): Promise<void> {
    for (const fn of this.handlers.get(type) ?? []) fn();
    await flush();
  }
  last(): FakeSentinel {
    const s = this.sentinels[this.sentinels.length - 1];
    if (!s) throw new Error('no lock was ever requested');
    return s;
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function lockAndUnlock(env: FakeEnv, lateReleaseEvent: boolean): Promise<void> {
  const old = env.last();
  env.visibleNow = false;
  old.drop();
  if (!lateReleaseEvent) old.fire();
  await env.emit('visibilitychange');
  env.visibleNow = true;
  await env.emit('visibilitychange');
  if (lateReleaseEvent) {
    old.fire();
    await flush();
  }
}

describe('ScreenAwake', () => {
  it('takes the lock', async () => {
    const env = new FakeEnv();
    const awake = new ScreenAwake(env);
    expect(await awake.keep()).toBe(true);
    expect(awake.awake).toBe(true);
  });

  it('takes it back after the screen was locked and unlocked', async () => {
    const env = new FakeEnv();
    const changes: boolean[] = [];
    const awake = new ScreenAwake(env, (on) => changes.push(on));
    await awake.keep();
    await lockAndUnlock(env, false);
    expect(env.sentinels.length).toBe(2);
    expect(awake.awake).toBe(true);
    expect(changes[changes.length - 1]).toBe(true);
  });

  it('…even when the release event arrives after the page is visible again', async () => {
    // the old code trusted the event: it still held the dead lock when the
    // page came back, skipped the request, and nothing ever retried
    const env = new FakeEnv();
    const awake = new ScreenAwake(env);
    await awake.keep();
    await lockAndUnlock(env, true);
    expect(awake.awake).toBe(true);
    expect(env.last().released).toBe(false);
  });

  it('a refusal right after unlocking is retried on the next touch', async () => {
    const env = new FakeEnv();
    const awake = new ScreenAwake(env);
    await awake.keep();
    env.grant = false; // e.g. the browser wants a gesture or focus first
    await lockAndUnlock(env, false);
    expect(awake.awake).toBe(false);
    env.grant = true;
    await env.emit('pointerdown');
    expect(awake.awake).toBe(true);
  });

  it('is retried on focus and pageshow too', async () => {
    for (const ev of ['focus', 'pageshow']) {
      const env = new FakeEnv();
      const awake = new ScreenAwake(env);
      await awake.keep();
      env.grant = false;
      await lockAndUnlock(env, false);
      env.grant = true;
      await env.emit(ev);
      expect(awake.awake, ev).toBe(true);
    }
  });

  it('holds one lock at a time, however many events arrive', async () => {
    const env = new FakeEnv();
    const awake = new ScreenAwake(env);
    await awake.keep();
    await Promise.all([env.emit('pointerdown'), env.emit('focus'), env.emit('visibilitychange')]);
    expect(env.sentinels.length).toBe(1);
  });

  it('release() lets the screen sleep and stops re-taking the lock', async () => {
    const env = new FakeEnv();
    const awake = new ScreenAwake(env);
    await awake.keep();
    await awake.release();
    expect(awake.awake).toBe(false);
    await env.emit('pointerdown');
    await env.emit('visibilitychange');
    expect(env.sentinels.length).toBe(1);
  });

  it('degrades silently without the API', async () => {
    const env = new FakeEnv();
    env.supported = false;
    const awake = new ScreenAwake(env);
    expect(await awake.keep()).toBe(false);
    await env.emit('pointerdown');
    expect(env.sentinels.length).toBe(0);
  });
});
