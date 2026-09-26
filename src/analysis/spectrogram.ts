// A log-frequency spectrogram of a render, for analyze.mjs --png (PLAN.md
// #22): an agent can't hear, but it can read a picture. One look at the
// waterfall settles questions a numeric metric can take an hour to (a bright
// line stepping across the harmonics IS the whistle). Pure.
import { fft } from './fft';

export interface Spectrogram {
  columns: number;
  rows: number;
  /** dBFS, row-major; row 0 is the top (fMax). A full-scale sine reads 0. */
  db: Float32Array;
  /** RMS dBFS around each column (0.4 s window). */
  loudness: Float32Array;
  /** Centre frequency of a row, Hz. */
  rowHz: (row: number) => number;
  /** Seconds at the centre of a column. */
  columnSeconds: (col: number) => number;
}

export interface SpectrogramOptions {
  columns?: number;
  rows?: number;
  fMin?: number;
  fMax?: number;
  fftSize?: number;
}

export function logSpectrogram(x: Float32Array, sr: number, opts: SpectrogramOptions = {}): Spectrogram {
  const columns = Math.max(2, opts.columns ?? 1200);
  const rows = Math.max(2, opts.rows ?? 320);
  const fMax = Math.min(opts.fMax ?? 12000, sr / 2);
  const fMin = Math.min(opts.fMin ?? 30, fMax / 2);
  // 4096 at 22 kHz: 5.4 Hz bins, fine enough to split a 55 Hz drone's harmonics
  const n = opts.fftSize ?? (sr >= 16000 ? 4096 : 2048);
  const rowHz = (row: number): number => fMax * Math.pow(fMin / fMax, row / (rows - 1));
  const span = Math.max(0, x.length - n);
  const columnStart = (col: number): number => Math.round((col * span) / (columns - 1));
  const columnSeconds = (col: number): number => (columnStart(col) + n / 2) / sr;

  const win = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const winSum = win.reduce((a, b) => a + b, 0);
  const norm = 1 / ((winSum / 2) * (winSum / 2)); // a full-scale sine's peak bin → 1
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const power = new Float64Array(n / 2 + 1);
  const db = new Float32Array(rows * columns);
  // which bins each row covers: between the geometric midpoints to its neighbours
  const lo = Float64Array.from({ length: rows }, (_, r) => (rowHz(r + 0.5) * n) / sr);
  const hi = Float64Array.from({ length: rows }, (_, r) => (rowHz(r - 0.5) * n) / sr);

  for (let c = 0; c < columns; c++) {
    const start = columnStart(c);
    for (let i = 0; i < n; i++) {
      re[i] = (x[start + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let k = 0; k <= n / 2; k++) power[k] = (re[k] * re[k] + im[k] * im[k]) * norm;
    for (let r = 0; r < rows; r++) {
      let p: number;
      const k0 = Math.ceil(lo[r]);
      const k1 = Math.min(n / 2, Math.floor(hi[r]));
      if (k1 >= k0) {
        // several bins in this row: the strongest, so harmonics stay crisp
        p = 0;
        for (let k = k0; k <= k1; k++) p = Math.max(p, power[k]);
      } else {
        // a row narrower than a bin (the bass): interpolate at its frequency
        const kf = Math.min(n / 2 - 1, (rowHz(r) * n) / sr);
        const k = Math.floor(kf);
        p = power[k] + (power[k + 1] - power[k]) * (kf - k);
      }
      db[r * columns + c] = 10 * Math.log10(p + 1e-20);
    }
  }

  const loudness = new Float32Array(columns);
  const half = Math.round(0.2 * sr);
  for (let c = 0; c < columns; c++) {
    const mid = columnStart(c) + n / 2;
    const a = Math.max(0, mid - half);
    const b = Math.min(x.length, mid + half);
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    loudness[c] = 10 * Math.log10(s / Math.max(1, b - a) + 1e-20);
  }
  return { columns, rows, db, loudness, rowHz, columnSeconds };
}
