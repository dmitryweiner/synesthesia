// PLAN.md #20: the tanpura, a drone that breathes in plucks. Four
// Karplus–Strong strings tuned Pa–Sa–Sa–Sa (3/2, 2, 2, 1 × the low Sa),
// plucked in a slow cycle, with the jawari buzz. It must stay on its grid,
// pluck four times a cycle, never break the band (dropout ≤ 6 dB) and stay
// bounded.
import { FormulaGenerator } from '../src/dsp/generator';
import type { Params } from '../src/dsp/generator';
import { mulberry32 } from '../src/dsp/rng';
import { fft } from '../src/analysis/fft';
import { detectClicks } from '../src/analysis/clicks';

const SR = 22050;
const BLOCK = 128;

function render(params: Params, seconds: number, seed = 1): Float32Array {
  const gen = new FormulaGenerator('tanpura', SR, { gain: 1, ...params }, mulberry32(seed));
  const out = new Float32Array(Math.round((seconds * SR) / BLOCK) * BLOCK);
  for (let i = 0; i < out.length; i += BLOCK) gen.fill(out.subarray(i, i + BLOCK));
  return out;
}

/** Power spectrum (Hann) of x[from, from + 2^k). */
function spectrum(x: Float32Array, from: number, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im, false);
  return Float64Array.from({ length: n / 2 }, (_, k) => re[k] * re[k] + im[k] * im[k]);
}

function rmsFrames(x: Float32Array, frame: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + frame <= x.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) s += x[j] * x[j];
    out.push(Math.sqrt(s / frame));
  }
  return out;
}

describe('tanpura', () => {
  it('sounds Sa, Pa and the upper Sa, in tune', () => {
    const x = render({ tanSa: 55, tanCycle: 4 }, 12);
    const n = 1 << 17; // 5.9 s, 0.17 Hz bins
    const p = spectrum(x, x.length - n, n);
    const median = [...p.slice(20, 4000)].sort((a, b) => a - b)[1990];
    for (const target of [55, 82.5, 110]) {
      const k0 = Math.floor((target * 0.95 * n) / SR);
      const k1 = Math.ceil((target * 1.05 * n) / SR);
      let best = k0;
      for (let k = k0; k <= k1; k++) if (p[k] > p[best]) best = k;
      const hz = (best * SR) / n;
      expect(Math.abs(1200 * Math.log2(hz / target)), `${target} Hz`).toBeLessThan(12); // cents
      expect(10 * Math.log10(p[best] / median), `${target} Hz above the floor`).toBeGreaterThan(20);
    }
  });

  it('plucks four strings a cycle', () => {
    // a fresh pluck is bright and KS damps the highs fast, so plucks show up
    // as rises of the first difference's energy
    const cycle = 3;
    const x = render({ tanCycle: cycle }, 24);
    const d = Float32Array.from(x, (v, i) => (i ? v - x[i - 1] : 0));
    const frames = rmsFrames(d, Math.round(0.01 * SR));
    let hits = 0;
    let last = -100;
    for (let i = 10; i < frames.length; i++) {
      const before = frames.slice(i - 10, i).reduce((a, b) => a + b, 0) / 10;
      if (frames[i] > 2 * before && i - last > 15) {
        hits++;
        last = i;
      }
    }
    expect(hits).toBeGreaterThanOrEqual(28); // 32 plucks in 24 s
    expect(hits).toBeLessThanOrEqual(34);
  });

  it('never breaks the band between plucks (dropout ≤ 6 dB)', () => {
    const x = render({}, 40); // the formula's defaults
    const db = rmsFrames(x.subarray(10 * SR), Math.round(0.4 * SR)).map((r) => 20 * Math.log10(r + 1e-12)).sort((a, b) => a - b);
    const median = db[Math.floor(db.length / 2)];
    const p5 = db[Math.floor(db.length * 0.05)];
    expect(median - p5).toBeLessThan(6);
  });

  it('jawari adds the buzz: more energy in the high partials', () => {
    const hfShare = (x: Float32Array): number => {
      const n = 1 << 16;
      const p = spectrum(x, x.length - n, n);
      const cut = Math.round((1500 * n) / SR);
      let hi = 0, all = 0;
      for (let k = 1; k < p.length; k++) {
        all += p[k];
        if (k >= cut) hi += p[k];
      }
      return hi / all;
    };
    const dry = hfShare(render({ tanJawari: 0 }, 8));
    const buzz = hfShare(render({ tanJawari: 1 }, 8));
    expect(buzz).toBeGreaterThan(2 * dry);
  });

  it('plucks are attacks, not clicks', () => {
    // A one-period noise burst through one pole was a short broadband hit:
    // a full-band line on the --png waterfall, 302 "clicks" in 30 s of the
    // preset (analyze.mjs --switch) and ~65 here. A three-period, two-pole
    // pluck under the jawari's sustained buzz: none. (Without jawari the
    // sustain is dark, and the median-relative detector still flags each
    // attack, as it does for any plucked or struck preset.)
    for (const tanJawari of [0.5, 1]) {
      const x = render({ tanJawari, tanCycle: 4 }, 30);
      expect(detectClicks(x.subarray(SR), SR).length, `jawari ${tanJawari}`).toBeLessThanOrEqual(3);
    }
  });

  it('stays bounded at the loudest settings', () => {
    const x = render({ tanJawari: 1, tanSustain: 30, tanCycle: 2, tanBright: 1, tanSa: 40 }, 60);
    let peak = 0;
    let finite = true;
    for (const v of x) {
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
    }
    expect(finite).toBe(true);
    expect(peak).toBeLessThan(1);
    expect(peak).toBeGreaterThan(0.1);
  });
});
