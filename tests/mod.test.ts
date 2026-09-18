import { effectiveParam, effectiveParams, lfoValue } from '../src/dsp/mod';
import type { LfoDef, ModRoute, ParamRanges } from '../src/dsp/mod';

describe('lfoValue — shapes', () => {
  const shapes = ['sine', 'triangle', 'saw', 'square', 'random'] as const;

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
