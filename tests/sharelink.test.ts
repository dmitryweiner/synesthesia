import { canonicalJson, presetIdOf, isPresetId, PRESET_ID_LENGTH } from '../src/state/canonical';
import { parseLaunch, cleanUrl, withPresetId } from '../src/state/launch';
import { sharePoint, fetchPoint, PRESETS_API } from '../src/state/cloud';
import { saveLastPoint, loadLastPoint, LAST_POINT_KEY } from '../src/state/lastPoint';
import { defaultAppState, stateToAppState } from '../src/state/schema';
import { encodeStateToken } from '../src/state/share';
import { PRESETS } from '../src/presets';

describe('canonicalJson', () => {
  it('sorts object keys at every depth, keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe('presetIdOf', () => {
  it('10 base62 characters, deterministic', async () => {
    const a = await presetIdOf('{"a":1}');
    expect(a).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(a.length).toBe(PRESET_ID_LENGTH);
    expect(await presetIdOf('{"a":1}')).toBe(a);
    expect(await presetIdOf('{"a":2}')).not.toBe(a);
  });

  it('distinct presets get distinct ids', async () => {
    const ids = await Promise.all(PRESETS.map((p) => presetIdOf(canonicalJson(p.state))));
    expect(new Set(ids).size).toBe(PRESETS.length);
  });

  it('isPresetId', () => {
    expect(isPresetId('Ab3xK9pQ2m')).toBe(true);
    expect(isPresetId('Ab3xK9pQ2')).toBe(false);
    expect(isPresetId('Ab3xK9pQ2m!')).toBe(false);
    expect(isPresetId('Ab3xK9-Q2m')).toBe(false);
  });
});

describe('launch URL', () => {
  const base = 'https://dmitryweiner.github.io/synesthesia/';

  it('priority: presetId > #s= token > ?preset=N > none', () => {
    const token = encodeStateToken(defaultAppState());
    expect(parseLaunch(`${base}?presetId=Ab3xK9pQ2m&preset=2#s=${token}`)).toEqual({ kind: 'presetId', id: 'Ab3xK9pQ2m' });
    expect(parseLaunch(`${base}?preset=2#s=${token}`)).toEqual({ kind: 'token', token });
    expect(parseLaunch(`${base}?preset=2`)).toEqual({ kind: 'preset', index: 2 });
    expect(parseLaunch(base)).toEqual({ kind: 'none' });
  });

  it('malformed values fall through instead of throwing', () => {
    expect(parseLaunch(`${base}?presetId=nope`)).toEqual({ kind: 'none' });
    expect(parseLaunch(`${base}?preset=abc`)).toEqual({ kind: 'none' });
    expect(parseLaunch(`${base}?preset=`)).toEqual({ kind: 'none' });
    expect(parseLaunch(`${base}?preset=-1`)).toEqual({ kind: 'none' });
  });

  it('cleanUrl drops the point (presetId, preset, #s=) but keeps settings (res, scout, api)', () => {
    expect(cleanUrl(`${base}?presetId=Ab3xK9pQ2m&res=256&scout=0#s=abc`)).toBe(`${base}?res=256&scout=0`);
    expect(cleanUrl(`${base}?preset=3`)).toBe(base);
    expect(cleanUrl(`${base}?api=http%3A%2F%2Flocalhost%3A8787`)).toBe(`${base}?api=http%3A%2F%2Flocalhost%3A8787`);
  });

  it('withPresetId puts the short id on a clean URL', () => {
    expect(withPresetId(`${base}?res=256#s=abc`, 'Ab3xK9pQ2m')).toBe(`${base}?res=256&presetId=Ab3xK9pQ2m`);
    expect(withPresetId(`${base}?presetId=OLDOLDOLD1`, 'Ab3xK9pQ2m')).toBe(`${base}?presetId=Ab3xK9pQ2m`);
  });
});

type FetchArgs = { url: string; init?: RequestInit };

function fakeFetch(respond: (a: FetchArgs) => Response | Promise<Response>): { fetch: typeof fetch; calls: FetchArgs[] } {
  const calls: FetchArgs[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return respond({ url, init });
  };
  return { fetch: f, calls };
}

describe('cloud client', () => {
  it('sharePoint POSTs the state as JSON and returns the id', async () => {
    const { fetch: f, calls } = fakeFetch(() => Response.json({ id: 'Ab3xK9pQ2m' }, { status: 201 }));
    const id = await sharePoint(defaultAppState(), { fetch: f, api: 'https://api.test' });
    expect(id).toBe('Ab3xK9pQ2m');
    expect(calls[0].url).toBe('https://api.test/v1/points');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(defaultAppState());
  });

  it('sharePoint rejects on HTTP errors and malformed replies', async () => {
    const bad = fakeFetch(() => new Response('nope', { status: 503 }));
    await expect(sharePoint(defaultAppState(), { fetch: bad.fetch })).rejects.toThrow();
    const junk = fakeFetch(() => Response.json({ id: 'not an id' }));
    await expect(sharePoint(defaultAppState(), { fetch: junk.fetch })).rejects.toThrow();
  });

  it('sharePoint times out', async () => {
    const hang = fakeFetch(({ init }) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(sharePoint(defaultAppState(), { fetch: hang.fetch, timeoutMs: 20 })).rejects.toThrow();
  });

  it('fetchPoint returns a sanitized partial state; 404 → null; bad id → null without a request', async () => {
    const s = defaultAppState();
    s.presetName = 'From the cloud';
    const ok = fakeFetch(() => Response.json({ ...s, junk: 1 }));
    const got = await fetchPoint('Ab3xK9pQ2m', { fetch: ok.fetch, api: 'https://api.test' });
    expect(ok.calls[0].url).toBe('https://api.test/v1/points/Ab3xK9pQ2m');
    expect(got && stateToAppState(got)).toEqual(s);
    const missing = fakeFetch(() => new Response('{}', { status: 404 }));
    expect(await fetchPoint('Ab3xK9pQ2m', { fetch: missing.fetch })).toBeNull();
    const none = fakeFetch(() => Response.json(s));
    expect(await fetchPoint('../etc/pwd', { fetch: none.fetch })).toBeNull();
    expect(none.calls.length).toBe(0);
  });

  it('the default API is the deployed worker', () => {
    expect(PRESETS_API).toMatch(/^https:\/\/synesthesia-presets\.[a-z0-9-]+\.workers\.dev$/);
  });
});

describe('last point (localStorage)', () => {
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

  it('round-trips; missing or junk → null', () => {
    expect(loadLastPoint()).toBeNull();
    const s = defaultAppState();
    s.audio.formulas.fm.enabled = true;
    saveLastPoint(s);
    expect(loadLastPoint()).toEqual(s);
    store.set(LAST_POINT_KEY, '{broken');
    expect(loadLastPoint()).toBeNull();
    store.set(LAST_POINT_KEY, '"a string"');
    expect(loadLastPoint()).toBeNull();
  });
});
