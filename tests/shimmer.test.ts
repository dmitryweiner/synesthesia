// PLAN.md #20: shimmer, an octave-up pitch shifter inside the delay's
// feedback loop. At 0 the loop must be the plain echo it always was; at 1
// every echo returns an octave higher; and the loop must stay bounded (the
// plan's "peak stays bounded over 5 minutes") with no build-up.
import { OctaveShimmer } from '../src/dsp/shimmer';
import { mulberry32 } from '../src/dsp/rng';
import { fft } from '../src/analysis/fft';

const SR = 22050;
const BLOCK = 128;

function process(sh: OctaveShimmer, input: Float32Array, amount: number): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += BLOCK) {
    sh.process(input.subarray(i, i + BLOCK), out.subarray(i, i + BLOCK), amount);
  }
  return out;
}

function tone(freq: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round((seconds * SR) / BLOCK) * BLOCK;
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
}

/**
 * Power within ±40 Hz of `freq`, over the last 2^14 samples. A band, not one
 * bin: overlapping 80 ms grains put the shifted tone on lines 12.5 Hz apart,
 * so exactly 660 Hz may sit between two of them.
 */
function bandPower(x: Float32Array, freq: number): number {
  const n = 1 << 14;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[x.length - n + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im, false);
  let p = 0;
  for (let k = Math.floor(((freq - 40) * n) / SR); k <= Math.ceil(((freq + 40) * n) / SR); k++) p += re[k] * re[k] + im[k] * im[k];
  return p;
}

describe('OctaveShimmer', () => {
  it('amount 0 passes the signal through bit for bit (every existing point sounds as before)', () => {
    const rng = mulberry32(3);
    const x = Float32Array.from({ length: BLOCK * 64 }, () => rng() * 2 - 1);
    expect(Array.from(process(new OctaveShimmer(SR), x, 0))).toEqual(Array.from(x));
  });

  it('amount 1 lifts a tone by an octave', () => {
    const x = tone(330, 2);
    const y = process(new OctaveShimmer(SR), x, 1);
    expect(bandPower(y, 660)).toBeGreaterThan(100 * bandPower(y, 330));
    expect(bandPower(y, 660)).toBeGreaterThan(0.3 * bandPower(x, 330)); // not lost on the way
  });

  it('never exceeds 1, however loud the input', () => {
    const rng = mulberry32(9);
    const x = Float32Array.from({ length: BLOCK * 400 }, () => 4 * (rng() * 2 - 1));
    const y = process(new OctaveShimmer(SR), x, 1);
    // amount 1 outputs only the shifted, soft-limited part
    expect(y.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(1);
  });
});

describe('a shimmering echo loop at the maximum feedback', () => {
  // y = x + fb·shimmer(y delayed): the engine's delay → feedback gain →
  // shimmer → delay cycle, sample by sample.
  function loop(seconds: number, fb: number, amount: number, input: (i: number) => number): Float32Array {
    const d = Math.round(0.35 * SR);
    const n = Math.round((seconds * SR) / BLOCK) * BLOCK;
    const y = new Float32Array(n);
    const sh = new OctaveShimmer(SR);
    const back = new Float32Array(BLOCK);
    const shifted = new Float32Array(BLOCK);
    for (let i = 0; i < n; i += BLOCK) {
      for (let j = 0; j < BLOCK; j++) back[j] = i + j >= d ? fb * y[i + j - d] : 0;
      sh.process(back, shifted, amount);
      for (let j = 0; j < BLOCK; j++) y[i + j] = input(i + j) + shifted[j];
    }
    return y;
  }
  const rms = (y: Float32Array, from: number, to: number): number => {
    let s = 0;
    for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) s += y[i] * y[i];
    return Math.sqrt(s / ((to - from) * SR));
  };
  const pad = (i: number): number =>
    0.3 * (Math.sin((2 * Math.PI * 110 * i) / SR) + Math.sin((2 * Math.PI * 165 * i) / SR) + Math.sin((2 * Math.PI * 220.5 * i) / SR));

  it('stays bounded over 5 minutes, with no build-up', () => {
    const y = loop(300, 0.9, 1, pad);
    let peak = 0;
    let finite = true;
    for (const v of y) {
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
    }
    expect(finite).toBe(true);
    expect(peak).toBeLessThan(0.9 + 1); // the pad's own peak + a limited loop
    expect(rms(y, 240, 300) / rms(y, 60, 120)).toBeLessThan(1.1);
  });

  it('dies out once the input stops (each pass climbs an octave into the low-pass)', () => {
    const y = loop(40, 0.9, 1, (i) => (i < 10 * SR ? pad(i) : 0));
    expect(rms(y, 35, 40)).toBeLessThan(rms(y, 5, 10) * 0.01);
  });
});
