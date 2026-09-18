// Pure engine logic split out of audio/engine.ts (which pulls Web Audio and
// the worklet URL, so it can't load in node).
import { filterMode, toBiquadType, vowelFormants, VOWELS, clampNum } from '../src/audio/filters';
import { buildModPayload, modulateFx } from '../src/audio/modrouting';
import { DEFAULT_FX, FX_PARAM_RANGES, FX_MOD_PARAMS, isFxModParam } from '../src/schema/audio';
import type { ModState } from '../src/dsp/mod';

describe('filterMode / toBiquadType', () => {
  it('special modes vs biquad', () => {
    expect(filterMode('formant')).toBe('formant');
    expect(filterMode('comb')).toBe('comb');
    for (const t of ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf', 'allpass'] as const) {
      expect(filterMode(t)).toBe('biquad');
      expect(toBiquadType(t)).toBe(t);
    }
    expect(toBiquadType('formant')).toBe('lowpass');
  });
});

describe('vowelFormants', () => {
  it('edges are pure A and U; midpoint interpolates', () => {
    expect(vowelFormants(0).f).toEqual([...VOWELS[0].f]);
    expect(vowelFormants(1).f).toEqual([...VOWELS[VOWELS.length - 1].f]);
    const mid = vowelFormants(0.125);
    for (let k = 0; k < 3; k++) expect(mid.f[k]).toBeCloseTo((VOWELS[0].f[k] + VOWELS[1].f[k]) / 2, 6);
  });
  it('clamps outside [0,1]', () => {
    expect(vowelFormants(-1).f).toEqual(vowelFormants(0).f);
    expect(vowelFormants(2).f).toEqual(vowelFormants(1).f);
  });
});

describe('clampNum', () => {
  it('clamps', () => {
    expect(clampNum(5, 0, 10)).toBe(5);
    expect(clampNum(-1, 0, 10)).toBe(0);
    expect(clampNum(99, 0, 10)).toBe(10);
  });
});

describe('buildModPayload', () => {
  const formulas = [
    { id: 'fm', sliders: [{ k: 'fc', min: 20, max: 2000 }, { k: 'I', min: 0, max: 20 }] },
    { id: 'additive', sliders: [{ k: 'fund', min: 20, max: 500 }] },
  ];
  const mod: ModState = {
    lfos: [{ shape: 'sine', rate: 2, phase: 0 }],
    routes: [
      { src: 0, target: 'fm', param: 'fc', depth: 0.3, exp: true },
      { src: 0, target: 'additive', param: 'fund', depth: 0.5 },
      { src: 0, target: 'fm', param: 'nope', depth: 0.4 },
      { src: 0, target: 'reaction', param: 'feed', depth: 0.4 },
    ],
  };

  it('null → empty payload', () => {
    expect(buildModPayload(null, 'fm', formulas)).toEqual({ lfos: [], routes: [], ranges: {} });
  });

  it('filters routes by target, ranges only for known sliders', () => {
    const p = buildModPayload(mod, 'fm', formulas);
    expect(p.routes.map((r) => r.param)).toEqual(['fc', 'nope']);
    expect(p.ranges).toEqual({ fc: [20, 2000] });
    expect(buildModPayload(mod, 'additive', formulas).ranges).toEqual({ fund: [20, 500] });
  });
});

describe('FX schema', () => {
  it('every modulatable FX param has a range and a default', () => {
    for (const p of FX_MOD_PARAMS) {
      expect(FX_PARAM_RANGES[p]).toBeDefined();
      expect(typeof DEFAULT_FX[p]).toBe('number');
      expect(isFxModParam(p)).toBe(true);
    }
    expect(isFxModParam('filterType')).toBe(false);
    expect(isFxModParam('reverbDecay')).toBe(false);
  });
});

describe('modulateFx', () => {
  const lfos = [{ shape: 'square' as const, rate: 1, phase: 0 }];

  it('applies fx routes to allowlisted fields only', () => {
    const eff = modulateFx(DEFAULT_FX, [
      { src: 0, target: 'fx', param: 'reverbMix', depth: 0.5 },
      { src: 0, target: 'fx', param: 'reverbDecay', depth: 0.5 },
      { src: 0, target: 'fm', param: 'reverbMix', depth: 0.5 },
    ], lfos, 0.1);
    expect(eff.reverbMix).toBeCloseTo(DEFAULT_FX.reverbMix + 0.5, 12);
    expect(eff.reverbDecay).toBe(DEFAULT_FX.reverbDecay);
  });

  it('no routes → identical copy', () => {
    const eff = modulateFx(DEFAULT_FX, [], lfos, 3);
    expect(eff).toEqual(DEFAULT_FX);
    expect(eff).not.toBe(DEFAULT_FX);
  });
});
