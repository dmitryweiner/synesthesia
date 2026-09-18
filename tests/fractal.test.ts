import { fft } from '../src/analysis/fft';
import {
  spectralSlope, higuchiFD, boxCountDimension, analyzeSound, fractalScore, preference,
} from '../src/analysis/fractal';
import { mulberry32, gaussian } from '../src/dsp/rng';

const N = 4096;

function white(n: number, seed: number): Float64Array {
  const r = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = gaussian(r);
  return out;
}

function brown(n: number, seed: number): Float64Array {
  const w = white(n, seed);
  const out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += w[i]; out[i] = acc; }
  return out;
}

/** 1/f^β noise by spectral shaping of white noise. */
function colored(n: number, beta: number, seed: number): Float64Array {
  const re = white(n, seed);
  const im = new Float64Array(n);
  fft(re, im, false);
  for (let k = 1; k < n; k++) {
    const f = Math.min(k, n - k);
    const g = Math.pow(f, -beta / 2);
    re[k] *= g;
    im[k] *= g;
  }
  re[0] = 0; im[0] = 0;
  fft(re, im, true);
  return re;
}

describe('fft', () => {
  it('forward then inverse returns the input', () => {
    const x = white(256, 1);
    const re = Float64Array.from(x);
    const im = new Float64Array(256);
    fft(re, im, false);
    fft(re, im, true);
    for (let i = 0; i < 256; i++) {
      expect(re[i]).toBeCloseTo(x[i], 9);
      expect(im[i]).toBeCloseTo(0, 9);
    }
  });

  it('a pure cosine lands in its bin', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft(re, im, false);
    expect(Math.hypot(re[5], im[5])).toBeCloseTo(n / 2, 6);
    expect(Math.hypot(re[6], im[6])).toBeCloseTo(0, 6);
  });

  it('rejects non-power-of-two lengths', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6), false)).toThrow();
  });
});

describe('spectralSlope (β of 1/f^β)', () => {
  it('white ≈ 0, pink ≈ 1, brown ≈ 2', () => {
    expect(spectralSlope(white(N, 2))).toBeCloseTo(0, 0);
    expect(Math.abs(spectralSlope(white(N, 2)))).toBeLessThan(0.25);
    expect(Math.abs(spectralSlope(colored(N, 1, 3)) - 1)).toBeLessThan(0.25);
    expect(Math.abs(spectralSlope(brown(N, 4)) - 2)).toBeLessThan(0.3);
  });

  it('degenerate input (constant / too short) → NaN', () => {
    expect(spectralSlope(new Float64Array(N).fill(3))).toBeNaN();
    expect(spectralSlope(new Float64Array(8))).toBeNaN();
  });
});

describe('higuchiFD', () => {
  it('white ≈ 2, brown ≈ 1.5, smooth sine ≈ 1', () => {
    expect(Math.abs(higuchiFD(white(N, 5)) - 2)).toBeLessThan(0.1);
    expect(Math.abs(higuchiFD(brown(N, 6)) - 1.5)).toBeLessThan(0.1);
    const s = new Float64Array(N);
    for (let i = 0; i < N; i++) s[i] = Math.sin(i / 200);
    expect(Math.abs(higuchiFD(s) - 1)).toBeLessThan(0.05);
  });
});

describe('boxCountDimension', () => {
  const S = 256;
  const grid = (f: (x: number, y: number) => boolean) => {
    const img = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img[y * S + x] = f(x, y) ? 1 : 0;
    return img;
  };

  it('filled plane = 2, a line = 1, empty = 0', () => {
    expect(boxCountDimension(grid(() => true), S, S)).toBeCloseTo(2, 6);
    expect(boxCountDimension(grid((_x, y) => y === 100), S, S)).toBeCloseTo(1, 6);
    expect(boxCountDimension(grid(() => false), S, S)).toBe(0);
  });

  it('Sierpinski triangle (Pascal mod 2) ≈ log2(3)', () => {
    // (x & y) === 0 is Pascal's triangle mod 2 on a 2^n grid.
    const d = boxCountDimension(grid((x, y) => (x & y) === 0), S, S);
    expect(d).toBeCloseTo(Math.log2(3), 2);
  });

  it('works on non-square images', () => {
    const w = 512, h = 64;
    const img = new Uint8Array(w * h).fill(1);
    expect(boxCountDimension(img, w, h)).toBeCloseTo(2, 6);
  });
});

describe('preference / fractalScore', () => {
  it('preference peaks at the target and falls off', () => {
    expect(preference(1, 1, 0.5)).toBe(1);
    expect(preference(1.5, 1, 0.5)).toBeLessThan(1);
    expect(preference(3, 1, 0.5)).toBeLessThan(preference(1.5, 1, 0.5));
    expect(preference(NaN, 1, 0.5)).toBe(0);
  });

  it('1/f fluctuations score above white and brown ones', () => {
    const base = { loudness: -20, envHiguchi: 1.5, boxDim: 1.6, silent: false };
    const pink = fractalScore({ ...base, envBeta: 1, centroidBeta: 1 });
    const whiteS = fractalScore({ ...base, envBeta: 0, centroidBeta: 0 });
    const brownS = fractalScore({ ...base, envBeta: 2.2, centroidBeta: 2.2 });
    expect(pink).toBeGreaterThan(whiteS);
    expect(pink).toBeGreaterThan(brownS);
    expect(fractalScore({ ...base, envBeta: 1, centroidBeta: 1, silent: true })).toBe(0);
  });
});

describe('analyzeSound', () => {
  const SR = 11025;
  const SECONDS = 24;

  it('silence → silent, score 0', () => {
    const m = analyzeSound(new Float32Array(SR * 4), SR);
    expect(m.silent).toBe(true);
    expect(m.score).toBe(0);
  });

  it('a steady tone is less "fractal" than a tone whose loudness and pitch wander as 1/f', () => {
    const n = SR * SECONDS;
    const steady = new Float32Array(n);
    for (let i = 0; i < n; i++) steady[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);

    // 1/f control signals at the 50 Hz analysis frame rate, interpolated.
    const frames = 2048;
    const amp = colored(frames, 1, 11);
    const pitch = colored(frames, 1, 12);
    const norm = (x: Float64Array) => {
      let lo = Infinity, hi = -Infinity;
      for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return (v: number) => (v - lo) / (hi - lo || 1);
    };
    const na = norm(amp), np = norm(pitch);
    const wander = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const fpos = Math.min(frames - 1, (i / n) * (frames - 1));
      const j = Math.floor(fpos);
      const t = fpos - j;
      const a = na(amp[j]) * (1 - t) + na(amp[Math.min(frames - 1, j + 1)]) * t;
      const p = np(pitch[j]) * (1 - t) + np(pitch[Math.min(frames - 1, j + 1)]) * t;
      phase += (2 * Math.PI * (220 * Math.pow(4, p))) / SR;
      wander[i] = (0.05 + 0.35 * a) * Math.sin(phase);
    }

    const ms = analyzeSound(steady, SR);
    const mw = analyzeSound(wander, SR);
    expect(ms.silent).toBe(false);
    expect(mw.silent).toBe(false);
    // a steady tone has no fluctuation structure at all
    expect(ms.envBeta).toBeNaN();
    expect(ms.centroidBeta).toBeNaN();
    // the wandering one's loudness and pitch contours read as ≈1/f
    expect(Math.abs(mw.envBeta - 1)).toBeLessThan(0.35);
    expect(Math.abs(mw.centroidBeta - 1)).toBeLessThan(0.35);
    expect(mw.score).toBeGreaterThan(ms.score + 0.3);
    for (const v of [mw.envBeta, mw.centroidBeta, mw.envHiguchi, mw.boxDim, mw.loudness]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
