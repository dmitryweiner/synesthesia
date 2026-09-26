// Audio parameter schema: formula sliders (ranges/defaults, ported from
// formula-synth's formulas.ts) and the FX state shape with its modulatable
// field allowlist. No DOM here — the genome, the engine and tests all read
// this. Slider `value` is the single source of truth for defaults.
import type { FormulaId, Params } from '../dsp/generator';

export interface SliderDef {
  k: string;
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Perceptually logarithmic (frequency-like): mutate/modulate in octaves. */
  exp?: boolean;
}

export interface FormulaDef {
  id: FormulaId;
  title: string;
  tag: string;
  desc: string;
  sliders: SliderDef[];
}

export const FORMULAS: readonly FormulaDef[] = [
  { id: 'additive', title: 'Harmonic Sum', tag: 'Additive', desc: 'Σ aₙ(t) sin(2π n f t)',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.12 },
      { k: 'fund', name: 'Fund (Hz)', min: 20, max: 500, step: 1, value: 110, exp: true },
      { k: 'N', name: 'Harmonics N', min: 1, max: 40, step: 1, value: 12 },
      { k: 'move', name: 'Move (Hz)', min: 0.01, max: 5, step: 0.01, value: 0.35, exp: true },
    ] },
  { id: 'lorenz', title: 'Lorenz Attractor', tag: 'Lorenz', desc: 'Lorenz ODE mapped to freq/amp',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'sigma', name: 'σ', min: 0, max: 30, step: 0.01, value: 10 },
      { k: 'rho', name: 'ρ', min: 0, max: 60, step: 0.01, value: 28 },
      { k: 'beta', name: 'β', min: 0.1, max: 10, step: 0.0001, value: 2.6667 },
      { k: 'lBase', name: 'Base f (Hz)', min: 20, max: 400, step: 1, value: 120, exp: true },
      { k: 'lFreqScale', name: 'Freq scale', min: 0, max: 200, step: 0.1, value: 40 },
      { k: 'lAmp', name: 'Amp scale', min: 0, max: 1, step: 0.001, value: 0.25 },
    ] },
  { id: 'rossler', title: 'Rossler Attractor', tag: 'Chaos', desc: 'dx=-y-z, dy=x+ay, dz=b+z(x-c)',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'rossA', name: 'a', min: 0.01, max: 0.5, step: 0.001, value: 0.2 },
      { k: 'rossB', name: 'b', min: 0.01, max: 0.5, step: 0.001, value: 0.2 },
      { k: 'rossC', name: 'c', min: 2, max: 12, step: 0.01, value: 5.7 },
      { k: 'rossBase', name: 'Base f (Hz)', min: 20, max: 400, step: 1, value: 120, exp: true },
      { k: 'rossFreqScale', name: 'Freq scale', min: 0, max: 100, step: 0.1, value: 30 },
      { k: 'rossAmp', name: 'Amp scale', min: 0, max: 1, step: 0.001, value: 0.25 },
    ] },
  { id: 'gliss', title: 'Exponential Glissando', tag: 'Gliss', desc: 'f(t)=f0·e^{k t}',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'f0', name: 'f0 (Hz)', min: 10, max: 400, step: 1, value: 55, exp: true },
      { k: 'k', name: 'k', min: -2.0, max: 2.0, step: 0.001, value: 0.15 },
    ] },
  { id: 'shepard', title: 'Shepard Tone', tag: 'Illusion', desc: 'Endless rising illusion',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.12 },
      { k: 'shepBase', name: 'Base f (Hz)', min: 20, max: 200, step: 1, value: 55, exp: true },
      { k: 'shepSpeed', name: 'Speed', min: -0.5, max: 0.5, step: 0.001, value: 0.1 },
      { k: 'shepOctaves', name: 'Octaves', min: 3, max: 10, step: 1, value: 6 },
    ] },
  { id: 'bell', title: 'FM Bell', tag: 'Bell', desc: 'e^{-3t/d}·sin(2π f t + I·e^{-3t/d}·sin(2π·ratio·f t))',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.15 },
      { k: 'bellF0', name: 'f0 (Hz)', min: 100, max: 1000, step: 1, value: 320, exp: true },
      { k: 'bellRatio', name: 'Inharmonicity', min: 1, max: 3, step: 0.01, value: 1.4 },
      { k: 'bellIndex', name: 'FM index', min: 0, max: 10, step: 0.1, value: 4 },
      { k: 'bellDecay', name: 'Decay (s)', min: 0.5, max: 8, step: 0.1, value: 3 },
      { k: 'bellPeriod', name: 'Strike every (s)', min: 1, max: 20, step: 0.5, value: 6 },
    ] },
  { id: 'risset', title: 'Risset Bell', tag: 'Bell', desc: 'additive bell — 11 inharmonic partials (Risset, 1969)',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.4 },
      { k: 'rissF0', name: 'f0 (Hz)', min: 100, max: 1200, step: 1, value: 480, exp: true },
      { k: 'rissDecay', name: 'Decay (s)', min: 0.5, max: 12, step: 0.1, value: 5 },
      { k: 'rissPeriod', name: 'Strike every (s)', min: 1, max: 20, step: 0.5, value: 6 },
    ] },
  { id: 'fm', title: 'FM Sine', tag: 'FM', desc: 'sin(2π f_c t + I sin(2π f_m t))',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.15 },
      { k: 'fc', name: 'f_c (Hz)', min: 20, max: 2000, step: 1, value: 220, exp: true },
      { k: 'fm', name: 'f_m (Hz)', min: 0.1, max: 60, step: 0.1, value: 2.0, exp: true },
      { k: 'I', name: 'Index I', min: 0, max: 20, step: 0.01, value: 3.0 },
    ] },
  { id: 'beats', title: 'Two Sines (Beats)', tag: 'Beats', desc: 'sin(2π f t)+sin(2π(f+Δf)t)',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.12 },
      { k: 'fbeat', name: 'f (Hz)', min: 20, max: 2000, step: 1, value: 220, exp: true },
      { k: 'df', name: 'Δf (Hz)', min: 0, max: 20, step: 0.01, value: 0.8 },
    ] },
  { id: 'pm', title: 'Phase Modulation', tag: 'PM', desc: 'sin(2π f t + 5·sin(sin(2π f2 t)))',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.12 },
      { k: 'f', name: 'f (Hz)', min: 20, max: 2000, step: 1, value: 220, exp: true },
      { k: 'f2pm', name: 'f2 (Hz)', min: 0.1, max: 40, step: 0.1, value: 3, exp: true },
    ] },
  { id: 'quasi', title: 'Quasi-random LFO', tag: 'Quasi', desc: 'f(t)=fq + Aq·sin(sin(sin(w·t)))',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'fq', name: 'Base f (Hz)', min: 20, max: 500, step: 1, value: 120, exp: true },
      { k: 'Aq', name: 'Depth (Hz)', min: 0, max: 1200, step: 1, value: 220 },
      { k: 'wq', name: 'w', min: 0.05, max: 6, step: 0.01, value: 0.8, exp: true },
    ] },
  { id: 'logistic', title: 'Logistic Map', tag: 'Chaos', desc: 'xₙ₊₁ = r xₙ(1−xₙ)',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.12 },
      { k: 'base', name: 'Base f (Hz)', min: 20, max: 800, step: 1, value: 110, exp: true },
      { k: 'depth', name: 'Depth (Hz)', min: 0, max: 1200, step: 1, value: 330 },
      { k: 'r', name: 'r', min: 2.8, max: 4.0, step: 0.0001, value: 3.86 },
      { k: 'lfoHz', name: 'Update rate (Hz)', min: 1, max: 400, step: 1, value: 40, exp: true },
    ] },
  { id: 'dist', title: 'Nonlinear Saturation', tag: 'tanh', desc: 'tanh(α·sin(2π f t))',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'fd', name: 'f (Hz)', min: 20, max: 2000, step: 1, value: 110, exp: true },
      { k: 'alpha', name: 'α', min: 0, max: 10, step: 0.01, value: 3.0 },
    ] },
  { id: 'karplus', title: 'Karplus–Strong (String)', tag: 'KS', desc: 'noise-in-delay + averaging + damping',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.14 },
      { k: 'ksFreq', name: 'Freq (Hz)', min: 40, max: 880, step: 1, value: 110, exp: true },
      { k: 'ksDamp', name: 'Damping', min: 0.90, max: 0.9999, step: 0.0001, value: 0.985 },
      { k: 'ksBright', name: 'Brightness', min: 0, max: 1, step: 0.001, value: 0.5 },
    ] },
  { id: 'bytebeat', title: 'Bytebeat', tag: '8-bit', desc: 'classic integer formulas, e.g. ((t>>10)&42)·t mod 256',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'bbRecipe', name: 'Recipe #', min: 1, max: 5, step: 1, value: 1 },
      { k: 'bbRate', name: 'Rate (Hz)', min: 1000, max: 16000, step: 100, value: 8000, exp: true },
    ] },
  { id: 'ocean', title: 'Ocean / Wind', tag: 'Noise', desc: 'noise → breathing LP filter (two slow LFOs)',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.25 },
      { k: 'oceanRate', name: 'Wave rate (Hz)', min: 0.03, max: 0.5, step: 0.001, value: 0.12, exp: true },
      { k: 'oceanCut', name: 'Cutoff (Hz)', min: 100, max: 2000, step: 1, value: 600, exp: true },
      { k: 'oceanDepth', name: 'Swell depth', min: 0, max: 1, step: 0.01, value: 0.7 },
    ] },
  { id: 'rain', title: 'Rain / Drops', tag: 'Noise', desc: 'sparse resonant water drops over a soft noise bed',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.35 },
      { k: 'rainDensity', name: 'Drops/s', min: 0.5, max: 20, step: 0.1, value: 4, exp: true },
      { k: 'rainPitch', name: 'Drop pitch (Hz)', min: 200, max: 3000, step: 1, value: 900, exp: true },
      { k: 'rainBed', name: 'Bed level', min: 0, max: 1, step: 0.01, value: 0.15 },
    ] },
  { id: 'noiselp', title: 'Noise → Low-pass', tag: 'Noise', desc: 'white noise → 1-pole LP',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'nCut', name: 'Cutoff (Hz)', min: 20, max: 18000, step: 1, value: 800, exp: true },
    ] },
  { id: 'pinknoise', title: 'Pink Noise (1/f)', tag: 'Noise', desc: 'Natural 1/f spectrum noise',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.12 },
      { k: 'pinkBright', name: 'Brightness', min: 0, max: 1, step: 0.01, value: 0.3 },
    ] },
  { id: 'brownnoise', title: 'Brown Noise (Brownian)', tag: 'Noise', desc: 'Random walk — deep rumble',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.15 },
      { k: 'brownStep', name: 'Step size', min: 0.001, max: 0.1, step: 0.001, value: 0.02, exp: true },
    ] },
  { id: 'velvetnoise', title: 'Velvet Noise', tag: 'Noise', desc: 'Sparse random impulses',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.10 },
      { k: 'velvetDensity', name: 'Density (imp/s)', min: 100, max: 10000, step: 10, value: 2000, exp: true },
    ] },
  // Appended last (PLAN.md #20): an index shift would change every other
  // formula's noise seed (src/audio/seed.ts).
  { id: 'tanpura', title: 'Tanpura', tag: 'Drone', desc: 'four plucked strings Pa–Sa–Sa–Sa, jawari bridge buzz',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.3 },
      { k: 'tanSa', name: 'Low Sa (Hz)', min: 30, max: 220, step: 0.1, value: 55, exp: true },
      { k: 'tanCycle', name: 'Cycle (s)', min: 2, max: 16, step: 0.1, value: 5, exp: true },
      { k: 'tanJawari', name: 'Jawari', min: 0, max: 1, step: 0.01, value: 0.5 },
      { k: 'tanSustain', name: 'Sustain (s)', min: 2, max: 30, step: 0.1, value: 16, exp: true },
      { k: 'tanBright', name: 'Pluck brightness', min: 0, max: 1, step: 0.01, value: 0.45 },
    ] },
  { id: 'bowl', title: 'Singing bowl', tag: 'Drone', desc: 'four inharmonic modes, each a slowly beating pair — a breathing hum',
    sliders: [
      { k: 'gain', name: 'Gain', min: 0, max: 1, step: 0.001, value: 0.25 },
      { k: 'bowlF', name: 'Pitch (Hz)', min: 40, max: 800, step: 0.1, value: 130, exp: true },
      { k: 'bowlBeat', name: 'Breathing (Hz)', min: 0.05, max: 3, step: 0.01, value: 0.4, exp: true },
      { k: 'bowlBright', name: 'Upper modes', min: 0, max: 1, step: 0.01, value: 0.4 },
    ] },
];

export function formulaDef(id: string): FormulaDef | undefined {
  return FORMULAS.find((f) => f.id === id);
}

/** UI defaults of a formula as a params record. */
export function formulaDefaults(id: FormulaId): Params {
  const def = formulaDef(id);
  const params: Params = {};
  if (def) for (const s of def.sliders) params[s.k] = s.value;
  return params;
}

// ---------------------------------------------------------------------------
// FX chain state

export type FilterType =
  | 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking'
  | 'lowshelf' | 'highshelf' | 'allpass' | 'formant' | 'comb';
export type ChorusMode = 'chorus' | 'flanger';

export const FILTER_TYPES: readonly FilterType[] = [
  'lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf', 'allpass', 'formant', 'comb',
];
export const CHORUS_MODES: readonly ChorusMode[] = ['chorus', 'flanger'];
export const PHASER_STAGES: readonly number[] = [2, 4, 6, 8];

export interface FxState {
  filterOn: boolean; filterType: FilterType; filterFreq: number; filterQ: number;
  filterGain: number; filterVowel: number; filterCombFb: number;
  chorusOn: boolean; chorusMode: ChorusMode; chorusRate: number; chorusDepth: number;
  chorusMix: number; chorusFb: number;
  reverbOn: boolean; reverbDecay: number; reverbMix: number;
  limiterOn: boolean; limiterThr: number; limiterRel: number;
  delayOn: boolean; delayTime: number; delayFb: number; delayMix: number;
  delayShimmer: number; // 0..1: how much of the echo loop climbs an octave per pass
  phaserOn: boolean; phaserRate: number; phaserDepth: number; phaserStages: number;
  phaserFb: number; phaserMix: number;
}

export const DEFAULT_FX: Readonly<FxState> = {
  filterOn: false, filterType: 'lowpass', filterFreq: 1000, filterQ: 0.7,
  filterGain: 0, filterVowel: 0, filterCombFb: 0.5,
  chorusOn: false, chorusMode: 'chorus', chorusRate: 0.35, chorusDepth: 6,
  chorusMix: 0.35, chorusFb: 0.15,
  reverbOn: false, reverbDecay: 2.8, reverbMix: 0.25,
  limiterOn: true, limiterThr: -12, limiterRel: 0.15,
  delayOn: false, delayTime: 0.35, delayFb: 0.4, delayMix: 0.3,
  delayShimmer: 0, // the plain echo — every point made before shimmer sounds as it did
  phaserOn: false, phaserRate: 0.5, phaserDepth: 0.7, phaserStages: 4,
  phaserFb: 0.3, phaserMix: 0.5,
};

export const FX_ON_KEYS = ['filterOn', 'chorusOn', 'reverbOn', 'limiterOn', 'delayOn', 'phaserOn'] as const;
export type FxOnKey = (typeof FX_ON_KEYS)[number];

// Modulatable (and mutable) numeric FX fields. Discrete fields (filterType,
// chorusMode, phaserStages) and expensive ones (reverbDecay — impulse
// rebuild) are excluded: modulating them clicks.
export type FxModParam =
  | 'filterFreq' | 'filterQ' | 'filterGain' | 'filterVowel' | 'filterCombFb'
  | 'chorusRate' | 'chorusDepth' | 'chorusMix' | 'chorusFb'
  | 'reverbMix'
  | 'delayTime' | 'delayFb' | 'delayMix'
  | 'phaserRate' | 'phaserDepth' | 'phaserFb' | 'phaserMix'
  | 'limiterThr' | 'limiterRel'
  | 'delayShimmer';

export const FX_MOD_PARAMS: readonly FxModParam[] = [
  'filterFreq', 'filterQ', 'filterGain', 'filterVowel', 'filterCombFb',
  'chorusRate', 'chorusDepth', 'chorusMix', 'chorusFb',
  'delayTime', 'delayFb', 'delayMix',
  'phaserRate', 'phaserDepth', 'phaserFb', 'phaserMix',
  'reverbMix', 'limiterThr', 'limiterRel',
  'delayShimmer', // appended (PLAN.md #20)
];

export const FX_PARAM_RANGES: Record<FxModParam, readonly [number, number]> = {
  filterFreq: [20, 2000], filterQ: [0.1, 30], filterGain: [-24, 24],
  filterVowel: [0, 1], filterCombFb: [0, 0.95],
  chorusRate: [0.01, 8], chorusDepth: [0, 20], chorusMix: [0, 1], chorusFb: [0, 0.95],
  reverbMix: [0, 1],
  delayTime: [0.05, 2.0], delayFb: [0, 0.9], delayMix: [0, 1],
  phaserRate: [0.1, 10], phaserDepth: [0, 1], phaserFb: [0, 0.9], phaserMix: [0, 1],
  limiterThr: [-40, 0], limiterRel: [0.02, 1],
  delayShimmer: [0, 1],
};

/** Which FX module (on-flag) each modulatable field belongs to. */
export const FX_PARAM_MODULE: Record<FxModParam, FxOnKey> = {
  filterFreq: 'filterOn', filterQ: 'filterOn', filterGain: 'filterOn', filterVowel: 'filterOn', filterCombFb: 'filterOn',
  chorusRate: 'chorusOn', chorusDepth: 'chorusOn', chorusMix: 'chorusOn', chorusFb: 'chorusOn',
  reverbMix: 'reverbOn',
  delayTime: 'delayOn', delayFb: 'delayOn', delayMix: 'delayOn',
  phaserRate: 'phaserOn', phaserDepth: 'phaserOn', phaserFb: 'phaserOn', phaserMix: 'phaserOn',
  limiterThr: 'limiterOn', limiterRel: 'limiterOn',
  delayShimmer: 'delayOn',
};

export const FX_PARAM_LABELS: Record<FxModParam, string> = {
  filterFreq: 'Filter cutoff', filterQ: 'Filter Q', filterGain: 'Filter gain',
  filterVowel: 'Filter vowel', filterCombFb: 'Comb feedback',
  chorusRate: 'Chorus rate', chorusDepth: 'Chorus depth', chorusMix: 'Chorus mix',
  chorusFb: 'Chorus feedback',
  reverbMix: 'Reverb mix',
  delayTime: 'Delay time', delayFb: 'Delay feedback', delayMix: 'Delay mix',
  phaserRate: 'Phaser rate', phaserDepth: 'Phaser depth', phaserFb: 'Phaser feedback',
  phaserMix: 'Phaser mix',
  limiterThr: 'Limiter threshold', limiterRel: 'Limiter release',
  delayShimmer: 'Delay shimmer',
};

// Frequency-like FX fields are modulated/mutated in octaves.
export const FX_EXP_PARAMS: ReadonlySet<string> = new Set<string>([
  'filterFreq', 'chorusRate', 'delayTime', 'phaserRate',
]);

// Range of the one non-modulatable numeric FX field (mutable by evolution
// only at structural moves — an impulse rebuild is fine there).
export const REVERB_DECAY_RANGE: readonly [number, number] = [0.1, 8];

const FX_MOD_SET: ReadonlySet<string> = new Set<string>(FX_MOD_PARAMS);

export function isFxModParam(k: string): k is FxModParam {
  return FX_MOD_SET.has(k);
}

export function isFilterType(v: unknown): v is FilterType {
  return typeof v === 'string' && FILTER_TYPES.some((t) => t === v);
}

export function isChorusMode(v: unknown): v is ChorusMode {
  return v === 'chorus' || v === 'flanger';
}

/** Max formulas enabled at once — more than this turns into mush. */
export const MAX_ENABLED_FORMULAS = 5;
