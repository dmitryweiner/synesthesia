// Modulation matrix core (pure). An LFO is a pure function of absolute time,
// so audio nodes and the visual loop that share one clock origin stay in
// sync without messaging. Imported by the worklet, the sim loop and vitest.
// Ported from formula-synth/chromaflux; the two projects' route types are
// unified here: a route targets 'fx', a formula id, or a visual card id.

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random'; // random = S&H

export interface LfoDef {
  shape: LfoShape;
  rate: number;   // Hz (slow: ~0.005–8)
  phase: number;  // 0–1 (fraction of a cycle)
}

export interface ModRoute {
  src: number;     // index into the LFO pool
  target: string;  // 'fx' | formula id | visual card id
  param: string;   // slider key / FxState field
  depth: number;   // bipolar fraction of the range, [-1, 1]
  exp?: boolean;   // exponential (octave) mapping for frequency-like params
}

export interface ModState {
  lfos: LfoDef[];
  routes: ModRoute[];
}

// param → [min, max]; ranges live in the schemas and are passed in.
export type ParamRanges = Record<string, readonly [number, number]>;

const TWO_PI = 2 * Math.PI;

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

// Deterministic integer hash → [0,1) (one mulberry32 step). For S&H the
// value is a pure function of the cycle number.
function hash01(n: number): number {
  let a = (n | 0) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** LFO value as a pure function of absolute time t (seconds) → [-1, 1]. */
export function lfoValue(lfo: LfoDef, t: number): number {
  const ph = lfo.rate * t + lfo.phase;
  const frac = ph - Math.floor(ph);
  switch (lfo.shape) {
    case 'sine': return Math.sin(TWO_PI * ph);
    case 'triangle': return frac < 0.5 ? 4 * frac - 1 : 3 - 4 * frac;
    case 'saw': return 2 * frac - 1;
    case 'square': return frac < 0.5 ? 1 : -1;
    case 'random': return 2 * hash01(Math.floor(ph)) - 1;
  }
}

/**
 * Effective parameter: base plus a bipolar fraction of the range times the
 * LFO, clamped. Frequency-like params use exponential mapping (octaves).
 */
export function effectiveParam(
  base: number,
  l: number,
  depth: number,
  range: readonly [number, number],
  exp: boolean,
): number {
  const [min, max] = range;
  if (exp && min > 0 && max > 0) {
    const octaves = Math.log2(max / min);
    return clamp(base * Math.pow(2, depth * octaves * l), min, max);
  }
  return clamp(base + depth * (max - min) * l, min, max);
}

/**
 * Applies every route aimed at `target` on top of `base` at time t. Params
 * without a route (or with a missing LFO/range) pass through. Pure.
 */
export function effectiveParams(
  target: string,
  base: Readonly<Record<string, number>>,
  lfos: readonly LfoDef[],
  routes: readonly ModRoute[],
  ranges: ParamRanges,
  t: number,
): Record<string, number> {
  const out: Record<string, number> = { ...base };
  for (const route of routes) {
    if (route.target !== target) continue;
    const lfo = lfos[route.src];
    if (!lfo) continue;
    const range = ranges[route.param];
    if (!range) continue;
    const baseVal = base[route.param];
    if (typeof baseVal !== 'number') continue;
    out[route.param] = effectiveParam(baseVal, lfoValue(lfo, t), route.depth, range, route.exp === true);
  }
  return out;
}
