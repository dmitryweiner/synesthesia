// Pure audio feature extraction from AnalyserNode buffers: loudness (RMS),
// its swell against the recent average, brightness (spectral centroid),
// bass/mid/treble band levels and onsets (half-wave-rectified spectral
// flux). FeatureTracker normalizes them with a little smoothing so the
// visual coupling (src/coupling.ts, src/visualFx.ts) sees stable signals;
// OnsetDetector turns the onset envelope into discrete hits.

export interface AudioFeatures {
  loudness: number;   // 0..1, smoothed RMS
  swell: number;      // -1..1, loudness relative to its ~4 s average (0 = steady)
  brightness: number; // 0..1, spectral centroid on a log-frequency scale
  onset: number;      // 0..1, decaying spike on spectral energy jumps
  low: number;        // 0..1, 30–250 Hz band level
  mid: number;        // 0..1, 250–2000 Hz
  high: number;       // 0..1, 2–10 kHz
}

export const SILENT_FEATURES: Readonly<AudioFeatures> = { loudness: 0, brightness: 0, onset: 0, swell: 0, low: 0, mid: 0, high: 0 };

export function rmsOf(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** Magnitude-weighted mean frequency (Hz) of a byte spectrum; 0 when empty. */
export function spectralCentroid(bins: Uint8Array, sampleRate: number): number {
  const hzPerBin = sampleRate / 2 / bins.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < bins.length; i++) {
    num += i * hzPerBin * bins[i];
    den += bins[i];
  }
  return den > 0 ? num / den : 0;
}

/** Sum of positive bin increases between two byte spectra, normalized per bin. */
export function spectralFlux(prev: Uint8Array, cur: Uint8Array): number {
  const n = Math.min(prev.length, cur.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = cur[i] - prev[i];
    if (d > 0) sum += d;
  }
  return sum / (n * 255);
}

// Smoothing is time-based (τ in seconds) so a 30 fps phone or a slow
// headless browser reacts as fast as a 60 fps desktop; the τ values equal
// the former per-frame fractions at 60 fps (0.5, 0.08, 0.2, 0.25).
const LOUD_ATTACK_TAU = 0.024;
const LOUD_RELEASE_TAU = 0.2;
const BRIGHT_TAU = 0.075;
const BAND_TAU = 0.058;
const ONSET_DECAY = 0.85;  // per 1/60 s
// Onsets: positive rise of 20 log-spaced band levels (60 Hz–10 kHz, byte dB
// units), against an adaptive threshold (recent mean + ONSET_K · recent
// deviation). Log bands keep a narrow drop or bell partial from drowning in
// 1000 linear bins; the adaptive part keeps steady noise/drones quiet and
// still catches attacks smeared by reverb (tuned on real-graph renders of
// every preset — see PLAN.md decision 8).
const ONSET_BANDS = 20;
const ONSET_K = 3;
const ONSET_MIN_RISE = 1;  // bytes (≈0.3 dB) above the threshold
const ONSET_SCALE = 6;     // bytes above threshold → full strength
const ONSET_TAU = 1;       // s — "recent" for the adaptive threshold
const LOUD_GAIN = 2.2;     // RMS 0.45 → loudness 1
const SWELL_TAU = 4;       // s — the "recent average" loudness is compared against
const SWELL_GAIN = 10;     // loudness delta 0.1 → swell ≈ 0.76
// Byte spectra are dB-scaled (analyser min/max dB → 0..255); a band's mean
// byte level maps floor..floor+span → 0..1.
const BAND_FLOOR = 0.2;
const BAND_SPAN = 0.55;
const BANDS: readonly (readonly [number, number])[] = [[30, 250], [250, 2000], [2000, 10000]];

function bandLevel(bins: Uint8Array, hzPerBin: number, lo: number, hi: number): number {
  let sum = 0;
  let n = 0;
  const i0 = Math.max(0, Math.floor(lo / hzPerBin));
  const i1 = Math.min(bins.length, Math.ceil(hi / hzPerBin));
  for (let i = i0; i < i1; i++) { sum += bins[i]; n++; }
  if (n === 0) return 0;
  return Math.max(0, Math.min(1, (sum / n / 255 - BAND_FLOOR) / BAND_SPAN));
}

export class FeatureTracker {
  private readonly sampleRate: number;
  private prevBands: Float64Array | null = null;
  private riseAvg = 0;
  private riseDev = 0;
  private loud = 0;
  private slowLoud = -1; // <0: not initialized yet
  private bright = 0;
  private onset = 0;
  private bands = [0, 0, 0];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  /** One analysis frame; dt (s) drives the time-based swell average. */
  update(timeDomain: Float32Array, bins: Uint8Array, dt = 1 / 60): AudioFeatures {
    const ease = (tau: number) => 1 - Math.exp(-dt / tau);
    const rms = Math.min(1, rmsOf(timeDomain) * LOUD_GAIN);
    this.loud += (rms - this.loud) * ease(rms > this.loud ? LOUD_ATTACK_TAU : LOUD_RELEASE_TAU);

    const centroid = spectralCentroid(bins, this.sampleRate);
    // log scale between 50 Hz and 8 kHz → 0..1
    const b = centroid > 0 ? Math.log(centroid / 50) / Math.log(8000 / 50) : 0;
    const bClamped = Math.max(0, Math.min(1, b));
    this.bright += (bClamped - this.bright) * ease(BRIGHT_TAU);

    const hzPerBin = this.sampleRate / 2 / Math.max(1, bins.length);
    const levels = new Float64Array(ONSET_BANDS);
    for (let b = 0; b < ONSET_BANDS; b++) {
      const lo = 60 * Math.pow(10000 / 60, b / ONSET_BANDS);
      const hi = 60 * Math.pow(10000 / 60, (b + 1) / ONSET_BANDS);
      const i0 = Math.min(bins.length - 1, Math.floor(lo / hzPerBin));
      const i1 = Math.min(bins.length, Math.max(i0 + 1, Math.ceil(hi / hzPerBin)));
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += bins[i];
      levels[b] = sum / (i1 - i0);
    }
    let rise = 0;
    if (this.prevBands) for (let b = 0; b < ONSET_BANDS; b++) rise += Math.max(0, levels[b] - this.prevBands[b]);
    rise /= ONSET_BANDS;
    this.prevBands = levels;
    const strength = Math.max(0, Math.min(1, (rise - this.riseAvg - ONSET_K * this.riseDev - ONSET_MIN_RISE) / ONSET_SCALE));
    const a = Math.min(1, dt / ONSET_TAU);
    this.riseAvg += (rise - this.riseAvg) * a;
    this.riseDev += (Math.abs(rise - this.riseAvg) - this.riseDev) * a;
    this.onset = Math.max(strength, this.onset * Math.pow(ONSET_DECAY, dt * 60));

    if (this.slowLoud < 0) this.slowLoud = this.loud;
    this.slowLoud += (this.loud - this.slowLoud) * Math.min(1, dt / SWELL_TAU);
    const swell = Math.tanh((this.loud - this.slowLoud) * SWELL_GAIN);

    for (let b = 0; b < BANDS.length; b++) {
      const lvl = bandLevel(bins, hzPerBin, BANDS[b][0], BANDS[b][1]);
      this.bands[b] += (lvl - this.bands[b]) * ease(BAND_TAU);
    }

    return {
      loudness: this.loud, swell, brightness: this.bright, onset: this.onset,
      low: this.bands[0], mid: this.bands[1], high: this.bands[2],
    };
  }
}

const ONSET_ON = 0.35;     // envelope must rise above this to count as a hit…
const ONSET_REARM = 0.2;   // …and fall below this before the next one
const ONSET_REFRACTORY = 0.12; // s

/** Turns the decaying onset envelope into discrete hits (rising edges). */
export class OnsetDetector {
  private armed = true;
  private last = -Infinity;

  /** Returns true once per hit. t is in seconds. */
  update(onset: number, t: number): boolean {
    if (!this.armed) {
      if (onset < ONSET_REARM) this.armed = true;
      return false;
    }
    if (onset >= ONSET_ON && t - this.last >= ONSET_REFRACTORY) {
      this.armed = false;
      this.last = t;
      return true;
    }
    return false;
  }
}
