// Pure emulation of the browser's AnalyserNode (as configured in
// audio/engine.ts: fftSize 2048, smoothingTimeConstant 0.5, default
// min/max dB −100/−30) over an offline signal, frame by frame at a given
// display frame rate. Lets unit tests and scripts run the exact feature /
// onset pipeline of the live app on rendered audio.
import { fft } from '../analysis/fft';

export interface AnalyserFrame {
  t: number;              // seconds (end of the analysis window)
  timeDomain: Float32Array;
  bytes: Uint8Array;      // getByteFrequencyData equivalent
}

export interface AnalyserOptions {
  fps?: number;
  fftSize?: number;
  smoothing?: number;
  minDb?: number;
  maxDb?: number;
}

export function* simulateAnalyser(samples: Float32Array, sr: number, opts: AnalyserOptions = {}): Generator<AnalyserFrame> {
  const fps = opts.fps ?? 60;
  const size = opts.fftSize ?? 2048;
  const smoothing = opts.smoothing ?? 0.5;
  const minDb = opts.minDb ?? -100;
  const maxDb = opts.maxDb ?? -30;
  const half = size / 2;
  // Blackman window, as specified for AnalyserNode
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const a = (2 * Math.PI * i) / size;
    win[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
  }
  const smooth = new Float64Array(half);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const hop = sr / fps;
  for (let k = 1; ; k++) {
    const end = Math.round(k * hop);
    if (end > samples.length) break;
    const start = end - size;
    const td = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const j = start + i;
      const v = j >= 0 ? samples[j] : 0;
      td[i] = v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    fft(re, im, false);
    const bytes = new Uint8Array(half);
    for (let b = 0; b < half; b++) {
      const mag = Math.hypot(re[b], im[b]) / size;
      smooth[b] = smoothing * smooth[b] + (1 - smoothing) * mag;
      const db = smooth[b] > 0 ? 20 * Math.log10(smooth[b]) : -Infinity;
      const scaled = (255 * (db - minDb)) / (maxDb - minDb);
      bytes[b] = Math.max(0, Math.min(255, Math.floor(scaled)));
    }
    yield { t: end / sr, timeDomain: td, bytes };
  }
}
