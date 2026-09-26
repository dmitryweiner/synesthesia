// The picture behind analyze.mjs --png (PLAN.md #22): a log-frequency
// spectrogram must put a tone where it is, at the level it has.
import { logSpectrogram } from '../src/analysis/spectrogram';

const SR = 22050;

function signal(seconds: number, f: (t: number) => number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => f(i / SR));
}

function loudestRowHz(s: ReturnType<typeof logSpectrogram>, col: number): { hz: number; db: number } {
  let best = 0;
  for (let r = 1; r < s.rows; r++) if (s.db[r * s.columns + col] > s.db[best * s.columns + col]) best = r;
  return { hz: s.rowHz(best), db: s.db[best * s.columns + col] };
}

describe('logSpectrogram', () => {
  it('puts a tone on its row at its level, in every column', () => {
    const s = logSpectrogram(signal(4, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t)), SR, { columns: 40, rows: 200 });
    for (let c = 0; c < s.columns; c++) {
      const { hz, db } = loudestRowHz(s, c);
      expect(Math.abs(12 * Math.log2(hz / 440))).toBeLessThan(0.5); // within a quarter tone
      expect(db).toBeGreaterThan(-6 - 1.5); // 20·log10(0.5)
      expect(db).toBeLessThan(-6 + 1.5);
    }
  });

  it('rows run from fMax at the top to fMin at the bottom, log-spaced', () => {
    const s = logSpectrogram(signal(1, () => 0), SR, { rows: 101, fMin: 50, fMax: 5000 });
    expect(s.rowHz(0)).toBeCloseTo(5000, 6);
    expect(s.rowHz(100)).toBeCloseTo(50, 6);
    expect(s.rowHz(50)).toBeCloseTo(500, 6);
  });

  it('follows a glide upwards', () => {
    // exponential chirp 100 Hz → 1600 Hz over 4 s
    const k = Math.log(16) / 4;
    const s = logSpectrogram(signal(4, (t) => 0.5 * Math.sin((2 * Math.PI * 100 * (Math.exp(k * t) - 1)) / k)), SR, { columns: 20, rows: 200 });
    const first = loudestRowHz(s, 1).hz;
    const last = loudestRowHz(s, s.columns - 2).hz;
    expect(first).toBeLessThan(200);
    expect(last).toBeGreaterThan(900);
  });

  it('reports loudness (RMS dBFS) per column', () => {
    const s = logSpectrogram(signal(4, (t) => (t < 2 ? 0.5 : 0.05) * Math.sin(2 * Math.PI * 220 * t)), SR, { columns: 40 });
    expect(s.loudness[5]).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 0);
    expect(s.loudness[35]).toBeCloseTo(20 * Math.log10(0.05 / Math.SQRT2), 0);
  });
});
