// The genome's gene list, derived from the audio/visual schemas. A Genome is
// a number[] indexed by GENES: continuous genes are stored normalized in
// [0,1] (exp genes through a log scale), bools as 0/1, choices as an
// integer index. `activeIf` names the bool gene that gates a gene — a
// disabled formula's params, an off card's params, an unused route slot.
import { FORMULAS, FX_MOD_PARAMS, FX_PARAM_RANGES, FX_PARAM_MODULE, FX_EXP_PARAMS, FX_PARAM_LABELS, FX_ON_KEYS, FILTER_TYPES, CHORUS_MODES, PHASER_STAGES, REVERB_DECAY_RANGE } from '../schema/audio';
import { CARDS, ALWAYS_ON_CARD_IDS } from '../schema/visual';
import { COUPLING_KEYS, LFO_COUNT } from '../state/schema';

export type GeneKind = 'cont' | 'bool' | 'choice';

export interface GeneDef {
  id: string;
  label: string;
  kind: GeneKind;
  /** Gene family, used by structural mutation: 'a.<formula>' | 'fx' | 'v.<card>' | 'lfo.<i>' | 'route.<i>' | 'coupling'. */
  group: string;
  min: number;
  max: number;
  step?: number;
  exp?: boolean;
  activeIf?: string;
}

export interface ModTarget {
  target: string;
  param: string;
  exp: boolean;
  label: string;
}

export const ROUTE_SLOTS = 12;
export const LFO_SHAPES = ['sine', 'triangle', 'saw', 'square', 'random'] as const;
export const LFO_RATE_RANGE: readonly [number, number] = [0.003, 2];

const FX_ON_LABELS: Record<(typeof FX_ON_KEYS)[number], string> = {
  filterOn: 'Filter', chorusOn: 'Chorus', reverbOn: 'Reverb', limiterOn: 'Limiter', delayOn: 'Delay', phaserOn: 'Phaser',
};

function buildModTargets(): ModTarget[] {
  const out: ModTarget[] = [];
  for (const f of FORMULAS) {
    for (const s of f.sliders) out.push({ target: f.id, param: s.k, exp: s.exp === true, label: `${f.title} · ${s.name}` });
  }
  for (const p of FX_MOD_PARAMS) out.push({ target: 'fx', param: p, exp: FX_EXP_PARAMS.has(p), label: FX_PARAM_LABELS[p] });
  for (const c of CARDS) {
    for (const s of c.sliders) out.push({ target: c.id, param: s.k, exp: s.exp === true, label: `${c.title} · ${s.name}` });
  }
  return out;
}

export const MOD_TARGETS: readonly ModTarget[] = buildModTargets();

export function modTargetIndex(target: string, param: string): number {
  return MOD_TARGETS.findIndex((t) => t.target === target && t.param === param);
}

function buildGenes(): GeneDef[] {
  const genes: GeneDef[] = [];
  for (const f of FORMULAS) {
    const group = `a.${f.id}`;
    const enabled = `${group}.enabled`;
    genes.push({ id: enabled, label: f.title, kind: 'bool', group, min: 0, max: 1 });
    for (const s of f.sliders) {
      genes.push({
        id: `${group}.${s.k}`, label: `${f.title} · ${s.name}`, kind: 'cont', group,
        min: s.min, max: s.max, step: s.step, exp: s.exp, activeIf: enabled,
      });
    }
  }

  for (const on of FX_ON_KEYS) genes.push({ id: `fx.${on}`, label: FX_ON_LABELS[on], kind: 'bool', group: 'fx', min: 0, max: 1 });
  for (const p of FX_MOD_PARAMS) {
    const [min, max] = FX_PARAM_RANGES[p];
    genes.push({
      id: `fx.${p}`, label: FX_PARAM_LABELS[p], kind: 'cont', group: 'fx', min, max,
      exp: FX_EXP_PARAMS.has(p), activeIf: `fx.${FX_PARAM_MODULE[p]}`,
    });
  }
  genes.push({ id: 'fx.reverbDecay', label: 'Reverb decay', kind: 'cont', group: 'fx', min: REVERB_DECAY_RANGE[0], max: REVERB_DECAY_RANGE[1], activeIf: 'fx.reverbOn' });
  genes.push({ id: 'fx.filterType', label: 'Filter type', kind: 'choice', group: 'fx', min: 0, max: FILTER_TYPES.length - 1, activeIf: 'fx.filterOn' });
  genes.push({ id: 'fx.chorusMode', label: 'Chorus mode', kind: 'choice', group: 'fx', min: 0, max: CHORUS_MODES.length - 1, activeIf: 'fx.chorusOn' });
  genes.push({ id: 'fx.phaserStages', label: 'Phaser stages', kind: 'choice', group: 'fx', min: 0, max: PHASER_STAGES.length - 1, activeIf: 'fx.phaserOn' });

  for (const c of CARDS) {
    const group = `v.${c.id}`;
    const alwaysOn = ALWAYS_ON_CARD_IDS.some((id) => id === c.id);
    const onId = alwaysOn ? undefined : `${group}.on`;
    if (onId) genes.push({ id: onId, label: c.title, kind: 'bool', group, min: 0, max: 1 });
    for (const s of c.selects ?? []) {
      genes.push({ id: `${group}.${s.k}`, label: `${c.title} · ${s.name}`, kind: 'choice', group, min: 0, max: s.options.length - 1, activeIf: onId });
    }
    for (const s of c.sliders) {
      genes.push({
        id: `${group}.${s.k}`, label: `${c.title} · ${s.name}`, kind: 'cont', group,
        min: s.min, max: s.max, step: s.step, exp: s.exp, activeIf: onId,
      });
    }
  }

  for (let i = 0; i < LFO_COUNT; i++) {
    const group = `lfo.${i}`;
    genes.push({ id: `${group}.shape`, label: `LFO ${i + 1} shape`, kind: 'choice', group, min: 0, max: LFO_SHAPES.length - 1 });
    genes.push({ id: `${group}.rate`, label: `LFO ${i + 1} rate`, kind: 'cont', group, min: LFO_RATE_RANGE[0], max: LFO_RATE_RANGE[1], exp: true });
    genes.push({ id: `${group}.phase`, label: `LFO ${i + 1} phase`, kind: 'cont', group, min: 0, max: 1 });
  }

  for (let i = 0; i < ROUTE_SLOTS; i++) {
    const group = `route.${i}`;
    const on = `${group}.on`;
    genes.push({ id: on, label: `Route ${i + 1}`, kind: 'bool', group, min: 0, max: 1 });
    genes.push({ id: `${group}.src`, label: `Route ${i + 1} LFO`, kind: 'choice', group, min: 0, max: LFO_COUNT - 1, activeIf: on });
    genes.push({ id: `${group}.target`, label: `Route ${i + 1} target`, kind: 'choice', group, min: 0, max: MOD_TARGETS.length - 1, activeIf: on });
    genes.push({ id: `${group}.depth`, label: `Route ${i + 1} depth`, kind: 'cont', group, min: -1, max: 1, activeIf: on });
    genes.push({ id: `${group}.exp`, label: `Route ${i + 1} exp`, kind: 'bool', group, min: 0, max: 1, activeIf: on });
  }

  for (const k of COUPLING_KEYS) {
    genes.push({ id: `c.${k}`, label: `Coupling · ${k}`, kind: 'cont', group: 'coupling', min: -1, max: 1 });
  }
  return genes;
}

export const GENES: readonly GeneDef[] = buildGenes();
export const GENE_INDEX: ReadonlyMap<string, number> = new Map(GENES.map((g, i) => [g.id, i]));

export function geneById(id: string): GeneDef | undefined {
  const i = GENE_INDEX.get(id);
  return i === undefined ? undefined : GENES[i];
}

/** Index of a gene id; throws for unknown ids (a programming error, not user data). */
export function geneIndex(id: string): number {
  const i = GENE_INDEX.get(id);
  if (i === undefined) throw new Error(`unknown gene ${id}`);
  return i;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Normalized gene value → real parameter value. Bool/choice pass through. */
export function geneValue(def: GeneDef, x: number): number {
  if (def.kind !== 'cont') return x;
  const t = clamp01(x);
  if (def.exp && def.min > 0) return def.min * Math.pow(def.max / def.min, t);
  return def.min + t * (def.max - def.min);
}

/** Real parameter value → normalized gene value (clamped to [0,1]). */
export function geneFromValue(def: GeneDef, v: number): number {
  if (def.kind !== 'cont') return v;
  if (def.max === def.min) return 0;
  if (def.exp && def.min > 0) {
    const safe = Math.max(def.min, Math.min(def.max, v));
    return clamp01(Math.log(safe / def.min) / Math.log(def.max / def.min));
  }
  return clamp01((v - def.min) / (def.max - def.min));
}

/** Whether gene i currently matters (its gate, if any, is on). */
export function isGeneActive(genome: readonly number[], i: number): boolean {
  const gate = GENES[i].activeIf;
  if (!gate) return true;
  const gi = GENE_INDEX.get(gate);
  return gi === undefined ? true : genome[gi] === 1;
}
