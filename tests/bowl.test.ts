// PLAN.md #25: a singing bowl — a breathing background hum. A few
// inharmonic partials (≈ 1 : 2.71 : 5.12 : 8.21), each a slightly detuned
// pair, so every partial beats slowly (higher ones faster) and the hum
// "breathes" without ever falling silent.
import { FormulaGenerator } from '../src/dsp/generator';
import type { Params } from '../src/dsp/generator';
import { mulberry32 } from '../src/dsp/rng';
import { fft } from '../src/analysis/fft';

const SR = 22050;
const BLOCK = 128;
const RATIOS = [1, 2.71, 5.12, 8.21];

function render(params: Params, seconds: number, gen = new FormulaGenerator('bowl', SR, { gain: 1, ...params }, mulberry32(1))): Float32Array {
  const out = new Float32Array(Math.round((seconds * SR) / BLOCK) * BLOCK);
  for (let i = 0; i < out.length; i += BLOCK) gen.fill(out.subarray(i, i + BLOCK));
  return out;
}

function spectrum(x: Float32Array, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[x.length - n + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im, false);
  return Float64Array.from({ length: n / 2 }, (_, k) => re[k] * re[k] + im[k] * im[k]);
}

/** Envelope of one partial: band-limited by a single-bin DFT sliding over 50 ms hops. */
function partialEnvelope(x: Float32Array, hz: number, seconds: number): number[] {
  const win = Math.round(0.25 * SR);
  const hop = Math.round(0.05 * SR);
  const out: number[] = [];
  for (let start = 0; start + win <= Math.min(x.length, seconds * SR); start += hop) {
    let re = 0, im = 0;
    for (let i = 0; i < win; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
      const a = (2 * Math.PI * hz * (start + i)) / SR;
      re += x[start + i] * w * Math.cos(a);
      im -= x[start + i] * w * Math.sin(a);
    }
    out.push(Math.hypot(re, im));
  }
  return out;
}

describe('bowl', () => {
  it('rings on its inharmonic partials', () => {
    const f = 130;
    const n = 1 << 16;
    const p = spectrum(render({ bowlF: f, bowlBright: 0.6 }, 4), n);
    const floor = [...p].sort((a, b) => a - b)[Math.floor(p.length / 2)];
    for (const r of RATIOS) {
      const k = Math.round((f * r * n) / SR);
      let best = 0;
      for (let j = k - 3; j <= k + 3; j++) best = Math.max(best, p[j]);
      expect(10 * Math.log10(best / floor), `partial ×${r}`).toBeGreaterThan(40);
    }
    // and nothing on the harmonic series in between (it is not a sawtooth)
    const k2 = Math.round((f * 2 * n) / SR);
    expect(10 * Math.log10(p[k2] / floor)).toBeLessThan(20);
  });

  it('breathes: each partial beats slowly, the higher ones faster, never to silence', () => {
    const f = 130;
    const beat = 0.4;
    const x = render({ bowlF: f, bowlBeat: beat, bowlBright: 0.6 }, 12);
    const count = (env: number[]): number => {
      const mean = env.reduce((a, b) => a + b, 0) / env.length;
      let c = 0;
      for (let i = 1; i < env.length; i++) if (env[i - 1] < mean && env[i] >= mean) c++;
      return c;
    };
    const fund = partialEnvelope(x, f, 12);
    const third = partialEnvelope(x, f * RATIOS[2], 12);
    // ~0.4 beats/s over 12 s on the fundamental; faster on the third partial
    expect(count(fund)).toBeGreaterThanOrEqual(3);
    expect(count(fund)).toBeLessThanOrEqual(7);
    expect(count(third)).toBeGreaterThan(count(fund));
    // a real wah, but the hum never stops
    const lo = Math.min(...fund.slice(2));
    const hi = Math.max(...fund.slice(2));
    expect(hi / lo).toBeGreaterThan(2);
    expect(hi / lo).toBeLessThan(20);
  });

  it('stays bounded at every brightness', () => {
    for (const bowlBright of [0, 0.5, 1]) {
      const x = render({ bowlBright, bowlBeat: 3, bowlF: 40 }, 20);
      const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, `bright ${bowlBright}`).toBeLessThanOrEqual(1);
      expect(peak).toBeGreaterThan(0.2);
    }
  });

  it('glides when its pitch moves (phases accumulate, no step)', () => {
    const gen = new FormulaGenerator('bowl', SR, { gain: 1, bowlF: 130 }, mulberry32(1));
    const a = render({}, 2, gen);
    gen.set({ bowlF: 180 });
    const b = render({}, 0.05, gen);
    const step = Math.abs(b[0] - a[a.length - 1]);
    let maxStep = 0;
    for (let i = a.length - 2000; i < a.length; i++) maxStep = Math.max(maxStep, Math.abs(a[i] - a[i - 1]));
    expect(step).toBeLessThan(2 * maxStep + 1e-3);
  });
});
