// AppState ⇄ Genome. Everything the evolution can touch is a gene; what it
// can't (presetName, masterGain) is not, and decode fills defaults for it.
import type { AppState } from '../state/schema';
import { COUPLING_KEYS, LFO_COUNT, defaultAppState } from '../state/schema';
import type { ModRoute } from '../dsp/mod';
import { FORMULAS, FX_MOD_PARAMS, FX_ON_KEYS, FILTER_TYPES, CHORUS_MODES, PHASER_STAGES } from '../schema/audio';
import { CARDS, ALWAYS_ON_CARD_IDS } from '../schema/visual';
import { GENES, GENE_INDEX, LFO_SHAPES, MOD_TARGETS, ROUTE_SLOTS, geneFromValue, geneIndex, geneValue, modTargetIndex } from './genes';

export type Genome = number[];

export function genomeLength(): number {
  return GENES.length;
}

function setVal(g: Genome, id: string, real: number): void {
  const i = geneIndex(id);
  g[i] = geneFromValue(GENES[i], real);
}

function setRaw(g: Genome, id: string, raw: number): void {
  g[geneIndex(id)] = raw;
}

function getVal(g: Genome, id: string): number {
  const i = geneIndex(id);
  const def = GENES[i];
  const v = geneValue(def, g[i]);
  return def.step !== undefined && def.step >= 1 ? Math.round(v) : v;
}

function getRaw(g: Genome, id: string): number {
  return g[geneIndex(id)];
}

function choiceIndex<T>(list: readonly T[], v: T): number {
  const i = list.indexOf(v);
  return i < 0 ? 0 : i;
}

export function encodeGenome(state: AppState): Genome {
  const g: Genome = new Array(GENES.length).fill(0);
  for (const f of FORMULAS) {
    const snap = state.audio.formulas[f.id];
    setRaw(g, `a.${f.id}.enabled`, snap?.enabled ? 1 : 0);
    for (const s of f.sliders) setVal(g, `a.${f.id}.${s.k}`, snap?.params[s.k] ?? s.value);
  }
  const fx = state.audio.fx;
  for (const on of FX_ON_KEYS) setRaw(g, `fx.${on}`, fx[on] ? 1 : 0);
  for (const p of FX_MOD_PARAMS) setVal(g, `fx.${p}`, fx[p]);
  setVal(g, 'fx.reverbDecay', fx.reverbDecay);
  setRaw(g, 'fx.filterType', choiceIndex(FILTER_TYPES, fx.filterType));
  setRaw(g, 'fx.chorusMode', choiceIndex(CHORUS_MODES, fx.chorusMode));
  setRaw(g, 'fx.phaserStages', choiceIndex(PHASER_STAGES, fx.phaserStages));

  for (const c of CARDS) {
    const card = state.visual.cards[c.id];
    if (!ALWAYS_ON_CARD_IDS.some((id) => id === c.id)) setRaw(g, `v.${c.id}.on`, card?.on ? 1 : 0);
    for (const s of c.selects ?? []) {
      const v = card?.params[s.k] ?? s.value;
      const idx = s.options.findIndex((o) => o.v === v);
      setRaw(g, `v.${c.id}.${s.k}`, idx < 0 ? 0 : idx);
    }
    for (const s of c.sliders) setVal(g, `v.${c.id}.${s.k}`, card?.params[s.k] ?? s.value);
  }

  for (let i = 0; i < LFO_COUNT; i++) {
    const lfo = state.mod.lfos[i];
    setRaw(g, `lfo.${i}.shape`, lfo ? choiceIndex(LFO_SHAPES, lfo.shape) : 0);
    setVal(g, `lfo.${i}.rate`, lfo ? lfo.rate : 0.05);
    setVal(g, `lfo.${i}.phase`, lfo ? lfo.phase : 0);
  }

  let slot = 0;
  for (const r of state.mod.routes) {
    if (slot >= ROUTE_SLOTS) break;
    const ti = modTargetIndex(r.target, r.param);
    if (ti < 0 || r.src < 0 || r.src >= LFO_COUNT) continue;
    setRaw(g, `route.${slot}.on`, 1);
    setRaw(g, `route.${slot}.src`, r.src);
    setRaw(g, `route.${slot}.target`, ti);
    setVal(g, `route.${slot}.depth`, r.depth);
    setRaw(g, `route.${slot}.exp`, r.exp ? 1 : 0);
    slot++;
  }
  for (; slot < ROUTE_SLOTS; slot++) {
    setRaw(g, `route.${slot}.on`, 0);
    setRaw(g, `route.${slot}.src`, 0);
    setRaw(g, `route.${slot}.target`, 0);
    setVal(g, `route.${slot}.depth`, 0);
    setRaw(g, `route.${slot}.exp`, 0);
  }

  for (const k of COUPLING_KEYS) setVal(g, `c.${k}`, state.coupling[k]);
  return g;
}

export function decodeGenome(g: Genome): AppState {
  const state = defaultAppState();
  for (const f of FORMULAS) {
    const snap = state.audio.formulas[f.id];
    snap.enabled = getRaw(g, `a.${f.id}.enabled`) === 1;
    for (const s of f.sliders) snap.params[s.k] = getVal(g, `a.${f.id}.${s.k}`);
  }
  const fx = state.audio.fx;
  for (const on of FX_ON_KEYS) fx[on] = getRaw(g, `fx.${on}`) === 1;
  for (const p of FX_MOD_PARAMS) fx[p] = getVal(g, `fx.${p}`);
  fx.reverbDecay = getVal(g, 'fx.reverbDecay');
  fx.filterType = FILTER_TYPES[getRaw(g, 'fx.filterType')] ?? FILTER_TYPES[0];
  fx.chorusMode = CHORUS_MODES[getRaw(g, 'fx.chorusMode')] ?? CHORUS_MODES[0];
  fx.phaserStages = PHASER_STAGES[getRaw(g, 'fx.phaserStages')] ?? PHASER_STAGES[1];

  for (const c of CARDS) {
    const card = state.visual.cards[c.id];
    if (!ALWAYS_ON_CARD_IDS.some((id) => id === c.id)) card.on = getRaw(g, `v.${c.id}.on`) === 1;
    for (const s of c.selects ?? []) {
      const opt = s.options[getRaw(g, `v.${c.id}.${s.k}`)];
      card.params[s.k] = opt ? opt.v : s.value;
    }
    for (const s of c.sliders) card.params[s.k] = getVal(g, `v.${c.id}.${s.k}`);
  }

  for (let i = 0; i < LFO_COUNT; i++) {
    state.mod.lfos[i] = {
      shape: LFO_SHAPES[getRaw(g, `lfo.${i}.shape`)] ?? 'sine',
      rate: getVal(g, `lfo.${i}.rate`),
      phase: getVal(g, `lfo.${i}.phase`),
    };
  }

  const routes: ModRoute[] = [];
  for (let i = 0; i < ROUTE_SLOTS; i++) {
    if (getRaw(g, `route.${i}.on`) !== 1) continue;
    const t = MOD_TARGETS[getRaw(g, `route.${i}.target`)];
    if (!t) continue;
    const route: ModRoute = { src: getRaw(g, `route.${i}.src`), target: t.target, param: t.param, depth: getVal(g, `route.${i}.depth`) };
    if (getRaw(g, `route.${i}.exp`) === 1) route.exp = true;
    routes.push(route);
  }
  state.mod.routes = routes;

  for (const k of COUPLING_KEYS) state.coupling[k] = getVal(g, `c.${k}`);
  return state;
}

/** Convenience for callers that only have a gene id and a genome. */
export function readGene(g: Genome, id: string): number {
  const i = GENE_INDEX.get(id);
  return i === undefined ? NaN : g[i];
}
