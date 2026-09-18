// Pure evolutionary operators on genomes. No state, no DOM — every
// function takes an injected Rng so tests are deterministic.
import type { Rng } from '../dsp/rng';
import { gaussian } from '../dsp/rng';
import { FORMULAS, MAX_ENABLED_FORMULAS } from '../schema/audio';
import { LFO_COUNT } from '../state/schema';
import type { GeneDef } from './genes';
import { GENES, GENE_INDEX, ROUTE_SLOTS, geneIndex, isGeneActive } from './genes';
import type { Genome } from './codec';

export type { Genome } from './codec';

export interface MutateOptions {
  /** Std-dev of the gaussian step, in normalized [0,1] units. */
  sigma: number;
  /** How many active continuous genes get a random step. */
  k: number;
  /** Probability of one structural (discrete) move. */
  structuralProb: number;
  /** Previous step (full-length delta) to continue along; only continuous genes are read. */
  momentum?: Genome | null;
  momentumWeight?: number;
  /** Gene indices that must not change (dims of a rejected step). */
  avoid?: ReadonlySet<number>;
}

const FORMULA_ENABLED_IDX: readonly number[] = FORMULAS.map((f) => geneIndex(`a.${f.id}.enabled`));
const CONT_IDX: readonly number[] = GENES.map((g, i) => (g.kind === 'cont' ? i : -1)).filter((i) => i >= 0);

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function randomChoice(rng: Rng, def: GeneDef, notEqual: number): number {
  const n = def.max - def.min + 1;
  if (n <= 1) return def.min;
  let v = def.min + Math.floor(rng() * n);
  if (v === notEqual) v = def.min + ((v - def.min + 1 + Math.floor(rng() * (n - 1))) % n);
  return v;
}

export function enabledFormulaCount(g: readonly number[]): number {
  let n = 0;
  for (const i of FORMULA_ENABLED_IDX) if (g[i] === 1) n++;
  return n;
}

/** Indices where two genomes differ. */
export function diffDims(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

export function isValidGenome(g: unknown): g is Genome {
  if (!Array.isArray(g) || g.length !== GENES.length) return false;
  for (let i = 0; i < g.length; i++) {
    const v: unknown = g[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    const d = GENES[i];
    if (d.kind === 'cont') {
      if (v < 0 || v > 1) return false;
    } else if (!Number.isInteger(v) || v < d.min || v > d.max) {
      return false;
    }
  }
  return true;
}

/** Enforces 1..MAX_ENABLED_FORMULAS enabled formulas. Returns a (possibly new) genome. */
export function repair(g: Genome, rng: Rng): Genome {
  const out = [...g];
  const on = FORMULA_ENABLED_IDX.filter((i) => out[i] === 1);
  if (on.length === 0) {
    out[pick(rng, FORMULA_ENABLED_IDX)] = 1;
  } else {
    let extra = on.length - MAX_ENABLED_FORMULAS;
    const pool = [...on];
    while (extra > 0 && pool.length > 0) {
      const j = Math.floor(rng() * pool.length);
      out[pool[j]] = 0;
      pool.splice(j, 1);
      extra--;
    }
  }
  return out;
}

// --- structural moves --------------------------------------------------

type Move = (g: Genome, rng: Rng, avoid: ReadonlySet<number>) => boolean;

const FX_TOGGLES = ['fx.filterOn', 'fx.chorusOn', 'fx.reverbOn', 'fx.limiterOn', 'fx.delayOn', 'fx.phaserOn'].map(geneIndex);
const FX_CHOICES = ['fx.filterType', 'fx.chorusMode', 'fx.phaserStages'].map(geneIndex);
const CARD_TOGGLES = GENES.map((d, i) => (d.kind === 'bool' && d.group.startsWith('v.') ? i : -1)).filter((i) => i >= 0);
const PALETTE_CHOICE = geneIndex('v.palette.paletteId');
const LFO_SHAPES_IDX = Array.from({ length: LFO_COUNT }, (_, i) => geneIndex(`lfo.${i}.shape`));

function toggleOneOf(list: readonly number[]): Move {
  return (g, rng) => {
    const i = pick(rng, list);
    g[i] = g[i] === 1 ? 0 : 1;
    return true;
  };
}

function reChooseOneOf(list: readonly number[], onlyActive: boolean): Move {
  return (g, rng) => {
    const candidates = onlyActive ? list.filter((i) => isGeneActive(g, i)) : [...list];
    if (candidates.length === 0) return false;
    const i = pick(rng, candidates);
    g[i] = randomChoice(rng, GENES[i], g[i]);
    return true;
  };
}

const routeMove: Move = (g, rng, avoid) => {
  const slots = Array.from({ length: ROUTE_SLOTS }, (_, i) => i)
    .filter((i) => !avoid.has(geneIndex(`route.${i}.depth`)));
  if (slots.length === 0) return false;
  const active = slots.filter((i) => g[geneIndex(`route.${i}.on`)] === 1);
  const inactive = slots.filter((i) => g[geneIndex(`route.${i}.on`)] === 0);
  const r = rng();
  if (inactive.length > 0 && (active.length === 0 || r < 0.45)) {
    // Enable a fresh route with a random source/target/depth.
    const s = pick(rng, inactive);
    g[geneIndex(`route.${s}.on`)] = 1;
    g[geneIndex(`route.${s}.src`)] = Math.floor(rng() * LFO_COUNT);
    const tDef = GENES[geneIndex(`route.${s}.target`)];
    g[geneIndex(`route.${s}.target`)] = Math.floor(rng() * (tDef.max + 1));
    // Depth in the outer halves of [-1,1] so a new route is audible/visible.
    const mag = 0.15 + rng() * 0.45;
    g[geneIndex(`route.${s}.depth`)] = clamp01(0.5 + (rng() < 0.5 ? -mag : mag));
    g[geneIndex(`route.${s}.exp`)] = rng() < 0.5 ? 1 : 0;
    return true;
  }
  if (active.length === 0) return false;
  const s = pick(rng, active);
  if (r < 0.7) {
    g[geneIndex(`route.${s}.on`)] = 0;
  } else {
    const ti = geneIndex(`route.${s}.target`);
    g[ti] = randomChoice(rng, GENES[ti], g[ti]);
  }
  return true;
};

interface WeightedMove {
  weight: number;
  move: Move;
}

const MOVES: readonly WeightedMove[] = [
  { weight: 3, move: toggleOneOf(FORMULA_ENABLED_IDX) },
  { weight: 2, move: toggleOneOf(FX_TOGGLES) },
  { weight: 1, move: reChooseOneOf(FX_CHOICES, true) },
  { weight: 1, move: toggleOneOf(CARD_TOGGLES) },
  { weight: 1.5, move: reChooseOneOf([PALETTE_CHOICE], false) },
  { weight: 1, move: reChooseOneOf(LFO_SHAPES_IDX, false) },
  { weight: 2.5, move: routeMove },
];
const MOVE_WEIGHT_SUM = MOVES.reduce((s, m) => s + m.weight, 0);

function structuralMove(g: Genome, rng: Rng, avoid: ReadonlySet<number>): void {
  // Up to a few attempts: some moves can legitimately find nothing to do.
  for (let attempt = 0; attempt < 4; attempt++) {
    let r = rng() * MOVE_WEIGHT_SUM;
    for (const m of MOVES) {
      r -= m.weight;
      if (r <= 0) {
        if (m.move(g, rng, avoid)) return;
        break;
      }
    }
  }
}

// --- mutation ----------------------------------------------------------

const EMPTY: ReadonlySet<number> = new Set();

/**
 * One proposal: momentum along the previous step, a sparse gaussian kick on
 * k random active continuous genes, and (with structuralProb) one discrete
 * move. Never touches inactive genes. Pure — returns a new genome.
 */
export function mutate(g: Genome, rng: Rng, opts: MutateOptions): Genome {
  const out = [...g];
  const avoid = opts.avoid ?? EMPTY;

  if (opts.structuralProb > 0 && rng() < opts.structuralProb) structuralMove(out, rng, avoid);

  const momentum = opts.momentum;
  const w = opts.momentumWeight ?? 0.5;
  if (momentum && w !== 0) {
    for (const i of CONT_IDX) {
      const m = momentum[i];
      if (!m || avoid.has(i) || !isGeneActive(out, i)) continue;
      out[i] = clamp01(out[i] + w * m);
    }
  }

  if (opts.k > 0 && opts.sigma > 0) {
    const candidates = CONT_IDX.filter((i) => !avoid.has(i) && isGeneActive(out, i));
    const n = Math.min(opts.k, candidates.length);
    for (let picked = 0; picked < n; picked++) {
      const j = picked + Math.floor(rng() * (candidates.length - picked));
      const tmp = candidates[picked];
      candidates[picked] = candidates[j];
      candidates[j] = tmp;
      const i = candidates[picked];
      out[i] = clamp01(out[i] + gaussian(rng) * opts.sigma);
    }
  }
  return out;
}

/** A fully random (but valid and sane) genome: 1–3 formulas, sparse FX/routes. */
export function randomGenome(rng: Rng): Genome {
  const g: Genome = new Array(GENES.length).fill(0);
  for (let i = 0; i < GENES.length; i++) {
    const d = GENES[i];
    if (d.kind === 'cont') g[i] = rng();
    else if (d.kind === 'choice') g[i] = d.min + Math.floor(rng() * (d.max - d.min + 1));
    else g[i] = 0;
  }
  for (const i of FX_TOGGLES) g[i] = rng() < 0.4 ? 1 : 0;
  g[geneIndex('fx.limiterOn')] = 1;
  for (const i of CARD_TOGGLES) g[i] = rng() < 0.6 ? 1 : 0;
  for (let s = 0; s < ROUTE_SLOTS; s++) g[geneIndex(`route.${s}.on`)] = rng() < 0.25 ? 1 : 0;
  const count = 1 + Math.floor(rng() * 3);
  const pool = [...FORMULA_ENABLED_IDX];
  for (let n = 0; n < count && pool.length > 0; n++) {
    const j = Math.floor(rng() * pool.length);
    g[pool[j]] = 1;
    pool.splice(j, 1);
  }
  // Keep random gains tame: 0.05..0.5 of the slider.
  for (const f of FORMULAS) g[geneIndex(`a.${f.id}.gain`)] = 0.05 + rng() * 0.45;
  return repair(g, rng);
}

/** Continuous genes interpolate; discrete genes switch as soon as t > 0. */
export function lerpGenome(a: Genome, b: Genome, t: number): Genome {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    if (GENES[i].kind === 'cont') out[i] = t >= 1 ? b[i] : a[i] + (b[i] - a[i]) * t;
    else out[i] = t > 0 ? b[i] : a[i];
  }
  return out;
}

export interface GeneChange {
  id: string;
  label: string;
  from: number;
  to: number;
  dir: 'up' | 'down' | 'on' | 'off' | 'switch';
}

/** Human-readable list of what changed between two genomes. */
export function diffSummary(a: Genome, b: Genome): GeneChange[] {
  const out: GeneChange[] = [];
  for (const i of diffDims(a, b)) {
    const d = GENES[i];
    let dir: GeneChange['dir'];
    if (d.kind === 'bool') dir = b[i] === 1 ? 'on' : 'off';
    else if (d.kind === 'choice') dir = 'switch';
    else dir = b[i] > a[i] ? 'up' : 'down';
    out.push({ id: d.id, label: d.label, from: a[i], to: b[i], dir });
  }
  return out;
}

export { GENE_INDEX };
