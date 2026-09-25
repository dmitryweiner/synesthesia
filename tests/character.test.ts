// Character metrics describe WHAT a sound is (continuous or broken, heavy
// or thin, on one harmonic grid or not, rough or smooth, how fast it
// changes), next to fractal.ts's "how 1/f is it". Each is checked on a
// synthetic signal whose answer is known.
import { analyzeCharacter } from '../src/analysis/character';

const SR = 16000;

function synth(seconds: number, f: (t: number) => number): Float32Array {
  const x = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < x.length; i++) x[i] = f(i / SR);
  return x;
}

const sine = (hz: number, amp = 0.3) => (t: number) => amp * Math.sin(2 * Math.PI * hz * t);
const sum = (...fs: ((t: number) => number)[]) => (t: number) => fs.reduce((a, g) => a + g(t), 0);

describe('analyzeCharacter: continuity', () => {
  it('a steady tone never drops out and does not swing', () => {
    const c = analyzeCharacter(synth(12, sine(220)), SR);
    expect(c.dropout).toBeLessThan(0.5);
    expect(c.swing).toBeLessThan(0.5);
  });

  it('a tone gated on and off drops out by tens of dB', () => {
    const c = analyzeCharacter(synth(12, (t) => (Math.floor(t) % 2 === 0 ? sine(220)(t) : 0)), SR);
    expect(c.dropout).toBeGreaterThan(20);
  });

  it('a ±6 dB slow swell swings ~12 dB but does not drop out as much', () => {
    const c = analyzeCharacter(synth(24, (t) => Math.pow(10, (6 * Math.sin(2 * Math.PI * 0.1 * t)) / 20) * sine(220, 0.1)(t)), SR);
    expect(c.swing).toBeGreaterThan(10);
    expect(c.swing).toBeLessThan(13);
    expect(c.dropout).toBeLessThan(c.swing);
  });
});

describe('analyzeCharacter: weight (energy below 200 Hz)', () => {
  it('a 55 Hz tone is all weight, a 2 kHz tone none', () => {
    expect(analyzeCharacter(synth(8, sine(55)), SR).lowShare).toBeGreaterThan(0.95);
    expect(analyzeCharacter(synth(8, sine(2000)), SR).lowShare).toBeLessThan(0.05);
  });
});

describe('analyzeCharacter: harmonicity', () => {
  it('a harmonic series sits on one grid', () => {
    const saw = (t: number) => { let s = 0; for (let k = 1; k <= 20; k++) s += Math.sin(2 * Math.PI * 110 * k * t) / k; return 0.2 * s; };
    expect(analyzeCharacter(synth(8, saw), SR).harmonicity).toBeGreaterThan(0.9);
  });

  it('Risset-bell partials (inharmonic by construction) do not', () => {
    const ratios = [0.56, 0.92, 1.19, 1.71, 2, 2.74, 3, 3.76, 4.07];
    const bell = (t: number) => ratios.reduce((a, r, i) => a + Math.sin(2 * Math.PI * 413 * r * t + i) / (1 + i * 0.3), 0) * 0.08;
    expect(analyzeCharacter(synth(8, bell), SR).harmonicity).toBeLessThan(0.7);
  });
});

describe('analyzeCharacter: roughness (Plomp–Levelt / Sethares)', () => {
  it('one sine is smooth; two sines 25 Hz apart are rough; an octave is not', () => {
    const one = analyzeCharacter(synth(6, sine(440)), SR).roughness;
    const rough = analyzeCharacter(synth(6, sum(sine(440), sine(465))), SR).roughness;
    const octave = analyzeCharacter(synth(6, sum(sine(440), sine(880))), SR).roughness;
    expect(one).toBeLessThan(0.01);
    expect(rough).toBeGreaterThan(0.05);
    expect(octave).toBeLessThan(rough / 5);
  });

  it('does not depend on level', () => {
    const a = analyzeCharacter(synth(6, sum(sine(440, 0.3), sine(465, 0.3))), SR).roughness;
    const b = analyzeCharacter(synth(6, sum(sine(440, 0.03), sine(465, 0.03))), SR).roughness;
    expect(b).toBeCloseTo(a, 2);
  });
});

describe('analyzeCharacter: motion across time scales', () => {
  it('a steady tone does not move at any scale', () => {
    const c = analyzeCharacter(synth(40, sine(220)), SR);
    expect(c.motion1s).toBeLessThan(0.5);
    expect(c.motion10s).toBeLessThan(0.5);
  });

  it('a slow glide moves more over 10 s than over 1 s', () => {
    // 110 → 880 Hz over 40 s, in octaves (a slow, continuous change)
    let ph = 0;
    const x = synth(40, (t) => { ph += (2 * Math.PI * 110 * Math.pow(2, (3 * t) / 40)) / SR; return 0.3 * Math.sin(ph); });
    const c = analyzeCharacter(x, SR);
    expect(c.motion10s).toBeGreaterThan(2 * c.motion1s);
    expect(c.motion1s).toBeGreaterThan(0.5);
  });
});

describe('analyzeCharacter: silence', () => {
  it('reports silence instead of numbers', () => {
    const c = analyzeCharacter(new Float32Array(SR * 4), SR);
    expect(c.silent).toBe(true);
  });
});
