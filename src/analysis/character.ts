// "Character" of a sound (pure): what kind of sound it is, next to
// fractal.ts's "how 1/f are its fluctuations". The built-in presets people
// liked most (formula-synth's FX-mod family: Fractal garden, Polivoks,
// Silver lace, Harmonic loom, Space journey) share a profile these numbers
// make visible: a band that never breaks, heavy low end, one harmonic grid,
// slow change. A new preset can be checked against that profile instead of
// by ear alone (there are no speakers on the dev box).
//   dropout     — median minus 5th percentile of 400 ms loudness, dB: how
//                 deep the sound falls out (a drone ~3–6, drips/bells 8–12)
//   swing       — 95th minus 5th percentile, dB: how far it breathes
//   lowShare    — energy share below 200 Hz ("weight")
//   harmonicity — share of spectral-peak energy on the best single harmonic
//                 grid (f0 30–400 Hz), mean over frames
//   roughness   — Plomp–Levelt sensory dissonance of the peaks (Sethares'
//                 parametrization), level-independent, mean over frames
//   motion1s / motion10s — RMS change of the 48-band dB spectrum between
//                 frames 1 s / 10 s apart: fast flicker vs slow evolution
import { fft } from './fft';

export interface Character {
  silent: boolean;
  dropout: number;
  swing: number;
  lowShare: number;
  harmonicity: number;
  roughness: number;
  motion1s: number;
  motion10s: number;
}

const SILENCE_DB = -60;
const FLOOR_DB = -100;        // a silent gap reads as 100 dB down, not −240
const SKIP_SECONDS = 1;       // renders start with a fade-in
const WINDOW_SECONDS = 0.4;   // momentary loudness, like EBU's 400 ms
const LOUD_HOP_SECONDS = 0.1;
const FRAME = 4096;           // ~0.19–0.26 s: resolves harmonics of a 30 Hz grid
const SPEC_HOP_SECONDS = 0.25;
const LOW_HZ = 200;
const PEAKS = 40;
const PEAK_FLOOR = 0.01;      // −40 dB below the frame's strongest bin
const PEAK_MAX_HZ = 5000;
const GRID_TOLERANCE = 0.03;  // a peak within 3% of f0 of a multiple is on the grid
const BANDS = 48;
const BAND_LO_HZ = 40;
const BAND_FLOOR_DB = 60;     // spectrogram cells more than this below the max are floored

function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))] ?? NaN;
}

interface Peak { f: number; a: number }

/** Strongest spectral peaks of one magnitude frame, parabolically refined, sorted by frequency. */
function peaksOf(mag: Float64Array, hzPerBin: number): Peak[] {
  let max = 0;
  for (let k = 2; k < mag.length - 1; k++) max = Math.max(max, mag[k]);
  if (!(max > 0)) return [];
  const out: Peak[] = [];
  const kMax = Math.min(mag.length - 2, Math.floor(PEAK_MAX_HZ / hzPerBin));
  for (let k = Math.max(2, Math.floor(30 / hzPerBin)); k <= kMax; k++) {
    if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] > max * PEAK_FLOOR) {
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(mag[k]);
      const c = Math.log(mag[k + 1] + 1e-12);
      const den = a - 2 * b + c;
      const d = den !== 0 ? (0.5 * (a - c)) / den : 0;
      out.push({ f: (k + d) * hzPerBin, a: mag[k] });
    }
  }
  return out.sort((p, q) => q.a - p.a).slice(0, PEAKS).sort((p, q) => p.f - q.f);
}

/** Sethares' dissonance of a peak set, divided by the total amplitude. */
function roughnessOf(peaks: readonly Peak[]): number {
  let r = 0;
  let total = 0;
  for (let i = 0; i < peaks.length; i++) {
    total += peaks[i].a;
    const s = 0.24 / (0.0207 * peaks[i].f + 18.96);
    for (let j = i + 1; j < peaks.length; j++) {
      const x = s * (peaks[j].f - peaks[i].f);
      if (x > 3) break; // the curve is ~0 beyond this, and peaks are sorted
      r += Math.min(peaks[i].a, peaks[j].a) * (Math.exp(-3.51 * x) - Math.exp(-5.75 * x));
    }
  }
  return total > 0 ? r / total : 0;
}

/** Largest share of peak energy that one harmonic grid (f0 30–400 Hz) explains. */
function harmonicityOf(peaks: readonly Peak[]): number {
  let energy = 0;
  for (const p of peaks) energy += p.a * p.a;
  if (!(energy > 0)) return 0;
  let best = 0;
  for (let f0 = 30; f0 <= 400; f0 *= 1.005) {
    let e = 0;
    for (const p of peaks) {
      const h = Math.round(p.f / f0);
      if (h >= 1 && Math.abs(p.f - h * f0) < GRID_TOLERANCE * f0) e += p.a * p.a;
    }
    if (e > best) best = e;
  }
  return best / energy;
}

export function analyzeCharacter(signal: Float32Array, sr: number): Character {
  const skip = Math.min(Math.floor(SKIP_SECONDS * sr), Math.floor(signal.length / 4));
  let sq = 0;
  for (let i = skip; i < signal.length; i++) sq += signal[i] * signal[i];
  const n = signal.length - skip;
  if (n <= FRAME || 10 * Math.log10(sq / n + 1e-24) < SILENCE_DB) {
    return { silent: true, dropout: NaN, swing: NaN, lowShare: NaN, harmonicity: NaN, roughness: NaN, motion1s: NaN, motion10s: NaN };
  }

  // Loudness contour: 400 ms windows every 100 ms.
  const win = Math.floor(WINDOW_SECONDS * sr);
  const loudHop = Math.max(1, Math.floor(LOUD_HOP_SECONDS * sr));
  const loud: number[] = [];
  for (let o = skip; o + win <= signal.length; o += loudHop) {
    let s = 0;
    for (let i = 0; i < win; i++) s += signal[o + i] * signal[o + i];
    loud.push(Math.max(FLOOR_DB, 10 * Math.log10(s / win + 1e-24)));
  }
  const p5 = percentile(loud, 0.05);

  // Spectra: 4096-point frames every 250 ms.
  const hop = Math.max(1, Math.floor(SPEC_HOP_SECONDS * sr));
  const hzPerBin = sr / FRAME;
  const half = FRAME / 2;
  const hann = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const fHi = Math.min(8000, sr / 2);
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(Math.min(half, Math.max(1, Math.round((BAND_LO_HZ * Math.pow(fHi / BAND_LO_HZ, b / BANDS)) / hzPerBin))));
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const mag = new Float64Array(half);
  const specs: Float64Array[] = [];
  let lowE = 0;
  let totE = 0;
  let rough = 0;
  let harm = 0;
  let frames = 0;
  for (let o = skip; o + FRAME <= signal.length; o += hop) {
    for (let i = 0; i < FRAME; i++) { re[i] = signal[o + i] * hann[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k < half; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let k = 1; k < half; k++) {
      const e = mag[k] * mag[k];
      totE += e;
      if (k * hzPerBin < LOW_HZ) lowE += e;
    }
    const band = new Float64Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      const k0 = edges[b];
      const k1 = Math.max(k0 + 1, edges[b + 1]);
      let p = 0;
      for (let k = k0; k < k1 && k < half; k++) p += mag[k] * mag[k];
      band[b] = 10 * Math.log10(p / (k1 - k0) + 1e-24);
    }
    specs.push(band);
    const peaks = peaksOf(mag, hzPerBin);
    rough += roughnessOf(peaks);
    harm += harmonicityOf(peaks);
    frames++;
  }

  // Motion: floor quiet cells (they flicker in dB without being heard),
  // then the RMS difference between spectra a fixed time apart.
  let top = -Infinity;
  for (const s of specs) for (const v of s) top = Math.max(top, v);
  for (const s of specs) for (let b = 0; b < BANDS; b++) s[b] = Math.max(top - BAND_FLOOR_DB, s[b]);
  const motion = (seconds: number): number => {
    const lag = Math.max(1, Math.round(seconds / SPEC_HOP_SECONDS));
    let acc = 0;
    let c = 0;
    for (let t = 0; t + lag < specs.length; t++) {
      let d = 0;
      for (let b = 0; b < BANDS; b++) d += (specs[t + lag][b] - specs[t][b]) ** 2;
      acc += Math.sqrt(d / BANDS);
      c++;
    }
    return c ? acc / c : NaN;
  };

  return {
    silent: false,
    dropout: percentile(loud, 0.5) - p5,
    swing: percentile(loud, 0.95) - p5,
    lowShare: totE > 0 ? lowE / totE : 0,
    harmonicity: frames ? harm / frames : 0,
    roughness: frames ? rough / frames : 0,
    motion1s: motion(1),
    motion10s: motion(10),
  };
}
