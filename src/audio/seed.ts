// Repeatable renders (PLAN.md #21). The reverb's room is exponentially
// decaying noise and several formulas are noise-driven; both used to draw
// from Math.random, so every render of a point differed, and a random room
// moved Overtone steppe's score across 0.82–0.96. Now both draw from
// streams seeded by RENDER_SEED, in the app and in the analysis alike: the
// room depends only on the reverb params, a point sounds the same on every
// device and through every link, and A/B renders compare in the same room.
// The analysis varies the seed on purpose (analyze.mjs --repeat N renders
// seeds 1..N) to average over rooms. Pure — no Web Audio.
import { mulberry32 } from '../dsp/rng';

export const RENDER_SEED = 1;

/** Stereo room impulse: noise under e^(−t/decay), `len` samples at `sr`. */
export function roomImpulse(len: number, sr: number, decay: number, seed: number): [Float32Array, Float32Array] {
  const rng = mulberry32(seed);
  const tc = Math.max(1e-3, decay);
  const out: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (const data of out) {
    for (let i = 0; i < len; i++) data[i] = (rng() * 2 - 1) * Math.exp(-i / sr / tc);
  }
  return out;
}

/** The noise stream of formula number `formulaIndex` in a render seeded `seed`. */
export function generatorSeed(seed: number, formulaIndex: number): number {
  return (Math.imul(seed, 0x9e3779b1) + formulaIndex * 0x85ebca6b) >>> 0;
}
