// Moving points saved by the old build (whole states in localStorage) into
// the library (names + cloud ids). Nothing may be lost on the way, including
// when the browser refuses to write.
import { defaultAppState } from '../src/state/schema';
import type { AppState } from '../src/state/schema';
import type { SavedPoint } from '../src/state/library';
import type { UserPreset } from '../src/state/userPresets';
import type { SaveResult } from '../src/state/store';
import { migrateLegacyPoints } from '../src/state/migrate';

const IDS = ['cnG1Iacvvb', 'a7Kp2Lm9xQ', 'Zz0987wxyV'];

function point(name: string): UserPreset {
  const state = defaultAppState();
  state.presetName = name;
  return { name, state };
}

/**
 * A fake browser store with a byte budget, so "full" behaves like the real
 * thing: freeing the old key really does make room for the new one.
 */
function io(opts: {
  legacy?: UserPreset[];
  library?: SavedPoint[];
  uploadFails?: (state: AppState) => boolean;
  quota?: number;
} = {}) {
  const keys = new Map<string, string>();
  if (opts.legacy?.length) keys.set('legacy', JSON.stringify(opts.legacy));
  if (opts.library?.length) keys.set('library', JSON.stringify(opts.library));
  const quota = opts.quota ?? Infinity;
  const used = (except: string) => [...keys].reduce((n, [k, v]) => n + (k === except ? 0 : v.length), 0);
  const put = (key: string, value: unknown): SaveResult => {
    const json = JSON.stringify(value);
    if (used(key) + json.length > quota) return { ok: false, reason: 'full' };
    keys.set(key, json);
    return { ok: true };
  };
  const get = (key: string): unknown => JSON.parse(keys.get(key) ?? 'null');
  const uploads: string[] = [];
  let next = 0;
  return {
    uploads,
    keys,
    legacyNow: () => get('legacy'),
    libraryNow: () => get('library'),
    async upload(state: AppState): Promise<string> {
      if (opts.uploadFails?.(state)) throw new Error('offline');
      uploads.push(state.presetName ?? '');
      return IDS[next++ % IDS.length];
    },
    readLibrary: (): SavedPoint[] => {
      const v = get('library');
      return Array.isArray(v) ? v : [];
    },
    writeLibrary: (points: SavedPoint[]): SaveResult => put('library', points),
    readLegacy: (): UserPreset[] => {
      const v = get('legacy');
      return Array.isArray(v) ? v : [];
    },
    writeLegacy: (points: UserPreset[]): SaveResult => put('legacy', points),
    clearLegacy: () => { keys.delete('legacy'); },
  };
}

describe('migrateLegacyPoints', () => {
  it('does nothing without legacy points', async () => {
    const box = io({ library: [{ id: IDS[0], name: 'kept' }] });
    const res = await migrateLegacyPoints(box);
    expect(res).toEqual({ library: [{ id: IDS[0], name: 'kept' }], legacy: [], moved: 0, stored: true });
    expect(box.uploads).toEqual([]);
    expect(box.keys.has('legacy')).toBe(false); // nothing was there to begin with
  });

  it('uploads every point, keeps the names, and drops the old key', async () => {
    const box = io({ legacy: [point('a'), point('b')] });
    const res = await migrateLegacyPoints(box);
    expect(box.uploads).toEqual(['a', 'b']);
    expect(res.moved).toBe(2);
    expect(res.legacy).toEqual([]);
    expect(res.library.map((p) => p.name)).toEqual(['a', 'b']);
    expect(res.library.every((p) => IDS.includes(p.id))).toBe(true);
    expect(box.libraryNow()).toEqual(res.library);
    expect(box.keys.has('legacy')).toBe(false); // key gone → ~4.4 KB per point freed
  });

  it('merges into an existing library without duplicating a name', async () => {
    const box = io({ legacy: [point('a')], library: [{ id: IDS[2], name: 'a' }, { id: IDS[1], name: 'b' }] });
    const res = await migrateLegacyPoints(box);
    expect(res.library.map((p) => p.name)).toEqual(['a', 'b']);
    expect(res.library[0].id).toBe(IDS[0]); // the freshly uploaded one wins
  });

  it('keeps what could not be uploaded, moves the rest', async () => {
    const box = io({ legacy: [point('a'), point('b')], uploadFails: (s) => s.presetName === 'b' });
    const res = await migrateLegacyPoints(box);
    expect(res.moved).toBe(1);
    expect(res.library.map((p) => p.name)).toEqual(['a']);
    expect(res.legacy.map((p) => p.name)).toEqual(['b']);
    expect(box.readLegacy().map((p) => p.name)).toEqual(['b']); // still on disk, retried next boot
  });

  it('frees the old key when that is the only way to fit the new one', async () => {
    const legacy = [point('a')];
    // room for the library entry, but not while the whole point is stored
    const quota = JSON.stringify(legacy).length + 20;
    const box = io({ legacy, quota });
    const res = await migrateLegacyPoints(box);
    expect(res.stored).toBe(true);
    expect(res.library.map((p) => p.name)).toEqual(['a']);
    expect(box.keys.has('legacy')).toBe(false);
    expect(box.libraryNow()).toEqual(res.library);
  });

  it('keeps the points usable in this session even if nothing can be written at all', async () => {
    const box = io({ legacy: [point('a')], quota: 0 });
    const res = await migrateLegacyPoints(box);
    expect(res.stored).toBe(false);
    expect(res.library.map((p) => p.name)).toEqual(['a']); // uploaded, so the list still shows it
    expect(box.uploads).toEqual(['a']);
  });
});
