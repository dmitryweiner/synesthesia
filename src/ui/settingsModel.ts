// The ⚙ Settings page's pure side (no DOM): how a slider maps to a value,
// which controls exist and with what ranges, which filter rows a filter type
// uses, the 5-formula cap, and which routes each tab lists. The page itself
// (ui/settings.ts) only builds widgets from this.
//
// One property matters above the rest (tests/settings.test.ts): everything
// the page lets you set survives the genome, because closing the settings
// commits the point through encodeGenome — what you heard is what stays.
import type { LfoShape, ModRoute } from '../dsp/mod';
import { isFormulaId } from '../dsp/generator';
import type { FilterType, FxModParam, FxOnKey, FxState } from '../schema/audio';
import {
  CHORUS_MODES, FILTER_TYPES, FORMULAS, FX_EXP_PARAMS, FX_MOD_PARAMS, FX_PARAM_LABELS,
  FX_PARAM_RANGES, MAX_ENABLED_FORMULAS, PHASER_STAGES, REVERB_DECAY_RANGE, isChorusMode, isFilterType,
} from '../schema/audio';
import { ALWAYS_ON_CARD_IDS, CARDS, isCardId } from '../schema/visual';
import type { AppState, CouplingKey } from '../state/schema';
import { COUPLING_KEYS, COUPLING_RANGES, EXPLICIT_COUPLING_KEYS } from '../state/schema';
import { canonicalJson } from '../state/canonical';
import { COUPLING_LABELS } from '../coupling';
import { LFO_RATE_RANGE, MOD_TARGETS, ROUTE_SLOTS, modTargetIndex } from '../genome/genes';

// ---------------------------------------------------------------------------
// Slider scales

export interface Scale {
  min: number;
  max: number;
  step?: number;
  /** Frequency-like: the slider moves in octaves. */
  exp?: boolean;
}

/** Positions of a logarithmic slider (1000 → 8 cents a step across 20–2000 Hz). */
export const LOG_STEPS = 1000;

export function isLogScale(s: Scale): boolean {
  return s.exp === true && s.min > 0 && s.max > s.min;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** min/max/step for the <input type="range">. */
export function rangeAttrs(s: Scale): { min: number; max: number; step: number } {
  if (isLogScale(s)) return { min: 0, max: LOG_STEPS, step: 1 };
  return { min: s.min, max: s.max, step: s.step ?? (s.max - s.min) / LOG_STEPS };
}

export function toSliderPos(s: Scale, v: number): number {
  if (!isLogScale(s)) return clamp(v, s.min, s.max);
  const t = Math.log(clamp(v, s.min, s.max) / s.min) / Math.log(s.max / s.min);
  return Math.round(t * LOG_STEPS);
}

/** Value at a slider position. Whole-step exp values come out whole, as the genome decodes them. */
export function fromSliderPos(s: Scale, pos: number): number {
  if (!isLogScale(s)) return clamp(pos, s.min, s.max);
  const v = s.min * Math.pow(s.max / s.min, clamp(pos, 0, LOG_STEPS) / LOG_STEPS);
  return s.step !== undefined && s.step >= 1 ? clamp(Math.round(v), s.min, s.max) : v;
}

/** A slider's readout: as many decimals as its step has; without a step, ~3 significant digits. */
export function formatValue(v: number, step?: number): string {
  if (!Number.isFinite(v)) return '—';
  if (step !== undefined && step > 0) {
    const decimals = clamp(Math.ceil(-Math.log10(step) - 1e-9), 0, 4);
    return v.toFixed(decimals);
  }
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return String(Number(v.toPrecision(3)));
}

// ---------------------------------------------------------------------------
// Effects: one card per module, in the order the chain runs
// (Filter → Chorus → Phaser → Delay → Reverb → Limiter, see audio/engine.ts)

export type FxNumKey = FxModParam | 'reverbDecay';
export type FxChoiceKey = 'filterType' | 'chorusMode' | 'phaserStages';

export interface ControlSpec<K extends string = string> extends Scale {
  k: K;
  name: string;
  step: number;
}

export interface FxChoiceSpec {
  k: FxChoiceKey;
  name: string;
  options: { value: string; label: string; group?: string }[];
}

export interface FxCardSpec {
  on: FxOnKey;
  title: string;
  tag: string;
  choices: FxChoiceSpec[];
  sliders: ControlSpec<FxNumKey>[];
}

function fx(k: FxModParam, name: string, step: number): ControlSpec<FxNumKey> {
  const [min, max] = FX_PARAM_RANGES[k];
  return { k, name, min, max, step, exp: FX_EXP_PARAMS.has(k) || undefined };
}

const FILTER_LABELS: Record<FilterType, string> = {
  lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', notch: 'Notch', peaking: 'Peaking',
  lowshelf: 'Low-shelf', highshelf: 'High-shelf', allpass: 'All-pass', formant: 'Formant (vowel)', comb: 'Comb',
};

export const FX_CARDS: readonly FxCardSpec[] = [
  {
    on: 'filterOn', title: 'Filter', tag: 'biquad · formant · comb',
    choices: [{
      k: 'filterType', name: 'Type',
      options: FILTER_TYPES.map((t) => ({ value: t, label: FILTER_LABELS[t], group: t === 'formant' || t === 'comb' ? 'Character' : 'Biquad' })),
    }],
    sliders: [
      fx('filterFreq', 'Cutoff (Hz)', 1), fx('filterQ', 'Q', 0.1), fx('filterGain', 'Gain (dB)', 0.1),
      fx('filterVowel', 'Vowel (A–U)', 0.01), fx('filterCombFb', 'Feedback', 0.01),
    ],
  },
  {
    on: 'chorusOn', title: 'Chorus / Flanger', tag: 'modulated delay',
    choices: [{ k: 'chorusMode', name: 'Mode', options: CHORUS_MODES.map((m) => ({ value: m, label: m === 'chorus' ? 'Chorus' : 'Flanger' })) }],
    sliders: [fx('chorusRate', 'Rate (Hz)', 0.01), fx('chorusDepth', 'Depth (ms)', 0.1), fx('chorusMix', 'Mix (dry↔wet)', 0.01), fx('chorusFb', 'Feedback', 0.01)],
  },
  {
    on: 'phaserOn', title: 'Phaser', tag: 'all-pass stages',
    choices: [{ k: 'phaserStages', name: 'Stages', options: PHASER_STAGES.map((n) => ({ value: String(n), label: String(n) })) }],
    sliders: [fx('phaserRate', 'Rate (Hz)', 0.01), fx('phaserDepth', 'Depth', 0.01), fx('phaserFb', 'Feedback', 0.01), fx('phaserMix', 'Mix (dry↔wet)', 0.01)],
  },
  {
    on: 'delayOn', title: 'Delay / Echo', tag: 'feedback loop',
    choices: [],
    sliders: [fx('delayTime', 'Time (s)', 0.01), fx('delayFb', 'Feedback', 0.01), fx('delayMix', 'Mix (dry↔wet)', 0.01), fx('delayShimmer', 'Shimmer (octave up)', 0.01)],
  },
  {
    on: 'reverbOn', title: 'Reverb', tag: 'convolver',
    choices: [],
    sliders: [
      { k: 'reverbDecay', name: 'Decay (s)', min: REVERB_DECAY_RANGE[0], max: REVERB_DECAY_RANGE[1], step: 0.1 },
      fx('reverbMix', 'Mix (dry↔wet)', 0.01),
    ],
  },
  {
    on: 'limiterOn', title: 'Limiter', tag: 'anti-clip',
    choices: [],
    sliders: [fx('limiterThr', 'Threshold (dB)', 0.5), fx('limiterRel', 'Release (s)', 0.01)],
  },
];

export function fxChoiceValue(state: Readonly<FxState>, k: FxChoiceKey): string {
  return String(state[k]);
}

/** Sets a choice from a <select>'s value; anything the engine doesn't know is ignored. */
export function setFxChoice(state: FxState, k: FxChoiceKey, value: string): void {
  if (k === 'filterType') {
    if (isFilterType(value)) state.filterType = value;
  } else if (k === 'chorusMode') {
    if (isChorusMode(value)) state.chorusMode = value;
  } else {
    const n = Number(value);
    if (PHASER_STAGES.includes(n)) state.phaserStages = n;
  }
}

export interface FilterControls {
  q: boolean;
  gain: boolean;
  vowel: boolean;
  comb: boolean;
  freqLabel: string;
  qLabel: string;
}

const BIQUAD: readonly FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf', 'allpass'];

/** Which filter rows a type uses, and what its frequency/Q mean (formula-synth's rules). */
export function filterControls(type: FilterType): FilterControls {
  const centred = type === 'bandpass' || type === 'notch' || type === 'peaking' || type === 'allpass';
  return {
    q: BIQUAD.includes(type) || type === 'formant',
    gain: type === 'peaking' || type === 'lowshelf' || type === 'highshelf',
    vowel: type === 'formant',
    comb: type === 'comb',
    freqLabel: type === 'comb' ? 'Pitch (Hz)' : type === 'formant' ? 'Formant shift (Hz)' : centred ? 'Frequency (Hz)' : 'Cutoff (Hz)',
    qLabel: type === 'formant' ? 'Resonance' : 'Q',
  };
}

const VOWELS = ['A', 'E', 'I', 'O', 'U'];

export function vowelLabel(v: number): string {
  return VOWELS[clamp(Math.round(v * 4), 0, 4)];
}

// ---------------------------------------------------------------------------
// Formulas

export function enabledFormulas(state: Readonly<AppState>): number {
  return FORMULAS.filter((f) => state.audio.formulas[f.id]?.enabled).length;
}

/** More than MAX_ENABLED_FORMULAS turns into mush — evolution keeps to it, and so does the page. */
export function canEnableFormula(state: Readonly<AppState>, id: string): boolean {
  return state.audio.formulas[id]?.enabled === true || enabledFormulas(state) < MAX_ENABLED_FORMULAS;
}

// ---------------------------------------------------------------------------
// Sound → image

export interface CouplingControl extends ControlSpec<CouplingKey> {
  /** 'offset': a signed nudge to one card param; 'effect': a display effect (kept ≥ 1.2 in total by evolution). */
  kind: 'offset' | 'effect';
}

export const COUPLING_CONTROLS: readonly CouplingControl[] = COUPLING_KEYS.map((k) => ({
  k,
  name: COUPLING_LABELS[k],
  min: COUPLING_RANGES[k][0],
  max: COUPLING_RANGES[k][1],
  step: 0.01,
  kind: EXPLICIT_COUPLING_KEYS.some((e) => e === k) ? 'effect' : 'offset',
}));

// ---------------------------------------------------------------------------
// Modulation. The LFO pool is shared by sound and picture; each tab lists
// the routes of its own side.

export type Domain = 'sound' | 'picture';
export const FX_TARGET = 'fx';

export const LFO_RATE_SCALE: Scale = { min: LFO_RATE_RANGE[0], max: LFO_RATE_RANGE[1], exp: true };
export const LFO_PHASE_SCALE: ControlSpec = { k: 'phase', name: 'Phase', min: 0, max: 1, step: 0.01 };
export const ROUTE_DEPTH_SCALE: ControlSpec = { k: 'depth', name: 'Depth', min: -1, max: 1, step: 0.01 };
const NEW_ROUTE_DEPTH = 0.2;

export const LFO_SHAPE_LABELS: Readonly<Record<LfoShape, string>> = {
  sine: 'Sine', triangle: 'Triangle', saw: 'Saw', square: 'Square', random: 'Random (S&H)', pink: 'Pink (1/f)',
};

export function routeDomain(target: string): Domain {
  return isCardId(target) ? 'picture' : 'sound';
}

export interface TargetParam {
  k: string;
  name: string;
  exp: boolean;
}

export interface TargetGroup {
  id: string;
  title: string;
  params: TargetParam[];
}

function paramsOf(target: string): TargetParam[] {
  return MOD_TARGETS.filter((t) => t.target === target).map((t) => ({
    k: t.param,
    name: target === FX_TARGET ? t.label : t.label.slice(t.label.indexOf(' · ') + 3),
    exp: t.exp,
  }));
}

/** What a route on this side can aim at: formulas then the effects, or the picture's cards. */
export function targetGroups(domain: Domain): TargetGroup[] {
  if (domain === 'picture') return CARDS.map((c) => ({ id: c.id, title: c.title, params: paramsOf(c.id) }));
  return [
    ...FORMULAS.map((f) => ({ id: f.id, title: f.title, params: paramsOf(f.id) })),
    { id: FX_TARGET, title: 'Effects', params: FX_MOD_PARAMS.map((p) => ({ k: p, name: FX_PARAM_LABELS[p], exp: FX_EXP_PARAMS.has(p) })) },
  ];
}

/** Whether a route's target is audible/visible now (its formula or card is on; effects always are). */
export function isTargetOn(state: Readonly<AppState>, target: string): boolean {
  if (target === FX_TARGET) return true;
  if (isFormulaId(target)) return state.audio.formulas[target]?.enabled === true;
  if (ALWAYS_ON_CARD_IDS.some((id) => id === target)) return true;
  return state.visual.cards[target]?.on === true;
}

export function canAddRoute(state: Readonly<AppState>): boolean {
  return state.mod.routes.length < ROUTE_SLOTS;
}

/** A fresh route for one side: LFO 1 on the first thing that is on there. */
export function newRoute(state: Readonly<AppState>, domain: Domain): ModRoute {
  const groups = targetGroups(domain);
  const group = groups.find((g) => g.id !== FX_TARGET && isTargetOn(state, g.id)) ?? groups[groups.length - 1];
  const param = group.params[0];
  const route: ModRoute = { src: 0, target: group.id, param: param.k, depth: NEW_ROUTE_DEPTH };
  if (param.exp) route.exp = true;
  return route;
}

/** The octave flag the schema gives a target (frequency-like params move in octaves). */
export function targetExp(target: string, param: string): boolean {
  const i = modTargetIndex(target, param);
  return i >= 0 && MOD_TARGETS[i].exp;
}

/** `target.param` of every route that moves something — those sliders get a ∿. */
export function modulatedKeys(routes: readonly ModRoute[]): Set<string> {
  return new Set(routes.filter((r) => r.depth !== 0).map((r) => `${r.target}.${r.param}`));
}

// ---------------------------------------------------------------------------

/** Same point for every gene, up to the genome codec's float noise; volume and name don't count. */
export function samePoint(a: Readonly<AppState>, b: Readonly<AppState>): boolean {
  const key = (s: Readonly<AppState>): string => canonicalJson(JSON.parse(JSON.stringify(
    {
      fx: s.audio.fx, formulas: s.audio.formulas, visual: s.visual, coupling: s.coupling,
      lfos: s.mod.lfos, routes: s.mod.routes.map((r) => ({ ...r, exp: r.exp === true })),
    },
    (_k, v: unknown) => (typeof v === 'number' ? Number(v.toPrecision(9)) : v),
  )));
  return key(a) === key(b);
}
