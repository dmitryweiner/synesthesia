import { rmsOf, spectralCentroid, spectralFlux, FeatureTracker } from '../src/audio/features';

function sine(n: number, freq: number, sr: number, amp = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe('rmsOf', () => {
  it('full-scale sine ≈ 0.707, silence = 0', () => {
    expect(rmsOf(sine(4096, 440, 48000))).toBeCloseTo(Math.SQRT1_2, 2);
    expect(rmsOf(new Float32Array(256))).toBe(0);
  });
});

describe('spectralCentroid', () => {
  // Byte magnitude spectrum with SR=48000 and 512 bins → 46.875 Hz per bin.
  it('single bin → that bin\'s frequency; empty spectrum → 0', () => {
    const bins = new Uint8Array(512);
    bins[100] = 255;
    expect(spectralCentroid(bins, 48000)).toBeCloseTo(100 * (24000 / 512), 6);
    expect(spectralCentroid(new Uint8Array(512), 48000)).toBe(0);
  });

  it('higher-frequency energy raises the centroid', () => {
    const low = new Uint8Array(512);
    const high = new Uint8Array(512);
    low[20] = 200; low[30] = 200;
    high[200] = 200; high[300] = 200;
    expect(spectralCentroid(high, 48000)).toBeGreaterThan(spectralCentroid(low, 48000));
  });
});

describe('spectralFlux', () => {
  it('identical frames → 0; rising energy → positive; falling → 0 (half-wave rectified)', () => {
    const a = new Uint8Array([10, 20, 30]);
    const b = new Uint8Array([20, 40, 30]);
    expect(spectralFlux(a, a)).toBe(0);
    expect(spectralFlux(a, b)).toBeGreaterThan(0);
    expect(spectralFlux(b, a)).toBe(0);
  });
});

describe('FeatureTracker', () => {
  it('normalizes to [0,1] and smooths', () => {
    const tr = new FeatureTracker(48000);
    const loudBins = new Uint8Array(512).fill(120);
    const f1 = tr.update(sine(2048, 440, 48000, 0.5), loudBins);
    for (const v of [f1.loudness, f1.brightness, f1.onset]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Silence afterwards: loudness decays but not instantly to zero.
    const f2 = tr.update(new Float32Array(2048), new Uint8Array(512));
    expect(f2.loudness).toBeLessThan(f1.loudness);
    expect(f2.loudness).toBeGreaterThan(0);
  });

  it('onset spikes when spectral energy jumps, then decays', () => {
    const tr = new FeatureTracker(48000);
    const quiet = new Uint8Array(512).fill(10);
    const loud = new Uint8Array(512).fill(200);
    const td = sine(2048, 440, 48000, 0.3);
    for (let i = 0; i < 10; i++) tr.update(td, quiet);
    const spike = tr.update(td, loud).onset;
    expect(spike).toBeGreaterThan(0.3);
    let later = spike;
    for (let i = 0; i < 20; i++) later = tr.update(td, loud).onset;
    expect(later).toBeLessThan(spike);
  });
});
