// "Fractality" of a sound (pure). Earlier projects found that people like
// sounds with fractal structure: fluctuations that look alike across time
// scales. Four measures, all computed from one STFT (~46 ms frames, 20 ms
// hop); the 1/f fits use only fluctuations slower than 5 Hz — faster ones
// are smeared by the analysis window and aren't "musical" anyway:
//   envBeta      — β of the loudness envelope's 1/f^β spectrum (pink = 1)
//   centroidBeta — β of the spectral-centroid (timbre/pitch) contour
//   envHiguchi   — Higuchi fractal dimension of the loudness envelope
//   boxDim       — box-counting dimension of the salient spectrogram cells
//                  (the "patterns on the waterfall" formula-synth tuned by)
// fractalScore folds them into [0,1]. Music tends to show β≈1 in both
// loudness and pitch fluctuations (Voss & Clarke, 1975); white (β=0)
// sounds restless, brown (β=2) sounds static.
import { fft, nextPow2 } from './fft';

export interface SoundMetrics {
  silent: boolean;
  loudness: number;      // dBFS of the overall RMS
  envBeta: number;
  centroidBeta: number;
  envHiguchi: number;
  boxDim: number;
}

export interface SoundAnalysis extends SoundMetrics {
  score: number;
}

const FRAME_SECONDS = 0.046;
const HOP_SECONDS = 0.02;
const FIT_MAX_HZ = 5;
const BANDS = 64;
const SILENCE_DB = -60;
// Contours flatter than this carry no fluctuation structure at all (a
// steady tone's envelope ripples by ~1e-3 dB from frame alignment alone).
const STATIC_ENV_DB = 0.5;
const STATIC_CENTROID_OCT = 0.02;

function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}

/** Least-squares slope of y over x. */
function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  return den > 0 ? num / den : NaN;
}

function std(x: readonly number[]): number {
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return x.length ? Math.sqrt(s / x.length) : 0;
}

/**
 * β of a series' 1/f^β power spectrum: linear detrend, Hann window, FFT,
 * power averaged in log-spaced frequency bins, log-log regression over
 * [bin 2, maxFrac·Nyquist]. NaN for constant or too-short series.
 */
export function spectralSlope(series: ArrayLike<number>, maxFrac = 1): number {
  const n = series.length;
  if (n < 64) return NaN;
  // detrend (remove the best-fit line — a drift would otherwise read as β≈2)
  const idx = Array.from({ length: n }, (_, i) => i);
  const ys = Array.from({ length: n }, (_, i) => series[i]);
  const b = slope(idx, ys);
  const a = mean(ys) - b * (n - 1) / 2;
  const size = nextPow2(n);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const v = (ys[i] - (a + b * i)) * w;
    re[i] = v;
    energy += v * v;
  }
  if (!(energy > 1e-18)) return NaN;
  fft(re, im, false);
  const half = size / 2;
  // skip the lowest bins (window leakage + detrend) — fit from bin 2 up
  const top = Math.max(8, Math.floor(half * Math.min(1, maxFrac)));
  const lo = Math.log(2);
  const hi = Math.log(top);
  const nb = Math.max(8, Math.min(24, Math.round((hi - lo) * 4)));
  const xs: number[] = [];
  const yl: number[] = [];
  for (let k = 0; k < nb; k++) {
    const f0 = Math.floor(Math.exp(lo + ((hi - lo) * k) / nb));
    const f1 = Math.max(f0 + 1, Math.floor(Math.exp(lo + ((hi - lo) * (k + 1)) / nb)));
    let p = 0;
    let c = 0;
    for (let f = f0; f < f1 && f < top; f++) { p += re[f] * re[f] + im[f] * im[f]; c++; }
    if (c === 0 || p <= 0) continue;
    xs.push(Math.log((f0 + f1 - 1) / 2));
    yl.push(Math.log(p / c));
  }
  const s = slope(xs, yl);
  return Number.isFinite(s) ? -s : NaN;
}

/** Higuchi fractal dimension of a series (1 = smooth curve, 2 = white noise). */
export function higuchiFD(series: ArrayLike<number>, kMax = 16): number {
  const n = series.length;
  if (n < kMax * 4) return NaN;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 1; k <= kMax; k++) {
    let lk = 0;
    for (let m = 0; m < k; m++) {
      const steps = Math.floor((n - 1 - m) / k);
      if (steps < 1) continue;
      let len = 0;
      for (let i = 1; i <= steps; i++) len += Math.abs(series[m + i * k] - series[m + (i - 1) * k]);
      lk += (len * (n - 1)) / (steps * k) / k;
    }
    lk /= k;
    if (lk <= 0) return NaN;
    xs.push(Math.log(1 / k));
    ys.push(Math.log(lk));
  }
  return slope(xs, ys);
}

/**
 * Box-counting dimension of a binary image (row-major, width×height), box
 * sizes 1,2,4,… up to the shorter side / 4. 0 for an empty image.
 */
export function boxCountDimension(img: Uint8Array, width: number, height: number): number {
  const xs: number[] = [];
  const ys: number[] = [];
  const maxBox = Math.max(1, Math.floor(Math.min(width, height) / 4));
  for (let s = 1; s <= maxBox; s *= 2) {
    let count = 0;
    for (let by = 0; by < height; by += s) {
      for (let bx = 0; bx < width; bx += s) {
        let hit = false;
        for (let y = by; y < Math.min(height, by + s) && !hit; y++) {
          const row = y * width;
          for (let x = bx; x < Math.min(width, bx + s); x++) {
            if (img[row + x]) { hit = true; break; }
          }
        }
        if (hit) count++;
      }
    }
    if (count === 0) return 0;
    xs.push(Math.log(1 / s));
    ys.push(Math.log(count));
  }
  const d = slope(xs, ys);
  return Number.isFinite(d) ? d : 0;
}

/** Gaussian preference: 1 at target, falls off with width; 0 for NaN. */
export function preference(v: number, target: number, width: number): number {
  if (!Number.isFinite(v)) return 0;
  const z = (v - target) / width;
  return Math.exp(-z * z);
}

/** Folds the metrics into [0,1]: 1/f in loudness and timbre, structured (not empty, not solid) spectrogram. */
export function fractalScore(m: SoundMetrics): number {
  if (m.silent) return 0;
  const env = preference(m.envBeta, 1, 0.7);
  const cen = preference(m.centroidBeta, 1, 0.7);
  const box = preference(m.boxDim, 1.6, 0.3);
  return (2 * env + 2 * cen + box) / 5;
}

interface Stft {
  env: number[];       // frame RMS (linear)
  centroid: number[];  // Hz; NaN for silent frames
  bands: Float64Array; // frames × BANDS, dB
  frames: number;
}

function stft(signal: Float32Array, sr: number): Stft {
  const FRAME = Math.pow(2, Math.max(6, Math.round(Math.log2(sr * FRAME_SECONDS))));
  const hop = Math.max(1, Math.round(sr * HOP_SECONDS));
  const frames = Math.max(0, Math.floor((signal.length - FRAME) / hop) + 1);
  const env: number[] = [];
  const centroid: number[] = [];
  const bands = new Float64Array(frames * BANDS);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const hann = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const half = FRAME / 2;
  const hzPerBin = sr / FRAME;
  // log-spaced band edges from 50 Hz to Nyquist
  const fLo = 50;
  const fHi = sr / 2;
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(Math.min(half, Math.max(1, Math.round((fLo * Math.pow(fHi / fLo, b / BANDS)) / hzPerBin))));

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let sq = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = signal[off + i];
      sq += v * v;
      re[i] = v * hann[i];
      im[i] = 0;
    }
    env.push(Math.sqrt(sq / FRAME));
    fft(re, im, false);
    let num = 0;
    let den = 0;
    for (let k = 1; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      num += k * hzPerBin * mag;
      den += mag;
    }
    centroid.push(den > 1e-9 ? num / den : NaN);
    for (let b = 0; b < BANDS; b++) {
      let p = 0;
      const k0 = edges[b];
      const k1 = Math.max(k0 + 1, edges[b + 1]);
      for (let k = k0; k < k1 && k < half; k++) p += re[k] * re[k] + im[k] * im[k];
      bands[f * BANDS + b] = 10 * Math.log10(p / (k1 - k0) + 1e-12);
    }
  }
  return { env, centroid, bands, frames };
}

/** Full analysis of a mono signal. Needs a few seconds to be meaningful (20+ s ideal). */
export function analyzeSound(signal: Float32Array, sr: number): SoundAnalysis {
  let sq = 0;
  for (let i = 0; i < signal.length; i++) sq += signal[i] * signal[i];
  const rms = signal.length ? Math.sqrt(sq / signal.length) : 0;
  const loudness = 20 * Math.log10(rms + 1e-12);
  const silent = loudness < SILENCE_DB;
  if (silent) {
    return { silent, loudness, envBeta: NaN, centroidBeta: NaN, envHiguchi: NaN, boxDim: 0, score: 0 };
  }
  const s = stft(signal, sr);

  // loudness contour in dB (perceptual), floored so silent gaps don't dominate
  const envDb = s.env.map((v) => Math.max(SILENCE_DB, 20 * Math.log10(v + 1e-12)));
  // timbre contour in octaves; silent frames carry the last known value
  let last = NaN;
  const cen: number[] = [];
  for (const c of s.centroid) {
    if (Number.isFinite(c) && c > 0) last = Math.log2(c);
    cen.push(Number.isFinite(last) ? last : 0);
  }

  // salient cells: the loudest 20% of the spectrogram
  const sorted = Float64Array.from(s.bands).sort();
  const thr = sorted[Math.floor(sorted.length * 0.8)] ?? 0;
  const img = new Uint8Array(s.bands.length);
  for (let i = 0; i < s.bands.length; i++) img[i] = s.bands[i] > thr ? 1 : 0;

  const fitFrac = FIT_MAX_HZ / (0.5 / HOP_SECONDS);
  const metrics: SoundMetrics = {
    silent,
    loudness,
    envBeta: std(envDb) < STATIC_ENV_DB ? NaN : spectralSlope(envDb, fitFrac),
    centroidBeta: std(cen) < STATIC_CENTROID_OCT ? NaN : spectralSlope(cen, fitFrac),
    envHiguchi: higuchiFD(envDb),
    // image is BANDS wide (frequency) × frames tall (time)
    boxDim: boxCountDimension(img, BANDS, s.frames),
  };
  return { ...metrics, score: fractalScore(metrics) };
}
