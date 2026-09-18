import {
  defaultAppState, sanitizeState, stateToAppState, cloneAppState, LFO_COUNT, COUPLING_KEYS,
} from '../src/state/schema';
import type { AppState } from '../src/state/schema';
import { FORMULA_IDS } from '../src/dsp/generator';
import { CARDS } from '../src/schema/visual';
import { DEFAULT_FX } from '../src/schema/audio';
import { b64urlDecode, b64urlEncode, decodeStateToken, encodeStateToken, tokenFromHash } from '../src/state/share';
import { loadUserPresets, saveUserPresets, nextPresetNumber, USER_PRESETS_KEY } from '../src/state/userPresets';

describe('defaultAppState', () => {
  it('has every formula (disabled, UI defaults), every card, 4 idle LFOs, zero coupling', () => {
    const s = defaultAppState();
    expect(s.v).toBe(1);
    expect(Object.keys(s.audio.formulas).sort()).toEqual([...FORMULA_IDS].sort());
    for (const f of Object.values(s.audio.formulas)) expect(f.enabled).toBe(false);
    expect(s.audio.formulas.fm.params.fc).toBe(220);
    expect(s.audio.fx).toEqual(DEFAULT_FX);
    expect(Object.keys(s.visual.cards)).toEqual(CARDS.map((c) => c.id));
    expect(s.visual.cards.reaction.on).toBe(true);
    expect(s.visual.cards.flow.on).toBe(false);
    expect(s.visual.cards.palette.params.paletteId).toBe(0);
    expect(s.mod.lfos).toHaveLength(LFO_COUNT);
    expect(s.mod.routes).toEqual([]);
    for (const k of COUPLING_KEYS) expect(s.coupling[k]).toBe(0);
  });

  it('returns fresh objects each call', () => {
    const a = defaultAppState();
    const b = defaultAppState();
    a.audio.formulas.fm.params.fc = 1;
    expect(b.audio.formulas.fm.params.fc).toBe(220);
  });
});

describe('sanitizeState', () => {
  it('rejects non-objects', () => {
    expect(sanitizeState(null)).toBeNull();
    expect(sanitizeState('x')).toBeNull();
  });

  it('keeps valid fields, drops junk', () => {
    const p = sanitizeState({
      presetName: 'X',
      audio: {
        masterGain: 0.5,
        fx: { filterOn: true, filterType: 'comb', filterFreq: 300, filterQ: 'bad', chorusMode: 'nope' },
        formulas: { fm: { enabled: true, params: { fc: 440, junk: 'no' } }, bogus: { enabled: true, params: {} } },
      },
      visual: { cards: { flow: { on: true, params: { curlStrength: 0.02 } }, veins: { on: true, params: {} } } },
      mod: {
        lfos: [{ shape: 'saw', rate: 0.1, phase: 0 }],
        routes: [
          { src: 0, target: 'fm', param: 'fc', depth: 0.5, exp: true },
          { src: 0, target: 'fx', param: 'filterFreq', depth: 2 },
          { src: 0, target: 'reaction', param: 'feed', depth: -0.2 },
          { src: 0, target: 'fx', param: 'reverbDecay', depth: 0.2 },
          { src: 9, target: 'fm', param: 'fc', depth: 0.5 },
          { src: 0, target: 'fm', param: 'nope', depth: 0.5 },
          { src: 0, target: 'palette', param: 'paletteId', depth: 0.5 },
        ],
      },
      coupling: { loudToFlow: 0.5, bogus: 1, loudToGloss: 'x' },
    });
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.presetName).toBe('X');
    expect(p.audio?.masterGain).toBe(0.5);
    expect(p.audio?.fx).toEqual({ filterOn: true, filterType: 'comb', filterFreq: 300 });
    expect(Object.keys(p.audio?.formulas ?? {})).toEqual(['fm']);
    expect(p.audio?.formulas?.fm.params).toEqual({ fc: 440 });
    expect(Object.keys(p.visual?.cards ?? {})).toEqual(['flow']);
    expect(p.mod?.lfos).toHaveLength(LFO_COUNT);
    expect(p.mod?.lfos[0]).toEqual({ shape: 'saw', rate: 0.1, phase: 0 });
    expect(p.mod?.routes).toEqual([
      { src: 0, target: 'fm', param: 'fc', depth: 0.5, exp: true },
      { src: 0, target: 'fx', param: 'filterFreq', depth: 1 },
      { src: 0, target: 'reaction', param: 'feed', depth: -0.2 },
    ]);
    expect(p.coupling).toEqual({ loudToFlow: 0.5 });
  });
});

describe('stateToAppState', () => {
  it('overlays partial onto defaults with clamping', () => {
    const s = stateToAppState({
      audio: { formulas: { fm: { enabled: true, params: { fc: 99999, I: -5 } } }, fx: { filterFreq: 5 } },
      visual: { cards: { reaction: { params: { feed: 5 } }, palette: { params: { paletteId: 42 } } } },
      coupling: { brightToShift: 7 },
    });
    expect(s.audio.formulas.fm.enabled).toBe(true);
    expect(s.audio.formulas.fm.params.fc).toBe(2000);
    expect(s.audio.formulas.fm.params.I).toBe(0);
    expect(s.audio.formulas.fm.params.fm).toBe(2); // untouched default
    expect(s.audio.fx.filterFreq).toBe(20);
    expect(s.visual.cards.reaction.params.feed).toBe(0.09);
    expect(s.visual.cards.palette.params.paletteId).toBe(0); // invalid option → default
    expect(s.coupling.brightToShift).toBe(1);
  });

  it('{} → defaults; presetName carried', () => {
    expect(stateToAppState({})).toEqual(defaultAppState());
    expect(stateToAppState({ presetName: 'Z' }).presetName).toBe('Z');
  });
});

describe('cloneAppState', () => {
  it('deep-copies params, cards, mod and coupling', () => {
    const s = defaultAppState();
    s.mod.routes.push({ src: 0, target: 'fm', param: 'fc', depth: 0.1 });
    const c = cloneAppState(s);
    expect(c).toEqual(s);
    c.audio.formulas.fm.params.fc = 1;
    c.visual.cards.flow.params.curlStrength = 1;
    c.mod.routes[0].depth = 0.9;
    c.coupling.loudToFlow = 1;
    expect(s.audio.formulas.fm.params.fc).toBe(220);
    expect(s.visual.cards.flow.params.curlStrength).not.toBe(1);
    expect(s.mod.routes[0].depth).toBe(0.1);
    expect(s.coupling.loudToFlow).toBe(0);
  });
});

describe('share tokens', () => {
  it('base64url round-trips unicode', () => {
    const str = 'héllo — wörld ∿';
    expect(b64urlDecode(b64urlEncode(str))).toBe(str);
    expect(b64urlEncode(str)).not.toMatch(/[+/=]/);
  });

  it('state → token → state', () => {
    const s: AppState = defaultAppState();
    s.presetName = 'Shared';
    s.audio.formulas.rain.enabled = true;
    s.visual.cards.flow.on = true;
    s.coupling.loudToGloss = 0.4;
    const token = encodeStateToken(s);
    const back = decodeStateToken(token);
    expect(back).not.toBeNull();
    expect(stateToAppState(back ?? {})).toEqual(s);
  });

  it('garbage token → null; tokenFromHash extracts', () => {
    expect(decodeStateToken('!!!')).toBeNull();
    expect(tokenFromHash('#s=abc_-123')).toBe('abc_-123');
    expect(tokenFromHash('#other')).toBeNull();
  });
});

describe('userPresets (localStorage)', () => {
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

  it('empty → []; save/load round trip; junk filtered', () => {
    expect(loadUserPresets()).toEqual([]);
    const s = defaultAppState();
    saveUserPresets([{ name: 'One', state: s }]);
    expect(loadUserPresets()).toEqual([{ name: 'One', state: s }]);
    store.set(USER_PRESETS_KEY, JSON.stringify([{ name: 'ok', state: {} }, { nope: 1 }, 5]));
    expect(loadUserPresets()).toHaveLength(1);
    store.set(USER_PRESETS_KEY, '{not json');
    expect(loadUserPresets()).toEqual([]);
  });

  it('nextPresetNumber', () => {
    expect(nextPresetNumber([])).toBe(1);
    expect(nextPresetNumber([{ name: 'Preset 3', state: defaultAppState() }, { name: 'x', state: defaultAppState() }])).toBe(4);
  });
});
