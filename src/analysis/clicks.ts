// Click detection (pure), after formula-synth's scripts/rec.mjs: a click is
// a short frame whose high-frequency energy (RMS of the second difference ≈
// a high-pass) jumps far above the signal's typical level. Relative to the
// median, so steady noise or bright timbres don't count — only sudden
// discontinuities do.

const FRAME_SECONDS = 0.005;
const RATIO = 6;          // frame HF energy vs the median frame
const ABS_FLOOR = 0.002;  // ignore anything quieter than this
const MIN_GAP = 0.04;     // s — one click per 40 ms at most

/** Times (s) of detected clicks. */
export function detectClicks(x: Float32Array, sr: number): number[] {
  const frame = Math.max(4, Math.round(sr * FRAME_SECONDS));
  const nf = Math.floor(x.length / frame);
  if (nf < 3) return [];
  const hf = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    let e = 0;
    for (let i = 2; i < frame; i++) {
      const j = f * frame + i;
      const dd = x[j] - 2 * x[j - 1] + x[j - 2];
      e += dd * dd;
    }
    // also the two samples straddling the previous frame boundary
    if (f > 0) {
      for (let i = 0; i < 2; i++) {
        const j = f * frame + i;
        const dd = x[j] - 2 * x[j - 1] + x[j - 2];
        e += dd * dd;
      }
    }
    hf[f] = Math.sqrt(e / frame);
  }
  const med = Float64Array.from(hf).sort()[Math.floor(nf / 2)] || 1e-12;
  const times: number[] = [];
  let last = -Infinity;
  for (let f = 1; f < nf; f++) {
    const t = (f * frame) / sr;
    if (hf[f] > med * RATIO && hf[f] > ABS_FLOOR && t - last > MIN_GAP) {
      times.push(+t.toFixed(3));
      last = t;
    }
  }
  return times;
}
