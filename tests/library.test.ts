// "My points": the library (names + cloud ids) and the legacy store it
// replaces (whole points in localStorage, PLAN.md decision 11).
import { defaultAppState } from '../src/state/schema';
import { writeJson, readJson, removeKey } from '../src/state/store';
import {
  LIBRARY_KEY, loadLibrary, saveLibrary, upsertPoint, removePoint,
  nextPointNumber, suggestPointName,
} from '../src/state/library';
import { USER_PRESETS_KEY, loadUserPresets, saveUserPresets, clearUserPresets } from '../src/state/userPresets';

const ID_A = 'cnG1Iacvvb';
const ID_B = 'a7Kp2Lm9xQ';

const store = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
});
beforeEach(() => { store.clear(); });

/** Replaces localStorage with one whose setItem misbehaves. */
function withBrokenStorage(setItem: () => void, body: () => void): void {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem, removeItem: () => {} },
  });
  try { body(); } finally { if (real) Object.defineProperty(globalThis, 'localStorage', real); }
}

describe('store', () => {
  it('round trips, and reports a refused write instead of throwing', () => {
    expect(readJson('k')).toBeNull();
    expect(writeJson('k', { a: 1 })).toEqual({ ok: true });
    expect(readJson('k')).toEqual({ a: 1 });
    removeKey('k');
    expect(readJson('k')).toBeNull();

    withBrokenStorage(() => { throw new DOMException('quota', 'QuotaExceededError'); }, () => {
      expect(writeJson('k', [1])).toEqual({ ok: false, reason: 'full' });
    });
    withBrokenStorage(() => { throw new Error('denied'); }, () => {
      expect(writeJson('k', [1])).toEqual({ ok: false, reason: 'blocked' });
    });
    // accepts the write but stores nothing (private mode, blocked site data)
    withBrokenStorage(() => {}, () => {
      expect(writeJson('k', [1])).toEqual({ ok: false, reason: 'blocked' });
    });
  });

  it('survives unreadable storage', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} },
    });
    expect(readJson('k')).toBeNull();
    expect(loadLibrary()).toEqual([]);
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
  });
});

describe('library (names + cloud ids)', () => {
  it('empty → []; round trip; junk filtered', () => {
    expect(loadLibrary()).toEqual([]);
    expect(saveLibrary([{ id: ID_A, name: 'One' }])).toEqual({ ok: true });
    expect(loadLibrary()).toEqual([{ id: ID_A, name: 'One' }]);

    store.set(LIBRARY_KEY, JSON.stringify([
      { id: ID_A, name: 'ok' },
      { id: 'not an id', name: 'bad id' },
      { id: ID_B },
      { name: 'no id' },
      7,
    ]));
    expect(loadLibrary()).toEqual([{ id: ID_A, name: 'ok' }]);
    store.set(LIBRARY_KEY, '{not json');
    expect(loadLibrary()).toEqual([]);
  });

  it('one entry is a fraction of a whole point (the origin quota is shared)', () => {
    const entry = JSON.stringify({ id: ID_A, name: 'My point' }).length;
    const whole = JSON.stringify({ name: 'My point', state: defaultAppState() }).length;
    expect(entry).toBeLessThan(whole / 50);
  });

  it('upsertPoint replaces by name in place, appends anything new, never mutates the input', () => {
    const list = [{ id: ID_A, name: 'a' }, { id: ID_B, name: 'b' }];
    expect(upsertPoint(list, { id: ID_B, name: 'a' })).toEqual([{ id: ID_B, name: 'a' }, { id: ID_B, name: 'b' }]);
    expect(upsertPoint(list, { id: ID_B, name: 'c' })).toEqual([...list, { id: ID_B, name: 'c' }]);
    expect(list).toEqual([{ id: ID_A, name: 'a' }, { id: ID_B, name: 'b' }]);
  });

  it('removePoint drops one by index, ignores bad indexes, never mutates the input', () => {
    const list = [{ id: ID_A, name: 'a' }, { id: ID_B, name: 'b' }, { id: ID_A, name: 'c' }];
    expect(removePoint(list, 1).map((p) => p.name)).toEqual(['a', 'c']);
    expect(list.map((p) => p.name)).toEqual(['a', 'b', 'c']);
    expect(removePoint(list, -1)).toEqual(list);
    expect(removePoint(list, 3)).toEqual(list);
    expect(removePoint([], 0)).toEqual([]);
  });

  it('nextPointNumber / suggestPointName, over anything with names', () => {
    expect(nextPointNumber([])).toBe(1);
    expect(nextPointNumber([{ name: 'Point 3' }, { name: 'x' }])).toBe(4);
    const mine = [{ name: 'My thing' }, { name: 'Point 1' }];
    expect(suggestPointName(undefined, [])).toBe('Point 1');
    expect(suggestPointName('Molten Polivoks', mine)).toBe('Point 2'); // built-in name → a fresh one
    expect(suggestPointName('My thing', mine)).toBe('My thing');       // own point → offer to overwrite
    expect(suggestPointName(undefined, mine)).toBe('Point 2');
  });
});

describe('legacy points (whole states in localStorage)', () => {
  it('loads, filters junk, and can be cleared once migrated', () => {
    const s = defaultAppState();
    expect(loadUserPresets()).toEqual([]);
    expect(saveUserPresets([{ name: 'One', state: s }])).toEqual({ ok: true });
    expect(loadUserPresets()).toEqual([{ name: 'One', state: s }]);

    store.set(USER_PRESETS_KEY, JSON.stringify([{ name: 'ok', state: {} }, { nope: 1 }, 5]));
    expect(loadUserPresets()).toHaveLength(1);
    store.set(USER_PRESETS_KEY, '{not json');
    expect(loadUserPresets()).toEqual([]);

    store.set(USER_PRESETS_KEY, JSON.stringify([{ name: 'One', state: s }]));
    clearUserPresets();
    expect(store.has(USER_PRESETS_KEY)).toBe(false);
    expect(loadUserPresets()).toEqual([]);
  });
});
