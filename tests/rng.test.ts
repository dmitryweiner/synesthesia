import { mulberry32, gaussian } from '../src/dsp/rng';

describe('mulberry32', () => {
  it('same seed → same sequence', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('different seeds → different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('values stay in [0, 1)', () => {
    const r = mulberry32(123);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('gaussian', () => {
  it('mean ≈ 0, std ≈ 1 over many samples', () => {
    const r = mulberry32(99);
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const g = gaussian(r);
      sum += g;
      sumSq += g * g;
    }
    const mean = sum / n;
    const std = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(std - 1)).toBeLessThan(0.03);
  });

  it('always finite (rng returning 0 must not produce -Infinity)', () => {
    let calls = 0;
    const zeroThenHalf = () => (calls++ === 0 ? 0 : 0.5);
    expect(Number.isFinite(gaussian(zeroThenHalf))).toBe(true);
  });
});
