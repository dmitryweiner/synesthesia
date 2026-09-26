// Phase continuity: changing a frequency parameter (LFO route, morph step,
// preset switch) must bend the pitch, never jump the waveform. Oscillators
// written as sin(2π·f·t) with absolute t jump by 2π·Δf·t per change — after
// a minute of playing that's an arbitrary phase step on every audio block,
// heard as harsh beating/buzz.
import { detectClicks } from '../src/analysis/clicks';
import { FormulaGenerator } from '../src/dsp/generator';
import type { FormulaId, Params } from '../src/dsp/generator';
import { formulaDefaults } from '../src/schema/audio';
import { mulberry32 } from '../src/dsp/rng';

const SR = 24000;
const BLOCK = 128;

// Whole blocks only: a truncated last block would drop samples between two
// consecutive render() calls and fake a discontinuity at the join.
function render(gen: FormulaGenerator, seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil((SR * seconds) / BLOCK) * BLOCK);
  const buf = new Float32Array(BLOCK);
  for (let i = 0; i < out.length; i += BLOCK) {
    gen.fill(buf);
    out.set(buf.subarray(0, Math.min(BLOCK, out.length - i)), i);
  }
  return out;
}

describe('detectClicks', () => {
  it('a clean sine has none; inserted discontinuities are found at their times', () => {
    const n = SR * 2;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
    expect(detectClicks(x, SR)).toEqual([]);
    const y = Float32Array.from(x);
    for (let i = Math.round(0.5 * SR); i < n; i++) y[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR + 2);
    for (let i = Math.round(1.5 * SR); i < n; i++) y[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR + 4);
    const clicks = detectClicks(y, SR);
    expect(clicks.length).toBe(2);
    expect(clicks[0]).toBeCloseTo(0.5, 1);
    expect(clicks[1]).toBeCloseTo(1.5, 1);
  });

  it('silence and steady noise have none', () => {
    expect(detectClicks(new Float32Array(SR), SR)).toEqual([]);
    const r = mulberry32(3);
    const noise = new Float32Array(SR * 2).map(() => (r() * 2 - 1) * 0.2);
    expect(detectClicks(noise, SR)).toEqual([]);
  });
});

// Formula → its frequency-like params (the ones LFOs and morphs bend).
const TONAL: readonly [FormulaId, readonly string[], Params?][] = [
  ['fm', ['fc', 'fm']],
  ['additive', ['fund', 'move', 'N']],
  ['pm', ['f', 'f2pm']],
  ['beats', ['fbeat', 'df']],
  ['dist', ['fd']],
  ['quasi', ['fq', 'wq']],
  ['logistic', ['base']],
  ['shepard', ['shepBase']],
  ['bell', ['bellF0'], { bellPeriod: 20, bellDecay: 8 }],
  ['risset', ['rissF0'], { rissPeriod: 20, rissDecay: 12 }],
  ['bowl', ['bowlF', 'bowlBeat']],
];

/** HF roughness: RMS of the 2nd difference over RMS of the 1st — amplitude-free. */
function roughness(x: Float32Array): number {
  let d1 = 0;
  let d2 = 0;
  for (let i = 2; i < x.length; i++) {
    const a = x[i] - x[i - 1];
    const b = x[i] - 2 * x[i - 1] + x[i - 2];
    d1 += a * a;
    d2 += b * b;
  }
  return Math.sqrt(d2 / Math.max(1e-30, d1));
}

describe('oscillators stay phase-continuous under modulation, long after start', () => {
  // A slow, shallow LFO on the frequency params must not make the sound any
  // rougher than the same generator without it. Phase jumps on every audio
  // block (the sin(2π·f·t) bug) spray broadband energy — measured here as
  // the HF roughness ratio, which the median-relative click detector can't
  // see when the "clicks" are on every block.
  it.each(TONAL.map((t) => [t[0], t] as const))('%s', (_id, [id, params, extra]) => {
    const base: Params = { ...formulaDefaults(id), ...(extra ?? {}), gain: 0.3 };
    const plain = new FormulaGenerator(id, SR, base, mulberry32(7));
    const modded = new FormulaGenerator(id, SR, base, mulberry32(7));
    const ranges: Record<string, readonly [number, number]> = {};
    for (const p of params) ranges[p] = [base[p] * 0.5, base[p] * 2];
    modded.setMod(
      [{ shape: 'sine', rate: 0.5, phase: 0 }],
      params.map((p) => ({ src: 0, target: id, param: p, depth: 0.05, exp: true })),
      ranges,
    );
    render(plain, 60); // let absolute time grow: the bug scales with t
    render(modded, 60);
    const r0 = roughness(render(plain, 3));
    const r1 = roughness(render(modded, 3));
    expect(r1 / r0, `${id}: roughness ×${(r1 / r0).toFixed(2)} at 60–63 s`).toBeLessThan(1.3);
  });

  it('a step change of every frequency param (preset switch) does not click', () => {
    for (const [id, params, extra] of TONAL) {
      if (id === 'bell' || id === 'risset') continue; // struck: covered above
      const base: Params = { ...formulaDefaults(id), ...(extra ?? {}), gain: 0.3 };
      const gen = new FormulaGenerator(id, SR, base, mulberry32(8));
      render(gen, 30);
      const before = render(gen, 1);
      const stepped: Params = {};
      for (const p of params) stepped[p] = base[p] * 1.37;
      gen.set(stepped);
      const after = render(gen, 1);
      const joined = new Float32Array(before.length + after.length);
      joined.set(before);
      joined.set(after, before.length);
      expect(detectClicks(joined, SR), `${id}: click at the step`).toEqual([]);
    }
  });
});

describe('discrete-ish params cross over smoothly', () => {
  it('additive: the harmonic count N stepping 12 → 13 → 11 fades harmonics in/out (no click)', () => {
    const base: Params = { ...formulaDefaults('additive'), gain: 0.4, N: 12, fund: 200 };
    const gen = new FormulaGenerator('additive', SR, base, mulberry32(9));
    render(gen, 5);
    const parts = [render(gen, 0.5)];
    gen.set({ N: 13 });
    parts.push(render(gen, 0.5));
    gen.set({ N: 11 });
    parts.push(render(gen, 0.5));
    const joined = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let off = 0;
    for (const p of parts) { joined.set(p, off); off += p.length; }
    expect(detectClicks(joined, SR)).toEqual([]);
  });

  it('additive: constant integer N sounds exactly as before (fractional weighting is a no-op)', () => {
    const a = new FormulaGenerator('additive', SR, { N: 7, fund: 110 }, mulberry32(1));
    const x = render(a, 0.2);
    // reference: plain harmonic sum with the same accumulated phases
    let ph1 = 0;
    let ph3 = 0;
    const w = (2 * Math.PI) / SR;
    for (let i = 0; i < 200; i++) {
      let s = 0;
      for (let k = 1; k <= 7; k++) s += (1 / k) * Math.sin(ph3 + k) * Math.sin(k * ph1);
      expect(x[i]).toBeCloseTo((s / Math.log2(8)) * 0.2, 6); // DEFAULT gain 0.2 (not in params)
      ph1 += w * 110;
      ph3 += w * 0.35;
    }
  });
});
