import { rmsOf, spectralCentroid, spectralFlux, FeatureTracker, OnsetDetector, SILENT_FEATURES } from '../src/audio/features';

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

describe('FeatureTracker: swell and spectral bands', () => {
  function binsWith(level: number, lo: number, hi: number, sr = 48000, n = 512): Uint8Array {
    const b = new Uint8Array(n);
    const hz = sr / 2 / n;
    for (let i = 0; i < n; i++) if (i * hz >= lo && i * hz < hi) b[i] = level;
    return b;
  }

  it('swell is ~0 for a steady level and positive right after the sound gets louder', () => {
    const tr = new FeatureTracker(48000);
    const quiet = sine(2048, 220, 48000, 0.1);
    const loud = sine(2048, 220, 48000, 0.4);
    const bins = new Uint8Array(512).fill(100);
    let f = tr.update(quiet, bins, 1 / 60);
    for (let i = 0; i < 60 * 10; i++) f = tr.update(quiet, bins, 1 / 60);
    // (a small residue of the start-up rise: ≈2% exposure at most — invisible)
    expect(Math.abs(f.swell)).toBeLessThan(0.1);
    for (let i = 0; i < 20; i++) f = tr.update(loud, bins, 1 / 60);
    expect(f.swell).toBeGreaterThan(0.3);
    for (let i = 0; i < 60 * 20; i++) f = tr.update(loud, bins, 1 / 60);
    expect(Math.abs(f.swell)).toBeLessThan(0.1); // adapted: the new level is the new normal
    for (let i = 0; i < 30; i++) f = tr.update(quiet, bins, 1 / 60);
    expect(f.swell).toBeLessThan(-0.3);
    expect(f.swell).toBeGreaterThanOrEqual(-1);
  });

  it('low / mid / high follow energy in their bands, each in [0,1]', () => {
    const td = sine(2048, 440, 48000, 0.3);
    const settle = (bins: Uint8Array) => {
      const tr = new FeatureTracker(48000);
      let f = tr.update(td, bins, 1 / 60);
      for (let i = 0; i < 60; i++) f = tr.update(td, bins, 1 / 60);
      return f;
    };
    const bass = settle(binsWith(220, 30, 250));
    const treble = settle(binsWith(220, 2000, 10000));
    expect(bass.low).toBeGreaterThan(0.5);
    expect(bass.high).toBeLessThan(0.1);
    expect(treble.high).toBeGreaterThan(0.5);
    expect(treble.low).toBeLessThan(0.1);
    for (const f of [bass, treble]) for (const v of [f.low, f.mid, f.high]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('SILENT_FEATURES carries neutral values for the new fields', () => {
    expect(SILENT_FEATURES).toEqual({ loudness: 0, brightness: 0, onset: 0, swell: 0, low: 0, mid: 0, high: 0 });
  });
});

describe('OnsetDetector', () => {
  it('fires once per rising edge above the threshold, with a refractory period', () => {
    const d = new OnsetDetector();
    const fired: number[] = [];
    // two spikes 0.5 s apart, each decaying over several frames, then a spike too soon
    const series: [number, number][] = [];
    let t = 0;
    const spike = () => { for (const v of [0.9, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05]) { series.push([t, v]); t += 1 / 60; } };
    spike(); t += 0.4; spike();
    // a re-armed but too-early hit: 2 frames after a fresh one (< 120 ms refractory)
    t += 0.3;
    series.push([t, 0.9], [t + 1 / 60, 0.1], [t + 2 / 60, 0.9]);
    for (const [time, v] of series) if (d.update(v, time)) fired.push(time);
    expect(fired.length).toBe(3);
    expect(fired[1] - fired[0]).toBeGreaterThan(0.4);
    expect(fired[2]).toBeCloseTo(t, 9); // the one 2 frames later was swallowed
  });

  it('never fires on silence or a steady low onset level', () => {
    const d = new OnsetDetector();
    for (let i = 0; i < 600; i++) expect(d.update(i % 2 ? 0.1 : 0.15, i / 60)).toBe(false);
  });
});
