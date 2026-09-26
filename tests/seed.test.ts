// PLAN.md #21: a render is repeatable. The reverb room and the noise
// generators draw from seeded streams, so the same point renders the same
// samples, and A/B comparisons happen in the same room.
import { RENDER_SEED, roomImpulse, generatorSeed } from '../src/audio/seed';
import { FormulaGenerator } from '../src/dsp/generator';
import { mulberry32 } from '../src/dsp/rng';

const SR = 8000;

describe('roomImpulse', () => {
  it('the same seed builds the same room', () => {
    const a = roomImpulse(4000, SR, 0.4, RENDER_SEED);
    const b = roomImpulse(4000, SR, 0.4, RENDER_SEED);
    expect(Array.from(a[0])).toEqual(Array.from(b[0]));
    expect(Array.from(a[1])).toEqual(Array.from(b[1]));
  });

  it('another seed builds another room; the two channels differ', () => {
    const a = roomImpulse(4000, SR, 0.4, 1);
    const b = roomImpulse(4000, SR, 0.4, 2);
    expect(Array.from(a[0])).not.toEqual(Array.from(b[0]));
    expect(Array.from(a[0])).not.toEqual(Array.from(a[1]));
  });

  it('decays exponentially with the given time constant', () => {
    const [l] = roomImpulse(SR * 2, SR, 0.3, RENDER_SEED);
    const rms = (from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s += l[i] * l[i];
      return Math.sqrt(s / (to - from));
    };
    // 0.3 s later the envelope is e^-1 lower
    const ratio = rms(0.6 * SR, 0.7 * SR) / rms(0.3 * SR, 0.4 * SR);
    expect(ratio).toBeGreaterThan(Math.exp(-1) * 0.8);
    expect(ratio).toBeLessThan(Math.exp(-1) * 1.25);
    for (const v of l) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});

describe('generatorSeed', () => {
  it('gives every formula its own stream, per render seed', () => {
    const seeds = new Set<number>();
    for (let s = 1; s <= 4; s++) for (let f = 0; f < 22; f++) seeds.add(generatorSeed(s, f));
    expect(seeds.size).toBe(4 * 22);
  });

  it('a noise formula renders the same samples from the same seed', () => {
    const render = (seed: number): number[] => {
      const g = new FormulaGenerator('rain', SR, {}, mulberry32(generatorSeed(seed, 20)));
      const out = new Float32Array(2048);
      g.fill(out);
      return Array.from(out);
    };
    expect(render(RENDER_SEED)).toEqual(render(RENDER_SEED));
    expect(render(RENDER_SEED)).not.toEqual(render(RENDER_SEED + 1));
  });
});
