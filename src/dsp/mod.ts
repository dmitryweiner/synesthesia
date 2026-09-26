// Modulation matrix core (pure). An LFO is a pure function of absolute time,
// so audio nodes and the visual loop that share one clock origin stay in
// sync without messaging. Imported by the worklet, the sim loop and vitest.
// Ported from formula-synth/chromaflux; the two projects' route types are
// unified here: a route targets 'fx', a formula id, or a visual card id.

// random = S&H; pink = 1/f fluctuations (PLAN.md #18). The order is stored
// as a choice gene's index: append, never reorder.
export const LFO_SHAPE_LIST = ['sine', 'triangle', 'saw', 'square', 'random', 'pink'] as const;
export type LfoShape = (typeof LFO_SHAPE_LIST)[number];

const LFO_SHAPE_SET: ReadonlySet<string> = new Set(LFO_SHAPE_LIST);

export function isLfoShape(v: unknown): v is LfoShape {
  return typeof v === 'string' && LFO_SHAPE_SET.has(v);
}

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

// Pink: PINK_OCTAVES octaves of value noise at rate·2^j with equal
// amplitude (Voss–McCartney). Measured: 1/f (−3 dB per octave) from about
// rate/2 to 4·rate, steeper above, where the top octave's smoothing takes
// over. Cosine interpolation between lattice values makes it glide. Each octave hashes its own lattice (n·PINK_OCTAVES + j never
// collides across octaves), so like S&H it is a pure function of the phase.
const PINK_OCTAVES = 5;
// tanh of the octave mean: the same spread as the measured prototype (which
// clamped sum/5·2.2 at ±1), but rare peaks stay round instead of flat.
const PINK_GAIN = 2.4;

function valueNoise(u: number, octave: number): number {
  const n = Math.floor(u);
  const a = 2 * hash01(n * PINK_OCTAVES + octave) - 1;
  const b = 2 * hash01((n + 1) * PINK_OCTAVES + octave) - 1;
  const w = 0.5 - 0.5 * Math.cos(Math.PI * (u - n));
  return a + (b - a) * w;
}

function pinkValue(ph: number): number {
  let sum = 0;
  let scale = 1;
  for (let j = 0; j < PINK_OCTAVES; j++) {
    sum += valueNoise(ph * scale, j);
    scale *= 2;
  }
  return Math.tanh((PINK_GAIN * sum) / PINK_OCTAVES);
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
    case 'pink': return pinkValue(ph);
  }
}

// Frequency-like params move in octaves — when the range allows a log scale.
function inOctaves(range: readonly [number, number], exp: boolean): boolean {
  return exp && range[0] > 0 && range[1] > 0;
}

/** One route's offset: octaves for an exp route, range units otherwise. */
function routeOffset(l: number, depth: number, range: readonly [number, number], octaves: boolean): number {
  const [min, max] = range;
  return depth * l * (octaves ? Math.log2(max / min) : max - min);
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
  const octaves = inOctaves(range, exp);
  const off = routeOffset(l, depth, range, octaves);
  return octaves ? clamp(base * Math.pow(2, off), min, max) : clamp(base + off, min, max);
}

/**
 * Effective value of one parameter under EVERY route aimed at it (PLAN.md
 * #19): offsets add up in each route's own space — octaves for exp routes,
 * range units otherwise — and the sum is clamped once:
 * base·2^Σoctaves + Σlinear. (Applying routes one by one made the last route
 * silently win.) Routes match by `param`, and by `target` when one is given;
 * with no live route the base passes through unclamped. Pure.
 */
export function modulatedParam(
  param: string,
  base: number,
  range: readonly [number, number],
  routes: readonly ModRoute[],
  lfos: readonly LfoDef[],
  t: number,
  target?: string,
): number {
  let oct = 0;
  let lin = 0;
  let live = false;
  for (const r of routes) {
    if (r.param !== param || (target !== undefined && r.target !== target)) continue;
    const lfo = lfos[r.src];
    if (!lfo) continue;
    live = true;
    const octaves = inOctaves(range, r.exp === true);
    const off = routeOffset(lfoValue(lfo, t), r.depth, range, octaves);
    if (octaves) oct += off;
    else lin += off;
  }
  if (!live) return base;
  const v = oct === 0 ? base + lin : base * Math.pow(2, oct) + lin;
  return clamp(v, range[0], range[1]);
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
    const range = ranges[route.param];
    if (!range) continue;
    const baseVal = base[route.param];
    if (typeof baseVal !== 'number') continue;
    out[route.param] = modulatedParam(route.param, baseVal, range, routes, lfos, t, target);
  }
  return out;
}
