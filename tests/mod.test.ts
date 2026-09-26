import { effectiveParam, effectiveParams, lfoValue, modulatedParam, LFO_SHAPE_LIST } from '../src/dsp/mod';
import type { LfoDef, ModRoute, ParamRanges } from '../src/dsp/mod';
import { fft } from '../src/analysis/fft';

describe('lfoValue — shapes', () => {
  const shapes = LFO_SHAPE_LIST;

  it('pink is appended last, so stored choice indices keep their meaning', () => {
    expect(LFO_SHAPE_LIST).toEqual(['sine', 'triangle', 'saw', 'square', 'random', 'pink']);
  });

  it.each(shapes)('%s: output stays in [-1, 1]', (shape) => {
    const lfo: LfoDef = { shape, rate: 0.3, phase: 0.2 };
    for (let i = 0; i <= 2000; i++) {
      const v = lfoValue(lfo, i / 200);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('sine: key points', () => {
    const lfo: LfoDef = { shape: 'sine', rate: 1, phase: 0 };
    expect(lfoValue(lfo, 0)).toBeCloseTo(0, 12);
    expect(lfoValue(lfo, 0.25)).toBeCloseTo(1, 12);
    expect(lfoValue(lfo, 0.5)).toBeCloseTo(0, 12);
    expect(lfoValue(lfo, 0.75)).toBeCloseTo(-1, 12);
  });

  it('triangle: -1 → +1 → -1', () => {
    const lfo: LfoDef = { shape: 'triangle', rate: 1, phase: 0 };
    expect(lfoValue(lfo, 0)).toBeCloseTo(-1, 12);
    expect(lfoValue(lfo, 0.25)).toBeCloseTo(0, 12);
    expect(lfoValue(lfo, 0.5)).toBeCloseTo(1, 12);
  });

  it('saw: linear ramp', () => {
    const lfo: LfoDef = { shape: 'saw', rate: 1, phase: 0 };
    expect(lfoValue(lfo, 0)).toBeCloseTo(-1, 12);
    expect(lfoValue(lfo, 0.5)).toBeCloseTo(0, 12);
  });

  it('square: +1 then -1', () => {
    const lfo: LfoDef = { shape: 'square', rate: 1, phase: 0 };
    expect(lfoValue(lfo, 0.1)).toBe(1);
    expect(lfoValue(lfo, 0.6)).toBe(-1);
  });

  it('random (S&H): holds within a cycle, changes across cycles, deterministic', () => {
    const lfo: LfoDef = { shape: 'random', rate: 2, phase: 0 };
    expect(lfoValue(lfo, 0.05)).toBe(lfoValue(lfo, 0.45));
    expect(lfoValue(lfo, 0.55)).not.toBe(lfoValue(lfo, 0.05));
    expect(lfoValue(lfo, 1.234)).toBe(lfoValue(lfo, 1.234));
  });

  it('phase offsets the cycle', () => {
    const a: LfoDef = { shape: 'sine', rate: 1, phase: 0 };
    const b: LfoDef = { shape: 'sine', rate: 1, phase: 0.25 };
    expect(lfoValue(b, 0)).toBeCloseTo(lfoValue(a, 0.25), 12);
  });
});

describe('effectiveParam', () => {
  const range: readonly [number, number] = [0, 10];

  it('linear: base + depth·range·l, clamped', () => {
    expect(effectiveParam(5, 1, 0.5, range, false)).toBe(10);
    expect(effectiveParam(5, -1, 0.5, range, false)).toBe(0);
    expect(effectiveParam(5, 0.5, 0.2, range, false)).toBeCloseTo(6, 12);
    expect(effectiveParam(9, 1, 1, range, false)).toBe(10); // clamp
  });

  it('exp: modulation in octaves across the range', () => {
    const r: readonly [number, number] = [20, 2000];
    expect(effectiveParam(200, 0, 0.5, r, true)).toBe(200);
    const up = effectiveParam(200, 1, 0.5, r, true);
    const down = effectiveParam(200, -1, 0.5, r, true);
    expect(up / 200).toBeCloseTo(200 / down, 6); // symmetric in log space
    expect(effectiveParam(1900, 1, 1, r, true)).toBe(2000); // clamp
  });

  it('exp falls back to linear when range touches zero', () => {
    expect(effectiveParam(5, 1, 0.5, [0, 10], true)).toBe(10);
  });
});

describe('effectiveParams', () => {
  const lfos: LfoDef[] = [{ shape: 'square', rate: 1, phase: 0 }];
  const ranges: ParamRanges = { fc: [20, 2000], I: [0, 20] };
  const base = { fc: 200, I: 4, gain: 0.3 };
  const routes: ModRoute[] = [
    { src: 0, target: 'fm', param: 'I', depth: 0.25 },
    { src: 0, target: 'additive', param: 'fund', depth: 0.5 },
    { src: 5, target: 'fm', param: 'fc', depth: 0.5 },
  ];

  it('applies only routes for the given target; base untouched', () => {
    const out = effectiveParams('fm', base, lfos, routes, ranges, 0.1);
    expect(out.I).toBe(9); // 4 + 0.25·20·(+1)
    expect(out.fc).toBe(200); // route src 5 has no LFO → skipped
    expect(out.gain).toBe(0.3);
    expect(base.I).toBe(4);
  });

  it('unknown range → param passes through', () => {
    const out = effectiveParams('fm', base, lfos, [{ src: 0, target: 'fm', param: 'gain', depth: 1 }], ranges, 0.1);
    expect(out.gain).toBe(0.3);
  });
});

// PLAN.md #18: a 1/f LFO — five octaves of smooth value noise at rate·2^j,
// equal amplitude per octave, a pure function of the LFO phase.
describe('lfoValue — pink', () => {
  const lfo: LfoDef = { shape: 'pink', rate: 1, phase: 0 };
  const sample = (from: number, n: number, dt: number): number[] =>
    Array.from({ length: n }, (_, i) => lfoValue(lfo, from + i * dt));

  it('is a pure function of time (sound and picture share the clock)', () => {
    expect(lfoValue(lfo, 12.345)).toBe(lfoValue(lfo, 12.345));
    expect(lfoValue({ ...lfo, phase: 0.25 }, 0)).toBeCloseTo(lfoValue(lfo, 0.25), 12);
  });

  it('glides: no jumps between neighbouring instants', () => {
    const xs = sample(0, 20000, 0.001); // 20 cycles of the slowest octave
    let maxStep = 0;
    for (let i = 1; i < xs.length; i++) maxStep = Math.max(maxStep, Math.abs(xs[i] - xs[i - 1]));
    expect(maxStep).toBeLessThan(0.05); // S&H would jump by up to 2
  });

  it('never repeats with the base period', () => {
    let diff = 0;
    for (let i = 0; i < 200; i++) diff += Math.abs(lfoValue(lfo, 3 + i * 0.05) - lfoValue(lfo, 4 + i * 0.05));
    expect(diff / 200).toBeGreaterThan(0.1);
  });

  it('spreads like the measured prototype, with round (soft-limited) peaks', () => {
    const xs = sample(0.123, 200000, 0.0137);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(sd).toBeGreaterThan(0.4);
    expect(sd).toBeLessThan(0.6);
    const peak = xs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeLessThan(1);
    expect(peak).toBeGreaterThan(0.8);
    // a hard clamp piles samples up at the edge; a soft limit doesn't
    expect(xs.filter((v) => Math.abs(v) > 0.97).length / xs.length).toBeLessThan(0.002);
  });

  it('fluctuates as 1/f from rate/2 to 4·rate', () => {
    // Measured per octave: −2.9, −3.4, −3.8 dB over 0.5–4 Hz (1/f is −3),
    // then −5.3 and −9.8 as the top octave's smoothing takes over.
    // Welch: average periodograms of 64 segments, fit log P vs log f.
    const fs = 64;
    const n = 1024; // 16 s per segment → 1/16 Hz bins
    const psd = new Float64Array(n / 2);
    for (let seg = 0; seg < 64; seg++) {
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
        re[i] = lfoValue(lfo, seg * 17 + i / fs) * w;
      }
      fft(re, im, false);
      for (let k = 0; k < n / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 8; k <= 64; k++) { // 0.5 Hz … 4 Hz
      xs.push(Math.log(k));
      ys.push(Math.log(psd[k]));
    }
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const beta = -num / den;
    expect(beta).toBeGreaterThan(0.8);
    expect(beta).toBeLessThan(1.4);
  });
});

// PLAN.md #19: routes aimed at one parameter add up — offsets in each route's
// own space (octaves for exp, range units otherwise), clamped once.
describe('routes on the same parameter add up', () => {
  const up: LfoDef = { shape: 'square', rate: 1, phase: 0 };   // +1 at t=0.1
  const down: LfoDef = { shape: 'square', rate: 1, phase: 0.5 }; // -1 at t=0.1
  const lfos = [up, down];

  it('linear offsets add', () => {
    const routes: ModRoute[] = [
      { src: 0, target: 'fm', param: 'I', depth: 0.25 },
      { src: 0, target: 'fm', param: 'I', depth: 0.1 },
    ];
    expect(modulatedParam('I', 4, [0, 20], routes, lfos, 0.1)).toBeCloseTo(4 + 0.35 * 20, 12);
    expect(effectiveParams('fm', { I: 4 }, lfos, routes, { I: [0, 20] }, 0.1).I).toBeCloseTo(11, 12);
  });

  it('exp offsets add in octaves', () => {
    const r: readonly [number, number] = [20, 2000];
    const routes: ModRoute[] = [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.1, exp: true },
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.1, exp: true },
    ];
    const one = effectiveParam(200, 1, 0.2, r, true);
    expect(modulatedParam('filterFreq', 200, r, routes, lfos, 0.1)).toBeCloseTo(one, 9);
  });

  it('clamps once: a push past the edge and a pull back cancel', () => {
    const routes: ModRoute[] = [
      { src: 0, target: 'fm', param: 'I', depth: 0.5 }, // +10
      { src: 1, target: 'fm', param: 'I', depth: 0.5 }, // -10
    ];
    // clamping per route would give clamp(19 + 10) − 10 = 10
    expect(modulatedParam('I', 19, [0, 20], routes, lfos, 0.1)).toBeCloseTo(19, 12);
  });

  it('a mixed pair: base·2^octaves + linear', () => {
    const routes: ModRoute[] = [
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.1, exp: true },
      { src: 0, target: 'fx', param: 'filterFreq', depth: 0.01 },
    ];
    const r: readonly [number, number] = [20, 2000];
    const expected = 200 * Math.pow(2, 0.1 * Math.log2(100)) + 0.01 * 1980;
    expect(modulatedParam('filterFreq', 200, r, routes, lfos, 0.1)).toBeCloseTo(expected, 9);
  });

  it('one route: exactly what effectiveParam gives (no built-in sound changes)', () => {
    for (const exp of [false, true]) {
      const route: ModRoute = { src: 0, target: 'fm', param: 'fc', depth: 0.3, exp };
      for (const t of [0.1, 0.6, 1.37]) {
        expect(modulatedParam('fc', 300, [20, 2000], [route], lfos, t))
          .toBe(effectiveParam(300, lfoValue(up, t), 0.3, [20, 2000], exp));
      }
    }
  });

  it('only routes for the param (and target) count; an unrouted param passes through', () => {
    const routes: ModRoute[] = [
      { src: 0, target: 'fm', param: 'fc', depth: 0.5 },
      { src: 0, target: 'pm', param: 'I', depth: 0.5 },
      { src: 7, target: 'fm', param: 'I', depth: 0.5 }, // no such LFO
    ];
    expect(modulatedParam('I', 25, [0, 20], routes, lfos, 0.1, 'fm')).toBe(25);
  });
});
