// Serializable app state (URL hash, localStorage, presets) — v1. AppState is
// both the live in-memory state and the serializable shape. Parsing is
// tolerant: unknown/malformed fields are silently dropped and covered by
// defaults. No `as` casts — only type guards.
import type { Params } from '../dsp/generator';
import { isFormulaId } from '../dsp/generator';
import type { LfoDef, LfoShape, ModRoute, ModState } from '../dsp/mod';
import type { FxState } from '../schema/audio';
import {
  DEFAULT_FX, FORMULAS, FX_PARAM_RANGES, PHASER_STAGES, REVERB_DECAY_RANGE,
  isChorusMode, isFilterType, isFxModParam, formulaDef,
} from '../schema/audio';
import type { CardDef } from '../schema/visual';
import { CARDS, DEFAULT_OFF_CARD_IDS, cardDef, isCardId, isVisualModTarget } from '../schema/visual';

export const LFO_COUNT = 4;
export const DEFAULT_MASTER_GAIN = 0.75;
// A gentle default: slow breathing (20s cycle), silent until routed.
export const DEFAULT_LFO: Readonly<LfoDef> = { shape: 'sine', rate: 0.05, phase: 0 };

// Audio → image coupling strengths (genes). The first five offset card
// params (src/coupling.ts) and are signed; the four "explicit" ones drive
// display-level effects and onset seeding (src/visualFx.ts, PLAN.md #8),
// range 0..1, and must together stay ≥ COUPLING_FLOOR so evolution can't
// mute the link (genome/evolve.ts repair()).
export const CARD_COUPLING_KEYS = ['loudToFlow', 'loudToCurl', 'loudToGloss', 'brightToShift', 'onsetToLight'] as const;
export const EXPLICIT_COUPLING_KEYS = ['loudToPulse', 'onsetToFlash', 'onsetToSeed', 'spectrumToTint'] as const;
export const COUPLING_KEYS = [...CARD_COUPLING_KEYS, ...EXPLICIT_COUPLING_KEYS] as const;
export type CardCouplingKey = (typeof CARD_COUPLING_KEYS)[number];
export type ExplicitCouplingKey = (typeof EXPLICIT_COUPLING_KEYS)[number];
export type CouplingKey = (typeof COUPLING_KEYS)[number];
export type CouplingState = Record<CouplingKey, number>;
export const COUPLING_FLOOR = 1.2;

export const COUPLING_RANGES: Readonly<Record<CouplingKey, readonly [number, number]>> = {
  loudToFlow: [-1, 1], loudToCurl: [-1, 1], loudToGloss: [-1, 1], brightToShift: [-1, 1], onsetToLight: [-1, 1],
  loudToPulse: [0, 1], onsetToFlash: [0, 1], onsetToSeed: [0, 1], spectrumToTint: [0, 1],
};

export interface FormulaSnapshot {
  enabled: boolean;
  params: Params;
}

export interface CardState {
  on: boolean;
  params: Record<string, number>;
}

export interface AudioState {
  masterGain: number;
  fx: FxState;
  formulas: Record<string, FormulaSnapshot>;
}

export interface VisualState {
  cards: Record<string, CardState>;
}

export interface AppState {
  v: 1;
  presetName?: string;
  audio: AudioState;
  visual: VisualState;
  mod: ModState;
  coupling: CouplingState;
}

export interface PartialFormulaSnapshot {
  enabled?: boolean;
  params?: Params;
}

export interface PartialCardState {
  on?: boolean;
  params?: Record<string, number>;
}

export interface PartialAppState {
  presetName?: string;
  audio?: {
    masterGain?: number;
    fx?: Partial<FxState>;
    formulas?: Record<string, PartialFormulaSnapshot>;
  };
  visual?: {
    cards?: Record<string, PartialCardState>;
  };
  mod?: ModState;
  coupling?: Partial<CouplingState>;
}

function defaultCardState(card: CardDef): CardState {
  const params: Record<string, number> = {};
  for (const s of card.sliders) params[s.k] = s.value;
  for (const s of card.selects ?? []) params[s.k] = s.value;
  return { on: !DEFAULT_OFF_CARD_IDS.some((id) => id === card.id), params };
}

// Explicit couplings default above the floor, so points saved before they
// existed (old #s= links, localStorage) also get a visible link.
export function defaultCoupling(): CouplingState {
  return {
    loudToFlow: 0, loudToCurl: 0, loudToGloss: 0, brightToShift: 0, onsetToLight: 0,
    loudToPulse: 0.5, onsetToFlash: 0.5, onsetToSeed: 0.4, spectrumToTint: 0.4,
  };
}

export function defaultAppState(): AppState {
  const formulas: Record<string, FormulaSnapshot> = {};
  for (const f of FORMULAS) {
    const params: Params = {};
    for (const s of f.sliders) params[s.k] = s.value;
    formulas[f.id] = { enabled: false, params };
  }
  const cards: Record<string, CardState> = {};
  for (const card of CARDS) cards[card.id] = defaultCardState(card);
  const lfos: LfoDef[] = [];
  for (let i = 0; i < LFO_COUNT; i++) lfos.push({ ...DEFAULT_LFO });
  return {
    v: 1,
    audio: { masterGain: DEFAULT_MASTER_GAIN, fx: { ...DEFAULT_FX }, formulas },
    visual: { cards },
    mod: { lfos, routes: [] },
    coupling: defaultCoupling(),
  };
}

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null;
}

function isFiniteNumber(u: unknown): u is number {
  return typeof u === 'number' && Number.isFinite(u);
}

function toParams(u: unknown): Record<string, number> | undefined {
  if (!isRecord(u)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(u)) {
    if (isFiniteNumber(v)) out[k] = v;
  }
  return out;
}

const FX_BOOL_KEYS = ['filterOn', 'chorusOn', 'reverbOn', 'limiterOn', 'delayOn', 'phaserOn'] as const;
const FX_NUM_KEYS = [
  'filterFreq', 'filterQ', 'filterGain', 'filterVowel', 'filterCombFb',
  'chorusRate', 'chorusDepth', 'chorusMix', 'chorusFb',
  'reverbDecay', 'reverbMix', 'limiterThr', 'limiterRel',
  'delayTime', 'delayFb', 'delayMix',
  'phaserRate', 'phaserDepth', 'phaserStages', 'phaserFb', 'phaserMix',
] as const;

function sanitizeFx(u: unknown): Partial<FxState> | undefined {
  if (!isRecord(u)) return undefined;
  const fx: Partial<FxState> = {};
  for (const k of FX_BOOL_KEYS) {
    if (typeof u[k] === 'boolean') fx[k] = u[k] === true;
  }
  for (const k of FX_NUM_KEYS) {
    const v = u[k];
    if (isFiniteNumber(v)) fx[k] = v;
  }
  if (isFilterType(u.filterType)) fx.filterType = u.filterType;
  if (isChorusMode(u.chorusMode)) fx.chorusMode = u.chorusMode;
  return fx;
}

function sanitizeFormulas(u: unknown): Record<string, PartialFormulaSnapshot> | undefined {
  if (!isRecord(u)) return undefined;
  const out: Record<string, PartialFormulaSnapshot> = {};
  for (const [id, st] of Object.entries(u)) {
    if (!isFormulaId(id) || !isRecord(st)) continue;
    const snap: PartialFormulaSnapshot = {};
    if (typeof st.enabled === 'boolean') snap.enabled = st.enabled;
    const params = toParams(st.params);
    if (params) snap.params = params;
    out[id] = snap;
  }
  return out;
}

function sanitizeCards(u: unknown): Record<string, PartialCardState> | undefined {
  if (!isRecord(u)) return undefined;
  const out: Record<string, PartialCardState> = {};
  for (const [id, st] of Object.entries(u)) {
    if (!isCardId(id) || !isRecord(st)) continue;
    const snap: PartialCardState = {};
    if (typeof st.on === 'boolean') snap.on = st.on;
    const params = toParams(st.params);
    if (params) snap.params = params;
    out[id] = snap;
  }
  return out;
}

const LFO_SHAPE_SET: ReadonlySet<string> = new Set(['sine', 'triangle', 'saw', 'square', 'random']);
function isLfoShape(v: unknown): v is LfoShape {
  return typeof v === 'string' && LFO_SHAPE_SET.has(v);
}

function sanitizeLfo(u: unknown): LfoDef | null {
  if (!isRecord(u)) return null;
  const { shape, rate, phase } = u;
  if (!isLfoShape(shape) || !isFiniteNumber(rate) || !isFiniteNumber(phase)) return null;
  return { shape, rate, phase };
}

/** Whether (target, param) names a real modulation target in any namespace. */
export function isModTarget(target: string, param: string): boolean {
  if (target === 'fx') return isFxModParam(param);
  if (isFormulaId(target)) return formulaDef(target)?.sliders.some((s) => s.k === param) ?? false;
  return isVisualModTarget(target, param);
}

// Routes reference LFOs by index (src): a malformed LFO is replaced with the
// default (not dropped — that would shift every later index); malformed
// routes are dropped individually. The pool is padded/truncated to LFO_COUNT.
function sanitizeRoute(u: unknown, lfoCount: number): ModRoute | null {
  if (!isRecord(u)) return null;
  const { src, target, param, depth, exp } = u;
  if (typeof src !== 'number' || !Number.isInteger(src) || src < 0 || src >= lfoCount) return null;
  if (typeof target !== 'string' || typeof param !== 'string') return null;
  if (!isModTarget(target, param)) return null;
  if (!isFiniteNumber(depth)) return null;
  const route: ModRoute = { src, target, param, depth: Math.max(-1, Math.min(1, depth)) };
  if (exp === true) route.exp = true;
  return route;
}

function sanitizeMod(u: unknown): ModState | undefined {
  if (!isRecord(u)) return undefined;
  if (!Array.isArray(u.lfos) || !Array.isArray(u.routes)) return undefined;
  const lfos: LfoDef[] = [];
  for (let i = 0; i < LFO_COUNT; i++) lfos.push(sanitizeLfo(u.lfos[i]) ?? { ...DEFAULT_LFO });
  const routes: ModRoute[] = [];
  for (const raw of u.routes) {
    const route = sanitizeRoute(raw, lfos.length);
    if (route) routes.push(route);
  }
  return { lfos, routes };
}

function sanitizeCoupling(u: unknown): Partial<CouplingState> | undefined {
  if (!isRecord(u)) return undefined;
  const out: Partial<CouplingState> = {};
  for (const k of COUPLING_KEYS) {
    const v = u[k];
    if (isFiniteNumber(v)) out[k] = v;
  }
  return out;
}

/** Tolerant parse of untrusted JSON (URL hash, localStorage, presets). */
export function sanitizeState(u: unknown): PartialAppState | null {
  if (!isRecord(u)) return null;
  const out: PartialAppState = {};
  if (typeof u.presetName === 'string') out.presetName = u.presetName;
  if (isRecord(u.audio)) {
    const audio: PartialAppState['audio'] = {};
    if (isFiniteNumber(u.audio.masterGain)) audio.masterGain = u.audio.masterGain;
    const fx = sanitizeFx(u.audio.fx);
    if (fx) audio.fx = fx;
    const formulas = sanitizeFormulas(u.audio.formulas);
    if (formulas) audio.formulas = formulas;
    out.audio = audio;
  }
  if (isRecord(u.visual)) {
    const cards = sanitizeCards(u.visual.cards);
    out.visual = cards ? { cards } : {};
  }
  const mod = sanitizeMod(u.mod);
  if (mod) out.mod = mod;
  const coupling = sanitizeCoupling(u.coupling);
  if (coupling) out.coupling = coupling;
  return out;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function clampFx(fx: FxState): void {
  for (const [k, range] of Object.entries(FX_PARAM_RANGES)) {
    if (isFxModParam(k)) fx[k] = clamp(fx[k], range[0], range[1]);
  }
  fx.reverbDecay = clamp(fx.reverbDecay, REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1]);
  if (!PHASER_STAGES.includes(fx.phaserStages)) fx.phaserStages = DEFAULT_FX.phaserStages;
}

/** Partial state overlaid on defaults → a fresh, fully-populated AppState. */
export function stateToAppState(partial: PartialAppState): AppState {
  const state = defaultAppState();
  if (partial.audio) {
    if (typeof partial.audio.masterGain === 'number') state.audio.masterGain = clamp(partial.audio.masterGain, 0, 1);
    if (partial.audio.fx) {
      state.audio.fx = { ...state.audio.fx, ...partial.audio.fx };
      clampFx(state.audio.fx);
    }
    if (partial.audio.formulas) {
      for (const [id, snap] of Object.entries(partial.audio.formulas)) {
        const def = formulaDef(id);
        const target = state.audio.formulas[id];
        if (!def || !target) continue;
        if (typeof snap.enabled === 'boolean') target.enabled = snap.enabled;
        if (snap.params) {
          for (const s of def.sliders) {
            const v = snap.params[s.k];
            if (typeof v === 'number' && Number.isFinite(v)) target.params[s.k] = clamp(v, s.min, s.max);
          }
        }
      }
    }
  }
  if (partial.visual?.cards) {
    for (const [id, snap] of Object.entries(partial.visual.cards)) {
      const card = cardDef(id);
      const target = state.visual.cards[id];
      if (!card || !target) continue;
      if (typeof snap.on === 'boolean') target.on = snap.on;
      if (snap.params) {
        for (const s of card.sliders) {
          const v = snap.params[s.k];
          if (typeof v === 'number' && Number.isFinite(v)) target.params[s.k] = clamp(v, s.min, s.max);
        }
        for (const s of card.selects ?? []) {
          const v = snap.params[s.k];
          if (typeof v === 'number' && s.options.some((o) => o.v === v)) target.params[s.k] = v;
        }
      }
    }
  }
  if (partial.mod) {
    state.mod = {
      lfos: partial.mod.lfos.map((l) => ({ ...l })),
      routes: partial.mod.routes.map((r) => ({ ...r })),
    };
  }
  if (partial.coupling) {
    for (const k of COUPLING_KEYS) {
      const v = partial.coupling[k];
      if (typeof v === 'number') state.coupling[k] = clamp(v, COUPLING_RANGES[k][0], COUPLING_RANGES[k][1]);
    }
  }
  if (partial.presetName) state.presetName = partial.presetName;
  return state;
}

/** Deep clone for save/share, so callers never alias live state. */
export function cloneAppState(state: AppState): AppState {
  const formulas: Record<string, FormulaSnapshot> = {};
  for (const [id, f] of Object.entries(state.audio.formulas)) formulas[id] = { enabled: f.enabled, params: { ...f.params } };
  const cards: Record<string, CardState> = {};
  for (const [id, c] of Object.entries(state.visual.cards)) cards[id] = { on: c.on, params: { ...c.params } };
  const clone: AppState = {
    v: 1,
    audio: { masterGain: state.audio.masterGain, fx: { ...state.audio.fx }, formulas },
    visual: { cards },
    mod: {
      lfos: state.mod.lfos.map((l) => ({ ...l })),
      routes: state.mod.routes.map((r) => ({ ...r })),
    },
    coupling: { ...state.coupling },
  };
  if (state.presetName) clone.presetName = state.presetName;
  return clone;
}
