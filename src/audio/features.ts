// Pure audio feature extraction from AnalyserNode buffers: loudness (RMS),
// brightness (spectral centroid) and onsets (half-wave-rectified spectral
// flux). FeatureTracker normalizes them to [0,1] with a little smoothing so
// the visual coupling (src/coupling.ts) sees stable, frame-rate signals.

export interface AudioFeatures {
  loudness: number;   // 0..1, smoothed RMS
  brightness: number; // 0..1, spectral centroid on a log-frequency scale
  onset: number;      // 0..1, decaying spike on spectral energy jumps
}

export const SILENT_FEATURES: Readonly<AudioFeatures> = { loudness: 0, brightness: 0, onset: 0 };

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

const LOUD_ATTACK = 0.5;   // fraction per update toward a louder value
const LOUD_RELEASE = 0.08; // fraction per update toward a quieter value
const BRIGHT_SMOOTH = 0.2;
const ONSET_DECAY = 0.85;
const ONSET_GAIN = 12;     // flux → onset scale (flux is a small number)
const LOUD_GAIN = 2.2;     // RMS 0.45 → loudness 1

export class FeatureTracker {
  private readonly sampleRate: number;
  private prevBins: Uint8Array | null = null;
  private loud = 0;
  private bright = 0;
  private onset = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  update(timeDomain: Float32Array, bins: Uint8Array): AudioFeatures {
    const rms = Math.min(1, rmsOf(timeDomain) * LOUD_GAIN);
    const k = rms > this.loud ? LOUD_ATTACK : LOUD_RELEASE;
    this.loud += (rms - this.loud) * k;

    const centroid = spectralCentroid(bins, this.sampleRate);
    // log scale between 50 Hz and 8 kHz → 0..1
    const b = centroid > 0 ? Math.log(centroid / 50) / Math.log(8000 / 50) : 0;
    const bClamped = Math.max(0, Math.min(1, b));
    this.bright += (bClamped - this.bright) * BRIGHT_SMOOTH;

    const flux = this.prevBins ? spectralFlux(this.prevBins, bins) : 0;
    this.prevBins = Uint8Array.from(bins);
    const spike = Math.min(1, flux * ONSET_GAIN);
    this.onset = Math.max(spike, this.onset * ONSET_DECAY);

    return { loudness: this.loud, brightness: this.bright, onset: this.onset };
  }
}
